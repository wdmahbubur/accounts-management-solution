-- US-056: show cumulative balance-sheet accounts and only the nominal earnings
-- that remain in the posted ledger at each selected date. Posted close journals
-- already move earnings to equity; reopened close reversals restore nominal balances.
CREATE FUNCTION public.read_balance_sheet_snapshot(p_organization_id uuid,p_as_of date,p_comparison_as_of date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_org finance.organizations%ROWTYPE;v_now timestamptz:=transaction_timestamp();v_data jsonb;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'reports.read');
  IF p_as_of IS NULL OR NOT isfinite(p_as_of) OR (p_comparison_as_of IS NOT NULL AND (NOT isfinite(p_comparison_as_of) OR p_comparison_as_of=p_as_of)) THEN
    RAISE EXCEPTION 'invalid balance-sheet dates' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_org FROM finance.organizations o WHERE o.id=p_organization_id;
  WITH periods(period_no,as_of) AS (
    SELECT 1,p_as_of UNION ALL SELECT 2,p_comparison_as_of WHERE p_comparison_as_of IS NOT NULL
  ), balances AS (
    SELECT p.period_no,a.id,a.code,a.name,a.account_type,a.report_group,
      COALESCE(sum(jl.debit),0)::numeric AS debit,COALESCE(sum(jl.credit),0)::numeric AS credit
    FROM periods p CROSS JOIN finance.accounts a
    LEFT JOIN finance.journal_lines jl ON jl.organization_id=a.organization_id AND jl.account_id=a.id
    LEFT JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted' AND je.accounting_date<=p.as_of
    LEFT JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id AND d.state='posted'
    WHERE a.organization_id=p_organization_id AND a.is_postable AND (d.id IS NOT NULL OR jl.id IS NULL)
    GROUP BY p.period_no,a.id,a.code,a.name,a.account_type,a.report_group
  ), rows AS (
    SELECT period_no,id,code,name,account_type,report_group,
      CASE account_type WHEN 'asset' THEN debit-credit WHEN 'liability' THEN credit-debit WHEN 'equity' THEN credit-debit
        WHEN 'income' THEN credit-debit WHEN 'expense' THEN debit-credit END AS amount,
      CASE WHEN account_type='income' OR account_type='expense' THEN 'untransferred_earnings' ELSE account_type END AS section
    FROM balances
  ), periods_data AS (
    SELECT period_no,
      COALESCE(sum(amount) FILTER(WHERE account_type='asset'),0)::numeric AS assets,
      COALESCE(sum(amount) FILTER(WHERE account_type='liability'),0)::numeric AS liabilities,
      COALESCE(sum(amount) FILTER(WHERE account_type='equity'),0)::numeric AS equity_accounts,
      COALESCE(sum(amount) FILTER(WHERE account_type IN ('income','expense')),0)::numeric AS untransferred_earnings
    FROM rows GROUP BY period_no
  )
  SELECT jsonb_build_object(
    'current',jsonb_build_object('as_of',p_as_of,
      'assets',COALESCE((SELECT assets FROM periods_data WHERE period_no=1),0)::text,
      'liabilities',COALESCE((SELECT liabilities FROM periods_data WHERE period_no=1),0)::text,
      'equity_accounts',COALESCE((SELECT equity_accounts FROM periods_data WHERE period_no=1),0)::text,
      'untransferred_earnings',COALESCE((SELECT untransferred_earnings FROM periods_data WHERE period_no=1),0)::text,
      'equity', (COALESCE((SELECT equity_accounts FROM periods_data WHERE period_no=1),0)+COALESCE((SELECT untransferred_earnings FROM periods_data WHERE period_no=1),0))::text,
      'liabilities_and_equity',(COALESCE((SELECT liabilities FROM periods_data WHERE period_no=1),0)+COALESCE((SELECT equity_accounts FROM periods_data WHERE period_no=1),0)+COALESCE((SELECT untransferred_earnings FROM periods_data WHERE period_no=1),0))::text,
      'difference',(COALESCE((SELECT assets FROM periods_data WHERE period_no=1),0)-COALESCE((SELECT liabilities FROM periods_data WHERE period_no=1),0)-COALESCE((SELECT equity_accounts FROM periods_data WHERE period_no=1),0)-COALESCE((SELECT untransferred_earnings FROM periods_data WHERE period_no=1),0))::text,
      'accounts',COALESCE((SELECT jsonb_agg(jsonb_build_object('account_id',r.id,'account_code',r.code,'account_name',r.name,'account_type',r.account_type,'report_group',r.report_group,'section',r.section,'amount',r.amount::text) ORDER BY r.section,r.code) FROM rows r WHERE r.period_no=1 AND r.amount<>0),'[]'::jsonb)),
    'comparison',CASE WHEN p_comparison_as_of IS NULL THEN NULL ELSE jsonb_build_object('as_of',p_comparison_as_of,
      'assets',COALESCE((SELECT assets FROM periods_data WHERE period_no=2),0)::text,
      'liabilities',COALESCE((SELECT liabilities FROM periods_data WHERE period_no=2),0)::text,
      'equity_accounts',COALESCE((SELECT equity_accounts FROM periods_data WHERE period_no=2),0)::text,
      'untransferred_earnings',COALESCE((SELECT untransferred_earnings FROM periods_data WHERE period_no=2),0)::text,
      'equity',(COALESCE((SELECT equity_accounts FROM periods_data WHERE period_no=2),0)+COALESCE((SELECT untransferred_earnings FROM periods_data WHERE period_no=2),0))::text,
      'liabilities_and_equity',(COALESCE((SELECT liabilities FROM periods_data WHERE period_no=2),0)+COALESCE((SELECT equity_accounts FROM periods_data WHERE period_no=2),0)+COALESCE((SELECT untransferred_earnings FROM periods_data WHERE period_no=2),0))::text,
      'difference',(COALESCE((SELECT assets FROM periods_data WHERE period_no=2),0)-COALESCE((SELECT liabilities FROM periods_data WHERE period_no=2),0)-COALESCE((SELECT equity_accounts FROM periods_data WHERE period_no=2),0)-COALESCE((SELECT untransferred_earnings FROM periods_data WHERE period_no=2),0))::text,
      'accounts',COALESCE((SELECT jsonb_agg(jsonb_build_object('account_id',r.id,'account_code',r.code,'account_name',r.name,'account_type',r.account_type,'report_group',r.report_group,'section',r.section,'amount',r.amount::text) ORDER BY r.section,r.code) FROM rows r WHERE r.period_no=2 AND r.amount<>0),'[]'::jsonb)) END
  ) INTO v_data;
  RETURN jsonb_build_object('snapshot_id',gen_random_uuid(),'report_type','balance_sheet','company',jsonb_build_object('id',v_org.id,'name',v_org.name,'timezone',v_org.timezone),
    'filters',jsonb_build_object('as_of',p_as_of,'comparison_as_of',p_comparison_as_of),'generated_at',v_now,'ledger_cutoff_at',v_now,'template_version','v1.0','status','posted','provisional',false,'data',v_data);
END; $$;
REVOKE ALL ON FUNCTION public.read_balance_sheet_snapshot(uuid,date,date) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_balance_sheet_snapshot(uuid,date,date) TO ams_runtime;
NOTIFY pgrst,'reload schema';
