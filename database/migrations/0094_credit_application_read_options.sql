-- US-038 / US-040: explicitly apply a posted credit to its original trade document.
-- Read only. The existing allocate_open_items command remains the money-event authority.
CREATE FUNCTION public.read_credit_application_options(p_organization_id uuid,p_document_id uuid,p_effective_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_doc finance.business_documents%ROWTYPE;v_original finance.business_documents%ROWTYPE;
  v_source_item finance.open_items%ROWTYPE;v_original_item finance.open_items%ROWTYPE;
  v_count integer;v_original_id uuid;v_minimum_date date;v_source_residual finance.amount;v_original_residual finance.amount;
  v_available finance.amount:=0;v_reversed boolean;v_status text;v_control text;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'dues.read');
  IF p_effective_date IS NULL OR NOT isfinite(p_effective_date) THEN
    RAISE EXCEPTION 'valid allocation date required' USING ERRCODE='22023'; END IF;
  IF NOT finance_private.can_read_document(p_organization_id,p_document_id) THEN
    RAISE EXCEPTION 'credit document unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id;
  IF v_doc.document_type NOT IN ('customer_credit','vendor_credit') OR v_doc.state<>'posted' THEN
    RAISE EXCEPTION 'posted trade credit required' USING ERRCODE='22023'; END IF;
  SELECT td.original_document_id INTO v_original_id FROM finance.trade_documents td
    WHERE td.organization_id=p_organization_id AND td.document_id=v_doc.id;
  IF v_original_id IS NULL OR NOT finance_private.can_read_document(p_organization_id,v_original_id) THEN
    RAISE EXCEPTION 'original document unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_original FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=v_original_id;
  IF v_original.state<>'posted' OR v_original.party_id IS DISTINCT FROM v_doc.party_id OR
    v_original.document_type::text<>(CASE WHEN v_doc.document_type='customer_credit' THEN 'invoice' ELSE 'bill' END) THEN
    RAISE EXCEPTION 'matching original trade document required' USING ERRCODE='23514'; END IF;
  v_control:=CASE WHEN v_doc.document_type='customer_credit' THEN 'ar' ELSE 'ap' END;
  SELECT count(*)::integer INTO v_count FROM finance.open_items oi
    JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
    WHERE oi.organization_id=p_organization_id AND je.source_document_id=v_doc.id AND oi.control_kind::text=v_control;
  IF v_count<>1 THEN RAISE EXCEPTION 'credit control item unavailable' USING ERRCODE='23514'; END IF;
  SELECT oi.* INTO v_source_item FROM finance.open_items oi
    JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
    WHERE oi.organization_id=p_organization_id AND je.source_document_id=v_doc.id AND oi.control_kind::text=v_control;
  SELECT count(*)::integer INTO v_count FROM finance.open_items oi
    JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
    WHERE oi.organization_id=p_organization_id AND je.source_document_id=v_original.id AND oi.control_kind::text=v_control;
  IF v_count<>1 THEN RAISE EXCEPTION 'original control item unavailable' USING ERRCODE='23514'; END IF;
  SELECT oi.* INTO v_original_item FROM finance.open_items oi
    JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
    WHERE oi.organization_id=p_organization_id AND je.source_document_id=v_original.id AND oi.control_kind::text=v_control;
  IF v_source_item.account_id<>v_original_item.account_id OR v_source_item.party_id<>v_original_item.party_id OR
    v_source_item.side::text<>(CASE WHEN v_doc.document_type='customer_credit' THEN 'credit' ELSE 'debit' END) OR
    v_original_item.side=v_source_item.side THEN
    RAISE EXCEPTION 'compatible opposite trade items required' USING ERRCODE='23514'; END IF;
  v_minimum_date:=greatest(v_doc.accounting_date,v_original.accounting_date,v_source_item.issue_date,v_original_item.issue_date);
  SELECT EXISTS(SELECT 1 FROM finance.business_documents r WHERE r.organization_id=p_organization_id
    AND r.reversal_of_document_id IN (v_doc.id,v_original.id)) INTO v_reversed;
  IF p_effective_date>=v_minimum_date THEN
    v_source_residual:=finance_private.open_item_residual_as_of(p_organization_id,v_source_item.id,p_effective_date);
    v_original_residual:=finance_private.open_item_residual_as_of(p_organization_id,v_original_item.id,p_effective_date);
    IF NOT v_reversed THEN
      SELECT least(min(finance_private.open_item_residual_as_of(p_organization_id,v_source_item.id,boundary.effective_date)),
        min(finance_private.open_item_residual_as_of(p_organization_id,v_original_item.id,boundary.effective_date)))::finance.amount INTO v_available
      FROM (
        SELECT p_effective_date AS effective_date
        UNION SELECT a.effective_date FROM finance.settlement_allocations a WHERE a.organization_id=p_organization_id
          AND (a.debit_open_item_id IN (v_source_item.id,v_original_item.id) OR a.credit_open_item_id IN (v_source_item.id,v_original_item.id))
          AND a.effective_date>p_effective_date
        UNION SELECT r.effective_date FROM finance.allocation_reversals r
          JOIN finance.settlement_allocations a ON a.organization_id=r.organization_id AND a.id=r.allocation_id
          WHERE a.organization_id=p_organization_id AND (a.debit_open_item_id IN (v_source_item.id,v_original_item.id) OR a.credit_open_item_id IN (v_source_item.id,v_original_item.id))
            AND r.effective_date>p_effective_date
      ) boundary;
    END IF;
  END IF;
  v_status:=CASE WHEN v_reversed THEN 'reversed' WHEN p_effective_date<v_minimum_date THEN 'not_yet_effective'
    WHEN v_source_residual=0 THEN 'already_allocated' WHEN v_original_residual=0 THEN 'original_settled'
    WHEN v_available<=0 THEN 'no_capacity' ELSE 'available' END;
  RETURN jsonb_build_object('organization_id',p_organization_id,'document_id',v_doc.id,'document_type',v_doc.document_type::text,
    'document_number',v_doc.document_number,'original_document_id',v_original.id,'original_document_type',v_original.document_type::text,
    'original_document_number',v_original.document_number,'effective_date',p_effective_date,'minimum_date',v_minimum_date,
    'credit_amount',v_doc.total_amount::text,'credit_residual_amount',v_source_residual::text,'original_residual_amount',v_original_residual::text,
    'available_amount',v_available::text,'status',v_status,
    'debit_open_item_id',CASE WHEN v_source_item.side='debit' THEN v_source_item.id ELSE v_original_item.id END,
    'credit_open_item_id',CASE WHEN v_source_item.side='credit' THEN v_source_item.id ELSE v_original_item.id END,
    'allocations',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'amount',a.amount::text,'effective_date',a.effective_date,
      'counter_document_id',CASE WHEN finance_private.can_read_document(other_doc.organization_id,other_doc.id) THEN other_doc.id ELSE NULL END,
      'counter_document_number',CASE WHEN finance_private.can_read_document(other_doc.organization_id,other_doc.id) THEN other_doc.document_number ELSE NULL END,
      'counter_document_type',CASE WHEN finance_private.can_read_document(other_doc.organization_id,other_doc.id) THEN other_doc.document_type::text ELSE NULL END,
      'reversed_on',r.effective_date) ORDER BY a.effective_date,a.id)
      FROM finance.settlement_allocations a
        JOIN finance.open_items other_item ON other_item.organization_id=a.organization_id AND other_item.id=CASE
          WHEN a.debit_open_item_id=v_source_item.id THEN a.credit_open_item_id ELSE a.debit_open_item_id END
        JOIN finance.journal_lines jl ON jl.organization_id=other_item.organization_id AND jl.id=other_item.journal_line_id
        JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
        JOIN finance.business_documents other_doc ON other_doc.organization_id=je.organization_id AND other_doc.id=je.source_document_id
        LEFT JOIN finance.allocation_reversals r ON r.organization_id=a.organization_id AND r.allocation_id=a.id
      WHERE a.organization_id=p_organization_id AND (a.debit_open_item_id=v_source_item.id OR a.credit_open_item_id=v_source_item.id)),'[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.read_credit_application_options(uuid,uuid,date) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_credit_application_options(uuid,uuid,date) TO ams_runtime;
