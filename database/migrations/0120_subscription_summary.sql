-- Read the existing SaaS subscription model without inventing commercial terms.
CREATE FUNCTION public.read_subscription_summary(p_organization_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE subscription jsonb;members integer;
BEGIN
 PERFORM finance_private.require_capability(p_organization_id,'subscription.read');
 SELECT jsonb_build_object('plan_code',p.code,'plan_name',p.name,'status',s.status,
   'period_start',s.current_period_start,'period_end',s.current_period_end,'grace_until',s.grace_until)
 INTO subscription FROM finance.subscriptions s JOIN finance.plans p ON p.id=s.plan_id WHERE s.organization_id=p_organization_id;
 SELECT count(*)::integer INTO members FROM finance.organization_members m WHERE m.organization_id=p_organization_id AND m.status='active';
 RETURN jsonb_build_object('organization_id',p_organization_id,'subscription',subscription,'active_members',members);
END $$;
REVOKE ALL ON FUNCTION public.read_subscription_summary(uuid) FROM PUBLIC,ams_runtime,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_subscription_summary(uuid) TO ams_runtime;
NOTIFY pgrst,'reload schema';
