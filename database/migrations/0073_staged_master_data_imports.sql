-- US-070: staged CSV imports for master data only. No financial import routine is added.
ALTER TABLE finance.import_jobs
  ADD COLUMN source_name text NOT NULL DEFAULT 'legacy-import.csv',
  ADD COLUMN row_count integer NOT NULL DEFAULT 0 CHECK (row_count BETWEEN 0 AND 500),
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_until timestamptz;
ALTER TABLE finance.import_jobs ALTER COLUMN source_name DROP DEFAULT;
ALTER TABLE finance.import_rows ADD COLUMN command_idempotency_key text;
ALTER TABLE finance.import_jobs ALTER COLUMN file_object_key DROP NOT NULL;

DROP POLICY import_jobs_read ON finance.import_jobs;
CREATE POLICY import_jobs_read ON finance.import_jobs FOR SELECT TO ams_runtime
  USING (finance_private.has_permission(organization_id,'imports.read') AND EXISTS(
    SELECT 1 FROM finance.organization_members m WHERE m.organization_id=import_jobs.organization_id
      AND m.id=import_jobs.created_by_member_id AND m.user_id=identity.current_actor_id() AND m.status='active'));
DROP POLICY import_rows_read ON finance.import_rows;
CREATE POLICY import_rows_read ON finance.import_rows FOR SELECT TO ams_runtime
  USING (finance_private.has_permission(organization_id,'imports.read') AND EXISTS(
    SELECT 1 FROM finance.import_jobs j JOIN finance.organization_members m
      ON m.organization_id=j.organization_id AND m.id=j.created_by_member_id
    WHERE j.organization_id=import_rows.organization_id AND j.id=import_rows.job_id
      AND m.user_id=identity.current_actor_id() AND m.status='active'));

