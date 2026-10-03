-- US-070 export worker: bounded leases, requester ownership and a fixed ledger cutoff.
ALTER TABLE finance.export_jobs ADD COLUMN lease_token uuid;
ALTER TABLE finance.export_jobs ADD COLUMN lease_until timestamptz;
ALTER TABLE finance.export_jobs ADD COLUMN attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5);
ALTER TABLE finance.export_jobs ADD COLUMN output_size bigint CHECK (output_size BETWEEN 1 AND 10485760);
ALTER TABLE finance.export_jobs ADD COLUMN output_sha256 text CHECK (output_sha256 IS NULL OR output_sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE finance.export_jobs ADD COLUMN generated_at timestamptz;
ALTER TABLE finance.export_jobs ADD COLUMN available_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE finance.export_jobs ADD COLUMN company_name_snapshot text;
ALTER TABLE finance.export_jobs ADD COLUMN snapshot_data jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(snapshot_data)='array');
UPDATE finance.export_jobs e SET company_name_snapshot=o.name FROM finance.organizations o
 WHERE o.id=e.organization_id AND e.company_name_snapshot IS NULL;
ALTER TABLE finance.export_jobs ALTER COLUMN company_name_snapshot SET NOT NULL;
UPDATE finance.export_jobs SET status='failed',error_code='EXPORT_SNAPSHOT_UNAVAILABLE'
 WHERE status IN ('queued','running') AND export_type='trial_balance' AND snapshot_data='[]'::jsonb;

CREATE FUNCTION finance_private.snapshot_export_company_name() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_as_of date;
BEGIN
 IF NEW.company_name_snapshot IS NULL THEN
  SELECT o.name INTO NEW.company_name_snapshot FROM finance.organizations o WHERE o.id=NEW.organization_id;
 END IF;
 IF NEW.export_type='trial_balance' AND NEW.format='csv' THEN
  IF jsonb_typeof(NEW.parameters) IS DISTINCT FROM 'object' OR
     COALESCE(NEW.parameters->>'as_of','') !~ '^\d{4}-\d{2}-\d{2}$' THEN
   RAISE EXCEPTION 'invalid saved export filters' USING ERRCODE='22023'; END IF;
  v_as_of:=(NEW.parameters->>'as_of')::date;
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.account_code),'[]'::jsonb) INTO NEW.snapshot_data
    FROM public.read_trial_balance(NEW.organization_id,v_as_of,NULL) t;
  IF octet_length(NEW.snapshot_data::text)>8000000 THEN
   RAISE EXCEPTION 'trial balance exceeds export capacity' USING ERRCODE='22023'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.snapshot_export_company_name() FROM PUBLIC,ams_runtime,ams_job_worker;
CREATE TRIGGER export_jobs_company_name_snapshot BEFORE INSERT ON finance.export_jobs
 FOR EACH ROW EXECUTE FUNCTION finance_private.snapshot_export_company_name();

