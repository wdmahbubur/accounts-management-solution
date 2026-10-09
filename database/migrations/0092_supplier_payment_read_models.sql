-- US-035 / UI-21, UI-22: select eligible supplier bills and read dated settlement.
-- These reads do not reserve balances, mutate drafts, or replace posting/capacity checks.
CREATE FUNCTION public.read_supplier_payment_allocation_options(
  p_organization_id uuid,p_party_id uuid,p_accounting_date date
) RETURNS TABLE(organization_id uuid,party_id uuid,open_item_id uuid,document_id uuid,document_number text,
  supplier_reference text,issue_date date,due_date date,total_amount text,residual_amount text,available_amount text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_ap uuid;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'purchases.write');
  PERFORM finance_private.require_capability(p_organization_id,'documents.read');
  PERFORM finance_private.require_capability(p_organization_id,'dues.read');
  IF p_party_id IS NULL OR p_accounting_date IS NULL OR NOT isfinite(p_accounting_date) OR NOT EXISTS(
    SELECT 1 FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=p_party_id AND c.is_vendor AND c.is_active
  ) THEN RAISE EXCEPTION 'active supplier and accounting date required' USING ERRCODE='22023'; END IF;
  SELECT m.account_id INTO v_ap FROM finance.account_mappings m
    JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id
    WHERE m.organization_id=p_organization_id AND m.mapping_key='ap' AND a.control_kind='ap' AND a.is_active AND a.is_postable;
  IF v_ap IS NULL THEN RAISE EXCEPTION 'active payable account mapping required' USING ERRCODE='23514'; END IF;
  RETURN QUERY
    SELECT d.organization_id,oi.party_id,oi.id,d.id,d.document_number,td.supplier_invoice_key,d.issue_date,d.due_date,
      d.total_amount::text,finance_private.open_item_residual_as_of(p_organization_id,oi.id,p_accounting_date)::text,capacity.amount::text
    FROM finance.open_items oi
      JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
      JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
      JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id
      JOIN finance.trade_documents td ON td.organization_id=d.organization_id AND td.document_id=d.id
      CROSS JOIN LATERAL (
        -- An allocation added on this date persists through all later boundaries.
        -- Reuse the existing dated residual reader instead of using today's balance.
        SELECT min(finance_private.open_item_residual_as_of(p_organization_id,oi.id,boundary.effective_date))::finance.amount AS amount
        FROM (
          SELECT p_accounting_date AS effective_date
          UNION SELECT a.effective_date FROM finance.settlement_allocations a
            WHERE a.organization_id=oi.organization_id AND (a.debit_open_item_id=oi.id OR a.credit_open_item_id=oi.id) AND a.effective_date>p_accounting_date
          UNION SELECT r.effective_date FROM finance.allocation_reversals r
            JOIN finance.settlement_allocations a ON a.organization_id=r.organization_id AND a.id=r.allocation_id
            WHERE a.organization_id=oi.organization_id AND (a.debit_open_item_id=oi.id OR a.credit_open_item_id=oi.id) AND r.effective_date>p_accounting_date
        ) boundary
      ) capacity
    WHERE oi.organization_id=p_organization_id AND oi.party_id=p_party_id AND oi.account_id=v_ap AND oi.control_kind='ap' AND oi.side='credit'
      AND d.party_id=p_party_id AND d.document_type='bill' AND d.state='posted' AND d.accounting_date<=p_accounting_date
      AND oi.issue_date<=p_accounting_date AND capacity.amount>0
      AND NOT EXISTS(SELECT 1 FROM finance.business_documents reversal WHERE reversal.organization_id=d.organization_id AND reversal.reversal_of_document_id=d.id)
    ORDER BY d.issue_date DESC,d.id DESC,oi.id
    LIMIT 1001; -- The application explicitly rejects overflow; it never presents a silently truncated list.
END; $$;
REVOKE ALL ON FUNCTION public.read_supplier_payment_allocation_options(uuid,uuid,date) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_supplier_payment_allocation_options(uuid,uuid,date) TO ams_runtime;

