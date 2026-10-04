-- US-049: show possible fingerprint duplicates during preview, before confirmation.
CREATE FUNCTION public.count_statement_fingerprint_matches(p_organization_id uuid,p_cash_account_id uuid,p_fingerprints text[])
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_count integer;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'banking.write');
  IF cardinality(p_fingerprints)>10000 OR EXISTS(SELECT 1 FROM unnest(p_fingerprints) f WHERE f !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'Invalid fingerprint list.' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM finance.cash_accounts c WHERE c.organization_id=p_organization_id AND c.id=p_cash_account_id AND c.is_active) THEN
    RAISE EXCEPTION 'Cash account unavailable.' USING ERRCODE='P0002';
  END IF;
  SELECT count(DISTINCT s.fingerprint)::integer INTO v_count
    FROM finance.statement_lines s JOIN unnest(p_fingerprints) f(fingerprint) ON f.fingerprint=s.fingerprint
   WHERE s.organization_id=p_organization_id AND s.cash_account_id=p_cash_account_id;
  RETURN COALESCE(v_count,0);
END; $$;
REVOKE ALL ON FUNCTION public.count_statement_fingerprint_matches(uuid,uuid,text[]) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.count_statement_fingerprint_matches(uuid,uuid,text[]) TO ams_runtime;
NOTIFY pgrst,'reload schema';
