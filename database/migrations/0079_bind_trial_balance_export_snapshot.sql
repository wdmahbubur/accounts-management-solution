-- Bind trial-balance CSV exports to the exact report snapshot returned to the
-- requesting member. The former request RPC captured a fresh ledger read when
-- inserting the job, which could differ from the rows already shown on screen.

DROP FUNCTION public.request_trial_balance_export(uuid,text,text,text,date,text);

CREATE FUNCTION public.request_trial_balance_export(
  p_organization_id uuid,
  p_request_id text,
  p_idempotency_key text,
  p_request_hash text,
  p_as_of date,
  p_from date,
  p_snapshot_id uuid,
  p_format text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_user uuid;
  v_member uuid;
  v_job finance.export_jobs%ROWTYPE;
  v_existing finance.idempotency_requests%ROWTYPE;
  v_snapshot finance.report_export_snapshots%ROWTYPE;
  v_result jsonb;
  v_filters jsonb;
  v_bound_hash text;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  v_user:=identity.current_actor_id();
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='28000'; END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{22,172}$'
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_as_of IS NULL OR NOT isfinite(p_as_of)
     OR (p_from IS NOT NULL AND NOT isfinite(p_from))
     OR p_snapshot_id IS NULL OR p_format IS DISTINCT FROM 'csv' THEN
    RAISE EXCEPTION 'invalid export request' USING ERRCODE='22023';
  END IF;
  IF NOT finance_private.has_permission(p_organization_id,'reports.export')
     OR NOT finance_private.has_permission(p_organization_id,'exports.read')
     OR NOT finance_private.has_permission(p_organization_id,'reports.read')
     OR NOT finance_private.has_permission(p_organization_id,'accounting.read')
     OR NOT finance_private.has_permission(p_organization_id,'ledger.read') THEN
    RAISE EXCEPTION 'export permission required' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM finance.organizations o WHERE o.id=p_organization_id AND o.status<>'archived') THEN
    RAISE EXCEPTION 'company unavailable' USING ERRCODE='P0002';
  END IF;
  SELECT m.id INTO v_member FROM finance.organization_members m
   WHERE m.organization_id=p_organization_id AND m.user_id=v_user AND m.status='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'company unavailable' USING ERRCODE='P0002'; END IF;

  v_filters:=jsonb_build_object('as_of',p_as_of::text);
  IF p_from IS NOT NULL THEN v_filters:=v_filters||jsonb_build_object('from',p_from::text); END IF;
  SELECT s.* INTO v_snapshot FROM finance.report_export_snapshots s
   WHERE s.organization_id=p_organization_id AND s.id=p_snapshot_id FOR SHARE;
  IF NOT FOUND OR v_snapshot.created_by_member_id IS DISTINCT FROM v_member
     OR v_snapshot.report_type IS DISTINCT FROM 'trial_balance'
     OR v_snapshot.filters IS DISTINCT FROM v_filters
     OR v_snapshot.expires_at<=clock_timestamp() OR v_snapshot.revoked_at IS NOT NULL
     OR jsonb_typeof(v_snapshot.payload->'data') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'report export snapshot unavailable or mismatched' USING ERRCODE='22023';
  END IF;

  -- The idempotency fingerprint includes the immutable snapshot binding even
  -- when a caller accidentally reuses its request hash for a changed snapshot.
  v_bound_hash:=encode(sha256(convert_to(p_request_hash||':'||v_filters::text||':'||p_snapshot_id::text,'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':export.trial-balance:'||p_idempotency_key,0));
  SELECT * INTO v_existing FROM finance.idempotency_requests i
   WHERE i.organization_id=p_organization_id AND i.operation='export.trial-balance'
     AND i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.actor_member_id IS DISTINCT FROM v_member OR v_existing.request_hash<>v_bound_hash THEN
      RAISE EXCEPTION 'idempotency conflict' USING ERRCODE='23505';
    END IF;
    RETURN v_existing.response_body||jsonb_build_object('replayed',true);
  END IF;

  INSERT INTO finance.export_jobs(organization_id,requested_by_member_id,export_type,parameters,ledger_cutoff_at,format,status)
   VALUES(p_organization_id,v_member,'trial_balance',
     jsonb_build_object('as_of',p_as_of::text,'export_snapshot_id',p_snapshot_id::text)
       ||CASE WHEN p_from IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('from',p_from::text) END,
     v_snapshot.ledger_cutoff_at,'csv','queued') RETURNING * INTO v_job;
  v_result:=jsonb_build_object('id',v_job.id,'organization_id',v_job.organization_id,'export_type',v_job.export_type,
    'parameters',v_job.parameters,'ledger_cutoff_at',v_job.ledger_cutoff_at,'format',v_job.format,'status',v_job.status,
    'created_at',v_job.created_at,'replayed',false);
  INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body)
   VALUES(p_organization_id,'export.trial-balance',p_idempotency_key,v_bound_hash,v_member,202,v_result);
  PERFORM finance_private.write_role_audit(p_organization_id,v_member,'report.export_requested','export_job',v_job.id,p_request_id,
    jsonb_build_object('export_type','trial_balance','format','csv','filters',v_filters,
      'export_snapshot_id',p_snapshot_id,'ledger_cutoff_at',v_job.ledger_cutoff_at));
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.request_trial_balance_export(uuid,text,text,text,date,date,uuid,text) FROM PUBLIC,ams_runtime,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.request_trial_balance_export(uuid,text,text,text,date,date,uuid,text) TO ams_runtime;

-- Keep the report-export behavior introduced in 0078. Trial balance stores the
-- snapshot's data array directly because read_trial_balance_export consumes a
-- JSON recordset; other report workers consume a one-element envelope array.
CREATE OR REPLACE FUNCTION finance_private.snapshot_export_company_name() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_snapshot finance.report_export_snapshots%ROWTYPE;
  v_snapshot_id uuid;
BEGIN
  IF NEW.company_name_snapshot IS NULL THEN
    SELECT o.name INTO NEW.company_name_snapshot FROM finance.organizations o WHERE o.id=NEW.organization_id;
  END IF;
  IF NEW.export_type='trial_balance' AND NEW.format='csv' THEN
    IF jsonb_typeof(NEW.parameters) IS DISTINCT FROM 'object'
       OR COALESCE(NEW.parameters->>'as_of','') !~ '^\d{4}-\d{2}-\d{2}$'
       OR COALESCE(NEW.parameters->>'export_snapshot_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR EXISTS(SELECT 1 FROM jsonb_object_keys(NEW.parameters) k WHERE k NOT IN ('as_of','from','export_snapshot_id'))
       OR (NEW.parameters ? 'from' AND COALESCE(NEW.parameters->>'from','') !~ '^\d{4}-\d{2}-\d{2}$') THEN
      RAISE EXCEPTION 'invalid saved export filters' USING ERRCODE='22023';
    END IF;
    v_snapshot_id:=(NEW.parameters->>'export_snapshot_id')::uuid;
    SELECT s.* INTO v_snapshot FROM finance.report_export_snapshots s
     WHERE s.organization_id=NEW.organization_id AND s.id=v_snapshot_id FOR SHARE;
    IF NOT FOUND OR v_snapshot.created_by_member_id IS DISTINCT FROM NEW.requested_by_member_id
       OR v_snapshot.report_type IS DISTINCT FROM 'trial_balance'
       OR v_snapshot.filters IS DISTINCT FROM (NEW.parameters-'export_snapshot_id')
       OR v_snapshot.expires_at<=clock_timestamp() OR v_snapshot.revoked_at IS NOT NULL
       OR jsonb_typeof(v_snapshot.payload->'data') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'report export snapshot unavailable or mismatched' USING ERRCODE='22023';
    END IF;
    NEW.ledger_cutoff_at:=v_snapshot.ledger_cutoff_at;
    NEW.snapshot_data:=v_snapshot.payload->'data';
  ELSIF NEW.export_type IN ('profit_and_loss','balance_sheet','customer_statement','vendor_statement')
     AND NEW.format IN ('csv','pdf','xlsx') THEN
    IF jsonb_typeof(NEW.parameters) IS DISTINCT FROM 'object'
       OR COALESCE(NEW.parameters->>'export_snapshot_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'report export snapshot required' USING ERRCODE='22023';
    END IF;
    v_snapshot_id:=(NEW.parameters->>'export_snapshot_id')::uuid;
    SELECT s.* INTO v_snapshot FROM finance.report_export_snapshots s
     WHERE s.organization_id=NEW.organization_id AND s.id=v_snapshot_id FOR SHARE;
    IF NOT FOUND OR v_snapshot.created_by_member_id IS DISTINCT FROM NEW.requested_by_member_id
       OR v_snapshot.report_type IS DISTINCT FROM NEW.export_type
       OR v_snapshot.filters IS DISTINCT FROM (NEW.parameters-'export_snapshot_id')
       OR v_snapshot.expires_at<=clock_timestamp() OR v_snapshot.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'report export snapshot unavailable or mismatched' USING ERRCODE='22023';
    END IF;
    NEW.ledger_cutoff_at:=v_snapshot.ledger_cutoff_at;
    NEW.snapshot_data:=jsonb_build_array(v_snapshot.payload||jsonb_build_object('export_format',NEW.format));
  END IF;
  IF octet_length(NEW.snapshot_data::text)>8000000 THEN
    RAISE EXCEPTION 'report exceeds export capacity' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.snapshot_export_company_name() FROM PUBLIC,ams_runtime,ams_job_worker;

NOTIFY pgrst,'reload schema';
