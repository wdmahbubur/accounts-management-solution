-- Date defaults follow the stored company timezone, using the server clock.
-- Return a calendar string, not an instant shifted by the browser's locale.
CREATE OR REPLACE FUNCTION public.read_company_locale(p_organization_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM finance.organization_members WHERE organization_id=p_organization_id AND user_id=identity.current_actor_id() AND status='active') THEN
  RAISE EXCEPTION 'company unavailable' USING ERRCODE='P0002'; END IF;
 RETURN(SELECT jsonb_build_object('organization_id',id,'country_code',country_code,'base_currency',base_currency,
  'timezone',timezone,'today',to_char(CURRENT_TIMESTAMP AT TIME ZONE timezone,'YYYY-MM-DD'))
  FROM finance.organizations WHERE id=p_organization_id);
END $$;
REVOKE ALL ON FUNCTION public.read_company_locale(uuid) FROM PUBLIC,ams_runtime,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_company_locale(uuid) TO ams_runtime;
NOTIFY pgrst,'reload schema';