CREATE FUNCTION public.read_supplier_document_lifecycle(p_organization_id uuid,p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_doc finance.business_documents%ROWTYPE;v_today date;v_item uuid;v_count integer;v_residual finance.amount;
  v_reversed boolean;v_effective boolean;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'purchases.read');
  SELECT * INTO v_doc FROM finance.business_documents d
    WHERE d.organization_id=p_organization_id AND d.id=p_document_id AND d.document_type IN ('bill','vendor_payment');
  IF NOT FOUND OR NOT finance_private.can_read_document(p_organization_id,p_document_id) THEN
    RAISE EXCEPTION 'supplier document unavailable' USING ERRCODE='P0002'; END IF;
  SELECT (now() AT TIME ZONE o.timezone)::date INTO v_today FROM finance.organizations o WHERE o.id=p_organization_id;
  SELECT count(*)::integer,(array_agg(oi.id))[1] INTO v_count,v_item
    FROM finance.open_items oi JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
      JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
    WHERE oi.organization_id=p_organization_id AND je.source_document_id=v_doc.id AND oi.control_kind='ap'
      AND oi.side=CASE WHEN v_doc.document_type='bill' THEN 'credit' ELSE 'debit' END;
  IF v_doc.state='posted' AND v_count<>1 THEN RAISE EXCEPTION 'posted supplier control item unavailable' USING ERRCODE='23514'; END IF;
  v_effective:=v_doc.state='posted' AND v_doc.accounting_date<=v_today;
  v_residual:=CASE WHEN v_effective THEN finance_private.open_item_residual_as_of(p_organization_id,v_item,v_today) ELSE NULL END;
  SELECT EXISTS(SELECT 1 FROM finance.business_documents r WHERE r.organization_id=p_organization_id
    AND r.reversal_of_document_id=v_doc.id AND r.state='posted' AND r.accounting_date<=v_today) INTO v_reversed;
  RETURN jsonb_build_object('id',v_doc.id,'organization_id',p_organization_id,'document_type',v_doc.document_type::text,
    'state',v_doc.state::text,'as_of_date',v_today,'total_amount',v_doc.total_amount::text,'residual_amount',v_residual::text,
    -- Applied means dated settlements of this source item, including reversal closure.
    -- It is not a cash-paid metric. Reversed sources keep their history/status explicit.
    'applied_amount',CASE WHEN v_effective THEN (v_doc.total_amount-v_residual)::finance.amount::text ELSE '0.00' END,
    'overdue',COALESCE(v_doc.document_type='bill' AND v_effective AND NOT v_reversed AND v_doc.due_date<v_today AND v_residual>0,false),
    'settlement_status',CASE WHEN v_doc.state<>'posted' THEN 'not_posted' WHEN NOT v_effective THEN 'not_yet_effective' WHEN v_reversed THEN 'reversed'
      WHEN v_doc.document_type='bill' THEN CASE WHEN v_residual=0 THEN 'paid' WHEN v_residual<v_doc.total_amount THEN 'partially_paid' ELSE 'unpaid' END
      ELSE CASE WHEN v_residual=0 THEN 'fully_allocated' WHEN v_residual<v_doc.total_amount THEN 'partially_allocated' ELSE 'unallocated' END END,
    'allocations',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'amount',a.amount::text,'effective_date',a.effective_date,
      'counter_document_id',CASE WHEN finance_private.can_read_document(other_doc.organization_id,other_doc.id) THEN other_doc.id ELSE NULL END,
      'counter_document_type',CASE WHEN finance_private.can_read_document(other_doc.organization_id,other_doc.id) THEN other_doc.document_type::text ELSE NULL END,
      'counter_document_number',CASE WHEN finance_private.can_read_document(other_doc.organization_id,other_doc.id) THEN other_doc.document_number ELSE NULL END,
      'reversed_on',r.effective_date) ORDER BY a.effective_date,a.id)
      FROM finance.settlement_allocations a
        JOIN finance.open_items other_item ON other_item.organization_id=a.organization_id
          AND other_item.id=CASE WHEN a.debit_open_item_id=v_item THEN a.credit_open_item_id ELSE a.debit_open_item_id END
        JOIN finance.journal_lines jl ON jl.organization_id=other_item.organization_id AND jl.id=other_item.journal_line_id
        JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
        JOIN finance.business_documents other_doc ON other_doc.organization_id=je.organization_id AND other_doc.id=je.source_document_id
        LEFT JOIN finance.allocation_reversals r ON r.organization_id=a.organization_id AND r.allocation_id=a.id
      WHERE a.organization_id=p_organization_id AND v_item IS NOT NULL AND (a.debit_open_item_id=v_item OR a.credit_open_item_id=v_item)),'[]'::jsonb),
    'corrections',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'document_type',r.document_type::text,'document_number',r.document_number,
      'state',r.state::text,'accounting_date',r.accounting_date,'reason',r.correction_reason) ORDER BY r.accounting_date,r.id)
      FROM finance.business_documents r WHERE r.organization_id=p_organization_id AND r.reversal_of_document_id=v_doc.id
        AND finance_private.can_read_document(r.organization_id,r.id)),'[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.read_supplier_document_lifecycle(uuid,uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_supplier_document_lifecycle(uuid,uuid) TO ams_runtime;
