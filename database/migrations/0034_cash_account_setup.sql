-- US-044: cash/bank/wallet setup; balances are always read from the ledger.
CREATE FUNCTION public.list_cash_account_options(p_organization_id uuid)
RETURNS TABLE(id uuid,code text,name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'banking.read');
  RETURN QUERY SELECT a.id,a.code,a.name FROM finance.accounts a WHERE a.organization_id=p_organization_id
    AND a.account_type='asset' AND a.control_kind IS NULL AND a.is_postable AND a.is_active
    AND (a.report_group ILIKE '%cash%' OR a.report_group ILIKE '%bank%' OR a.report_group ILIKE '%wallet%')
  ORDER BY a.code,a.id;
END; $$;
REVOKE ALL ON FUNCTION public.list_cash_account_options(uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.list_cash_account_options(uuid) TO ams_runtime;

CREATE FUNCTION public.read_cash_accounts(p_organization_id uuid)
RETURNS TABLE(id uuid,name text,kind text,institution text,masked_account_number text,is_cash_equivalent boolean,allow_negative_balance boolean,is_active boolean,account_id uuid,account_code text,account_name text,book_balance text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'banking.read');
  RETURN QUERY SELECT ca.id,ca.name,ca.kind,ca.institution,ca.masked_account_number,ca.is_cash_equivalent,ca.allow_negative_balance,ca.is_active,
    a.id,a.code,a.name,COALESCE(sum(CASE WHEN je.state='posted' THEN jl.debit-jl.credit ELSE 0 END),0)::text
  FROM finance.cash_accounts ca JOIN finance.accounts a ON a.organization_id=ca.organization_id AND a.id=ca.account_id
  LEFT JOIN finance.journal_lines jl ON jl.organization_id=ca.organization_id AND jl.account_id=ca.account_id
  LEFT JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
  WHERE ca.organization_id=p_organization_id GROUP BY ca.id,a.id ORDER BY ca.is_active DESC,ca.name,ca.id;
END; $$;
REVOKE ALL ON FUNCTION public.read_cash_accounts(uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_cash_accounts(uuid) TO ams_runtime;

CREATE FUNCTION public.save_cash_account(p_organization_id uuid,p_name text,p_kind text,p_account_id uuid,p_institution text DEFAULT NULL,
  p_masked_account_number text DEFAULT NULL,p_is_cash_equivalent boolean DEFAULT false,p_allow_negative_balance boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'banking.write');
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 120 OR p_kind IS NULL OR p_kind NOT IN ('cash','bank','mobile_wallet','payment_clearing')
    OR p_account_id IS NULL OR p_is_cash_equivalent IS NULL OR p_allow_negative_balance IS NULL
    OR (p_masked_account_number IS NOT NULL AND length(p_masked_account_number)>80)
    OR (p_institution IS NOT NULL AND length(p_institution)>120) THEN RAISE EXCEPTION 'invalid cash account' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=p_account_id AND a.account_type='asset'
    AND a.control_kind IS NULL AND a.is_postable AND a.is_active AND (a.report_group ILIKE '%cash%' OR a.report_group ILIKE '%bank%' OR a.report_group ILIKE '%wallet%'))
    THEN RAISE EXCEPTION 'cash account must map to an active postable cash or bank asset account' USING ERRCODE='23514'; END IF;
  INSERT INTO finance.cash_accounts(organization_id,name,kind,account_id,institution,masked_account_number,is_cash_equivalent,allow_negative_balance)
    VALUES(p_organization_id,btrim(p_name),p_kind,p_account_id,NULLIF(btrim(p_institution),''),NULLIF(btrim(p_masked_account_number),''),p_is_cash_equivalent,p_allow_negative_balance)
    RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.save_cash_account(uuid,text,text,uuid,text,text,boolean,boolean) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.save_cash_account(uuid,text,text,uuid,text,text,boolean,boolean) TO ams_runtime;

CREATE FUNCTION public.archive_cash_account(p_organization_id uuid,p_cash_account_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'banking.write');
  UPDATE finance.cash_accounts SET is_active=false WHERE organization_id=p_organization_id AND id=p_cash_account_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'cash account unavailable' USING ERRCODE='P0002'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.archive_cash_account(uuid,uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.archive_cash_account(uuid,uuid) TO ams_runtime;
NOTIFY pgrst,'reload schema';
