-- Preserve two-decimal money strings for both sides, including zero balances.
CREATE OR REPLACE FUNCTION public.read_trial_balance(p_organization_id uuid,p_as_of date,p_from date DEFAULT NULL)
RETURNS TABLE(account_id uuid,account_code text,account_name text,account_type text,opening_balance text,movement_debit text,movement_credit text,closing_debit text,closing_credit text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'reports.read');
  IF p_as_of IS NULL OR NOT isfinite(p_as_of) OR (p_from IS NOT NULL AND (NOT isfinite(p_from) OR p_from>p_as_of)) THEN RAISE EXCEPTION 'invalid trial balance dates' USING ERRCODE='22023'; END IF;
  RETURN QUERY WITH balances AS (
    SELECT a.id,a.code,a.name,a.account_type,
      COALESCE(sum(jl.debit-jl.credit) FILTER(WHERE je.accounting_date<COALESCE(p_from,p_as_of+1)),0)::finance.amount AS opening,
      COALESCE(sum(jl.debit) FILTER(WHERE p_from IS NOT NULL AND je.accounting_date>=p_from AND je.accounting_date<=p_as_of),0)::finance.amount AS movement_dr,
      COALESCE(sum(jl.credit) FILTER(WHERE p_from IS NOT NULL AND je.accounting_date>=p_from AND je.accounting_date<=p_as_of),0)::finance.amount AS movement_cr,
      COALESCE(sum(jl.debit-jl.credit) FILTER(WHERE je.accounting_date<=p_as_of),0)::finance.amount AS closing
    FROM finance.accounts a LEFT JOIN finance.journal_lines jl ON jl.organization_id=a.organization_id AND jl.account_id=a.id
    LEFT JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
    WHERE a.organization_id=p_organization_id AND a.is_postable GROUP BY a.id,a.code,a.name,a.account_type
  ) SELECT b.id,b.code,b.name,b.account_type,b.opening::text,b.movement_dr::text,b.movement_cr::text,
    greatest(b.closing,0)::finance.amount::text,greatest(-b.closing,0)::finance.amount::text FROM balances b ORDER BY b.code;
END; $$;
