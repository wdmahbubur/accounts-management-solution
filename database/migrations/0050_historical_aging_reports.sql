-- US-057: historical open-item aging with effective-date allocations and credits.
CREATE FUNCTION public.read_aging_snapshot(p_organization_id uuid,p_control text,p_as_of date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_now timestamptz:=transaction_timestamp();v_org finance.organizations%ROWTYPE;v_access text;
  v_trade_mapping text;v_advance_kind text;v_advance_mapping text;v_control_id uuid;v_advance_id uuid;v_data jsonb;
BEGIN
  IF p_control NOT IN ('ar','ap') OR p_as_of IS NULL OR NOT isfinite(p_as_of) THEN
    RAISE EXCEPTION 'invalid aging filters' USING ERRCODE='22023'; END IF;
  v_access:=CASE p_control WHEN 'ar' THEN 'sales.read' ELSE 'purchases.read' END;
  IF NOT finance_private.has_permission(p_organization_id,'dues.read') AND NOT finance_private.has_permission(p_organization_id,v_access) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;
  v_trade_mapping:=p_control;
  v_advance_kind:=CASE p_control WHEN 'ar' THEN 'customer_advance' ELSE 'vendor_advance' END;
  v_advance_mapping:=v_advance_kind;
  SELECT * INTO v_org FROM finance.organizations o WHERE o.id=p_organization_id;
  SELECT m.account_id INTO v_control_id FROM finance.account_mappings m WHERE m.organization_id=p_organization_id AND m.mapping_key=v_trade_mapping;
  SELECT m.account_id INTO v_advance_id FROM finance.account_mappings m WHERE m.organization_id=p_organization_id AND m.mapping_key=v_advance_mapping;
  IF v_control_id IS NULL OR v_advance_id IS NULL THEN RAISE EXCEPTION 'control-account mapping unavailable' USING ERRCODE='P0002'; END IF;
  WITH items AS (
    SELECT oi.id,oi.journal_line_id,je.source_document_id,d.document_number,oi.party_id,c.display_name AS party_name,
      oi.control_kind,oi.side,oi.reference,oi.issue_date,oi.due_date,
      finance_private.open_item_balance_at(p_organization_id,oi.id,p_as_of,v_now)::numeric AS residual,
      CASE WHEN oi.control_kind=v_advance_kind THEN 'advance'
        WHEN oi.side=CASE p_control WHEN 'ar' THEN 'debit' ELSE 'credit' END THEN
          CASE WHEN oi.due_date IS NULL THEN 'no_due_date' WHEN oi.due_date>=p_as_of THEN 'not_due'
            WHEN p_as_of-oi.due_date<=30 THEN 'days_1_30' WHEN p_as_of-oi.due_date<=60 THEN 'days_31_60'
            WHEN p_as_of-oi.due_date<=90 THEN 'days_61_90' ELSE 'days_91_plus' END
        ELSE 'unapplied_credit' END AS bucket
    FROM finance.open_items oi
    JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted' AND je.accounting_date<=p_as_of AND je.posted_at<=v_now
    JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id AND d.state='posted'
    JOIN finance.contacts c ON c.organization_id=oi.organization_id AND c.id=oi.party_id
    WHERE oi.organization_id=p_organization_id AND oi.control_kind IN (v_trade_mapping,v_advance_kind)
      AND oi.issue_date<=p_as_of AND oi.created_at<=v_now
  ), nonzero AS (SELECT * FROM items WHERE residual>0),
  ledger AS (
    SELECT mapping.mapping_key,balance.debit_balance
    FROM (VALUES(v_trade_mapping,v_control_id),(v_advance_mapping,v_advance_id)) mapping(mapping_key,account_id)
    CROSS JOIN LATERAL (SELECT COALESCE(sum(jl.debit-jl.credit),0)::numeric AS debit_balance
      FROM finance.journal_lines jl JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
        AND je.state='posted' AND je.accounting_date<=p_as_of AND je.posted_at<=v_now
      JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id AND d.state='posted'
      WHERE jl.organization_id=p_organization_id AND jl.account_id=mapping.account_id) balance
  ), sums AS (
    SELECT
      COALESCE(sum(residual) FILTER(WHERE control_kind=v_trade_mapping AND bucket='not_due'),0)::numeric AS not_due,
      COALESCE(sum(residual) FILTER(WHERE control_kind=v_trade_mapping AND bucket='days_1_30'),0)::numeric AS days_1_30,
      COALESCE(sum(residual) FILTER(WHERE control_kind=v_trade_mapping AND bucket='days_31_60'),0)::numeric AS days_31_60,
      COALESCE(sum(residual) FILTER(WHERE control_kind=v_trade_mapping AND bucket='days_61_90'),0)::numeric AS days_61_90,
      COALESCE(sum(residual) FILTER(WHERE control_kind=v_trade_mapping AND bucket='days_91_plus'),0)::numeric AS days_91_plus,
      COALESCE(sum(residual) FILTER(WHERE control_kind=v_trade_mapping AND bucket='no_due_date'),0)::numeric AS no_due_date,
      COALESCE(sum(residual) FILTER(WHERE control_kind=v_trade_mapping AND bucket='unapplied_credit'),0)::numeric AS credits,
      COALESCE(sum(residual) FILTER(WHERE control_kind=v_advance_kind AND side=CASE p_control WHEN 'ar' THEN 'credit' ELSE 'debit' END),0)::numeric AS advance_normal,
      COALESCE(sum(residual) FILTER(WHERE control_kind=v_advance_kind AND side=CASE p_control WHEN 'ar' THEN 'debit' ELSE 'credit' END),0)::numeric AS advance_opposite,
      COALESCE(sum(residual) FILTER(WHERE control_kind=v_trade_mapping AND side=CASE p_control WHEN 'ar' THEN 'debit' ELSE 'credit' END),0)::numeric AS debt,
      COALESCE(sum(residual) FILTER(WHERE control_kind=v_trade_mapping AND side=CASE p_control WHEN 'ar' THEN 'credit' ELSE 'debit' END),0)::numeric AS trade_credits
    FROM nonzero
  ), serialized AS (
    SELECT n.*,jsonb_build_object('open_item_id',n.id,'journal_line_id',n.journal_line_id,'source_document_id',n.source_document_id,
      'document_number',n.document_number,'party_id',n.party_id,'party_name',n.party_name,'control_kind',n.control_kind,'side',n.side,
      'reference',n.reference,'issue_date',n.issue_date,'due_date',n.due_date,'bucket',n.bucket,'residual',n.residual::text) AS payload FROM nonzero n
  ), item_rows AS (
    SELECT COALESCE(jsonb_agg(payload ORDER BY party_name,COALESCE(due_date,'infinity'::date),issue_date,id),'[]'::jsonb) AS data FROM serialized
  )
  SELECT jsonb_build_object('as_of',p_as_of,'cutoff_at',v_now,'timezone',v_org.timezone,'control_kind',v_trade_mapping,
    'buckets',jsonb_build_object('not_due',(SELECT not_due FROM sums)::text,'days_1_30',(SELECT days_1_30 FROM sums)::text,
      'days_31_60',(SELECT days_31_60 FROM sums)::text,'days_61_90',(SELECT days_61_90 FROM sums)::text,
      'days_91_plus',(SELECT days_91_plus FROM sums)::text,'no_due_date',(SELECT no_due_date FROM sums)::text),
    'trade_debt',(SELECT debt FROM sums)::text,'unapplied_trade_credits',(SELECT trade_credits FROM sums)::text,
    'net_trade_control_items',((SELECT debt FROM sums)-(SELECT trade_credits FROM sums))::text,
    'trade_control_ledger',CASE p_control WHEN 'ar' THEN (SELECT debit_balance FROM ledger WHERE mapping_key=v_trade_mapping)::text ELSE (-(SELECT debit_balance FROM ledger WHERE mapping_key=v_trade_mapping))::text END,
    'trade_control_difference',CASE p_control WHEN 'ar' THEN ((SELECT debit_balance FROM ledger WHERE mapping_key=v_trade_mapping)-((SELECT debt FROM sums)-(SELECT trade_credits FROM sums)))::text
      ELSE (-(SELECT debit_balance FROM ledger WHERE mapping_key=v_trade_mapping)-((SELECT debt FROM sums)-(SELECT trade_credits FROM sums)))::text END,
    'trade_credit_items',COALESCE((SELECT jsonb_agg(n.payload ORDER BY n.party_name,n.issue_date,n.id) FROM serialized n WHERE n.control_kind=v_trade_mapping AND n.bucket='unapplied_credit'),'[]'::jsonb),
    'advances',jsonb_build_object('control_kind',v_advance_kind,'normal_balance',(SELECT advance_normal FROM sums)::text,
      'opposite_side_credits',(SELECT advance_opposite FROM sums)::text,
      'ledger_balance',CASE p_control WHEN 'ar' THEN (-(SELECT debit_balance FROM ledger WHERE mapping_key=v_advance_mapping))::text ELSE (SELECT debit_balance FROM ledger WHERE mapping_key=v_advance_mapping)::text END,
      'difference',CASE p_control WHEN 'ar' THEN ((-(SELECT debit_balance FROM ledger WHERE mapping_key=v_advance_mapping))-((SELECT advance_normal FROM sums)-(SELECT advance_opposite FROM sums)))::text
        ELSE ((SELECT debit_balance FROM ledger WHERE mapping_key=v_advance_mapping)-((SELECT advance_normal FROM sums)-(SELECT advance_opposite FROM sums)))::text END,
      'items',COALESCE((SELECT jsonb_agg(n.payload ORDER BY n.party_name,n.issue_date,n.id) FROM serialized n WHERE n.control_kind=v_advance_kind),'[]'::jsonb)),
    'items',(SELECT data FROM item_rows),'net_bridge_difference',((SELECT debt FROM sums)-(SELECT trade_credits FROM sums))-
      CASE p_control WHEN 'ar' THEN (SELECT debit_balance FROM ledger WHERE mapping_key=v_trade_mapping) ELSE -(SELECT debit_balance FROM ledger WHERE mapping_key=v_trade_mapping) END,
    'provisional',false) INTO v_data;
  RETURN jsonb_build_object('snapshot_id',gen_random_uuid(),'report_type',CASE p_control WHEN 'ar' THEN 'receivable_aging' ELSE 'payable_aging' END,
    'company',jsonb_build_object('id',v_org.id,'name',v_org.name,'timezone',v_org.timezone),'filters',jsonb_build_object('as_of',p_as_of),
    'generated_at',v_now,'ledger_cutoff_at',v_now,'template_version','v1.0','status','posted','provisional',false,'data',v_data);
END; $$;
REVOKE ALL ON FUNCTION public.read_aging_snapshot(uuid,text,date) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_aging_snapshot(uuid,text,date) TO ams_runtime;
NOTIFY pgrst,'reload schema';
