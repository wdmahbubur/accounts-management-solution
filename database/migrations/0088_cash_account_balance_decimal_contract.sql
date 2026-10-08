-- An empty or draft-only ledger must return the same exact two-decimal text
-- contract as the cashbook and other ledger APIs, including the value '0.00'.
CREATE OR REPLACE FUNCTION public.read_cash_accounts(p_organization_id uuid)
RETURNS TABLE(id uuid,name text,kind text,institution text,masked_account_number text,is_cash_equivalent boolean,allow_negative_balance boolean,is_active boolean,account_id uuid,account_code text,account_name text,book_balance text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'banking.read');
  RETURN QUERY SELECT ca.id,ca.name,ca.kind,ca.institution,ca.masked_account_number,ca.is_cash_equivalent,ca.allow_negative_balance,ca.is_active,
    a.id,a.code,a.name,COALESCE(sum(CASE WHEN je.state='posted' THEN jl.debit-jl.credit ELSE 0 END),0)::finance.amount::text
  FROM finance.cash_accounts ca JOIN finance.accounts a ON a.organization_id=ca.organization_id AND a.id=ca.account_id
  LEFT JOIN finance.journal_lines jl ON jl.organization_id=ca.organization_id AND jl.account_id=ca.account_id
  LEFT JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
  WHERE ca.organization_id=p_organization_id GROUP BY ca.id,a.id ORDER BY ca.is_active DESC,ca.name,ca.id;
END; $$;
REVOKE ALL ON FUNCTION public.read_cash_accounts(uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_cash_accounts(uuid) TO ams_runtime;
NOTIFY pgrst,'reload schema';
