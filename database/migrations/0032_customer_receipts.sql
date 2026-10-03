-- US-032: current, tenant-scoped receipt register and invoice allocation choices.

CREATE FUNCTION finance_private.open_item_residual_as_of(p_organization_id uuid,p_open_item_id uuid,p_cutoff date)
RETURNS finance.amount LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT CASE WHEN p_cutoff<oi.issue_date THEN 0::finance.amount ELSE
    GREATEST(oi.original_amount-COALESCE((
      SELECT sum(events.delta)::finance.amount FROM (
        SELECT a.amount AS delta FROM finance.settlement_allocations a
        WHERE a.organization_id=oi.organization_id AND (a.debit_open_item_id=oi.id OR a.credit_open_item_id=oi.id) AND a.effective_date<=p_cutoff
        UNION ALL
        SELECT -a.amount FROM finance.settlement_allocations a JOIN finance.allocation_reversals r
          ON r.organization_id=a.organization_id AND r.allocation_id=a.id
        WHERE a.organization_id=oi.organization_id AND (a.debit_open_item_id=oi.id OR a.credit_open_item_id=oi.id) AND r.effective_date<=p_cutoff
      ) events),0),0)::finance.amount END
  FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.id=p_open_item_id
$$;
REVOKE ALL ON FUNCTION finance_private.open_item_residual_as_of(uuid,uuid,date) FROM PUBLIC,ams_runtime;

CREATE FUNCTION public.read_receipt_allocation_options(p_organization_id uuid,p_party_id uuid,p_accounting_date date)
RETURNS TABLE(open_item_id uuid,document_id uuid,document_number text,issue_date date,due_date date,total_amount text,residual_amount text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$

BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'sales.write');
  IF p_party_id IS NULL OR p_accounting_date IS NULL OR NOT isfinite(p_accounting_date) OR NOT EXISTS(
    SELECT 1 FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=p_party_id AND c.is_customer AND c.is_active
  ) THEN RAISE EXCEPTION 'active customer and accounting date required' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT oi.id,d.id,d.document_number,d.issue_date,d.due_date,d.total_amount::text,
    finance_private.open_item_residual_as_of(p_organization_id,oi.id,p_accounting_date)::text
  FROM finance.open_items oi JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
    JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id
  WHERE oi.organization_id=p_organization_id AND oi.party_id=p_party_id AND oi.control_kind='ar' AND oi.side='debit'
    AND d.document_type='invoice' AND d.state='posted' AND d.accounting_date<=p_accounting_date
    AND finance_private.open_item_residual_as_of(p_organization_id,oi.id,p_accounting_date)>0
  ORDER BY d.issue_date DESC,d.id DESC,oi.id;
END; $$;
REVOKE ALL ON FUNCTION public.read_receipt_allocation_options(uuid,uuid,date) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_receipt_allocation_options(uuid,uuid,date) TO ams_runtime;

