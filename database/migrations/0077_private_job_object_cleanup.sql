-- US-070: expire private exports and retry deletion of expired/abandoned files.
ALTER TABLE finance.export_jobs
  ADD COLUMN object_cleanup_lease_token uuid,
  ADD COLUMN object_cleanup_lease_until timestamptz,
  ADD COLUMN object_cleanup_attempt_count integer NOT NULL DEFAULT 0 CHECK (object_cleanup_attempt_count BETWEEN 0 AND 8),
  ADD COLUMN object_cleanup_available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN object_cleanup_at timestamptz,
  ADD COLUMN object_cleanup_error_code text;

CREATE FUNCTION finance_private.claim_expired_export_cleanup(p_limit integer DEFAULT 10,p_lease_seconds integer DEFAULT 600)
RETURNS TABLE(job_id uuid,organization_id uuid,object_key text,lease_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_now timestamptz:=clock_timestamp();
BEGIN
  IF p_limit NOT BETWEEN 1 AND 25 OR p_lease_seconds NOT BETWEEN 60 AND 1800 THEN
    RAISE EXCEPTION 'invalid export cleanup claim' USING ERRCODE='22023'; END IF;
  UPDATE finance.export_jobs e SET status='expired',lease_token=NULL,lease_until=NULL
    WHERE e.status='completed' AND e.expires_at<=v_now;
  RETURN QUERY WITH ready AS (
    SELECT e.organization_id,e.id FROM finance.export_jobs e
    WHERE e.status IN ('expired','failed') AND e.object_key=e.organization_id||'/exports/'||e.id AND e.object_cleanup_at IS NULL
      AND e.object_cleanup_attempt_count<8 AND e.object_cleanup_available_at<=v_now
      AND (e.object_cleanup_lease_until IS NULL OR e.object_cleanup_lease_until<=v_now)
    ORDER BY COALESCE(e.expires_at,e.created_at),e.id FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), claimed AS (
    UPDATE finance.export_jobs e SET object_cleanup_attempt_count=e.object_cleanup_attempt_count+1,
      object_cleanup_lease_token=gen_random_uuid(),object_cleanup_lease_until=v_now+make_interval(secs=>p_lease_seconds),
      object_cleanup_error_code=NULL FROM ready r
    WHERE e.organization_id=r.organization_id AND e.id=r.id
    RETURNING e.id,e.organization_id,e.object_key,e.object_cleanup_lease_token
  ) SELECT c.id,c.organization_id,c.object_key,c.object_cleanup_lease_token FROM claimed c;
END $$;
REVOKE ALL ON FUNCTION finance_private.claim_expired_export_cleanup(integer,integer) FROM PUBLIC,ams_runtime,ams_job_worker;

CREATE FUNCTION finance_private.complete_expired_export_cleanup(p_organization_id uuid,p_job_id uuid,p_lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE finance.export_jobs SET object_key=NULL,object_cleanup_at=clock_timestamp(),object_cleanup_lease_token=NULL,
    object_cleanup_lease_until=NULL,object_cleanup_error_code=NULL
  WHERE organization_id=p_organization_id AND id=p_job_id AND status IN ('expired','failed') AND object_cleanup_lease_token=p_lease_token
    AND object_cleanup_lease_until>clock_timestamp() AND object_cleanup_at IS NULL;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION finance_private.complete_expired_export_cleanup(uuid,uuid,uuid) FROM PUBLIC,ams_runtime,ams_job_worker;

CREATE FUNCTION finance_private.fail_expired_export_cleanup(p_organization_id uuid,p_job_id uuid,p_lease_token uuid,p_error_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_job finance.export_jobs%ROWTYPE;v_delay integer;
BEGIN
  IF p_error_code IS NULL OR p_error_code !~ '^[A-Z][A-Z0-9_]{2,63}$' THEN
    RAISE EXCEPTION 'invalid cleanup error code' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_job FROM finance.export_jobs e WHERE e.organization_id=p_organization_id AND e.id=p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.status NOT IN ('expired','failed') OR v_job.object_cleanup_at IS NOT NULL OR
    v_job.object_cleanup_lease_token IS DISTINCT FROM p_lease_token OR v_job.object_cleanup_lease_until<=clock_timestamp() THEN
    RAISE EXCEPTION 'export cleanup lease unavailable' USING ERRCODE='40001'; END IF;
  v_delay:=LEAST(43200,60*(2^LEAST(v_job.object_cleanup_attempt_count-1,9))::integer);
  UPDATE finance.export_jobs SET object_cleanup_available_at=clock_timestamp()+make_interval(secs=>v_delay),
    object_cleanup_lease_token=NULL,object_cleanup_lease_until=NULL,object_cleanup_error_code=p_error_code
  WHERE organization_id=v_job.organization_id AND id=v_job.id;
END $$;
REVOKE ALL ON FUNCTION finance_private.fail_expired_export_cleanup(uuid,uuid,uuid,text) FROM PUBLIC,ams_runtime,ams_job_worker;

CREATE FUNCTION finance_private.record_report_export_object(p_organization_id uuid,p_job_id uuid,p_lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE finance.export_jobs SET object_key=organization_id||'/exports/'||id
  WHERE organization_id=p_organization_id AND id=p_job_id AND status='running' AND lease_token=p_lease_token
    AND lease_until>clock_timestamp() AND finance_private.export_requester_authorized_for_type(organization_id,requested_by_member_id,export_type)
    AND (object_key IS NULL OR object_key=organization_id||'/exports/'||id);
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION finance_private.record_report_export_object(uuid,uuid,uuid) FROM PUBLIC,ams_runtime,ams_job_worker;
GRANT EXECUTE ON FUNCTION finance_private.record_report_export_object(uuid,uuid,uuid) TO ams_job_worker;

CREATE OR REPLACE FUNCTION finance_private.fail_trial_balance_export(p_job_id uuid,p_lease_token uuid,p_error_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_job finance.export_jobs%ROWTYPE;v_delay integer;
BEGIN
  IF p_error_code IS NULL OR p_error_code !~ '^[A-Z][A-Z0-9_]{2,63}$' THEN RAISE EXCEPTION 'invalid export error code' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_job FROM finance.export_jobs e WHERE e.id=p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.status<>'running' OR v_job.lease_token IS DISTINCT FROM p_lease_token OR v_job.lease_until<=clock_timestamp() THEN
    RAISE EXCEPTION 'export lease unavailable' USING ERRCODE='40001'; END IF;
  v_delay:=LEAST(1800,15*(2^LEAST(v_job.attempt_count-1,7))::integer);
  UPDATE finance.export_jobs SET status=CASE WHEN v_job.attempt_count>=5 THEN 'failed' ELSE 'queued' END,
    object_key=COALESCE(object_key,organization_id||'/exports/'||id),
    available_at=clock_timestamp()+make_interval(secs=>v_delay),error_code=p_error_code,
    lease_token=NULL,lease_until=NULL WHERE id=v_job.id AND organization_id=v_job.organization_id;
END $$;
REVOKE ALL ON FUNCTION finance_private.fail_trial_balance_export(uuid,uuid,text) FROM PUBLIC,ams_runtime,ams_job_worker;
GRANT EXECUTE ON FUNCTION finance_private.fail_trial_balance_export(uuid,uuid,text) TO ams_job_worker;

-- An upload left in the `uploaded` state for an hour was interrupted before
-- row staging; quarantine its job as failed and remove its temporary bytes.
ALTER TABLE finance.import_jobs
  ADD COLUMN upload_cleanup_object_key text,
  ADD COLUMN upload_cleanup_lease_token uuid,
  ADD COLUMN upload_cleanup_lease_until timestamptz,
  ADD COLUMN upload_cleanup_attempt_count integer NOT NULL DEFAULT 0 CHECK (upload_cleanup_attempt_count BETWEEN 0 AND 8),
  ADD COLUMN upload_cleanup_available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN upload_cleanup_at timestamptz,
  ADD COLUMN upload_cleanup_error_code text;

CREATE FUNCTION finance_private.claim_abandoned_import_uploads(p_limit integer DEFAULT 10,p_lease_seconds integer DEFAULT 600)
RETURNS TABLE(job_id uuid,organization_id uuid,object_key text,lease_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_now timestamptz:=clock_timestamp();
BEGIN
  IF p_limit NOT BETWEEN 1 AND 25 OR p_lease_seconds NOT BETWEEN 60 AND 1800 THEN
    RAISE EXCEPTION 'invalid import cleanup claim' USING ERRCODE='22023'; END IF;
  RETURN QUERY WITH ready AS (
    SELECT j.organization_id,j.id FROM finance.import_jobs j
    WHERE (j.upload_cleanup_object_key=j.organization_id||'/imports/'||j.id OR
      (j.file_object_key=j.organization_id||'/imports/'||j.id AND j.status='uploaded' AND j.created_at<=v_now-interval '1 hour'))
      AND j.upload_cleanup_at IS NULL
      AND j.upload_cleanup_attempt_count<8 AND j.upload_cleanup_available_at<=v_now
      AND (j.upload_cleanup_lease_until IS NULL OR j.upload_cleanup_lease_until<=v_now)
    ORDER BY j.created_at,j.id FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), claimed AS (
    UPDATE finance.import_jobs j SET upload_cleanup_object_key=COALESCE(j.upload_cleanup_object_key,j.file_object_key),
      status=CASE WHEN j.status='uploaded' THEN 'failed' ELSE j.status END,
      result_summary=CASE WHEN j.status='uploaded' THEN jsonb_build_object('total',j.row_count,'valid',0,'invalid',j.row_count,
        'imported',0,'error_code','IMPORT_UPLOAD_ABANDONED') ELSE j.result_summary END,
      upload_cleanup_attempt_count=j.upload_cleanup_attempt_count+1,upload_cleanup_lease_token=gen_random_uuid(),
      upload_cleanup_lease_until=v_now+make_interval(secs=>p_lease_seconds),upload_cleanup_error_code=NULL
    FROM ready r WHERE j.organization_id=r.organization_id AND j.id=r.id
    RETURNING j.id,j.organization_id,j.upload_cleanup_object_key,j.upload_cleanup_lease_token
  ) SELECT c.id,c.organization_id,c.upload_cleanup_object_key,c.upload_cleanup_lease_token FROM claimed c;
END $$;
REVOKE ALL ON FUNCTION finance_private.claim_abandoned_import_uploads(integer,integer) FROM PUBLIC,ams_runtime,ams_job_worker;

CREATE FUNCTION finance_private.complete_abandoned_import_upload_cleanup(p_organization_id uuid,p_job_id uuid,p_lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE finance.import_jobs SET file_object_key=NULL,upload_cleanup_object_key=NULL,upload_cleanup_at=clock_timestamp(),upload_cleanup_lease_token=NULL,
    upload_cleanup_lease_until=NULL,upload_cleanup_error_code=NULL
  WHERE organization_id=p_organization_id AND id=p_job_id AND upload_cleanup_lease_token=p_lease_token
    AND upload_cleanup_lease_until>clock_timestamp() AND upload_cleanup_at IS NULL;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION finance_private.complete_abandoned_import_upload_cleanup(uuid,uuid,uuid) FROM PUBLIC,ams_runtime,ams_job_worker;

CREATE FUNCTION finance_private.fail_abandoned_import_upload_cleanup(p_organization_id uuid,p_job_id uuid,p_lease_token uuid,p_error_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_job finance.import_jobs%ROWTYPE;v_delay integer;
BEGIN
  IF p_error_code IS NULL OR p_error_code !~ '^[A-Z][A-Z0-9_]{2,63}$' THEN
    RAISE EXCEPTION 'invalid cleanup error code' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_job FROM finance.import_jobs j WHERE j.organization_id=p_organization_id AND j.id=p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.upload_cleanup_at IS NOT NULL OR
    v_job.upload_cleanup_lease_token IS DISTINCT FROM p_lease_token OR v_job.upload_cleanup_lease_until<=clock_timestamp() THEN
    RAISE EXCEPTION 'import cleanup lease unavailable' USING ERRCODE='40001'; END IF;
  v_delay:=LEAST(43200,60*(2^LEAST(v_job.upload_cleanup_attempt_count-1,9))::integer);
  UPDATE finance.import_jobs SET upload_cleanup_available_at=clock_timestamp()+make_interval(secs=>v_delay),
    upload_cleanup_lease_token=NULL,upload_cleanup_lease_until=NULL,upload_cleanup_error_code=p_error_code
  WHERE organization_id=v_job.organization_id AND id=v_job.id;
END $$;
REVOKE ALL ON FUNCTION finance_private.fail_abandoned_import_upload_cleanup(uuid,uuid,uuid,text) FROM PUBLIC,ams_runtime,ams_job_worker;

GRANT EXECUTE ON FUNCTION finance_private.claim_expired_export_cleanup(integer,integer) TO ams_job_worker;
GRANT EXECUTE ON FUNCTION finance_private.complete_expired_export_cleanup(uuid,uuid,uuid) TO ams_job_worker;
GRANT EXECUTE ON FUNCTION finance_private.fail_expired_export_cleanup(uuid,uuid,uuid,text) TO ams_job_worker;
GRANT EXECUTE ON FUNCTION finance_private.claim_abandoned_import_uploads(integer,integer) TO ams_job_worker;
GRANT EXECUTE ON FUNCTION finance_private.complete_abandoned_import_upload_cleanup(uuid,uuid,uuid) TO ams_job_worker;
GRANT EXECUTE ON FUNCTION finance_private.fail_abandoned_import_upload_cleanup(uuid,uuid,uuid,text) TO ams_job_worker;

-- Keep a cleanup pointer after the staged rows are stored and source bytes are
-- no longer needed. The HTTP handler deletes immediately; this lease queue is
-- the crash/retry fallback if deletion fails or the process exits early.
CREATE OR REPLACE FUNCTION public.stage_import_rows(p_organization_id uuid,p_job_id uuid,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_member uuid;v_job finance.import_jobs%ROWTYPE;v_count integer;
BEGIN
  v_member:=finance_private.require_capability(p_organization_id,'imports.run');
  SELECT * INTO v_job FROM finance.import_jobs j WHERE j.organization_id=p_organization_id AND j.id=p_job_id
    AND j.created_by_member_id=v_member FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import unavailable' USING ERRCODE='P0002'; END IF;
  IF (v_job.import_type='contacts' AND NOT finance_private.has_permission(p_organization_id,'contacts.write')) OR
     (v_job.import_type='items' AND NOT finance_private.has_permission(p_organization_id,'catalog.write')) THEN
    RAISE EXCEPTION 'import capability required' USING ERRCODE='42501'; END IF;
  IF v_job.status IN ('validating','ready','running','completed') THEN
    RETURN jsonb_build_object('id',v_job.id,'status',v_job.status,'row_count',v_job.row_count,'replayed',true);
  END IF;
  IF v_job.status<>'uploaded' OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR
     (CASE WHEN jsonb_typeof(p_rows)='array' THEN jsonb_array_length(p_rows) ELSE -1 END)<>v_job.row_count OR v_job.row_count NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'staged rows do not match the upload' USING ERRCODE='22023'; END IF;
  IF octet_length(p_rows::text)>8388608 THEN RAISE EXCEPTION 'staged rows exceed the supported size' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE
      COALESCE((r->>'row_no')::integer,0)<1 OR jsonb_typeof(r->'input_data') IS DISTINCT FROM 'object' OR
      octet_length((r->'input_data')::text)>20000 OR COALESCE(r->>'command_idempotency_key','') !~ '^[A-Za-z0-9_-]{43}$') OR
     (SELECT count(DISTINCT (r->>'row_no')::integer) FROM jsonb_array_elements(p_rows) r)<>v_job.row_count THEN
    RAISE EXCEPTION 'staged row shape is invalid' USING ERRCODE='22023'; END IF;
  INSERT INTO finance.import_rows(organization_id,job_id,row_no,input_data,command_idempotency_key)
    SELECT p_organization_id,p_job_id,(r->>'row_no')::integer,r->'input_data',r->>'command_idempotency_key'
    FROM jsonb_array_elements(p_rows) r;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>v_job.row_count THEN RAISE EXCEPTION 'staged rows are incomplete' USING ERRCODE='22023'; END IF;
  UPDATE finance.import_jobs SET status='validating',upload_cleanup_object_key=file_object_key,file_object_key=NULL
    WHERE organization_id=p_organization_id AND id=p_job_id;
  RETURN jsonb_build_object('id',v_job.id,'status','validating','row_count',v_count,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.stage_import_rows(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stage_import_rows(uuid,uuid,jsonb) TO ams_runtime;