CREATE FUNCTION public.create_staged_import(
  p_organization_id uuid,p_job_id uuid,p_import_type text,p_file_sha256 text,p_file_object_key text,
  p_source_name text,p_row_count integer,p_request_id text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_member uuid;v_existing finance.idempotency_requests%ROWTYPE;v_job finance.import_jobs%ROWTYPE;v_body jsonb;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  v_member:=finance_private.require_capability(p_organization_id,'imports.run');
  IF p_import_type NOT IN ('contacts','items') OR
     (p_import_type='contacts' AND NOT finance_private.has_permission(p_organization_id,'contacts.write')) OR
     (p_import_type='items' AND NOT finance_private.has_permission(p_organization_id,'catalog.write')) THEN
    RAISE EXCEPTION 'import capability required' USING ERRCODE='42501'; END IF;
  IF p_job_id IS NULL OR p_file_sha256 IS NULL OR p_file_sha256 !~ '^[0-9a-f]{64}$' OR
     p_file_object_key IS DISTINCT FROM p_organization_id::text||'/imports/'||p_job_id::text OR
     p_source_name IS NULL OR length(p_source_name) NOT BETWEEN 1 AND 180 OR
     p_row_count IS NULL OR p_row_count NOT BETWEEN 1 AND 500 OR
     p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{22,172}$' OR
     p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid staged import request' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':imports.stage:'||p_idempotency_key,0));
  SELECT * INTO v_existing FROM finance.idempotency_requests i WHERE i.organization_id=p_organization_id
    AND i.operation='imports.stage' AND i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.actor_member_id<>v_member OR v_existing.request_hash<>p_request_hash THEN
      RAISE EXCEPTION 'idempotency conflict' USING ERRCODE='23505'; END IF;
    SELECT * INTO v_job FROM finance.import_jobs j WHERE j.organization_id=p_organization_id AND j.id=(v_existing.response_body->>'id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'import unavailable' USING ERRCODE='P0002'; END IF;
    RETURN jsonb_build_object('id',v_job.id,'object_key',v_job.file_object_key,'status',v_job.status,'row_count',v_job.row_count,'source_name',v_job.source_name,'replayed',true);
  END IF;
  SELECT * INTO v_job FROM finance.import_jobs j WHERE j.organization_id=p_organization_id
    AND j.import_type=p_import_type AND j.file_sha256=p_file_sha256 FOR UPDATE;
  IF FOUND THEN
    IF v_job.created_by_member_id<>v_member THEN RAISE EXCEPTION 'import unavailable' USING ERRCODE='P0002'; END IF;
    v_body:=jsonb_build_object('id',v_job.id,'status',v_job.status,'row_count',v_job.row_count,'source_name',v_job.source_name);
    INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body)
      VALUES(p_organization_id,'imports.stage',p_idempotency_key,p_request_hash,v_member,200,v_body);
    RETURN jsonb_build_object('id',v_job.id,'object_key',v_job.file_object_key,'status',v_job.status,'row_count',v_job.row_count,'source_name',v_job.source_name,'replayed',true);
  END IF;
  INSERT INTO finance.import_jobs(id,organization_id,import_type,file_sha256,file_object_key,source_name,row_count,mapping,status,created_by_member_id)
    VALUES(p_job_id,p_organization_id,p_import_type,p_file_sha256,p_file_object_key,left(p_source_name,180),p_row_count,'{}'::jsonb,'uploaded',v_member)
    RETURNING * INTO v_job;
  v_body:=jsonb_build_object('id',v_job.id,'status',v_job.status,'row_count',v_job.row_count,'source_name',v_job.source_name);
  INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body)
    VALUES(p_organization_id,'imports.stage',p_idempotency_key,p_request_hash,v_member,202,v_body);
  PERFORM finance_private.write_role_audit(p_organization_id,v_member,'import.staged','import_job',v_job.id,p_request_id,
    jsonb_build_object('import_type',p_import_type,'sha256',p_file_sha256,'row_count',p_row_count,'source_name',v_job.source_name));
  RETURN jsonb_build_object('id',v_job.id,'object_key',v_job.file_object_key,'status',v_job.status,'row_count',v_job.row_count,'source_name',v_job.source_name,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.create_staged_import(uuid,uuid,text,text,text,text,integer,text,text,text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.create_staged_import(uuid,uuid,text,text,text,text,integer,text,text,text) TO ams_runtime;

CREATE FUNCTION public.stage_import_rows(p_organization_id uuid,p_job_id uuid,p_rows jsonb)
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
      octet_length((r->'input_data')::text)>20000 OR
      COALESCE(r->>'command_idempotency_key','') !~ '^[A-Za-z0-9_-]{43}$') OR
     (SELECT count(DISTINCT (r->>'row_no')::integer) FROM jsonb_array_elements(p_rows) r)<>v_job.row_count THEN
    RAISE EXCEPTION 'staged row shape is invalid' USING ERRCODE='22023'; END IF;
  INSERT INTO finance.import_rows(organization_id,job_id,row_no,input_data,command_idempotency_key)
    SELECT p_organization_id,p_job_id,(r->>'row_no')::integer,r->'input_data',r->>'command_idempotency_key'
      FROM jsonb_array_elements(p_rows) r;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>v_job.row_count THEN RAISE EXCEPTION 'staged rows are incomplete' USING ERRCODE='22023'; END IF;
  UPDATE finance.import_jobs SET status='validating',file_object_key=NULL WHERE organization_id=p_organization_id AND id=p_job_id;
  RETURN jsonb_build_object('id',v_job.id,'status','validating','row_count',v_count,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.stage_import_rows(uuid,uuid,jsonb) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.stage_import_rows(uuid,uuid,jsonb) TO ams_runtime;

CREATE FUNCTION public.read_import_validation_rows(p_organization_id uuid,p_job_id uuid)
RETURNS TABLE(row_no integer,input_data jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_member uuid;v_type text;
BEGIN
  v_member:=finance_private.require_capability(p_organization_id,'imports.run');
  SELECT j.import_type INTO v_type FROM finance.import_jobs j WHERE j.organization_id=p_organization_id AND j.id=p_job_id
    AND j.created_by_member_id=v_member AND j.status IN ('validating','ready');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'import unavailable' USING ERRCODE='P0002'; END IF;
  IF (v_type='contacts' AND NOT finance_private.has_permission(p_organization_id,'contacts.write')) OR
     (v_type='items' AND NOT finance_private.has_permission(p_organization_id,'catalog.write')) OR
     v_type NOT IN ('contacts','items') THEN
    RAISE EXCEPTION 'import capability required' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT r.row_no,r.input_data FROM finance.import_rows r
    WHERE r.organization_id=p_organization_id AND r.job_id=p_job_id ORDER BY r.row_no;
END $$;
REVOKE ALL ON FUNCTION public.read_import_validation_rows(uuid,uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_import_validation_rows(uuid,uuid) TO ams_runtime;

CREATE FUNCTION public.record_import_validation(p_organization_id uuid,p_job_id uuid,p_results jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_member uuid;v_job finance.import_jobs%ROWTYPE;v_valid integer;v_invalid integer;v_count integer;
BEGIN
  v_member:=finance_private.require_capability(p_organization_id,'imports.run');
  SELECT * INTO v_job FROM finance.import_jobs j WHERE j.organization_id=p_organization_id AND j.id=p_job_id
    AND j.created_by_member_id=v_member FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import unavailable' USING ERRCODE='P0002'; END IF;
  IF (v_job.import_type='contacts' AND NOT finance_private.has_permission(p_organization_id,'contacts.write')) OR
     (v_job.import_type='items' AND NOT finance_private.has_permission(p_organization_id,'catalog.write')) THEN
    RAISE EXCEPTION 'import capability required' USING ERRCODE='42501'; END IF;
  IF v_job.status='ready' THEN RETURN v_job.result_summary||jsonb_build_object('status','ready','replayed',true); END IF;
  IF v_job.status<>'validating' OR jsonb_typeof(p_results) IS DISTINCT FROM 'array' OR
     (CASE WHEN jsonb_typeof(p_results)='array' THEN jsonb_array_length(p_results) ELSE -1 END)<>v_job.row_count THEN RAISE EXCEPTION 'validation results are incomplete' USING ERRCODE='22023'; END IF;
  IF (SELECT count(DISTINCT (r->>'row_no')::integer) FROM jsonb_array_elements(p_results) r)<>v_job.row_count OR
     EXISTS(SELECT 1 FROM jsonb_array_elements(p_results) r WHERE COALESCE((r->>'row_no')::integer,0)<1 OR
       jsonb_typeof(r->'errors') IS DISTINCT FROM 'array' OR octet_length((r->'errors')::text)>8000 OR
       jsonb_typeof(r->'input_data') IS DISTINCT FROM 'object' OR octet_length((r->'input_data')::text)>20000) THEN
    RAISE EXCEPTION 'validation result shape is invalid' USING ERRCODE='22023'; END IF;
  UPDATE finance.import_rows i SET status=CASE WHEN jsonb_array_length(r->'errors')=0 THEN 'valid' ELSE 'invalid' END,
    errors=r->'errors',input_data=CASE WHEN jsonb_array_length(r->'errors')=0 THEN r->'input_data' ELSE i.input_data END
    FROM jsonb_array_elements(p_results) r WHERE i.organization_id=p_organization_id AND i.job_id=p_job_id AND i.row_no=(r->>'row_no')::integer;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>v_job.row_count THEN RAISE EXCEPTION 'validation rows changed' USING ERRCODE='40001'; END IF;
  SELECT count(*) FILTER(WHERE status='valid'),count(*) FILTER(WHERE status='invalid') INTO v_valid,v_invalid
    FROM finance.import_rows WHERE organization_id=p_organization_id AND job_id=p_job_id;
  UPDATE finance.import_jobs SET status=CASE WHEN v_valid=0 THEN 'completed' ELSE 'ready' END,
    result_summary=jsonb_build_object('total',v_job.row_count,'valid',v_valid,'invalid',v_invalid,'imported',0)
    WHERE organization_id=p_organization_id AND id=p_job_id;
  RETURN jsonb_build_object('id',p_job_id,'status',CASE WHEN v_valid=0 THEN 'completed' ELSE 'ready' END,
    'total',v_job.row_count,'valid',v_valid,'invalid',v_invalid,'imported',0,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.record_import_validation(uuid,uuid,jsonb) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.record_import_validation(uuid,uuid,jsonb) TO ams_runtime;

CREATE FUNCTION public.claim_import_commit(p_organization_id uuid,p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_member uuid;v_job finance.import_jobs%ROWTYPE;v_token uuid:=gen_random_uuid();
BEGIN
  v_member:=finance_private.require_capability(p_organization_id,'imports.run');
  SELECT * INTO v_job FROM finance.import_jobs j WHERE j.organization_id=p_organization_id AND j.id=p_job_id
    AND j.created_by_member_id=v_member FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import unavailable' USING ERRCODE='P0002'; END IF;
  IF (v_job.import_type='contacts' AND NOT finance_private.has_permission(p_organization_id,'contacts.write')) OR
     (v_job.import_type='items' AND NOT finance_private.has_permission(p_organization_id,'catalog.write')) THEN
    RAISE EXCEPTION 'import capability required' USING ERRCODE='42501'; END IF;
  IF v_job.status='completed' THEN RETURN jsonb_build_object('id',v_job.id,'status','completed','replayed',true,'summary',v_job.result_summary); END IF;
  IF v_job.status='running' AND v_job.lease_until>clock_timestamp() THEN RAISE EXCEPTION 'import commit is already active' USING ERRCODE='40001'; END IF;
  IF v_job.status NOT IN ('ready','running') THEN RAISE EXCEPTION 'import must be validated before commit' USING ERRCODE='22023'; END IF;
  UPDATE finance.import_jobs SET status='running',lease_token=v_token,lease_until=clock_timestamp()+interval '10 minutes'
    WHERE organization_id=p_organization_id AND id=p_job_id;
  RETURN jsonb_build_object('id',v_job.id,'status','running','lease_token',v_token,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.claim_import_commit(uuid,uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.claim_import_commit(uuid,uuid) TO ams_runtime;

CREATE FUNCTION public.read_import_commit_rows(p_organization_id uuid,p_job_id uuid,p_lease_token uuid,p_limit integer DEFAULT 25)
RETURNS TABLE(row_no integer,input_data jsonb,command_idempotency_key text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_member uuid;v_type text;
BEGIN
  v_member:=finance_private.require_capability(p_organization_id,'imports.run');
  IF p_limit NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'invalid import batch size' USING ERRCODE='22023'; END IF;
  SELECT j.import_type INTO v_type FROM finance.import_jobs j WHERE j.organization_id=p_organization_id
    AND j.id=p_job_id AND j.created_by_member_id=v_member AND j.status='running' AND j.lease_token=p_lease_token AND j.lease_until>clock_timestamp();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'import lease unavailable' USING ERRCODE='40001'; END IF;
  IF (v_type='contacts' AND NOT finance_private.has_permission(p_organization_id,'contacts.write')) OR
     (v_type='items' AND NOT finance_private.has_permission(p_organization_id,'catalog.write')) OR
     v_type NOT IN ('contacts','items') THEN
    RAISE EXCEPTION 'import capability required' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT r.row_no,r.input_data,r.command_idempotency_key FROM finance.import_rows r
    WHERE r.organization_id=p_organization_id AND r.job_id=p_job_id AND r.status='valid' ORDER BY r.row_no LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.read_import_commit_rows(uuid,uuid,uuid,integer) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_import_commit_rows(uuid,uuid,uuid,integer) TO ams_runtime;

CREATE FUNCTION public.record_import_row_result(p_organization_id uuid,p_job_id uuid,p_lease_token uuid,p_row_no integer,
  p_status text,p_errors jsonb,p_result_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_member uuid;v_type text;
BEGIN
  v_member:=finance_private.require_capability(p_organization_id,'imports.run');
  SELECT j.import_type INTO v_type FROM finance.import_jobs j WHERE j.organization_id=p_organization_id AND j.id=p_job_id
    AND j.created_by_member_id=v_member AND j.status='running' AND j.lease_token=p_lease_token AND j.lease_until>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import lease unavailable' USING ERRCODE='40001'; END IF;
  IF p_status NOT IN ('valid','invalid','imported') OR jsonb_typeof(p_errors) IS DISTINCT FROM 'array' OR
     jsonb_array_length(p_errors)>20 OR octet_length(p_errors::text)>8000 OR (p_status='imported' AND p_result_id IS NULL) OR
     (p_status<>'imported' AND p_result_id IS NOT NULL) THEN RAISE EXCEPTION 'invalid import result' USING ERRCODE='22023'; END IF;
  UPDATE finance.import_rows SET status=p_status,errors=p_errors,
    result_contact_id=CASE WHEN v_type='contacts' AND p_status='imported' THEN p_result_id ELSE NULL END,
    result_item_id=CASE WHEN v_type='items' AND p_status='imported' THEN p_result_id ELSE NULL END,
    input_data=CASE WHEN p_status='imported' THEN '{}'::jsonb ELSE input_data END
    WHERE organization_id=p_organization_id AND job_id=p_job_id AND row_no=p_row_no AND status='valid';
  IF NOT FOUND THEN RAISE EXCEPTION 'import row unavailable' USING ERRCODE='P0002'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.record_import_row_result(uuid,uuid,uuid,integer,text,jsonb,uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.record_import_row_result(uuid,uuid,uuid,integer,text,jsonb,uuid) TO ams_runtime;

CREATE FUNCTION public.finish_import_commit(p_organization_id uuid,p_job_id uuid,p_lease_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_member uuid;v_job finance.import_jobs%ROWTYPE;v_valid integer;v_invalid integer;v_imported integer;v_status text;v_summary jsonb;
BEGIN
  v_member:=finance_private.require_capability(p_organization_id,'imports.run');
  SELECT * INTO v_job FROM finance.import_jobs j WHERE j.organization_id=p_organization_id AND j.id=p_job_id
    AND j.created_by_member_id=v_member AND j.status='running' AND j.lease_token=p_lease_token AND j.lease_until>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import lease unavailable' USING ERRCODE='40001'; END IF;
  SELECT count(*) FILTER(WHERE status='valid'),count(*) FILTER(WHERE status='invalid'),count(*) FILTER(WHERE status='imported')
    INTO v_valid,v_invalid,v_imported FROM finance.import_rows WHERE organization_id=p_organization_id AND job_id=p_job_id;
  v_status:=CASE WHEN v_valid=0 THEN 'completed' ELSE 'ready' END;
  v_summary:=jsonb_build_object('total',v_job.row_count,'valid',v_valid,'invalid',v_invalid,'imported',v_imported);
  UPDATE finance.import_jobs SET status=v_status,lease_token=NULL,lease_until=NULL,result_summary=v_summary
    WHERE organization_id=p_organization_id AND id=p_job_id;
  IF v_status='completed' THEN UPDATE finance.import_rows SET input_data='{}'::jsonb
    WHERE organization_id=p_organization_id AND job_id=p_job_id; END IF;
  RETURN v_summary||jsonb_build_object('id',p_job_id,'status',v_status,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.finish_import_commit(uuid,uuid,uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.finish_import_commit(uuid,uuid,uuid) TO ams_runtime;

CREATE FUNCTION public.list_own_import_jobs(p_organization_id uuid,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_member uuid;
BEGIN
  v_member:=finance_private.require_capability(p_organization_id,'imports.read');
  IF p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'invalid import page size' USING ERRCODE='22023'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',j.id,'import_type',j.import_type,'source_name',j.source_name,
    'status',j.status,'row_count',j.row_count,'result_summary',j.result_summary,'created_at',j.created_at) ORDER BY j.created_at DESC,j.id DESC)
    FROM (SELECT * FROM finance.import_jobs WHERE organization_id=p_organization_id AND created_by_member_id=v_member
      ORDER BY created_at DESC,id DESC LIMIT p_limit) j),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.list_own_import_jobs(uuid,integer) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.list_own_import_jobs(uuid,integer) TO ams_runtime;

CREATE FUNCTION public.read_own_import_job(p_organization_id uuid,p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_member uuid;v_job finance.import_jobs%ROWTYPE;
BEGIN
  v_member:=finance_private.require_capability(p_organization_id,'imports.read');
  SELECT * INTO v_job FROM finance.import_jobs j WHERE j.organization_id=p_organization_id AND j.id=p_job_id AND j.created_by_member_id=v_member;
  IF NOT FOUND THEN RAISE EXCEPTION 'import unavailable' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('id',v_job.id,'import_type',v_job.import_type,'source_name',v_job.source_name,'status',v_job.status,
    'row_count',v_job.row_count,'result_summary',v_job.result_summary,'created_at',v_job.created_at,
    'rows',COALESCE((SELECT jsonb_agg(jsonb_build_object('row_no',r.row_no,'status',r.status,'errors',r.errors,
      'preview',CASE WHEN v_job.import_type='contacts' AND finance_private.has_permission(p_organization_id,'contacts.read')
          THEN jsonb_build_object('name',r.input_data->>'display_name','detail',concat_ws(' / ',
            CASE WHEN r.input_data->>'is_customer'='true' THEN 'customer' END,
            CASE WHEN r.input_data->>'is_vendor'='true' THEN 'vendor' END))
        WHEN v_job.import_type='items' AND finance_private.has_permission(p_organization_id,'catalog.read')
          THEN jsonb_build_object('name',r.input_data->>'name','unit',r.input_data->>'unit') END,
      'result_contact_id',CASE WHEN v_job.import_type='contacts' AND finance_private.has_permission(p_organization_id,'contacts.read') THEN r.result_contact_id END,
      'result_item_id',CASE WHEN v_job.import_type='items' AND finance_private.has_permission(p_organization_id,'catalog.read') THEN r.result_item_id END) ORDER BY r.row_no)
      FROM finance.import_rows r WHERE r.organization_id=p_organization_id AND r.job_id=p_job_id),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.read_own_import_job(uuid,uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_own_import_job(uuid,uuid) TO ams_runtime;
NOTIFY pgrst,'reload schema';
