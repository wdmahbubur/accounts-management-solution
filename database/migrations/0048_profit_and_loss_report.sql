-- US-055: accrual profit and loss from posted nominal ledger movements plus
-- the approved pre-cutover YTD component, once, for each covering year range.
CREATE UNIQUE INDEX journal_entries_one_posted_opening_per_organization
  ON finance.journal_entries(organization_id) WHERE is_opening AND state='posted';

CREATE FUNCTION public.list_profit_loss_options(p_organization_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'reports.read');
  RETURN jsonb_build_object(
    'company', (SELECT jsonb_build_object('name',o.name,'timezone',o.timezone,'books_start_date',o.books_start_date) FROM finance.organizations o WHERE o.id=p_organization_id),
    'fiscal_years',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.id,'label',f.label,'starts_on',f.starts_on,'ends_on',f.ends_on) ORDER BY f.starts_on DESC)
      FROM finance.fiscal_years f WHERE f.organization_id=p_organization_id),'[]'::jsonb),
    'cost_centers',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'code',c.code,'name',c.name) ORDER BY c.code)
      FROM finance.cost_centers c WHERE c.organization_id=p_organization_id AND c.is_active),'[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.list_profit_loss_options(uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.list_profit_loss_options(uuid) TO ams_runtime;

CREATE FUNCTION public.read_profit_loss_snapshot(p_organization_id uuid,p_from date,p_to date,p_cost_center_id uuid DEFAULT NULL,
  p_comparison_from date DEFAULT NULL,p_comparison_to date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_org finance.organizations%ROWTYPE;v_now timestamptz:=transaction_timestamp();v_data jsonb;v_warnings jsonb:='[]'::jsonb;
  v_current_ytd_requested boolean:=false;v_comparison_ytd_requested boolean:=false;v_has_summary boolean:=false;v_center_name text;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'reports.read');
  IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_from>p_to OR
    ((p_comparison_from IS NULL)<>(p_comparison_to IS NULL)) OR
    (p_comparison_from IS NOT NULL AND (NOT isfinite(p_comparison_from) OR NOT isfinite(p_comparison_to) OR p_comparison_from>p_comparison_to OR
      daterange(p_from,p_to,'[]') && daterange(p_comparison_from,p_comparison_to,'[]'))) THEN
    RAISE EXCEPTION 'invalid profit and loss period filters' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_org FROM finance.organizations o WHERE o.id=p_organization_id;
  IF p_cost_center_id IS NOT NULL THEN
    SELECT c.name INTO v_center_name FROM finance.cost_centers c WHERE c.organization_id=p_organization_id AND c.id=p_cost_center_id AND c.is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'cost center unavailable' USING ERRCODE='P0002'; END IF;
  END IF;
  SELECT EXISTS(SELECT 1 FROM finance_private.opening_cutover_summaries s JOIN finance.business_documents d
      ON d.organization_id=s.organization_id AND d.id=s.document_id AND d.document_type='opening_balance' AND d.state='posted'
    JOIN finance.journal_entries je ON je.organization_id=d.organization_id AND je.source_document_id=d.id AND je.state='posted' AND je.is_opening
    JOIN finance.fiscal_years f ON f.organization_id=s.organization_id AND s.cutover_date BETWEEN f.starts_on AND f.ends_on
    WHERE s.organization_id=p_organization_id AND p_from<=f.starts_on AND p_to>=s.cutover_date) INTO v_current_ytd_requested;
  IF p_comparison_from IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM finance_private.opening_cutover_summaries s JOIN finance.business_documents d
        ON d.organization_id=s.organization_id AND d.id=s.document_id AND d.document_type='opening_balance' AND d.state='posted'
      JOIN finance.journal_entries je ON je.organization_id=d.organization_id AND je.source_document_id=d.id AND je.state='posted' AND je.is_opening
      JOIN finance.fiscal_years f ON f.organization_id=s.organization_id AND s.cutover_date BETWEEN f.starts_on AND f.ends_on
      WHERE s.organization_id=p_organization_id AND p_comparison_from<=f.starts_on AND p_comparison_to>=s.cutover_date) INTO v_comparison_ytd_requested;
  END IF;
  v_has_summary:=v_current_ytd_requested OR v_comparison_ytd_requested;
  IF p_cost_center_id IS NOT NULL AND v_has_summary THEN
    v_warnings:=v_warnings||jsonb_build_array('Pre-cutover YTD summary has no cost-center detail and is excluded from this filtered report.');
  END IF;
  WITH periods(period_no,starts_on,ends_on,include_ytd) AS (
    SELECT 1,p_from,p_to,v_current_ytd_requested UNION ALL
    SELECT 2,p_comparison_from,p_comparison_to,v_comparison_ytd_requested WHERE p_comparison_from IS NOT NULL
  ), actual AS (
    SELECT p.period_no,jl.account_id,sum(jl.debit)::numeric AS debit,sum(jl.credit)::numeric AS credit,
      'ledger'::text AS detail_kind,NULL::uuid AS evidence_document_id,NULL::text AS evidence_reference
    FROM periods p JOIN finance.journal_entries je ON je.organization_id=p_organization_id AND je.state='posted' AND je.accounting_date BETWEEN p.starts_on AND p.ends_on
    JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id AND d.state='posted'
    JOIN finance.journal_lines jl ON jl.organization_id=je.organization_id AND jl.journal_entry_id=je.id
    JOIN finance.accounts a ON a.organization_id=jl.organization_id AND a.id=jl.account_id AND a.is_postable AND a.account_type IN ('income','expense')
    WHERE NOT je.is_opening AND NOT je.is_year_close AND (p_cost_center_id IS NULL OR jl.cost_center_id=p_cost_center_id)
      AND NOT EXISTS(SELECT 1 FROM finance.business_documents original JOIN finance.journal_entries close_entry
        ON close_entry.organization_id=original.organization_id AND close_entry.source_document_id=original.id AND close_entry.is_year_close
        WHERE original.organization_id=d.organization_id AND original.id=d.reversal_of_document_id)
    GROUP BY p.period_no,jl.account_id
  ), imported AS (
    SELECT p.period_no,(item.value->>'account_id')::uuid AS account_id,
      (item.value->>'debit')::numeric AS debit,(item.value->>'credit')::numeric AS credit,
      'imported_ytd_summary'::text AS detail_kind,s.document_id AS evidence_document_id,s.evidence_reference
    FROM periods p JOIN finance_private.opening_cutover_summaries s ON s.organization_id=p_organization_id AND p.include_ytd
      AND p_cost_center_id IS NULL AND p.starts_on<=(SELECT f.starts_on FROM finance.fiscal_years f WHERE f.organization_id=s.organization_id AND s.cutover_date BETWEEN f.starts_on AND f.ends_on)
      AND p.ends_on>=s.cutover_date
    JOIN finance.business_documents d ON d.organization_id=s.organization_id AND d.id=s.document_id AND d.document_type='opening_balance' AND d.state='posted'
    JOIN finance.journal_entries je ON je.organization_id=d.organization_id AND je.source_document_id=d.id AND je.state='posted' AND je.is_opening
    CROSS JOIN LATERAL jsonb_array_elements(s.ytd_summary) item(value)
  ), components AS (
    SELECT * FROM actual UNION ALL SELECT * FROM imported
  ), signed AS (
    SELECT c.period_no,c.account_id,c.debit,c.credit,c.detail_kind,c.evidence_document_id,c.evidence_reference,
      CASE WHEN a.account_type='income' THEN c.credit-c.debit ELSE c.credit-c.debit END AS signed_amount,
      a.account_type,a.report_group
    FROM components c JOIN finance.accounts a ON a.organization_id=p_organization_id AND a.id=c.account_id
  ), per_account AS (
    SELECT account_id,
      COALESCE(sum(signed_amount) FILTER(WHERE period_no=1),0)::numeric AS current_amount,
      COALESCE(sum(signed_amount) FILTER(WHERE period_no=2),0)::numeric AS comparison_amount,
      COALESCE(sum(debit) FILTER(WHERE period_no=1 AND detail_kind='ledger'),0)::numeric AS current_ledger_debit,
      COALESCE(sum(credit) FILTER(WHERE period_no=1 AND detail_kind='ledger'),0)::numeric AS current_ledger_credit,
      COALESCE(sum(debit) FILTER(WHERE period_no=1 AND detail_kind='imported_ytd_summary'),0)::numeric AS current_summary_debit,
      COALESCE(sum(credit) FILTER(WHERE period_no=1 AND detail_kind='imported_ytd_summary'),0)::numeric AS current_summary_credit,
      COALESCE(sum(debit) FILTER(WHERE period_no=2 AND detail_kind='ledger'),0)::numeric AS comparison_ledger_debit,
      COALESCE(sum(credit) FILTER(WHERE period_no=2 AND detail_kind='ledger'),0)::numeric AS comparison_ledger_credit,
      COALESCE(sum(debit) FILTER(WHERE period_no=2 AND detail_kind='imported_ytd_summary'),0)::numeric AS comparison_summary_debit,
      COALESCE(sum(credit) FILTER(WHERE period_no=2 AND detail_kind='imported_ytd_summary'),0)::numeric AS comparison_summary_credit,
      (max(evidence_document_id::text) FILTER(WHERE period_no=1 AND detail_kind='imported_ytd_summary'))::uuid AS current_evidence_document_id,
      max(evidence_reference) FILTER(WHERE period_no=1 AND detail_kind='imported_ytd_summary') AS current_evidence_reference,
      (max(evidence_document_id::text) FILTER(WHERE period_no=2 AND detail_kind='imported_ytd_summary'))::uuid AS comparison_evidence_document_id,
      max(evidence_reference) FILTER(WHERE period_no=2 AND detail_kind='imported_ytd_summary') AS comparison_evidence_reference
    FROM signed GROUP BY account_id
  ), rows AS (
    SELECT a.id,a.code,a.name,a.account_type,a.report_group,p.* FROM per_account p
    JOIN finance.accounts a ON a.organization_id=p_organization_id AND a.id=p.account_id
  ), totals AS (
    SELECT period_no,
      COALESCE(sum(signed_amount) FILTER(WHERE account_type='income' AND report_group<>'other_income'),0)::numeric AS revenue,
      COALESCE(sum(debit-credit) FILTER(WHERE account_type='expense' AND report_group='cost_of_sales'),0)::numeric AS direct_costs,
      COALESCE(sum(debit-credit) FILTER(WHERE account_type='expense' AND report_group NOT IN ('cost_of_sales','other_expense')),0)::numeric AS operating_costs,
      COALESCE(sum(signed_amount) FILTER(WHERE account_type='income' AND report_group='other_income'),0)::numeric AS other_income,
      COALESCE(sum(debit-credit) FILTER(WHERE account_type='expense' AND report_group='other_expense'),0)::numeric AS other_expenses,
      COALESCE(sum(signed_amount),0)::numeric AS net_profit
    FROM signed GROUP BY period_no
  )
  SELECT jsonb_build_object(
    'periods',jsonb_build_object('current',jsonb_build_object('from',p_from,'to',p_to,'ytd_summary_included',v_current_ytd_requested AND p_cost_center_id IS NULL),
      'comparison',CASE WHEN p_comparison_from IS NULL THEN NULL ELSE jsonb_build_object('from',p_comparison_from,'to',p_comparison_to,'ytd_summary_included',v_comparison_ytd_requested AND p_cost_center_id IS NULL) END),
    'accounts',COALESCE((SELECT jsonb_agg(jsonb_build_object('account_id',r.id,'account_code',r.code,'account_name',r.name,'account_type',r.account_type,'report_group',r.report_group,
      'current_amount',(r.current_amount)::text,'comparison_amount',(r.comparison_amount)::text,
      'current_ledger_debit',r.current_ledger_debit::text,'current_ledger_credit',r.current_ledger_credit::text,
      'current_summary_debit',r.current_summary_debit::text,'current_summary_credit',r.current_summary_credit::text,
      'current_evidence_document_id',r.current_evidence_document_id,'current_evidence_reference',r.current_evidence_reference,
      'comparison_ledger_debit',r.comparison_ledger_debit::text,'comparison_ledger_credit',r.comparison_ledger_credit::text,
      'comparison_summary_debit',r.comparison_summary_debit::text,'comparison_summary_credit',r.comparison_summary_credit::text,
      'comparison_evidence_document_id',r.comparison_evidence_document_id,'comparison_evidence_reference',r.comparison_evidence_reference)
      ORDER BY r.report_group,r.code) FROM rows r),'[]'::jsonb),
    'totals',jsonb_build_object(
      'revenue',COALESCE((SELECT revenue FROM totals WHERE period_no=1),0)::text,
      'direct_costs',COALESCE((SELECT direct_costs FROM totals WHERE period_no=1),0)::text,
      'gross_profit',(COALESCE((SELECT revenue FROM totals WHERE period_no=1),0)-COALESCE((SELECT direct_costs FROM totals WHERE period_no=1),0))::text,
      'operating_costs',COALESCE((SELECT operating_costs FROM totals WHERE period_no=1),0)::text,
      'other_income',COALESCE((SELECT other_income FROM totals WHERE period_no=1),0)::text,
      'other_expenses',COALESCE((SELECT other_expenses FROM totals WHERE period_no=1),0)::text,
      'net_profit',COALESCE((SELECT net_profit FROM totals WHERE period_no=1),0)::text,
      'comparison_revenue',COALESCE((SELECT revenue FROM totals WHERE period_no=2),0)::text,
      'comparison_direct_costs',COALESCE((SELECT direct_costs FROM totals WHERE period_no=2),0)::text,
      'comparison_gross_profit',(COALESCE((SELECT revenue FROM totals WHERE period_no=2),0)-COALESCE((SELECT direct_costs FROM totals WHERE period_no=2),0))::text,
      'comparison_operating_costs',COALESCE((SELECT operating_costs FROM totals WHERE period_no=2),0)::text,
      'comparison_other_income',COALESCE((SELECT other_income FROM totals WHERE period_no=2),0)::text,
      'comparison_other_expenses',COALESCE((SELECT other_expenses FROM totals WHERE period_no=2),0)::text,
      'comparison_net_profit',COALESCE((SELECT net_profit FROM totals WHERE period_no=2),0)::text),
    'warnings',v_warnings,'provisional',p_cost_center_id IS NOT NULL AND v_has_summary)
  INTO v_data;
  RETURN jsonb_build_object('snapshot_id',md5(p_organization_id::text||p_from::text||p_to::text||COALESCE(p_cost_center_id::text,'')||v_now::text),
    'report_type','profit_loss','company',jsonb_build_object('id',v_org.id,'name',v_org.name,'timezone',v_org.timezone),
    'filters',jsonb_build_object('from',p_from,'to',p_to,'cost_center',p_cost_center_id,'comparison_from',p_comparison_from,'comparison_to',p_comparison_to),
    'generated_at',v_now,'ledger_cutoff_at',v_now,'template_version','v1.0','status','posted',
    'provisional',p_cost_center_id IS NOT NULL AND v_has_summary,'data',v_data);
END; $$;
REVOKE ALL ON FUNCTION public.read_profit_loss_snapshot(uuid,date,date,uuid,date,date) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_profit_loss_snapshot(uuid,date,date,uuid,date,date) TO ams_runtime;
