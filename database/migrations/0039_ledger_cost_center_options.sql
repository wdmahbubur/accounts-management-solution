-- US-048: organization-scoped filter options for ledger readers.
CREATE FUNCTION public.list_ledger_cost_centers(p_organization_id uuid)
RETURNS TABLE(id uuid,code text,name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'ledger.read');
  RETURN QUERY SELECT c.id,c.code,c.name FROM finance.cost_centers c WHERE c.organization_id=p_organization_id AND c.is_active ORDER BY c.code,c.id;
END; $$;
REVOKE ALL ON FUNCTION public.list_ledger_cost_centers(uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.list_ledger_cost_centers(uuid) TO ams_runtime;
NOTIFY pgrst,'reload schema';
