-- US-070: private, staged contact CSV imports. Financial source imports remain
-- unavailable until their owning atomic posting stories are implemented.
BEGIN;

CREATE TABLE finance.import_upload_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  uploader_member_id uuid NOT NULL,
  object_key text NOT NULL,
  original_filename text NOT NULL,
  expected_size bigint NOT NULL CHECK (expected_size BETWEEN 1 AND 5242880),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','completed','expired')),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
  import_job_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), UNIQUE (organization_id,object_key),
  FOREIGN KEY (organization_id,uploader_member_id) REFERENCES finance.organization_members(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,import_job_id) REFERENCES finance.import_jobs(organization_id,id) ON DELETE RESTRICT,
  CHECK (object_key=organization_id||'/imports/'||id),
  CHECK (original_filename<>'' AND length(original_filename)<=180 AND original_filename !~ '[[:cntrl:]/\\\\]')
);
ALTER TABLE finance.import_jobs ADD COLUMN IF NOT EXISTS source_sha256 text;
ALTER TABLE finance.import_jobs ADD COLUMN IF NOT EXISTS source_filename text;
ALTER TABLE finance.import_jobs ADD COLUMN IF NOT EXISTS source_size bigint;
ALTER TABLE finance.import_jobs ADD COLUMN IF NOT EXISTS committed_at timestamptz;
ALTER TABLE finance.import_jobs ADD CONSTRAINT import_jobs_source_sha256_format CHECK (source_sha256 IS NULL OR source_sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE finance.import_jobs ADD CONSTRAINT import_jobs_source_size_range CHECK (source_size IS NULL OR source_size BETWEEN 1 AND 5242880);

ALTER TABLE finance.import_upload_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.import_upload_intents FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION finance_private.can_upload_import(p_object_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
   SELECT 1 FROM finance.import_upload_intents i
   JOIN finance.organization_members m ON m.organization_id=i.organization_id AND m.id=i.uploader_member_id
   WHERE i.object_key=p_object_key AND i.state='pending' AND i.expires_at>now()
    AND m.user_id=auth.uid() AND m.status='active'
    AND finance_private.has_permission(i.organization_id,'imports.run'))
$$;
REVOKE ALL ON FUNCTION finance_private.can_upload_import(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION finance_private.can_upload_import(text) TO authenticated;
CREATE POLICY ams_import_intent_upload ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='ams-private-artifacts' AND finance_private.can_upload_import(name));
CREATE POLICY ams_import_intent_cleanup ON storage.objects FOR DELETE TO authenticated
 USING(bucket_id='ams-private-artifacts' AND finance_private.can_upload_import(name));
CREATE FUNCTION finance_private.can_read_import_artifact(p_object_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(
  SELECT 1 FROM finance.import_upload_intents i
  JOIN finance.import_jobs j ON j.organization_id=i.organization_id AND j.id=i.import_job_id
  JOIN finance.organizations o ON o.id=i.organization_id
  JOIN finance.organization_members m ON m.organization_id=i.organization_id AND m.id=i.uploader_member_id
  WHERE i.object_key=p_object_key AND i.object_key=i.organization_id||'/imports/'||i.id
   AND i.state='pending' AND i.expires_at>now() AND j.status='uploaded' AND o.status<>'archived'
   AND m.user_id=auth.uid() AND m.status='active' AND finance_private.has_permission(i.organization_id,'imports.run'))
$$;
REVOKE ALL ON FUNCTION finance_private.can_read_import_artifact(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION finance_private.can_read_import_artifact(text) TO authenticated;
CREATE POLICY ams_import_artifact_download ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='ams-private-artifacts' AND storage.allow_only_operation('object.get_authenticated')
   AND finance_private.can_read_import_artifact(name));
DROP POLICY IF EXISTS ams_private_artifact_fence ON storage.objects;
CREATE POLICY ams_private_artifact_fence ON storage.objects AS RESTRICTIVE FOR SELECT TO public
 USING(bucket_id<>'ams-private-artifacts' OR (auth.uid() IS NOT NULL AND storage.allow_only_operation('object.get_authenticated')
   AND (finance_private.can_download_artifact(name) OR finance_private.can_read_import_artifact(name))));

-- Replace org-wide SELECT policies: import data contains contact PII and is
-- visible only to its requester, subject to live membership and capability.
DROP POLICY IF EXISTS import_jobs_read ON finance.import_jobs;
DROP POLICY IF EXISTS import_rows_read ON finance.import_rows;
CREATE POLICY import_jobs_read ON finance.import_jobs FOR SELECT TO authenticated USING (
 finance_private.has_permission(organization_id,'imports.read') AND EXISTS (
  SELECT 1 FROM finance.organization_members m WHERE m.organization_id=import_jobs.organization_id
   AND m.id=import_jobs.created_by_member_id AND m.user_id=auth.uid() AND m.status='active'));
CREATE POLICY import_rows_read ON finance.import_rows FOR SELECT TO authenticated USING (
 finance_private.has_permission(organization_id,'imports.read') AND EXISTS (
  SELECT 1 FROM finance.import_jobs j JOIN finance.organization_members m
   ON m.organization_id=j.organization_id AND m.id=j.created_by_member_id
  WHERE j.organization_id=import_rows.organization_id AND j.id=import_rows.job_id
   AND m.user_id=auth.uid() AND m.status='active'));

CREATE FUNCTION public.create_contact_import(p_organization_id uuid,p_filename text,p_size bigint,p_sha256 text,
 p_rows jsonb,p_mapping jsonb,p_request_id text)
RETURNS TABLE(import_job_id uuid,object_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_job uuid:=gen_random_uuid(); v_intent uuid:=gen_random_uuid(); v_key text; v_existing finance.import_jobs%ROWTYPE;
BEGIN
 v_actor:=finance_private.require_capability(p_organization_id,'imports.run');
 PERFORM finance_private.validate_request_id(p_request_id);
 IF p_rows IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR
   p_mapping IS NULL OR jsonb_typeof(p_mapping) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'invalid contact import structure' USING ERRCODE='22023'; END IF;
 IF p_filename IS NULL OR length(p_filename) NOT BETWEEN 5 AND 180 OR p_filename !~* '\\.csv$' OR p_filename ~ '[[:cntrl:]/\\\\]'
  OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 5242880 OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$'
  OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500
  OR (p_mapping-ARRAY['display_name','legal_name','is_customer','is_vendor','email','phone','payment_terms_days','credit_limit','external_key','is_active'])<>'{}'::jsonb
  OR jsonb_typeof(p_mapping->'display_name') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_mapping->'is_customer') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_mapping->'is_vendor') IS DISTINCT FROM 'string'
  OR EXISTS(SELECT 1 FROM jsonb_each(p_mapping) kv WHERE jsonb_typeof(kv.value) IS DISTINCT FROM 'string'
    OR length(kv.value#>>'{}') NOT BETWEEN 1 AND 100)
  OR (SELECT count(DISTINCT kv.value) FROM jsonb_each(p_mapping) kv)<>(SELECT count(*) FROM jsonb_each(p_mapping))
  OR octet_length(p_rows::text)>4194304 THEN
  RAISE EXCEPTION 'invalid contact import source' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) e WHERE jsonb_typeof(e) IS DISTINCT FROM 'object'
   OR (e-ARRAY['row_no','input_data','errors','status'])<>'{}'::jsonb
   OR jsonb_typeof(e->'row_no') IS DISTINCT FROM 'number' OR e->>'row_no' !~ '^[0-9]+$'
   OR jsonb_typeof(e->'input_data') IS DISTINCT FROM 'object'
   OR (e->>'row_no')::integer NOT BETWEEN 2 AND 501 OR jsonb_typeof(e->'errors') IS DISTINCT FROM 'array'
   OR jsonb_typeof(e->'status') IS DISTINCT FROM 'string'
   OR e->>'status' NOT IN ('valid','invalid')
   OR CASE WHEN jsonb_typeof(e->'errors')='array' THEN jsonb_array_length(e->'errors')>20 OR
     (e->>'status'='valid' AND jsonb_array_length(e->'errors')<>0) OR (e->>'status'='invalid' AND jsonb_array_length(e->'errors')=0)
     ELSE true END) THEN
   RAISE EXCEPTION 'invalid contact import rows' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_existing FROM finance.import_jobs j WHERE j.organization_id=p_organization_id
   AND j.import_type='contacts' AND j.file_sha256=p_sha256 FOR UPDATE;
 IF FOUND THEN
   IF v_existing.created_by_member_id=v_actor AND v_existing.status='uploaded' AND v_existing.mapping=p_mapping THEN
    UPDATE finance.import_upload_intents SET state='pending',expires_at=now()+interval '10 minutes'
     WHERE organization_id=p_organization_id AND import_job_id=v_existing.id AND state IN ('pending','expired');
    RETURN QUERY SELECT v_existing.id,v_existing.file_object_key; RETURN;
   END IF;
   RAISE EXCEPTION 'duplicate import file' USING ERRCODE='23505';
 END IF;
 v_key:=p_organization_id||'/imports/'||v_intent;
 INSERT INTO finance.import_jobs(id,organization_id,import_type,file_sha256,file_object_key,mapping,status,created_by_member_id,
   result_summary,source_sha256,source_filename,source_size)
 VALUES(v_job,p_organization_id,'contacts',p_sha256,v_key,p_mapping,'uploaded',v_actor,
   jsonb_build_object('row_count',jsonb_array_length(p_rows)),p_sha256,p_filename,p_size);
 INSERT INTO finance.import_rows(organization_id,job_id,row_no,input_data,errors,status)
 SELECT p_organization_id,v_job,(r->>'row_no')::integer,r->'input_data',r->'errors',r->>'status'
 FROM jsonb_array_elements(p_rows) r;
 INSERT INTO finance.import_upload_intents(id,organization_id,uploader_member_id,object_key,original_filename,expected_size,import_job_id)
 VALUES(v_intent,p_organization_id,v_actor,v_key,p_filename,p_size,v_job);
 RETURN QUERY SELECT v_job,v_key;
END $$;
REVOKE ALL ON FUNCTION public.create_contact_import(uuid,text,bigint,text,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_contact_import(uuid,text,bigint,text,jsonb,jsonb,text) TO authenticated;

CREATE FUNCTION public.create_item_import(p_organization_id uuid,p_filename text,p_size bigint,p_sha256 text,
 p_rows jsonb,p_mapping jsonb,p_request_id text)
RETURNS TABLE(import_job_id uuid,object_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_job uuid:=gen_random_uuid(); v_intent uuid:=gen_random_uuid(); v_key text; v_existing finance.import_jobs%ROWTYPE;
BEGIN
 v_actor:=finance_private.require_capability(p_organization_id,'imports.run'); PERFORM finance_private.validate_request_id(p_request_id);
 IF p_rows IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR p_mapping IS NULL OR jsonb_typeof(p_mapping) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'invalid item import structure' USING ERRCODE='22023'; END IF;
 IF p_filename IS NULL OR length(p_filename) NOT BETWEEN 5 AND 180 OR p_filename !~* '\\.csv$' OR p_filename ~ '[[:cntrl:]/\\\\]'
  OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 5242880 OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$'
  OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 OR octet_length(p_rows::text)>4194304
  OR (p_mapping-ARRAY['sku','name','unit','default_unit_price','sales_account_id','purchase_account_id','tax_code_id','is_active'])<>'{}'::jsonb
  OR jsonb_typeof(p_mapping->'name') IS DISTINCT FROM 'string' OR jsonb_typeof(p_mapping->'unit') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_mapping->'default_unit_price') IS DISTINCT FROM 'string'
  OR EXISTS(SELECT 1 FROM jsonb_each(p_mapping) kv WHERE jsonb_typeof(kv.value) IS DISTINCT FROM 'string' OR length(kv.value#>>'{}') NOT BETWEEN 1 AND 100)
  OR (SELECT count(DISTINCT kv.value) FROM jsonb_each(p_mapping) kv)<>(SELECT count(*) FROM jsonb_each(p_mapping)) THEN
  RAISE EXCEPTION 'invalid item import metadata' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) e WHERE jsonb_typeof(e) IS DISTINCT FROM 'object'
   OR (e-ARRAY['row_no','input_data','errors','status'])<>'{}'::jsonb OR jsonb_typeof(e->'row_no') IS DISTINCT FROM 'number'
   OR e->>'row_no' !~ '^[0-9]+$' OR jsonb_typeof(e->'status') IS DISTINCT FROM 'string'
   OR (e->>'row_no')::integer NOT BETWEEN 2 AND 501 OR jsonb_typeof(e->'input_data') IS DISTINCT FROM 'object'
   OR jsonb_typeof(e->'errors') IS DISTINCT FROM 'array' OR e->>'status' NOT IN ('valid','invalid')
   OR CASE WHEN jsonb_typeof(e->'errors')='array' THEN jsonb_array_length(e->'errors')>20 OR
     (e->>'status'='valid' AND jsonb_array_length(e->'errors')<>0) OR (e->>'status'='invalid' AND jsonb_array_length(e->'errors')=0)
     ELSE true END) THEN
  RAISE EXCEPTION 'invalid item import rows' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_existing FROM finance.import_jobs WHERE organization_id=p_organization_id AND import_type='items' AND file_sha256=p_sha256 FOR UPDATE;
 IF FOUND THEN
  IF v_existing.created_by_member_id=v_actor AND v_existing.status='uploaded' AND v_existing.mapping=p_mapping THEN
   UPDATE finance.import_upload_intents SET state='pending',expires_at=now()+interval '10 minutes'
    WHERE organization_id=p_organization_id AND import_job_id=v_existing.id AND state IN ('pending','expired');
   RETURN QUERY SELECT v_existing.id,v_existing.file_object_key; RETURN;
  END IF;
  RAISE EXCEPTION 'duplicate item import file' USING ERRCODE='23505';
 END IF;
 v_key:=p_organization_id||'/imports/'||v_intent;
 INSERT INTO finance.import_jobs(id,organization_id,import_type,file_sha256,file_object_key,mapping,status,created_by_member_id,result_summary,source_sha256,source_filename,source_size)
 VALUES(v_job,p_organization_id,'items',p_sha256,v_key,p_mapping,'uploaded',v_actor,jsonb_build_object('row_count',jsonb_array_length(p_rows)),p_sha256,p_filename,p_size);
 INSERT INTO finance.import_rows(organization_id,job_id,row_no,input_data,errors,status)
 SELECT p_organization_id,v_job,(e->>'row_no')::integer,e->'input_data',e->'errors',e->>'status' FROM jsonb_array_elements(p_rows) e;
 INSERT INTO finance.import_upload_intents(id,organization_id,uploader_member_id,object_key,original_filename,expected_size,import_job_id)
 VALUES(v_intent,p_organization_id,v_actor,v_key,p_filename,p_size,v_job);
 RETURN QUERY SELECT v_job,v_key;
END $$;
REVOKE ALL ON FUNCTION public.create_item_import(uuid,text,bigint,text,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_item_import(uuid,text,bigint,text,jsonb,jsonb,text) TO authenticated;

CREATE FUNCTION public.complete_contact_import_upload(p_organization_id uuid,p_import_job_id uuid,p_sha256 text,p_request_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; j finance.import_jobs%ROWTYPE; i finance.import_upload_intents%ROWTYPE;
BEGIN
 v_actor:=finance_private.require_capability(p_organization_id,'imports.run'); PERFORM finance_private.validate_request_id(p_request_id);
 SELECT * INTO j FROM finance.import_jobs WHERE organization_id=p_organization_id AND id=p_import_job_id FOR UPDATE;
 IF NOT FOUND OR j.import_type NOT IN ('contacts','items') OR j.created_by_member_id<>v_actor THEN RAISE EXCEPTION 'import unavailable' USING ERRCODE='P0002'; END IF;
 SELECT * INTO i FROM finance.import_upload_intents WHERE organization_id=p_organization_id AND import_job_id=j.id FOR UPDATE;
 IF NOT FOUND OR i.uploader_member_id<>v_actor OR p_sha256<>j.source_sha256 OR i.expected_size<>j.source_size THEN
  RAISE EXCEPTION 'import upload unavailable' USING ERRCODE='P0002'; END IF;
 IF i.state='completed' AND j.status='ready' THEN RETURN true; END IF;
 IF i.state<>'pending' OR i.expires_at<=now() OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='ams-private-artifacts' AND o.name=i.object_key) THEN
  RAISE EXCEPTION 'import upload unavailable' USING ERRCODE='P0002'; END IF;
 UPDATE finance.import_upload_intents SET state='completed' WHERE organization_id=p_organization_id AND id=i.id;
 UPDATE finance.import_jobs SET status='ready' WHERE organization_id=p_organization_id AND id=j.id AND status='uploaded';
 INSERT INTO finance.audit_events(organization_id,actor_member_id,actor_kind,action,entity_type,entity_id,request_id,redacted_change)
 VALUES(p_organization_id,v_actor,'user','import.staged','import_job',j.id,p_request_id,
   jsonb_build_object('type','contacts','rows',(j.result_summary->>'row_count')::integer,'sha256',j.source_sha256));
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.complete_contact_import_upload(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_contact_import_upload(uuid,uuid,text,text) TO authenticated;

CREATE FUNCTION public.read_contact_import(p_organization_id uuid,p_import_job_id uuid DEFAULT NULL)
RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT finance_private.has_permission(p_organization_id,'imports.read') THEN RAISE EXCEPTION 'import unavailable' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT jsonb_build_object('id',j.id,'type','contacts','status',j.status,'filename',j.source_filename,'mapping',j.mapping,'created_at',j.created_at,
   'row_count',j.result_summary->'row_count','valid_count',(SELECT count(*) FROM finance.import_rows r WHERE r.organization_id=j.organization_id AND r.job_id=j.id AND r.status IN ('valid','imported')),
   'invalid_count',(SELECT count(*) FROM finance.import_rows r WHERE r.organization_id=j.organization_id AND r.job_id=j.id AND r.status='invalid'),
   'rows',COALESCE((SELECT jsonb_agg(jsonb_build_object('row_no',r.row_no,'input_data',r.input_data,'errors',r.errors,'status',r.status,
      'contact_id',r.result_contact_id) ORDER BY r.row_no) FROM finance.import_rows r WHERE r.organization_id=j.organization_id AND r.job_id=j.id),'[]'::jsonb))
 FROM finance.import_jobs j JOIN finance.organization_members m ON m.organization_id=j.organization_id AND m.id=j.created_by_member_id
 WHERE j.organization_id=p_organization_id AND j.import_type='contacts' AND (p_import_job_id IS NULL OR j.id=p_import_job_id)
  AND m.user_id=auth.uid() AND m.status='active' ORDER BY j.created_at DESC LIMIT CASE WHEN p_import_job_id IS NULL THEN 50 ELSE 1 END;
END $$;
REVOKE ALL ON FUNCTION public.read_contact_import(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_contact_import(uuid,uuid) TO authenticated;

CREATE FUNCTION public.read_item_import(p_organization_id uuid,p_import_job_id uuid DEFAULT NULL)
RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT finance_private.has_permission(p_organization_id,'imports.read') THEN RAISE EXCEPTION 'import unavailable' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT jsonb_build_object('id',j.id,'type','items','status',j.status,'filename',j.source_filename,'mapping',j.mapping,'created_at',j.created_at,
   'row_count',j.result_summary->'row_count','valid_count',(SELECT count(*) FROM finance.import_rows r WHERE r.organization_id=j.organization_id AND r.job_id=j.id AND r.status IN ('valid','imported')),
   'invalid_count',(SELECT count(*) FROM finance.import_rows r WHERE r.organization_id=j.organization_id AND r.job_id=j.id AND r.status='invalid'),
   'rows',COALESCE((SELECT jsonb_agg(jsonb_build_object('row_no',r.row_no,'input_data',r.input_data,'errors',r.errors,'status',r.status,
      'result_id',r.result_item_id) ORDER BY r.row_no) FROM finance.import_rows r WHERE r.organization_id=j.organization_id AND r.job_id=j.id),'[]'::jsonb))
 FROM finance.import_jobs j JOIN finance.organization_members m ON m.organization_id=j.organization_id AND m.id=j.created_by_member_id
 WHERE j.organization_id=p_organization_id AND j.import_type='items' AND (p_import_job_id IS NULL OR j.id=p_import_job_id)
  AND m.user_id=auth.uid() AND m.status='active' ORDER BY j.created_at DESC LIMIT CASE WHEN p_import_job_id IS NULL THEN 50 ELSE 1 END;
END $$;
REVOKE ALL ON FUNCTION public.read_item_import(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_item_import(uuid,uuid) TO authenticated;

CREATE FUNCTION public.mark_item_import_row(p_organization_id uuid,p_import_job_id uuid,p_row_no integer,p_item_id uuid,p_request_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; j finance.import_jobs%ROWTYPE;
BEGIN
 v_actor:=finance_private.require_capability(p_organization_id,'imports.run'); PERFORM finance_private.validate_request_id(p_request_id);
 SELECT * INTO j FROM finance.import_jobs WHERE organization_id=p_organization_id AND id=p_import_job_id FOR UPDATE;
 IF NOT FOUND OR j.import_type<>'items' OR j.created_by_member_id<>v_actor OR j.status NOT IN ('ready','running') THEN RAISE EXCEPTION 'import unavailable' USING ERRCODE='P0002'; END IF;
 UPDATE finance.import_jobs SET status='running' WHERE organization_id=p_organization_id AND id=j.id AND status='ready';
 UPDATE finance.import_rows SET status='imported',result_item_id=p_item_id,errors='[]'::jsonb WHERE organization_id=p_organization_id
  AND job_id=p_import_job_id AND row_no=p_row_no AND status IN ('valid','imported') AND (result_item_id IS NULL OR result_item_id=p_item_id);
 IF NOT FOUND THEN RAISE EXCEPTION 'import row unavailable' USING ERRCODE='P0002'; END IF;
 IF NOT EXISTS(SELECT 1 FROM finance.import_rows WHERE organization_id=p_organization_id AND job_id=p_import_job_id AND status<>'imported') THEN
  UPDATE finance.import_jobs SET status='completed',committed_at=COALESCE(committed_at,now()),result_summary=result_summary||jsonb_build_object('completed',true)
   WHERE organization_id=p_organization_id AND id=p_import_job_id;
  INSERT INTO finance.audit_events(organization_id,actor_member_id,actor_kind,action,entity_type,entity_id,request_id,redacted_change)
   VALUES(p_organization_id,v_actor,'user','import.completed','import_job',j.id,p_request_id,jsonb_build_object('type','items','rows',(j.result_summary->>'row_count')::integer));
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.mark_item_import_row(uuid,uuid,integer,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mark_item_import_row(uuid,uuid,integer,uuid,text) TO authenticated;

CREATE FUNCTION public.record_item_import_row_error(p_organization_id uuid,p_import_job_id uuid,p_row_no integer,p_message text,p_request_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; j finance.import_jobs%ROWTYPE;
BEGIN
 v_actor:=finance_private.require_capability(p_organization_id,'imports.run'); PERFORM finance_private.validate_request_id(p_request_id);
 SELECT * INTO j FROM finance.import_jobs WHERE organization_id=p_organization_id AND id=p_import_job_id FOR UPDATE;
 IF NOT FOUND OR j.import_type<>'items' OR j.created_by_member_id<>v_actor OR j.status NOT IN ('ready','running') OR p_message IS NULL OR length(p_message)>240 THEN
  RAISE EXCEPTION 'import row unavailable' USING ERRCODE='P0002'; END IF;
 UPDATE finance.import_rows SET errors=jsonb_build_array(p_message) WHERE organization_id=p_organization_id AND job_id=p_import_job_id AND row_no=p_row_no AND status='valid';
 IF NOT FOUND THEN RAISE EXCEPTION 'import row unavailable' USING ERRCODE='P0002'; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.record_item_import_row_error(uuid,uuid,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_item_import_row_error(uuid,uuid,integer,text,text) TO authenticated;

CREATE FUNCTION public.mark_contact_import_row(p_organization_id uuid,p_import_job_id uuid,p_row_no integer,p_contact_id uuid,p_request_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; j finance.import_jobs%ROWTYPE;
BEGIN
 v_actor:=finance_private.require_capability(p_organization_id,'imports.run'); PERFORM finance_private.validate_request_id(p_request_id);
 SELECT * INTO j FROM finance.import_jobs WHERE organization_id=p_organization_id AND id=p_import_job_id FOR UPDATE;
 IF NOT FOUND OR j.import_type<>'contacts' OR j.created_by_member_id<>v_actor OR j.status NOT IN ('ready','running') THEN RAISE EXCEPTION 'import unavailable' USING ERRCODE='P0002'; END IF;
 UPDATE finance.import_jobs SET status='running' WHERE organization_id=p_organization_id AND id=j.id AND status='ready';
 UPDATE finance.import_rows SET status='imported',result_contact_id=p_contact_id,errors='[]'::jsonb WHERE organization_id=p_organization_id
  AND job_id=p_import_job_id AND row_no=p_row_no AND status IN ('valid','imported')
  AND (result_contact_id IS NULL OR result_contact_id=p_contact_id);
 IF NOT FOUND THEN RAISE EXCEPTION 'import row unavailable' USING ERRCODE='P0002'; END IF;
 IF NOT EXISTS(SELECT 1 FROM finance.import_rows WHERE organization_id=p_organization_id AND job_id=p_import_job_id AND status<>'imported') THEN
  UPDATE finance.import_jobs SET status='completed',committed_at=COALESCE(committed_at,now()),
   result_summary=result_summary||jsonb_build_object('completed',true)
   WHERE organization_id=p_organization_id AND id=p_import_job_id;
  INSERT INTO finance.audit_events(organization_id,actor_member_id,actor_kind,action,entity_type,entity_id,request_id,redacted_change)
   VALUES(p_organization_id,v_actor,'user','import.completed','import_job',j.id,p_request_id,
   jsonb_build_object('type',j.import_type,'rows',(j.result_summary->>'row_count')::integer));
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.mark_contact_import_row(uuid,uuid,integer,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mark_contact_import_row(uuid,uuid,integer,uuid,text) TO authenticated;

CREATE FUNCTION public.record_contact_import_row_error(p_organization_id uuid,p_import_job_id uuid,p_row_no integer,p_message text,p_request_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; j finance.import_jobs%ROWTYPE;
BEGIN
 v_actor:=finance_private.require_capability(p_organization_id,'imports.run'); PERFORM finance_private.validate_request_id(p_request_id);
 SELECT * INTO j FROM finance.import_jobs WHERE organization_id=p_organization_id AND id=p_import_job_id FOR UPDATE;
 IF NOT FOUND OR j.import_type<>'contacts' OR j.created_by_member_id<>v_actor OR j.status NOT IN ('ready','running') OR p_message IS NULL OR length(p_message)>240 THEN
  RAISE EXCEPTION 'import row unavailable' USING ERRCODE='P0002'; END IF;
 UPDATE finance.import_rows SET errors=jsonb_build_array(p_message) WHERE organization_id=p_organization_id
  AND job_id=p_import_job_id AND row_no=p_row_no AND status='valid';
 IF NOT FOUND THEN RAISE EXCEPTION 'import row unavailable' USING ERRCODE='P0002'; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.record_contact_import_row_error(uuid,uuid,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_contact_import_row_error(uuid,uuid,integer,text,text) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