CREATE FUNCTION public.read_receipt_register(
 p_organization_id uuid,p_status text DEFAULT 'all',p_search text DEFAULT NULL,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 101
) RETURNS TABLE(id uuid,organization_id uuid,state text,document_number text,customer_name text,issue_date date,
 total_amount text,applied_amount text,unused_credit text,settlement_status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_timezone text;v_today date;
BEGIN
 PERFORM finance_private.require_capability(p_organization_id,'sales.read');
 IF p_status NOT IN ('all','drafts','awaiting_approval','posted') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 101
   OR (p_search IS NOT NULL AND length(p_search)>100) THEN RAISE EXCEPTION 'invalid receipt filters' USING ERRCODE='22023'; END IF;
 SELECT o.timezone INTO v_timezone FROM finance.organizations o WHERE o.id=p_organization_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'organization unavailable' USING ERRCODE='P0002'; END IF;
 v_today:=(now() AT TIME ZONE v_timezone)::date;
 RETURN QUERY SELECT d.id,d.organization_id,d.state::text,d.document_number,c.display_name,d.issue_date,d.total_amount::text,
   CASE WHEN d.state='posted' THEN (d.total_amount-finance_private.open_item_residual_as_of(p_organization_id,oi.id,v_today))::text ELSE '0.00' END,
   CASE WHEN d.state='posted' THEN finance_private.open_item_residual_as_of(p_organization_id,oi.id,v_today)::text ELSE '0.00' END,
   CASE WHEN d.state<>'posted' THEN 'not_posted' WHEN finance_private.open_item_residual_as_of(p_organization_id,oi.id,v_today)=0 THEN 'fully_allocated'
     WHEN finance_private.open_item_residual_as_of(p_organization_id,oi.id,v_today)<d.total_amount THEN 'partially_allocated' ELSE 'unallocated' END
 FROM finance.business_documents d JOIN finance.contacts c ON c.organization_id=d.organization_id AND c.id=d.party_id
 LEFT JOIN LATERAL (SELECT oi.id FROM finance.open_items oi JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
   JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
   WHERE oi.organization_id=d.organization_id AND je.source_document_id=d.id AND oi.control_kind='ar' AND oi.side='credit' ORDER BY oi.id LIMIT 1) oi ON true
 WHERE d.organization_id=p_organization_id AND d.document_type='receipt'
   AND (p_status='all' OR (p_status='drafts' AND d.state='draft') OR (p_status='awaiting_approval' AND d.state='pending_approval') OR (p_status='posted' AND d.state='posted'))
   AND (p_after IS NULL OR d.id<p_after)
   AND (p_search IS NULL OR btrim(p_search)='' OR d.document_number ILIKE '%'||btrim(p_search)||'%' OR c.display_name ILIKE '%'||btrim(p_search)||'%'
     OR COALESCE(d.external_reference,'') ILIKE '%'||btrim(p_search)||'%')
 ORDER BY d.id DESC LIMIT p_limit;
END; $$;
REVOKE ALL ON FUNCTION public.read_receipt_register(uuid,text,text,uuid,integer) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_receipt_register(uuid,text,text,uuid,integer) TO ams_runtime;

CREATE FUNCTION public.read_receipt_lifecycle(p_organization_id uuid,p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_doc finance.business_documents%ROWTYPE;v_open_item uuid;v_timezone text;v_today date;v_residual finance.amount;
BEGIN
 PERFORM finance_private.require_capability(p_organization_id,'sales.read');
 SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id AND d.document_type='receipt';
 IF NOT FOUND OR NOT finance_private.can_read_document(p_organization_id,p_document_id) THEN RAISE EXCEPTION 'receipt unavailable' USING ERRCODE='P0002'; END IF;
 SELECT o.timezone INTO v_timezone FROM finance.organizations o WHERE o.id=p_organization_id;v_today:=(now() AT TIME ZONE v_timezone)::date;
 SELECT oi.id INTO v_open_item FROM finance.open_items oi JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
   JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
   WHERE oi.organization_id=p_organization_id AND je.source_document_id=v_doc.id AND oi.control_kind='ar' AND oi.side='credit' ORDER BY oi.id LIMIT 1;
 IF v_open_item IS NULL AND v_doc.state='posted' THEN RAISE EXCEPTION 'posted receipt control item unavailable' USING ERRCODE='23514'; END IF;
 IF v_open_item IS NULL THEN v_residual:=0;ELSE v_residual:=finance_private.open_item_residual_as_of(p_organization_id,v_open_item,v_today);END IF;
 RETURN jsonb_build_object('id',v_doc.id,'organization_id',p_organization_id,'state',v_doc.state::text,
   'total_amount',v_doc.total_amount::text,'residual_amount',CASE WHEN v_doc.state='posted' THEN v_residual::text ELSE NULL END,
   'applied_amount',CASE WHEN v_doc.state='posted' THEN (v_doc.total_amount-v_residual)::text ELSE '0.00' END,
   'allocations',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'amount',a.amount::text,'effective_date',a.effective_date,
     'counter_document_id',other_doc.id,'counter_document_type',other_doc.document_type::text,'counter_document_number',other_doc.document_number,
     'reversed_on',r.effective_date) ORDER BY a.effective_date,a.id)
     FROM finance.settlement_allocations a JOIN finance.open_items other_item
       ON other_item.organization_id=a.organization_id AND other_item.id=CASE WHEN a.debit_open_item_id=v_open_item THEN a.credit_open_item_id ELSE a.debit_open_item_id END
     JOIN finance.journal_lines jl ON jl.organization_id=other_item.organization_id AND jl.id=other_item.journal_line_id
     JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
     JOIN finance.business_documents other_doc ON other_doc.organization_id=je.organization_id AND other_doc.id=je.source_document_id
     LEFT JOIN finance.allocation_reversals r ON r.organization_id=a.organization_id AND r.allocation_id=a.id
     WHERE a.organization_id=p_organization_id AND v_open_item IS NOT NULL AND (a.debit_open_item_id=v_open_item OR a.credit_open_item_id=v_open_item)),'[]'::jsonb),
   'corrections',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'document_type',c.document_type::text,'document_number',c.document_number,
     'state',c.state::text,'accounting_date',c.accounting_date,'reason',c.correction_reason) ORDER BY c.accounting_date,c.id)
     FROM finance.business_documents c WHERE c.organization_id=p_organization_id AND c.reversal_of_document_id=v_doc.id),'[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.read_receipt_lifecycle(uuid,uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_receipt_lifecycle(uuid,uuid) TO ams_runtime;
NOTIFY pgrst,'reload schema';
