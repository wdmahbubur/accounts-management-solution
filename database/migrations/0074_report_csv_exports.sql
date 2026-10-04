-- US-072: queue immutable CSV snapshots for the implemented financial statements.
-- The snapshot is captured by the existing report functions inside the request
-- transaction, so exports use the same dated, posted-ledger semantics as screens.

CREATE OR REPLACE FUNCTION finance_private.snapshot_export_company_name() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_as_of date; v_snapshot jsonb; v_filters jsonb;
BEGIN
 IF NEW.company_name_snapshot IS NULL THEN
  SELECT o.name INTO NEW.company_name_snapshot FROM finance.organizations o WHERE o.id=NEW.organization_id;
 END IF;
 IF NEW.format='csv' AND NEW.export_type='trial_balance' THEN
  IF jsonb_typeof(NEW.parameters) IS DISTINCT FROM 'object' OR
     COALESCE(NEW.parameters->>'as_of','') !~ '^\d{4}-\d{2}-\d{2}$' THEN
   RAISE EXCEPTION 'invalid saved export filters' USING ERRCODE='22023'; END IF;
  v_as_of:=(NEW.parameters->>'as_of')::date;
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.account_code),'[]'::jsonb) INTO NEW.snapshot_data
    FROM public.read_trial_balance(NEW.organization_id,v_as_of,NULL) t;
 ELSIF NEW.format IN ('csv','pdf','xlsx') AND NEW.export_type IN ('profit_and_loss','balance_sheet','customer_statement','vendor_statement') THEN
  IF jsonb_typeof(NEW.parameters) IS DISTINCT FROM 'object' THEN
   RAISE EXCEPTION 'invalid saved export filters' USING ERRCODE='22023'; END IF;
  IF NEW.export_type='profit_and_loss' THEN
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(NEW.parameters) k WHERE k NOT IN ('from','to','cost_center','comparison_from','comparison_to')) OR
      COALESCE(NEW.parameters->>'from','') !~ '^\d{4}-\d{2}-\d{2}$' OR
      COALESCE(NEW.parameters->>'to','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'invalid saved P&L filters' USING ERRCODE='22023'; END IF;
   v_snapshot:=public.read_profit_loss_snapshot(NEW.organization_id,(NEW.parameters->>'from')::date,(NEW.parameters->>'to')::date,
      NULLIF(NEW.parameters->>'cost_center','')::uuid,NULLIF(NEW.parameters->>'comparison_from','')::date,NULLIF(NEW.parameters->>'comparison_to','')::date);
  ELSIF NEW.export_type='balance_sheet' THEN
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(NEW.parameters) k WHERE k NOT IN ('as_of','comparison_as_of')) OR
      COALESCE(NEW.parameters->>'as_of','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'invalid saved balance-sheet filters' USING ERRCODE='22023'; END IF;
   v_snapshot:=public.read_balance_sheet_snapshot(NEW.organization_id,(NEW.parameters->>'as_of')::date,NULLIF(NEW.parameters->>'comparison_as_of','')::date);
  ELSE
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(NEW.parameters) k WHERE k NOT IN ('party_id','from','to')) OR
      COALESCE(NEW.parameters->>'party_id','') !~* '^[0-9a-f-]{36}$' OR
      COALESCE(NEW.parameters->>'from','') !~ '^\d{4}-\d{2}-\d{2}$' OR
      COALESCE(NEW.parameters->>'to','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'invalid saved statement filters' USING ERRCODE='22023'; END IF;
   v_snapshot:=public.read_party_statement_snapshot(NEW.organization_id,
      CASE WHEN NEW.export_type='customer_statement' THEN 'customer' ELSE 'vendor' END,
      (NEW.parameters->>'party_id')::uuid,(NEW.parameters->>'from')::date,(NEW.parameters->>'to')::date);
  END IF;
  IF v_snapshot IS NULL OR jsonb_typeof(v_snapshot) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'report snapshot unavailable' USING ERRCODE='P0002'; END IF;
  NEW.ledger_cutoff_at:=(v_snapshot->>'ledger_cutoff_at')::timestamptz;
  NEW.snapshot_data:=jsonb_build_array(v_snapshot||jsonb_build_object('export_format',NEW.format));
 END IF;
 IF octet_length(NEW.snapshot_data::text)>8000000 THEN
  RAISE EXCEPTION 'report exceeds export capacity' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION finance_private.export_requester_authorized_for_type(p_org uuid,p_member uuid,p_type text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT finance_private.member_has_capability(p_org,p_member,'exports.read')
  AND finance_private.member_has_capability(p_org,p_member,'reports.export') AND CASE p_type
  WHEN 'trial_balance' THEN finance_private.member_has_capability(p_org,p_member,'reports.read')
    AND finance_private.member_has_capability(p_org,p_member,'accounting.read') AND finance_private.member_has_capability(p_org,p_member,'ledger.read')
  WHEN 'profit_and_loss' THEN finance_private.member_has_capability(p_org,p_member,'reports.read')
  WHEN 'balance_sheet' THEN finance_private.member_has_capability(p_org,p_member,'reports.read')
  WHEN 'customer_statement' THEN finance_private.member_has_capability(p_org,p_member,'dues.read') OR finance_private.member_has_capability(p_org,p_member,'sales.read')
  WHEN 'vendor_statement' THEN finance_private.member_has_capability(p_org,p_member,'dues.read') OR finance_private.member_has_capability(p_org,p_member,'purchases.read')
  ELSE false END
$$;
REVOKE ALL ON FUNCTION finance_private.export_requester_authorized_for_type(uuid,uuid,text) FROM PUBLIC,ams_runtime,ams_job_worker;

CREATE OR REPLACE FUNCTION finance_private.complete_trial_balance_export(p_job_id uuid,p_lease_token uuid,p_byte_size bigint,p_sha256 text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_job finance.export_jobs%ROWTYPE;
BEGIN
 SELECT * INTO v_job FROM finance.export_jobs e WHERE e.id=p_job_id FOR UPDATE;
 IF NOT FOUND OR v_job.status<>'running' OR v_job.lease_token IS DISTINCT FROM p_lease_token OR v_job.lease_until<=clock_timestamp() THEN
  RAISE EXCEPTION 'export lease unavailable' USING ERRCODE='40001'; END IF;
 IF p_byte_size IS NULL OR p_byte_size NOT BETWEEN 1 AND 10485760 OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'invalid export output' USING ERRCODE='22023'; END IF;
 IF NOT finance_private.export_requester_authorized_for_type(v_job.organization_id,v_job.requested_by_member_id,v_job.export_type)
  OR NOT EXISTS(SELECT 1 FROM finance.organization_members m JOIN finance.organizations o ON o.id=m.organization_id
   WHERE m.organization_id=v_job.organization_id AND m.id=v_job.requested_by_member_id AND m.status='active' AND o.status<>'archived') THEN
  UPDATE finance.export_jobs SET status='failed',error_code='REQUESTER_ACCESS_REVOKED',lease_token=NULL,lease_until=NULL WHERE id=v_job.id;
  RETURN false;
 END IF;
 UPDATE finance.export_jobs SET status='completed',object_key=organization_id||'/exports/'||id,output_size=p_byte_size,output_sha256=p_sha256,
  generated_at=v_job.ledger_cutoff_at,expires_at=clock_timestamp()+interval '24 hours',error_code=NULL,lease_token=NULL,lease_until=NULL
  WHERE organization_id=v_job.organization_id AND id=v_job.id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION finance_private.complete_trial_balance_export(uuid,uuid,bigint,text) FROM PUBLIC,ams_runtime,ams_job_worker;
GRANT EXECUTE ON FUNCTION finance_private.complete_trial_balance_export(uuid,uuid,bigint,text) TO ams_runtime;

CREATE OR REPLACE FUNCTION finance_private.claim_trial_balance_exports(p_limit integer DEFAULT 3,p_lease_seconds integer DEFAULT 600)
RETURNS TABLE(job_id uuid,organization_id uuid,requester_member_id uuid,company_name text,parameters jsonb,
  ledger_cutoff_at timestamptz,created_at timestamptz,lease_token uuid,attempt_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_now timestamptz:=clock_timestamp();
BEGIN
 IF p_limit NOT BETWEEN 1 AND 10 OR p_lease_seconds NOT BETWEEN 60 AND 1800 THEN RAISE EXCEPTION 'invalid export worker claim' USING ERRCODE='22023'; END IF;
 UPDATE finance.export_jobs e SET status='expired',lease_token=NULL,lease_until=NULL WHERE e.status='completed' AND e.expires_at<=v_now;
 UPDATE finance.export_jobs e SET status='failed',lease_token=NULL,lease_until=NULL,error_code='REQUESTER_ACCESS_REVOKED'
  WHERE e.status IN ('queued','running') AND e.export_type IN ('trial_balance','profit_and_loss','balance_sheet','customer_statement','vendor_statement')
   AND NOT EXISTS(SELECT 1 FROM finance.organizations o JOIN finance.organization_members m ON m.organization_id=o.id
    WHERE o.id=e.organization_id AND o.status<>'archived' AND m.id=e.requested_by_member_id AND m.status='active'
     AND finance_private.export_requester_authorized_for_type(e.organization_id,m.id,e.export_type));
 UPDATE finance.export_jobs e SET status='failed',lease_token=NULL,lease_until=NULL,error_code='EXPORT_RETRY_LIMIT'
  WHERE e.status='running' AND e.lease_until<=v_now AND e.attempt_count>=5;
 RETURN QUERY WITH ready AS (
  SELECT e.organization_id,e.id FROM finance.export_jobs e JOIN finance.organizations o ON o.id=e.organization_id
   JOIN finance.organization_members m ON m.organization_id=e.organization_id AND m.id=e.requested_by_member_id
   WHERE e.export_type IN ('trial_balance','profit_and_loss','balance_sheet','customer_statement','vendor_statement') AND e.format IN ('csv','pdf','xlsx')
    AND e.attempt_count<5 AND o.status<>'archived' AND m.status='active' AND finance_private.export_requester_authorized_for_type(e.organization_id,m.id,e.export_type)
    AND e.available_at<=v_now AND (e.status='queued' OR (e.status='running' AND e.lease_until<=v_now))
   ORDER BY e.created_at,e.id FOR UPDATE OF e SKIP LOCKED LIMIT p_limit
 ), claimed AS (
  UPDATE finance.export_jobs e SET status='running',attempt_count=e.attempt_count+1,lease_token=gen_random_uuid(),
    lease_until=v_now+make_interval(secs=>p_lease_seconds),error_code=NULL FROM ready r
   WHERE e.organization_id=r.organization_id AND e.id=r.id
   RETURNING e.id,e.organization_id,e.requested_by_member_id,e.company_name_snapshot,e.parameters,e.ledger_cutoff_at,e.created_at,e.lease_token,e.attempt_count
 ) SELECT c.id,c.organization_id,c.requested_by_member_id,c.company_name_snapshot,c.parameters,c.ledger_cutoff_at,c.created_at,c.lease_token,c.attempt_count FROM claimed c;
END $$;
REVOKE ALL ON FUNCTION finance_private.claim_trial_balance_exports(integer,integer) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION finance_private.claim_trial_balance_exports(integer,integer) TO ams_runtime;

CREATE FUNCTION finance_private.read_report_export_snapshot(p_job_id uuid,p_lease_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_job finance.export_jobs%ROWTYPE;
BEGIN
 SELECT * INTO v_job FROM finance.export_jobs e WHERE e.id=p_job_id FOR SHARE;
 IF NOT FOUND OR v_job.format NOT IN ('csv','pdf','xlsx') OR v_job.status<>'running' OR v_job.lease_token IS DISTINCT FROM p_lease_token OR v_job.lease_until<=clock_timestamp()
  OR NOT finance_private.export_requester_authorized_for_type(v_job.organization_id,v_job.requested_by_member_id,v_job.export_type)
  OR NOT EXISTS(SELECT 1 FROM finance.organization_members m JOIN finance.organizations o ON o.id=m.organization_id
   WHERE m.organization_id=v_job.organization_id AND m.id=v_job.requested_by_member_id AND m.status='active' AND o.status<>'archived')
 THEN RAISE EXCEPTION 'export lease unavailable' USING ERRCODE='40001'; END IF;
 IF v_job.export_type='trial_balance' THEN RETURN NULL; END IF;
 IF v_job.export_type NOT IN ('profit_and_loss','balance_sheet','customer_statement','vendor_statement') OR jsonb_array_length(v_job.snapshot_data)<>1 THEN
  RAISE EXCEPTION 'export snapshot unavailable' USING ERRCODE='P0002'; END IF;
 RETURN v_job.snapshot_data->0;
END $$;
REVOKE ALL ON FUNCTION finance_private.read_report_export_snapshot(uuid,uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION finance_private.read_report_export_snapshot(uuid,uuid) TO ams_runtime;

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
     AND e.status='completed' AND e.expires_at>now() AND e.export_type IN ('trial_balance','profit_and_loss','balance_sheet','customer_statement','vendor_statement')
     AND finance_private.export_requester_authorized_for_type(e.organization_id,e.requested_by_member_id,e.export_type)))
$$;
REVOKE ALL ON FUNCTION finance_private.can_download_artifact(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance_private.can_download_artifact(text) TO ams_runtime;

CREATE OR REPLACE FUNCTION public.cancel_trial_balance_export(p_organization_id uuid,p_export_id uuid,p_request_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid;v_member uuid;v_job finance.export_jobs%ROWTYPE;
BEGIN
 PERFORM finance_private.validate_request_id(p_request_id);v_actor:=identity.current_actor_id();
 IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='28000'; END IF;
 IF NOT finance_private.has_permission(p_organization_id,'reports.export') OR NOT finance_private.has_permission(p_organization_id,'exports.read') THEN RAISE EXCEPTION 'export permission required' USING ERRCODE='42501'; END IF;
 SELECT m.id INTO v_member FROM finance.organization_members m WHERE m.organization_id=p_organization_id AND m.user_id=v_actor AND m.status='active' FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM finance.organizations o WHERE o.id=p_organization_id AND o.status<>'archived') THEN RAISE EXCEPTION 'company unavailable' USING ERRCODE='P0002'; END IF;
 SELECT e.* INTO v_job FROM finance.export_jobs e WHERE e.organization_id=p_organization_id AND e.id=p_export_id AND e.requested_by_member_id=v_member
  AND e.export_type IN ('trial_balance','profit_and_loss','balance_sheet','customer_statement','vendor_statement') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'export unavailable' USING ERRCODE='P0002'; END IF;
 IF NOT finance_private.export_requester_authorized_for_type(p_organization_id,v_member,v_job.export_type) THEN RAISE EXCEPTION 'report export permission required' USING ERRCODE='42501'; END IF;
 IF v_job.status='cancelled' THEN RETURN jsonb_build_object('id',v_job.id,'status','cancelled','replayed',true); END IF;
 IF v_job.status<>'queued' THEN RAISE EXCEPTION 'export is no longer cancellable' USING ERRCODE='40001'; END IF;
 UPDATE finance.export_jobs SET status='cancelled',error_code=NULL WHERE organization_id=p_organization_id AND id=p_export_id AND status='queued';
 IF NOT FOUND THEN RAISE EXCEPTION 'export is no longer cancellable' USING ERRCODE='40001'; END IF;
 PERFORM finance_private.write_role_audit(p_organization_id,v_member,'report.export_cancelled','export_job',p_export_id,p_request_id,jsonb_build_object('export_type',v_job.export_type));
 RETURN jsonb_build_object('id',p_export_id,'status','cancelled','replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.cancel_trial_balance_export(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_trial_balance_export(uuid,uuid,text) TO ams_runtime;

CREATE FUNCTION public.request_report_export(p_organization_id uuid,p_request_id text,p_idempotency_key text,p_request_hash text,p_export_type text,p_format text,p_parameters jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid;v_member uuid;v_job finance.export_jobs%ROWTYPE;v_existing finance.idempotency_requests%ROWTYPE;v_result jsonb;v_operation text;
BEGIN
 PERFORM finance_private.validate_request_id(p_request_id);v_actor:=identity.current_actor_id();
 IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='28000'; END IF;
 IF p_export_type NOT IN ('profit_and_loss','balance_sheet','customer_statement','vendor_statement') OR p_format IS NULL OR p_format NOT IN ('csv','pdf','xlsx') OR jsonb_typeof(p_parameters) IS DISTINCT FROM 'object'
  OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{22,172}$' OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'invalid export request' USING ERRCODE='22023'; END IF;
 IF NOT finance_private.has_permission(p_organization_id,'reports.export') OR NOT finance_private.has_permission(p_organization_id,'exports.read') THEN
  RAISE EXCEPTION 'export permission required' USING ERRCODE='42501'; END IF;
 IF p_export_type IN ('profit_and_loss','balance_sheet') AND NOT finance_private.has_permission(p_organization_id,'reports.read') THEN
  RAISE EXCEPTION 'report permission required' USING ERRCODE='42501'; END IF;
 IF p_export_type IN ('customer_statement','vendor_statement') AND NOT finance_private.has_permission(p_organization_id,
    CASE WHEN p_export_type='customer_statement' THEN 'sales.read' ELSE 'purchases.read' END)
    AND NOT finance_private.has_permission(p_organization_id,'dues.read') THEN RAISE EXCEPTION 'statement permission required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM finance.organizations o WHERE o.id=p_organization_id AND o.status<>'archived') THEN RAISE EXCEPTION 'company unavailable' USING ERRCODE='P0002'; END IF;
 v_operation:='export.'||p_export_type;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||v_operation||':'||p_idempotency_key,0));
 SELECT * INTO v_existing FROM finance.idempotency_requests i WHERE i.organization_id=p_organization_id AND i.operation=v_operation AND i.idempotency_key=p_idempotency_key FOR UPDATE;
 IF FOUND THEN
  IF v_existing.actor_member_id<>(SELECT m.id FROM finance.organization_members m WHERE m.organization_id=p_organization_id AND m.user_id=v_actor AND m.status='active' LIMIT 1)
   OR v_existing.request_hash<>p_request_hash THEN RAISE EXCEPTION 'idempotency conflict' USING ERRCODE='23505'; END IF;
  RETURN v_existing.response_body||jsonb_build_object('replayed',true);
 END IF;
 SELECT m.id INTO v_member FROM finance.organization_members m WHERE m.organization_id=p_organization_id AND m.user_id=v_actor AND m.status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'company unavailable' USING ERRCODE='P0002'; END IF;
 INSERT INTO finance.export_jobs(organization_id,requested_by_member_id,export_type,parameters,ledger_cutoff_at,format,status)
  VALUES(p_organization_id,v_member,p_export_type,p_parameters,transaction_timestamp(),p_format,'queued') RETURNING * INTO v_job;
 v_result:=jsonb_build_object('id',v_job.id,'organization_id',v_job.organization_id,'export_type',v_job.export_type,'parameters',v_job.parameters,
  'ledger_cutoff_at',v_job.ledger_cutoff_at,'format',v_job.format,'status',v_job.status,'created_at',v_job.created_at,'replayed',false);
 INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body)
  VALUES(p_organization_id,v_operation,p_idempotency_key,p_request_hash,v_member,202,v_result);
 PERFORM finance_private.write_role_audit(p_organization_id,v_member,'report.export_requested','export_job',v_job.id,p_request_id,
  jsonb_build_object('export_type',p_export_type,'format',p_format,'filters',p_parameters,'ledger_cutoff_at',v_job.ledger_cutoff_at));
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.request_report_export(uuid,text,text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_report_export(uuid,text,text,text,text,text,jsonb) TO ams_runtime;
NOTIFY pgrst,'reload schema';
