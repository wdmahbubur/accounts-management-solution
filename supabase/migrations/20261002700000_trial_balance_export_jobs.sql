-- US-070: idempotent, private trial-balance export jobs.
BEGIN;

ALTER TABLE finance.export_jobs
  ADD COLUMN idempotency_key text,
  ADD COLUMN request_hash text,
  ADD COLUMN result_sha256 text,
  ADD COLUMN result_size bigint,
  ADD COLUMN completed_at timestamptz,
  ADD CONSTRAINT export_request_key_pair CHECK ((idempotency_key IS NULL)=(request_hash IS NULL)),
  ADD CONSTRAINT export_hash_format CHECK (request_hash IS NULL OR request_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT export_result_hash_format CHECK (result_sha256 IS NULL OR result_sha256 ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT export_result_size_valid CHECK (result_size IS NULL OR result_size BETWEEN 1 AND 10485760);
CREATE UNIQUE INDEX export_idempotency_idx ON finance.export_jobs(organization_id,requested_by_member_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE FUNCTION finance_private.guard_export_job_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' OR (NEW.organization_id,NEW.id,NEW.requested_by_member_id,NEW.export_type,NEW.parameters,
    NEW.ledger_cutoff_at,NEW.format,NEW.idempotency_key,NEW.request_hash,NEW.created_at)
    IS DISTINCT FROM (OLD.organization_id,OLD.id,OLD.requested_by_member_id,OLD.export_type,OLD.parameters,
    OLD.ledger_cutoff_at,OLD.format,OLD.idempotency_key,OLD.request_hash,OLD.created_at) THEN
    RAISE EXCEPTION 'export request parameters are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status IN ('completed','expired') AND (NEW.object_key,NEW.result_sha256,NEW.result_size,NEW.completed_at,NEW.expires_at)
    IS DISTINCT FROM (OLD.object_key,OLD.result_sha256,OLD.result_size,OLD.completed_at,OLD.expires_at) THEN
    RAISE EXCEPTION 'completed export output is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status='expired' OR
    NOT ((OLD.status='queued' AND NEW.status IN ('running','failed')) OR
      (OLD.status='running' AND NEW.status IN ('completed','failed','queued')) OR
      (OLD.status='completed' AND NEW.status='expired') OR
      (OLD.status='failed' AND NEW.status IN ('queued','running')) OR (OLD.status=NEW.status)) OR
    (NEW.status='completed' AND (NEW.object_key IS NULL OR NEW.result_sha256 IS NULL OR NEW.result_size IS NULL OR NEW.completed_at IS NULL OR NEW.expires_at IS NULL)) OR
    (NEW.status<>'completed' AND NEW.status NOT IN ('expired') AND (NEW.object_key IS NOT NULL OR NEW.result_sha256 IS NOT NULL OR NEW.result_size IS NOT NULL OR NEW.completed_at IS NOT NULL OR NEW.expires_at IS NOT NULL)) OR
    (NEW.error_code IS NOT NULL AND NEW.error_code !~ '^[A-Z][A-Z0-9_]{0,79}$') THEN
    RAISE EXCEPTION 'invalid export job state transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_export_job_update() FROM PUBLIC,anon,authenticated,service_role,ams_job_worker;
CREATE TRIGGER export_jobs_guard_update BEFORE UPDATE OR DELETE ON finance.export_jobs
  FOR EACH ROW EXECUTE FUNCTION finance_private.guard_export_job_update();
CREATE TRIGGER export_jobs_no_truncate BEFORE TRUNCATE ON finance.export_jobs
  FOR EACH STATEMENT EXECUTE FUNCTION finance_private.reject_audit_mutation();

CREATE FUNCTION public.request_trial_balance_export(
  p_organization_id uuid,p_as_of date,p_from date,p_format text,p_idempotency_key text,p_request_hash text
) RETURNS TABLE(export_job_id uuid,ledger_cutoff_at timestamptz,status text,replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid;v_id uuid;v_cutoff timestamptz;v_status text;v_existing_hash text;
BEGIN
  v_actor:=finance_private.require_capability(p_organization_id,'reports.export');
  PERFORM finance_private.require_capability(p_organization_id,'reports.read');
  PERFORM finance_private.require_capability(p_organization_id,'accounting.read');
  PERFORM finance_private.require_capability(p_organization_id,'ledger.read');
  PERFORM finance_private.require_capability(p_organization_id,'exports.read');
  IF p_as_of IS NULL OR (p_from IS NOT NULL AND p_from>p_as_of) OR p_format IS DISTINCT FROM 'csv' OR
    p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$' OR
    p_request_hash IS NULL OR p_request_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid export request' USING ERRCODE='22023';
  END IF;
  v_cutoff:=clock_timestamp();
  INSERT INTO finance.export_jobs(organization_id,requested_by_member_id,export_type,parameters,ledger_cutoff_at,format,idempotency_key,request_hash)
    VALUES(p_organization_id,v_actor,'trial_balance',jsonb_build_object('as_of',p_as_of,'from',p_from),v_cutoff,'csv',p_idempotency_key,p_request_hash)
    ON CONFLICT(organization_id,requested_by_member_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
    RETURNING id,status,ledger_cutoff_at INTO v_id,v_status,v_cutoff;
  IF v_id IS NULL THEN
    SELECT e.id,e.status,e.ledger_cutoff_at,e.request_hash INTO v_id,v_status,v_cutoff,v_existing_hash FROM finance.export_jobs e
      WHERE e.organization_id=p_organization_id AND e.requested_by_member_id=v_actor AND e.idempotency_key=p_idempotency_key FOR UPDATE;
    IF NOT FOUND OR v_existing_hash IS DISTINCT FROM p_request_hash THEN RAISE EXCEPTION 'export key reused with different filters' USING ERRCODE='23505'; END IF;
    RETURN QUERY SELECT v_id,v_cutoff,v_status,true; RETURN;
  END IF;
  PERFORM finance_private.enqueue_outbox_event(p_organization_id,'report.export_requested',NULL,'report.export:'||v_id::text,
    jsonb_build_object('export_job_id',v_id));
  RETURN QUERY SELECT v_id,v_cutoff,v_status,false;
END $$;
REVOKE ALL ON FUNCTION public.request_trial_balance_export(uuid,date,date,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_trial_balance_export(uuid,date,date,text,text,text) TO authenticated;

CREATE FUNCTION public.start_export_job(p_organization_id uuid,p_export_job_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_count integer;
BEGIN
  UPDATE finance.export_jobs SET status='running',error_code=NULL
    WHERE organization_id=p_organization_id AND id=p_export_job_id AND status IN ('queued','failed');
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count=1 THEN RETURN true; END IF;
  RETURN EXISTS(SELECT 1 FROM finance.export_jobs e WHERE e.organization_id=p_organization_id AND e.id=p_export_job_id AND e.status='running');
END $$;
REVOKE ALL ON FUNCTION public.start_export_job(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_export_job(uuid,uuid) TO service_role,ams_job_worker;

CREATE FUNCTION public.get_export_job_state(p_organization_id uuid,p_export_job_id uuid)
RETURNS TABLE(status text,object_key text,result_sha256 text,result_size bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  RETURN QUERY SELECT e.status,e.object_key,e.result_sha256,e.result_size FROM finance.export_jobs e
    WHERE e.organization_id=p_organization_id AND e.id=p_export_job_id AND e.export_type='trial_balance';
END $$;
REVOKE ALL ON FUNCTION public.get_export_job_state(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_export_job_state(uuid,uuid) TO service_role,ams_job_worker;

CREATE FUNCTION public.build_trial_balance_export(p_organization_id uuid,p_export_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_job finance.export_jobs%ROWTYPE;v_member finance.organization_members%ROWTYPE;v_org finance.organizations%ROWTYPE;v_data jsonb;
BEGIN
  SELECT * INTO v_job FROM finance.export_jobs e WHERE e.organization_id=p_organization_id AND e.id=p_export_job_id AND e.export_type='trial_balance' AND e.status IN ('queued','running');
  IF NOT FOUND THEN RAISE EXCEPTION 'export job unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_member FROM finance.organization_members m WHERE m.organization_id=p_organization_id AND m.id=v_job.requested_by_member_id AND m.status='active';
  IF NOT FOUND OR NOT finance_private.member_has_capability(p_organization_id,v_member.id,'reports.read') OR
    NOT finance_private.member_has_capability(p_organization_id,v_member.id,'reports.export') OR
    NOT finance_private.member_has_capability(p_organization_id,v_member.id,'accounting.read') OR
    NOT finance_private.member_has_capability(p_organization_id,v_member.id,'ledger.read') OR
    NOT finance_private.member_has_capability(p_organization_id,v_member.id,'exports.read') THEN
    RAISE EXCEPTION 'export permission was revoked' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_org FROM finance.organizations o WHERE o.id=p_organization_id AND o.status<>'archived';
  IF NOT FOUND THEN RAISE EXCEPTION 'export organization unavailable' USING ERRCODE='P0002'; END IF;
  IF v_job.format<>'csv' THEN RAISE EXCEPTION 'unsupported export format' USING ERRCODE='22023'; END IF;
  WITH balances AS (
    SELECT a.id,a.code,a.name,a.account_type,
      COALESCE(sum(l.debit-l.credit) FILTER(WHERE j.id IS NOT NULL AND (v_job.parameters->>'from') IS NOT NULL AND j.accounting_date<(v_job.parameters->>'from')::date),0)::finance.amount AS opening,
      COALESCE(sum(l.debit) FILTER(WHERE j.id IS NOT NULL AND ((v_job.parameters->>'from') IS NULL OR j.accounting_date>=(v_job.parameters->>'from')::date) AND j.accounting_date<=(v_job.parameters->>'as_of')::date),0)::finance.amount AS movement_debit,
      COALESCE(sum(l.credit) FILTER(WHERE j.id IS NOT NULL AND ((v_job.parameters->>'from') IS NULL OR j.accounting_date>=(v_job.parameters->>'from')::date) AND j.accounting_date<=(v_job.parameters->>'as_of')::date),0)::finance.amount AS movement_credit,
      COALESCE(sum(l.debit-l.credit) FILTER(WHERE j.id IS NOT NULL),0)::finance.amount AS closing
    FROM finance.accounts a LEFT JOIN finance.journal_lines l ON l.organization_id=a.organization_id AND l.account_id=a.id
    LEFT JOIN finance.journal_entries j ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id AND j.state='posted'
      AND j.accounting_date<=(v_job.parameters->>'as_of')::date AND j.posted_at<=v_job.ledger_cutoff_at
    WHERE a.organization_id=p_organization_id AND (a.is_active OR j.id IS NOT NULL) GROUP BY a.id,a.code,a.name,a.account_type
  ), nonzero AS (SELECT * FROM balances WHERE opening<>0 OR movement_debit<>0 OR movement_credit<>0 OR closing<>0)
  SELECT jsonb_build_object('company',v_org.name,'as_of',v_job.parameters->>'as_of','from_date',v_job.parameters->>'from',
    'generated_at',v_job.ledger_cutoff_at,'currency','BDT','accounts',COALESCE(jsonb_agg(jsonb_build_object(
      'code',code,'name',name,'account_type',account_type,'opening_debit',greatest(opening,0)::text,
      'opening_credit',greatest(-opening,0)::text,'movement_debit',movement_debit::text,'movement_credit',movement_credit::text,
      'closing_debit',greatest(closing,0)::text,'closing_credit',greatest(-closing,0)::text) ORDER BY code),'[]'::jsonb),
    'total_debit',COALESCE(sum(greatest(closing,0)),0)::finance.amount::text,'total_credit',COALESCE(sum(greatest(-closing,0)),0)::finance.amount::text)
  INTO v_data FROM nonzero;
  RETURN v_data;
END $$;
REVOKE ALL ON FUNCTION public.build_trial_balance_export(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.build_trial_balance_export(uuid,uuid) TO service_role,ams_job_worker;

CREATE FUNCTION public.complete_export_job(p_organization_id uuid,p_export_job_id uuid,p_object_key text,p_sha256 text,p_byte_size bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_count integer;
BEGIN
  IF p_organization_id IS NULL OR p_export_job_id IS NULL OR p_object_key IS DISTINCT FROM p_organization_id||'/exports/'||p_export_job_id OR
    p_sha256 IS NULL OR p_sha256 !~ '^[a-f0-9]{64}$' OR p_byte_size NOT BETWEEN 1 AND 10485760 THEN
    RAISE EXCEPTION 'invalid export result' USING ERRCODE='22023';
  END IF;
  UPDATE finance.export_jobs AS job SET status='completed',object_key=p_object_key,result_sha256=p_sha256,result_size=p_byte_size,
    completed_at=clock_timestamp(),expires_at=clock_timestamp()+interval '24 hours',error_code=NULL
  WHERE organization_id=p_organization_id AND id=p_export_job_id AND status='running' AND format='csv'
    AND EXISTS(SELECT 1 FROM finance.organization_members m WHERE m.organization_id=p_organization_id AND m.id=job.requested_by_member_id AND m.status='active'
      AND finance_private.member_has_capability(p_organization_id,m.id,'reports.read')
      AND finance_private.member_has_capability(p_organization_id,m.id,'reports.export')
      AND finance_private.member_has_capability(p_organization_id,m.id,'accounting.read')
      AND finance_private.member_has_capability(p_organization_id,m.id,'ledger.read')
      AND finance_private.member_has_capability(p_organization_id,m.id,'exports.read'));
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>1 THEN
    IF EXISTS(SELECT 1 FROM finance.export_jobs e WHERE e.organization_id=p_organization_id AND e.id=p_export_job_id
      AND e.status='completed' AND e.object_key=p_object_key AND e.result_sha256=p_sha256) THEN RETURN true; END IF;
    RAISE EXCEPTION 'export job cannot be completed' USING ERRCODE='55P03';
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.complete_export_job(uuid,uuid,text,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_export_job(uuid,uuid,text,text,bigint) TO service_role,ams_job_worker;

CREATE FUNCTION public.fail_export_job(p_organization_id uuid,p_export_job_id uuid,p_error_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_error_code IS NULL OR p_error_code !~ '^[A-Z][A-Z0-9_]{0,79}$' THEN RAISE EXCEPTION 'invalid export error code' USING ERRCODE='22023'; END IF;
  UPDATE finance.export_jobs SET status='failed',error_code=p_error_code
    WHERE organization_id=p_organization_id AND id=p_export_job_id AND status IN ('queued','running');
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.fail_export_job(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fail_export_job(uuid,uuid,text) TO service_role,ams_job_worker;

CREATE OR REPLACE FUNCTION public.authorize_artifact_download(p_organization_id uuid,p_kind text,p_artifact_id uuid)
RETURNS TABLE(object_key text,download_filename text,expected_size bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_key text:=p_organization_id||'/'||p_kind||'/'||p_artifact_id;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='28000'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('attachments','exports') OR NOT finance_private.can_download_artifact(v_key) THEN
    RAISE EXCEPTION 'artifact unavailable' USING ERRCODE='P0002';
  END IF;
  IF p_kind='attachments' THEN
    RETURN QUERY SELECT a.object_key,a.original_filename,a.byte_size FROM finance.attachments a
      WHERE a.organization_id=p_organization_id AND a.id=p_artifact_id;
  ELSE
    RETURN QUERY SELECT e.object_key,'export-'||e.id||'.'||e.format,e.result_size FROM finance.export_jobs e
      WHERE e.organization_id=p_organization_id AND e.id=p_artifact_id AND e.status='completed';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.authorize_artifact_download(uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.authorize_artifact_download(uuid,text,uuid) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
