-- US-070: persist an idempotent, permission-bound export request before rendering.
CREATE FUNCTION public.request_trial_balance_export(
  p_organization_id uuid,p_request_id text,p_idempotency_key text,p_request_hash text,p_as_of date,p_format text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid;v_org_status text;v_job finance.export_jobs%ROWTYPE;v_existing finance.idempotency_requests%ROWTYPE;v_result jsonb;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  v_actor:=identity.current_actor_id();
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='28000'; END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{22,172}$' OR
     p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' OR
     p_as_of IS NULL OR NOT isfinite(p_as_of) OR p_format IS DISTINCT FROM 'csv' THEN
    RAISE EXCEPTION 'invalid export request' USING ERRCODE='22023';
  END IF;
  IF NOT finance_private.has_permission(p_organization_id,'reports.export') OR
     NOT finance_private.has_permission(p_organization_id,'exports.read') OR
     NOT finance_private.has_permission(p_organization_id,'reports.read') OR
     NOT finance_private.has_permission(p_organization_id,'accounting.read') OR
     NOT finance_private.has_permission(p_organization_id,'ledger.read') THEN
    RAISE EXCEPTION 'export permission required' USING ERRCODE='42501';
  END IF;
  SELECT o.status INTO v_org_status FROM finance.organizations o WHERE o.id=p_organization_id;
  IF NOT FOUND OR v_org_status='archived' THEN RAISE EXCEPTION 'company unavailable' USING ERRCODE='P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':export.trial-balance:'||p_idempotency_key,0));
  SELECT * INTO v_existing FROM finance.idempotency_requests i WHERE i.organization_id=p_organization_id
    AND i.operation='export.trial-balance' AND i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.actor_member_id<>(SELECT m.id FROM finance.organization_members m WHERE m.organization_id=p_organization_id AND m.user_id=v_actor AND m.status='active' LIMIT 1)
       OR v_existing.request_hash<>p_request_hash THEN RAISE EXCEPTION 'idempotency conflict' USING ERRCODE='23505'; END IF;
    RETURN v_existing.response_body||jsonb_build_object('replayed',true);
  END IF;
  SELECT m.id INTO v_actor FROM finance.organization_members m WHERE m.organization_id=p_organization_id AND m.user_id=v_actor AND m.status='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'company unavailable' USING ERRCODE='P0002'; END IF;
  INSERT INTO finance.export_jobs(organization_id,requested_by_member_id,export_type,parameters,ledger_cutoff_at,format,status)
    VALUES(p_organization_id,v_actor,'trial_balance',jsonb_build_object('as_of',p_as_of),transaction_timestamp(),'csv','queued') RETURNING * INTO v_job;
  v_result:=jsonb_build_object('id',v_job.id,'organization_id',v_job.organization_id,'export_type',v_job.export_type,
    'parameters',v_job.parameters,'ledger_cutoff_at',v_job.ledger_cutoff_at,'format',v_job.format,'status',v_job.status,'created_at',v_job.created_at,'replayed',false);
  INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body)
    VALUES(p_organization_id,'export.trial-balance',p_idempotency_key,p_request_hash,v_actor,202,v_result);
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'report.export_requested','export_job',v_job.id,p_request_id,
    jsonb_build_object('export_type','trial_balance','format','csv','as_of',p_as_of,'ledger_cutoff_at',v_job.ledger_cutoff_at));
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.request_trial_balance_export(uuid,text,text,text,date,text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.request_trial_balance_export(uuid,text,text,text,date,text) TO ams_runtime;

CREATE FUNCTION public.list_own_export_jobs(p_organization_id uuid,p_limit integer DEFAULT 50)
RETURNS TABLE(id uuid,export_type text,parameters jsonb,ledger_cutoff_at timestamptz,format text,status text,
  expires_at timestamptz,error_code text,created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user uuid:=identity.current_actor_id();v_member uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='28000'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid page size' USING ERRCODE='22023'; END IF;
  IF NOT finance_private.has_permission(p_organization_id,'exports.read') THEN RAISE EXCEPTION 'export permission required' USING ERRCODE='42501'; END IF;
  SELECT m.id INTO v_member FROM finance.organization_members m WHERE m.organization_id=p_organization_id AND m.user_id=v_user AND m.status='active';
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM finance.organizations o WHERE o.id=p_organization_id AND o.status<>'archived') THEN
    RAISE EXCEPTION 'company unavailable' USING ERRCODE='P0002';
  END IF;
  RETURN QUERY SELECT e.id,e.export_type,e.parameters,e.ledger_cutoff_at,e.format,e.status,e.expires_at,e.error_code,e.created_at
    FROM finance.export_jobs e WHERE e.organization_id=p_organization_id AND e.requested_by_member_id=v_member
    ORDER BY e.created_at DESC,e.id DESC LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.list_own_export_jobs(uuid,integer) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.list_own_export_jobs(uuid,integer) TO ams_runtime;