CREATE FUNCTION finance_private.export_requester_authorized(p_org uuid,p_member uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT finance_private.member_has_capability(p_org,p_member,'exports.read')
    AND finance_private.member_has_capability(p_org,p_member,'reports.export')
    AND finance_private.member_has_capability(p_org,p_member,'reports.read')
    AND finance_private.member_has_capability(p_org,p_member,'accounting.read')
    AND finance_private.member_has_capability(p_org,p_member,'ledger.read')
$$;
REVOKE ALL ON FUNCTION finance_private.export_requester_authorized(uuid,uuid) FROM PUBLIC,ams_runtime,ams_job_worker;

CREATE FUNCTION finance_private.claim_trial_balance_exports(p_limit integer DEFAULT 3,p_lease_seconds integer DEFAULT 600)
RETURNS TABLE(job_id uuid,organization_id uuid,requester_member_id uuid,company_name text,parameters jsonb,
  ledger_cutoff_at timestamptz,created_at timestamptz,lease_token uuid,attempt_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_now timestamptz:=clock_timestamp();
BEGIN
 IF p_limit NOT BETWEEN 1 AND 10 OR p_lease_seconds NOT BETWEEN 60 AND 1800 THEN
   RAISE EXCEPTION 'invalid export worker claim' USING ERRCODE='22023'; END IF;
 -- Expired delivery links become inaccessible immediately; clean up jobs whose requester lost access.
 UPDATE finance.export_jobs e SET status='expired',lease_token=NULL,lease_until=NULL
  WHERE e.status='completed' AND e.expires_at<=v_now;
 UPDATE finance.export_jobs e SET status='failed',lease_token=NULL,lease_until=NULL,error_code='REQUESTER_ACCESS_REVOKED'
  WHERE e.status IN ('queued','running') AND e.export_type='trial_balance' AND NOT EXISTS(
   SELECT 1 FROM finance.organizations o JOIN finance.organization_members m ON m.organization_id=o.id
    WHERE o.id=e.organization_id AND o.status<>'archived' AND m.id=e.requested_by_member_id AND m.status='active'
     AND finance_private.export_requester_authorized(e.organization_id,m.id));
 UPDATE finance.export_jobs e SET status='failed',lease_token=NULL,lease_until=NULL,error_code='EXPORT_RETRY_LIMIT'
  WHERE e.status='running' AND e.lease_until<=v_now AND e.attempt_count>=5;
 RETURN QUERY WITH ready AS (
   SELECT e.organization_id,e.id FROM finance.export_jobs e JOIN finance.organizations o ON o.id=e.organization_id
    JOIN finance.organization_members m ON m.organization_id=e.organization_id AND m.id=e.requested_by_member_id
    WHERE e.export_type='trial_balance' AND e.format='csv' AND e.attempt_count<5
      AND o.status<>'archived' AND m.status='active'
      AND finance_private.export_requester_authorized(e.organization_id,m.id)
      AND e.available_at<=v_now AND (e.status='queued' OR (e.status='running' AND e.lease_until<=v_now))
    ORDER BY e.created_at,e.id FOR UPDATE OF e SKIP LOCKED LIMIT p_limit
 ), claimed AS (
   UPDATE finance.export_jobs e SET status='running',attempt_count=e.attempt_count+1,
     lease_token=gen_random_uuid(),lease_until=v_now+make_interval(secs=>p_lease_seconds),error_code=NULL
    FROM ready r WHERE e.organization_id=r.organization_id AND e.id=r.id
     RETURNING e.id,e.organization_id,e.requested_by_member_id,e.company_name_snapshot,e.parameters,e.ledger_cutoff_at,e.created_at,e.lease_token,e.attempt_count
 ) SELECT c.id,c.organization_id,c.requested_by_member_id,c.company_name_snapshot,c.parameters,c.ledger_cutoff_at,c.created_at,c.lease_token,c.attempt_count
    FROM claimed c;
END $$;
REVOKE ALL ON FUNCTION finance_private.claim_trial_balance_exports(integer,integer) FROM PUBLIC,ams_runtime,ams_job_worker;

CREATE FUNCTION finance_private.read_trial_balance_export(p_job_id uuid,p_lease_token uuid)
RETURNS TABLE(company_name text,currency char(3),as_of date,ledger_cutoff_at timestamptz,generated_at timestamptz,
  account_code text,account_name text,account_type text,opening_balance text,movement_debit text,movement_credit text,closing_debit text,closing_credit text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_job finance.export_jobs%ROWTYPE; v_as_of date;
BEGIN
 SELECT * INTO v_job FROM finance.export_jobs e WHERE e.id=p_job_id FOR SHARE;
 IF NOT FOUND OR v_job.export_type<>'trial_balance' OR v_job.format<>'csv' OR v_job.status<>'running'
   OR v_job.lease_token IS DISTINCT FROM p_lease_token OR v_job.lease_until<=clock_timestamp()
   OR NOT finance_private.export_requester_authorized(v_job.organization_id,v_job.requested_by_member_id)
   OR NOT EXISTS(SELECT 1 FROM finance.organization_members m JOIN finance.organizations o ON o.id=m.organization_id
      WHERE m.organization_id=v_job.organization_id AND m.id=v_job.requested_by_member_id AND m.status='active' AND o.status<>'archived') THEN
   RAISE EXCEPTION 'export lease unavailable' USING ERRCODE='40001'; END IF;
 IF jsonb_typeof(v_job.parameters) IS DISTINCT FROM 'object' OR
    COALESCE(v_job.parameters->>'as_of','') !~ '^\d{4}-\d{2}-\d{2}$' THEN
   RAISE EXCEPTION 'invalid saved export filters' USING ERRCODE='22023'; END IF;
 v_as_of:=(v_job.parameters->>'as_of')::date;
 RETURN QUERY SELECT v_job.company_name_snapshot,o.base_currency,v_as_of,v_job.ledger_cutoff_at,v_job.ledger_cutoff_at,
   t.account_code,t.account_name,t.account_type,t.opening_balance,t.movement_debit,t.movement_credit,t.closing_debit,t.closing_credit
   FROM jsonb_to_recordset(v_job.snapshot_data) AS t(account_code text,account_name text,account_type text,
      opening_balance text,movement_debit text,movement_credit text,closing_debit text,closing_credit text)
   CROSS JOIN finance.organizations o WHERE o.id=v_job.organization_id ORDER BY t.account_code;
END $$;
REVOKE ALL ON FUNCTION finance_private.read_trial_balance_export(uuid,uuid) FROM PUBLIC,ams_runtime,ams_job_worker;

CREATE FUNCTION finance_private.complete_trial_balance_export(p_job_id uuid,p_lease_token uuid,p_byte_size bigint,p_sha256 text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_job finance.export_jobs%ROWTYPE;
BEGIN
 SELECT * INTO v_job FROM finance.export_jobs e WHERE e.id=p_job_id FOR UPDATE;
 IF NOT FOUND OR v_job.status<>'running' OR v_job.lease_token IS DISTINCT FROM p_lease_token OR v_job.lease_until<=clock_timestamp() THEN
   RAISE EXCEPTION 'export lease unavailable' USING ERRCODE='40001'; END IF;
 IF p_byte_size IS NULL OR p_byte_size NOT BETWEEN 1 AND 10485760 OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN
   RAISE EXCEPTION 'invalid export output' USING ERRCODE='22023'; END IF;
 IF NOT finance_private.export_requester_authorized(v_job.organization_id,v_job.requested_by_member_id)
   OR NOT EXISTS(SELECT 1 FROM finance.organization_members m JOIN finance.organizations o ON o.id=m.organization_id
      WHERE m.organization_id=v_job.organization_id AND m.id=v_job.requested_by_member_id AND m.status='active' AND o.status<>'archived') THEN
   UPDATE finance.export_jobs SET status='failed',error_code='REQUESTER_ACCESS_REVOKED',lease_token=NULL,lease_until=NULL WHERE id=v_job.id;
   RETURN false;
 END IF;
 UPDATE finance.export_jobs SET status='completed',object_key=organization_id||'/exports/'||id,
   output_size=p_byte_size,output_sha256=p_sha256,generated_at=v_job.ledger_cutoff_at,
   expires_at=clock_timestamp()+interval '24 hours',error_code=NULL,lease_token=NULL,lease_until=NULL
   WHERE organization_id=v_job.organization_id AND id=v_job.id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION finance_private.complete_trial_balance_export(uuid,uuid,bigint,text) FROM PUBLIC,ams_runtime,ams_job_worker;

CREATE FUNCTION finance_private.fail_trial_balance_export(p_job_id uuid,p_lease_token uuid,p_error_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_job finance.export_jobs%ROWTYPE; v_delay integer;
BEGIN
 IF p_error_code IS NULL OR p_error_code !~ '^[A-Z][A-Z0-9_]{2,63}$' THEN RAISE EXCEPTION 'invalid export error code' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_job FROM finance.export_jobs e WHERE e.id=p_job_id FOR UPDATE;
 IF NOT FOUND OR v_job.status<>'running' OR v_job.lease_token IS DISTINCT FROM p_lease_token OR v_job.lease_until<=clock_timestamp() THEN
   RAISE EXCEPTION 'export lease unavailable' USING ERRCODE='40001'; END IF;
 v_delay:=LEAST(1800,15*(2^LEAST(v_job.attempt_count-1,7))::integer);
 UPDATE finance.export_jobs SET status=CASE WHEN v_job.attempt_count>=5 THEN 'failed' ELSE 'queued' END,
   available_at=clock_timestamp()+make_interval(secs=>v_delay),error_code=p_error_code,
   lease_token=NULL,lease_until=NULL WHERE id=v_job.id AND organization_id=v_job.organization_id;
END $$;
REVOKE ALL ON FUNCTION finance_private.fail_trial_balance_export(uuid,uuid,text) FROM PUBLIC,ams_runtime,ams_job_worker;

-- Export metadata/download requests remain requester-owned and permission checked.
CREATE OR REPLACE FUNCTION finance_private.can_download_artifact(p_object_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT identity.current_actor_id() IS NOT NULL AND (
  EXISTS(SELECT 1 FROM finance.attachments a JOIN finance.organizations o ON o.id=a.organization_id
   WHERE a.object_key=p_object_key AND a.object_key=a.organization_id||'/attachments/'||a.id AND o.status<>'archived'
    AND a.scan_status='clean' AND a.byte_size BETWEEN 1 AND 10485760 AND finance_private.has_permission(a.organization_id,'attachments.read')
    AND NOT EXISTS(SELECT 1 FROM finance.attachment_links l WHERE l.organization_id=a.organization_id AND l.attachment_id=a.id
      AND NOT finance_private.can_read_document(l.organization_id,l.document_id))
    AND (EXISTS(SELECT 1 FROM finance.attachment_links l WHERE l.organization_id=a.organization_id AND l.attachment_id=a.id)
      OR (finance_private.has_permission(a.organization_id,'attachments.write') AND EXISTS(
       SELECT 1 FROM finance.organization_members m WHERE m.organization_id=a.organization_id AND m.id=a.uploaded_by_member_id
        AND m.user_id=identity.current_actor_id() AND m.status='active'))))
  OR EXISTS(SELECT 1 FROM finance.export_jobs e JOIN finance.organizations o ON o.id=e.organization_id
    JOIN finance.organization_members m ON m.organization_id=e.organization_id AND m.id=e.requested_by_member_id
    WHERE e.object_key=p_object_key AND e.object_key=e.organization_id||'/exports/'||e.id AND e.output_size BETWEEN 1 AND 10485760
     AND e.output_sha256 IS NOT NULL AND m.user_id=identity.current_actor_id() AND m.status='active' AND o.status<>'archived'
     AND e.status='completed' AND e.expires_at>now() AND e.export_type='trial_balance'
     AND finance_private.export_requester_authorized(e.organization_id,e.requested_by_member_id))
 )
$$;
REVOKE ALL ON FUNCTION finance_private.can_download_artifact(text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION finance_private.can_download_artifact(text) TO ams_runtime;

CREATE OR REPLACE FUNCTION public.authorize_artifact_download(p_organization_id uuid,p_kind text,p_artifact_id uuid)
RETURNS TABLE(object_key text,download_filename text,expected_size bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_key text:=p_organization_id||'/'||p_kind||'/'||p_artifact_id;
BEGIN
 IF identity.current_actor_id() IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='28000'; END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('attachments','exports') OR NOT finance_private.can_download_artifact(v_key) THEN
  RAISE EXCEPTION 'artifact unavailable' USING ERRCODE='P0002'; END IF;
 IF p_kind='attachments' THEN
  RETURN QUERY SELECT a.object_key,a.original_filename,a.byte_size FROM finance.attachments a
   WHERE a.organization_id=p_organization_id AND a.id=p_artifact_id;
 ELSE
  RETURN QUERY SELECT e.object_key,'export-'||e.id||'.'||e.format,e.output_size FROM finance.export_jobs e
   WHERE e.organization_id=p_organization_id AND e.id=p_artifact_id;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.authorize_artifact_download(uuid,text,uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.authorize_artifact_download(uuid,text,uuid) TO ams_runtime;

GRANT USAGE ON SCHEMA finance_private TO ams_runtime;
GRANT EXECUTE ON FUNCTION finance_private.claim_trial_balance_exports(integer,integer) TO ams_runtime;
GRANT EXECUTE ON FUNCTION finance_private.read_trial_balance_export(uuid,uuid) TO ams_runtime;
GRANT EXECUTE ON FUNCTION finance_private.complete_trial_balance_export(uuid,uuid,bigint,text) TO ams_runtime;
GRANT EXECUTE ON FUNCTION finance_private.fail_trial_balance_export(uuid,uuid,text) TO ams_runtime;
NOTIFY pgrst,'reload schema';
