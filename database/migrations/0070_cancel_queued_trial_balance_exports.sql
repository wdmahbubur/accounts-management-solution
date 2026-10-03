-- US-070: permit the requester to cancel an export only before a worker claims it.
ALTER TABLE finance.export_jobs DROP CONSTRAINT export_jobs_status_check;
ALTER TABLE finance.export_jobs ADD CONSTRAINT export_jobs_status_check
  CHECK (status IN ('queued','running','completed','failed','expired','cancelled'));

CREATE FUNCTION public.cancel_trial_balance_export(
  p_organization_id uuid, p_export_id uuid, p_request_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_member uuid; v_job finance.export_jobs%ROWTYPE;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  v_actor:=identity.current_actor_id();
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='28000'; END IF;
  IF NOT finance_private.has_permission(p_organization_id,'reports.export')
     OR NOT finance_private.has_permission(p_organization_id,'exports.read') THEN
    RAISE EXCEPTION 'export permission required' USING ERRCODE='42501';
  END IF;
  SELECT m.id INTO v_member FROM finance.organization_members m
    WHERE m.organization_id=p_organization_id AND m.user_id=v_actor AND m.status='active' FOR SHARE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM finance.organizations o WHERE o.id=p_organization_id AND o.status<>'archived') THEN
    RAISE EXCEPTION 'company unavailable' USING ERRCODE='P0002';
  END IF;
  SELECT e.* INTO v_job FROM finance.export_jobs e
    WHERE e.organization_id=p_organization_id AND e.id=p_export_id
      AND e.requested_by_member_id=v_member AND e.export_type='trial_balance' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'export unavailable' USING ERRCODE='P0002'; END IF;
  IF v_job.status='cancelled' THEN RETURN jsonb_build_object('id',v_job.id,'status','cancelled','replayed',true); END IF;
  IF v_job.status<>'queued' THEN RAISE EXCEPTION 'export is no longer cancellable' USING ERRCODE='40001'; END IF;
  UPDATE finance.export_jobs SET status='cancelled',error_code=NULL
    WHERE organization_id=p_organization_id AND id=p_export_id AND status='queued';
  IF NOT FOUND THEN RAISE EXCEPTION 'export is no longer cancellable' USING ERRCODE='40001'; END IF;
  PERFORM finance_private.write_role_audit(p_organization_id,v_member,'report.export_cancelled','export_job',p_export_id,p_request_id,
    jsonb_build_object('export_type','trial_balance'));
  RETURN jsonb_build_object('id',p_export_id,'status','cancelled','replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.cancel_trial_balance_export(uuid,uuid,text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.cancel_trial_balance_export(uuid,uuid,text) TO ams_runtime;
NOTIFY pgrst,'reload schema';
