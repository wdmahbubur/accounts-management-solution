-- US-059: management cash flow from explicitly designated cash-equivalent GL lines.
CREATE FUNCTION public.read_cash_flow_snapshot(p_organization_id uuid,p_from date,p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_org finance.organizations%ROWTYPE;v_now timestamptz:=transaction_timestamp();v_data jsonb;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'reports.read');
  IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_from>p_to THEN
    RAISE EXCEPTION 'invalid cash-flow date range' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_org FROM finance.organizations o WHERE o.id=p_organization_id;
  WITH cash_accounts AS (
    SELECT ca.id AS cash_account_id,ca.account_id,a.code,a.name FROM finance.cash_accounts ca
    JOIN finance.accounts a ON a.organization_id=ca.organization_id AND a.id=ca.account_id
    WHERE ca.organization_id=p_organization_id AND ca.is_cash_equivalent
  ), balances AS (
    SELECT ca.cash_account_id,ca.account_id,ca.code,ca.name,
      COALESCE(sum(jl.debit-jl.credit) FILTER(WHERE je.accounting_date<p_from),0)::numeric AS opening,
      COALESCE(sum(jl.debit-jl.credit) FILTER(WHERE je.accounting_date<=p_to),0)::numeric AS closing
    FROM cash_accounts ca LEFT JOIN finance.journal_lines jl ON jl.organization_id=p_organization_id AND jl.account_id=ca.account_id
    LEFT JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted' AND je.posted_at<=v_now
    LEFT JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id AND d.state='posted'
    WHERE d.id IS NOT NULL OR jl.id IS NULL GROUP BY ca.cash_account_id,ca.account_id,ca.code,ca.name
  ), cash_lines AS (
    SELECT ca.cash_account_id,ca.account_id,ca.code AS account_code,ca.name AS account_name,d.id AS document_id,d.document_number,d.document_type::text AS document_type,
      je.id AS journal_id,je.accounting_date,jl.id AS line_id,jl.description,jl.cash_flow_class::text AS cash_flow_class,(jl.debit-jl.credit)::numeric AS movement,
      t.id AS transfer_id,t.from_cash_account_id,t.to_cash_account_id,t.amount::numeric AS transfer_amount,t.fee_amount::numeric AS transfer_fee,
      from_ca.is_cash_equivalent AS from_is_equivalent,to_ca.is_cash_equivalent AS to_is_equivalent
    FROM cash_accounts ca JOIN finance.journal_lines jl ON jl.organization_id=p_organization_id AND jl.account_id=ca.account_id
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted' AND je.accounting_date BETWEEN p_from AND p_to AND je.posted_at<=v_now AND NOT je.is_opening
    JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id AND d.state='posted'
    LEFT JOIN finance.transfers t ON t.organization_id=d.organization_id AND t.document_id=d.id AND d.document_type='transfer'
    LEFT JOIN finance.cash_accounts from_ca ON from_ca.organization_id=t.organization_id AND from_ca.id=t.from_cash_account_id
    LEFT JOIN finance.cash_accounts to_ca ON to_ca.organization_id=t.organization_id AND to_ca.id=t.to_cash_account_id
  ), classified AS (
    SELECT cash_account_id,account_id,account_code,account_name,document_id,document_number,document_type,journal_id,accounting_date,line_id,description,
      CASE WHEN cash_flow_class IN ('operating','investing','financing') THEN cash_flow_class ELSE 'unclassified' END AS flow_class,
      movement AS amount,CASE WHEN cash_flow_class IN ('operating','investing','financing') THEN NULL
        WHEN cash_flow_class='internal' THEN 'Internal classification outside a transfer document.'
        WHEN cash_flow_class='opening' THEN 'Opening classification appears on a non-opening journal.'
        ELSE 'Cash-equivalent movement has no operating, investing or financing classification.' END AS exception_reason
    FROM cash_lines WHERE transfer_id IS NULL
    UNION ALL
    SELECT cash_account_id,account_id,account_code,account_name,document_id,document_number,document_type,journal_id,accounting_date,line_id,description,
      'internal_transfer',CASE WHEN cash_account_id=to_cash_account_id THEN transfer_amount ELSE -transfer_amount END,
      NULL::text
    FROM cash_lines WHERE transfer_id IS NOT NULL AND COALESCE(from_is_equivalent,false) AND COALESCE(to_is_equivalent,false)
    UNION ALL
    SELECT cash_account_id,account_id,account_code,account_name,document_id,document_number,document_type,journal_id,accounting_date,line_id,description,
      'unclassified',CASE WHEN cash_account_id=to_cash_account_id THEN transfer_amount ELSE -transfer_amount END,
      'Transfer crosses the cash-equivalent boundary; classify its external principal movement.'
    FROM cash_lines WHERE transfer_id IS NOT NULL AND NOT (COALESCE(from_is_equivalent,false) AND COALESCE(to_is_equivalent,false))
    UNION ALL
    SELECT cash_account_id,account_id,account_code,account_name,document_id,document_number,document_type,journal_id,accounting_date,line_id,description,
      'operating',-transfer_fee,NULL::text FROM cash_lines
    WHERE transfer_id IS NOT NULL AND cash_account_id=from_cash_account_id AND transfer_fee>0
  ), summary AS (
    SELECT COALESCE((SELECT sum(opening) FROM balances),0)::numeric AS opening,
      COALESCE((SELECT sum(closing) FROM balances),0)::numeric AS closing,
      COALESCE(sum(amount) FILTER(WHERE flow_class='operating'),0)::numeric AS operating,
      COALESCE(sum(amount) FILTER(WHERE flow_class='investing'),0)::numeric AS investing,
      COALESCE(sum(amount) FILTER(WHERE flow_class='financing'),0)::numeric AS financing,
      COALESCE(sum(amount) FILTER(WHERE flow_class='internal_transfer'),0)::numeric AS internal_net,
      COALESCE(sum(amount) FILTER(WHERE flow_class='unclassified'),0)::numeric AS unclassified,
      COALESCE(sum(amount) FILTER(WHERE flow_class='internal_transfer' AND amount>0),0)::numeric AS internal_inflows,
      COALESCE(-sum(amount) FILTER(WHERE flow_class='internal_transfer' AND amount<0),0)::numeric AS internal_outflows,
      count(*) FILTER(WHERE flow_class='unclassified')::integer AS exception_count
    FROM classified
  ), activity AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('date',accounting_date,'flow_class',flow_class,'cash_account',account_name,'account_code',account_code,
      'account_id',account_id,'document_id',document_id,'document_number',document_number,'document_type',document_type,'description',description,'amount',amount::text,'exception_reason',exception_reason)
      ORDER BY accounting_date,journal_id,line_id),'[]'::jsonb) AS rows FROM classified
  ), exception_rows AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('date',accounting_date,'account_id',account_id,'account_code',account_code,'cash_account',account_name,'document_id',document_id,'document_number',document_number,
      'document_type',document_type,'description',description,'amount',amount::text,'reason',exception_reason) ORDER BY accounting_date,journal_id,line_id),'[]'::jsonb) AS rows
    FROM classified WHERE flow_class='unclassified'
  ), cash_accounts_json AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('cash_account_id',cash_account_id,'account_id',account_id,'account_code',code,'account_name',name,
      'opening',opening::text,'closing',closing::text) ORDER BY code),'[]'::jsonb) AS rows FROM balances
  )
  SELECT jsonb_build_object('from',p_from,'to',p_to,'opening_cash',(SELECT opening FROM summary)::text,
    'operating', (SELECT operating FROM summary)::text,'investing',(SELECT investing FROM summary)::text,'financing',(SELECT financing FROM summary)::text,
    'internal_transfer_inflows',(SELECT internal_inflows FROM summary)::text,'internal_transfer_outflows',(SELECT internal_outflows FROM summary)::text,
    'internal_transfer_net',(SELECT internal_net FROM summary)::text,'unclassified',(SELECT unclassified FROM summary)::text,
    'unclassified_count',(SELECT exception_count FROM summary),'closing_cash',(SELECT closing FROM summary)::text,
    'calculated_closing',((SELECT opening FROM summary)+(SELECT operating FROM summary)+(SELECT investing FROM summary)+(SELECT financing FROM summary)+(SELECT internal_net FROM summary)+(SELECT unclassified FROM summary))::text,
    'reconciliation_difference',((SELECT closing FROM summary)-((SELECT opening FROM summary)+(SELECT operating FROM summary)+(SELECT investing FROM summary)+(SELECT financing FROM summary)+(SELECT internal_net FROM summary)+(SELECT unclassified FROM summary)))::text,
    'cash_equivalent_account_count',(SELECT count(*) FROM balances),'provisional',((SELECT exception_count FROM summary)>0 OR NOT EXISTS(SELECT 1 FROM balances)),
    'cash_accounts',(SELECT rows FROM cash_accounts_json),'activity',(SELECT rows FROM activity),'exceptions',(SELECT rows FROM exception_rows),'cutoff_at',v_now,'timezone',v_org.timezone)
  INTO v_data;
  RETURN jsonb_build_object('snapshot_id',gen_random_uuid(),'report_type','cash_flow','company',jsonb_build_object('id',v_org.id,'name',v_org.name,'timezone',v_org.timezone),
    'filters',jsonb_build_object('from',p_from,'to',p_to),'generated_at',v_now,'ledger_cutoff_at',v_now,'template_version','v1.0',
    'status',CASE WHEN (v_data->>'provisional')::boolean THEN 'provisional' ELSE 'posted' END,'provisional',(v_data->>'provisional')::boolean,'data',v_data);
END; $$;
REVOKE ALL ON FUNCTION public.read_cash_flow_snapshot(uuid,date,date) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_cash_flow_snapshot(uuid,date,date) TO ams_runtime;
NOTIFY pgrst,'reload schema';
