-- US-033: purchase-scoped bill register, duplicate reference warnings and lifecycle reads.
BEGIN;

CREATE FUNCTION finance_private.ap_residual_as_of(p_organization_id uuid,p_open_item_id uuid,p_cutoff date)
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
REVOKE ALL ON FUNCTION finance_private.ap_residual_as_of(uuid,uuid,date) FROM PUBLIC,anon,authenticated,ams_job_worker;

CREATE FUNCTION public.read_supplier_bill_register(
  p_organization_id uuid,p_status text DEFAULT 'all',p_search text DEFAULT NULL,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50
) RETURNS TABLE(
  id uuid,organization_id uuid,state text,document_number text,vendor_name text,supplier_invoice_reference text,
  supplier_invoice_date date,issue_date date,accounting_date date,due_date date,total_amount text,residual_amount text,
  settlement_status text,overdue boolean,duplicate_reference boolean
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_today date;v_timezone text;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'purchases.read');
  IF p_status NOT IN ('all','drafts','awaiting_approval','posted') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 101
    OR (p_search IS NOT NULL AND length(p_search)>100) THEN RAISE EXCEPTION 'invalid bill register filters' USING ERRCODE='22023'; END IF;
  SELECT o.timezone INTO v_timezone FROM finance.organizations o WHERE o.id=p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'organization unavailable' USING ERRCODE='P0002'; END IF;
  v_today:=(now() AT TIME ZONE v_timezone)::date;
  RETURN QUERY SELECT d.id,d.organization_id,d.state::text,d.document_number,c.display_name,td.supplier_invoice_key,td.supplier_invoice_date,
    d.issue_date,d.accounting_date,d.due_date,d.total_amount::text,
    CASE WHEN d.state='posted' THEN balances.residual::text ELSE NULL END,
    CASE WHEN d.state<>'posted' THEN 'not_posted' WHEN balances.residual=0 THEN 'paid'
      WHEN balances.residual<d.total_amount THEN 'partially_paid' ELSE 'unpaid' END,
    COALESCE(d.state='posted' AND d.due_date<v_today AND balances.residual>0,false),
    COALESCE(NULLIF(btrim(td.supplier_invoice_key),'') IS NOT NULL AND EXISTS(
      SELECT 1 FROM finance.trade_documents other_td JOIN finance.business_documents other
        ON other.organization_id=other_td.organization_id AND other.id=other_td.document_id
      WHERE other_td.organization_id=d.organization_id AND other.party_id=d.party_id AND other.id<>d.id
        AND other.document_type='bill' AND other.state<>'void'
        AND lower(btrim(other_td.supplier_invoice_key))=lower(btrim(td.supplier_invoice_key))),false)
  FROM finance.business_documents d JOIN finance.contacts c ON c.organization_id=d.organization_id AND c.id=d.party_id
    JOIN finance.trade_documents td ON td.organization_id=d.organization_id AND td.document_id=d.id
  CROSS JOIN LATERAL (
    SELECT CASE WHEN d.state<>'posted' THEN 0::finance.amount ELSE COALESCE(sum(
      GREATEST(oi.original_amount-COALESCE(applied.amount,0),0)),0)::finance.amount END AS residual
    FROM finance.open_items oi JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
      JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
      LEFT JOIN LATERAL (SELECT COALESCE(sum(events.delta),0)::finance.amount AS amount FROM (
        SELECT a.amount AS delta FROM finance.settlement_allocations a WHERE a.organization_id=oi.organization_id
          AND (a.debit_open_item_id=oi.id OR a.credit_open_item_id=oi.id) AND a.effective_date<=v_today
        UNION ALL SELECT -a.amount FROM finance.settlement_allocations a JOIN finance.allocation_reversals r
          ON r.organization_id=a.organization_id AND r.allocation_id=a.id
          WHERE a.organization_id=oi.organization_id AND (a.debit_open_item_id=oi.id OR a.credit_open_item_id=oi.id) AND r.effective_date<=v_today
      ) events) applied ON true
    WHERE d.state='posted' AND je.source_document_id=d.id AND oi.control_kind='ap' AND oi.side='credit'
  ) balances
  WHERE d.organization_id=p_organization_id AND d.document_type='bill'
    AND (p_status='all' OR (p_status='drafts' AND d.state='draft') OR (p_status='awaiting_approval' AND d.state='pending_approval') OR (p_status='posted' AND d.state='posted'))
    AND (p_after IS NULL OR d.id<p_after)
    AND (p_search IS NULL OR btrim(p_search)='' OR d.document_number ILIKE '%'||btrim(p_search)||'%'
      OR c.display_name ILIKE '%'||btrim(p_search)||'%' OR COALESCE(td.supplier_invoice_key,'') ILIKE '%'||btrim(p_search)||'%'
      OR COALESCE(d.external_reference,'') ILIKE '%'||btrim(p_search)||'%')
  ORDER BY d.id DESC LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.read_supplier_bill_register(uuid,text,text,uuid,integer) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_supplier_bill_register(uuid,text,text,uuid,integer) TO authenticated;

CREATE FUNCTION public.find_duplicate_supplier_bill_reference(
  p_organization_id uuid,p_party_id uuid,p_reference text,p_exclude_document_id uuid DEFAULT NULL
) RETURNS TABLE(document_id uuid,document_number text,document_state text,supplier_invoice_date date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'purchases.write');
  IF p_party_id IS NULL OR p_reference IS NULL OR length(btrim(p_reference)) NOT BETWEEN 1 AND 160
    OR NOT EXISTS(SELECT 1 FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=p_party_id AND c.is_vendor AND c.is_active)
    OR (p_exclude_document_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM finance.business_documents d
      WHERE d.organization_id=p_organization_id AND d.id=p_exclude_document_id AND d.party_id=p_party_id AND d.document_type='bill')) THEN
    RAISE EXCEPTION 'active supplier, reference and matching bill required' USING ERRCODE='22023';
  END IF;
  RETURN QUERY SELECT d.id,d.document_number,d.state::text,td.supplier_invoice_date FROM finance.business_documents d
    JOIN finance.trade_documents td ON td.organization_id=d.organization_id AND td.document_id=d.id
    WHERE d.organization_id=p_organization_id AND d.party_id=p_party_id AND d.document_type='bill' AND d.state<>'void'
      AND (p_exclude_document_id IS NULL OR d.id<>p_exclude_document_id)
      AND lower(btrim(td.supplier_invoice_key))=lower(btrim(p_reference)) ORDER BY d.accounting_date DESC,d.id DESC LIMIT 25;
END $$;
REVOKE ALL ON FUNCTION public.find_duplicate_supplier_bill_reference(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.find_duplicate_supplier_bill_reference(uuid,uuid,text,uuid) TO authenticated;

CREATE FUNCTION public.read_supplier_bill_lifecycle(p_organization_id uuid,p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_doc finance.business_documents%ROWTYPE;v_timezone text;v_today date;v_residual finance.amount;v_approvals jsonb:='[]'::jsonb;
  v_attachments jsonb:='[]'::jsonb;v_activity jsonb:='[]'::jsonb;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'purchases.read');
  SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id AND d.document_type='bill';
  IF NOT FOUND OR NOT finance_private.can_read_document(p_organization_id,p_document_id) THEN RAISE EXCEPTION 'supplier bill unavailable' USING ERRCODE='P0002'; END IF;
  SELECT o.timezone INTO v_timezone FROM finance.organizations o WHERE o.id=p_organization_id;v_today:=(now() AT TIME ZONE v_timezone)::date;
  SELECT COALESCE(sum(finance_private.ap_residual_as_of(p_organization_id,oi.id,v_today)),0)::finance.amount INTO v_residual
    FROM finance.open_items oi JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
    WHERE v_doc.state='posted' AND je.source_document_id=v_doc.id AND oi.control_kind='ap' AND oi.side='credit';
  IF v_doc.state='posted' AND NOT EXISTS(SELECT 1 FROM finance.open_items oi JOIN finance.journal_lines jl
    ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id JOIN finance.journal_entries je
    ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
    WHERE oi.organization_id=p_organization_id AND je.source_document_id=v_doc.id AND oi.control_kind='ap' AND oi.side='credit') THEN
    RAISE EXCEPTION 'posted supplier bill control item unavailable' USING ERRCODE='23514';
  END IF;
  IF finance_private.has_permission(p_organization_id,'approvals.read') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',r.id,'state',r.state,'version',r.document_version,'created_at',r.created_at,
      'decisions',COALESCE((SELECT jsonb_agg(jsonb_build_object('decision',ad.decision,'reason',ad.reason,'created_at',ad.created_at,
        'decided_by',m.display_name_snapshot) ORDER BY ad.created_at,ad.id) FROM finance.approval_decisions ad
        JOIN finance.organization_members m ON m.organization_id=ad.organization_id AND m.id=ad.decided_by_member_id
        WHERE ad.organization_id=r.organization_id AND ad.request_id=r.id),'[]'::jsonb)) ORDER BY r.created_at DESC,r.id DESC),'[]'::jsonb)
      INTO v_approvals FROM finance.approval_requests r WHERE r.organization_id=p_organization_id AND r.document_id=v_doc.id;
  END IF;
  IF finance_private.has_permission(p_organization_id,'attachments.read') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',a.id,'filename',a.original_filename,'content_type',a.content_type,'byte_size',a.byte_size,
      'scan_status',a.scan_status,'created_at',a.created_at) ORDER BY a.created_at,a.id),'[]'::jsonb) INTO v_attachments
    FROM finance.attachment_links al JOIN finance.attachments a ON a.organization_id=al.organization_id AND a.id=al.attachment_id
    WHERE al.organization_id=p_organization_id AND al.document_id=v_doc.id AND finance_private.can_read_attachment(p_organization_id,a.id);
  END IF;
  IF finance_private.has_permission(p_organization_id,'audit.read') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('action',ae.action,'actor_kind',ae.actor_kind,'created_at',ae.created_at,'reason',ae.reason)
      ORDER BY ae.created_at,ae.id),'[]'::jsonb) INTO v_activity FROM finance.audit_events ae WHERE ae.organization_id=p_organization_id AND ae.document_id=v_doc.id;
  END IF;
  RETURN jsonb_build_object('id',v_doc.id,'organization_id',p_organization_id,'state',v_doc.state::text,
    'residual_amount',CASE WHEN v_doc.state='posted' THEN v_residual::text ELSE NULL END,
    'applied_amount',CASE WHEN v_doc.state='posted' THEN (v_doc.total_amount-v_residual)::text ELSE '0.00' END,
    'settlement_status',CASE WHEN v_doc.state<>'posted' THEN 'not_posted' WHEN v_residual=0 THEN 'paid'
      WHEN v_residual<v_doc.total_amount THEN 'partially_paid' ELSE 'unpaid' END,
    'overdue',COALESCE(v_doc.state='posted' AND v_doc.due_date<v_today AND v_residual>0,false),
    'duplicate_reference',COALESCE((SELECT NULLIF(btrim(td.supplier_invoice_key),'') IS NOT NULL AND EXISTS(
      SELECT 1 FROM finance.trade_documents other_td JOIN finance.business_documents other
        ON other.organization_id=other_td.organization_id AND other.id=other_td.document_id
      WHERE other_td.organization_id=td.organization_id AND other.party_id=v_doc.party_id AND other.id<>td.id
        AND other.document_type='bill' AND other.state<>'void' AND lower(btrim(other_td.supplier_invoice_key))=lower(btrim(td.supplier_invoice_key)))
      FROM finance.trade_documents td WHERE td.organization_id=p_organization_id AND td.document_id=v_doc.id),false),
    'allocations',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'amount',a.amount::text,'effective_date',a.effective_date,
      'counter_document_type',other_doc.document_type::text,'counter_document_number',other_doc.document_number,'reversed_on',r.effective_date)
      ORDER BY a.effective_date,a.id) FROM finance.open_items bill_item
      JOIN finance.journal_lines bjl ON bjl.organization_id=bill_item.organization_id AND bjl.id=bill_item.journal_line_id
      JOIN finance.journal_entries bje ON bje.organization_id=bjl.organization_id AND bje.id=bjl.journal_entry_id AND bje.source_document_id=v_doc.id
      JOIN finance.settlement_allocations a ON a.organization_id=bill_item.organization_id AND (a.debit_open_item_id=bill_item.id OR a.credit_open_item_id=bill_item.id)
      JOIN finance.open_items other_item ON other_item.organization_id=a.organization_id AND other_item.id=CASE WHEN a.debit_open_item_id=bill_item.id THEN a.credit_open_item_id ELSE a.debit_open_item_id END
      JOIN finance.journal_lines ojl ON ojl.organization_id=other_item.organization_id AND ojl.id=other_item.journal_line_id
      JOIN finance.journal_entries oje ON oje.organization_id=ojl.organization_id AND oje.id=ojl.journal_entry_id
      JOIN finance.business_documents other_doc ON other_doc.organization_id=oje.organization_id AND other_doc.id=oje.source_document_id
      LEFT JOIN finance.allocation_reversals r ON r.organization_id=a.organization_id AND r.allocation_id=a.id
      WHERE bill_item.organization_id=p_organization_id AND bill_item.control_kind='ap' AND bill_item.side='credit'),'[]'::jsonb),
    'approvals',v_approvals,'attachments',v_attachments,'activity',v_activity,
    'corrections',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'document_type',c.document_type::text,'document_number',c.document_number,
      'state',c.state::text,'accounting_date',c.accounting_date,'reason',c.correction_reason) ORDER BY c.accounting_date,c.id)
      FROM finance.business_documents c WHERE c.organization_id=p_organization_id AND c.reversal_of_document_id=v_doc.id),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.read_supplier_bill_lifecycle(uuid,uuid) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_supplier_bill_lifecycle(uuid,uuid) TO authenticated;

-- Expose the already-approved recovery treatment in the shared draft options so billers can choose knowingly.
CREATE OR REPLACE FUNCTION public.list_document_draft_options(p_organization_id uuid,p_document_type text,p_accounting_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_type finance.document_type;v_permission text;
BEGIN
  BEGIN v_type:=p_document_type::finance.document_type;EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'unsupported source type' USING ERRCODE='22023';END;
  v_permission:=CASE WHEN v_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance') THEN 'sales.write'
    WHEN v_type IN ('bill','vendor_credit','paid_expense','vendor_payment','vendor_refund','vendor_advance') THEN 'purchases.write'
    WHEN v_type='transfer' THEN 'banking.write' ELSE 'journal.write' END;
  PERFORM finance_private.require_capability(p_organization_id,v_permission);
  IF p_accounting_date IS NULL OR NOT isfinite(p_accounting_date) THEN RAISE EXCEPTION 'accounting date required' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object(
    'accounts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'code',a.code,'name',a.name,'account_type',a.account_type,'normal_side',a.normal_side) ORDER BY a.code)
      FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.is_active AND a.is_postable AND a.control_kind IS NULL
        AND ((v_type IN ('invoice','customer_credit') AND a.account_type='income') OR
          (v_type IN ('bill','vendor_credit','paid_expense') AND a.account_type IN ('expense','asset')) OR
          (v_type='transfer' AND a.account_type='expense') OR
          (v_type IN ('manual_journal','controlled_adjustment','opening_balance') AND finance_private.has_permission(p_organization_id,'accounting.read')))),'[]'::jsonb),
    'parties',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'display_name',c.display_name) ORDER BY c.display_name)
      FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.is_active AND
        ((v_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance') AND c.is_customer) OR
          (v_type IN ('bill','vendor_credit','vendor_payment','vendor_refund','vendor_advance') AND c.is_vendor) OR (v_type='paid_expense' AND c.is_vendor))),'[]'::jsonb),
    'cash_accounts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',ca.id,'name',ca.name,'kind',ca.kind) ORDER BY ca.name)
      FROM finance.cash_accounts ca WHERE ca.organization_id=p_organization_id AND ca.is_active AND
        (finance_private.has_permission(p_organization_id,'banking.read') OR finance_private.has_permission(p_organization_id,'banking.write'))),'[]'::jsonb),
    'rounding_accounts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'code',a.code,'name',a.name) ORDER BY a.code)
      FROM finance.accounts a JOIN finance.account_mappings m ON m.organization_id=a.organization_id AND m.account_id=a.id
      WHERE a.organization_id=p_organization_id AND m.mapping_key='rounding_difference' AND a.is_active AND a.is_postable),'[]'::jsonb),
    'tax_codes',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'code',t.code,'label',t.label,'rate_percent',t.rate_percent::text,
      'recoverability',t.recoverability) ORDER BY t.code) FROM finance.tax_codes t WHERE t.organization_id=p_organization_id AND t.is_active
        AND t.effective_from<=p_accounting_date AND (t.effective_to IS NULL OR t.effective_to>=p_accounting_date)
        AND finance_private.has_permission(p_organization_id,'tax.read')),'[]'::jsonb),
    'items',CASE WHEN finance_private.has_permission(p_organization_id,'catalog.read') THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'sku',i.sku,'name',i.name,'unit',i.unit,'default_unit_price',i.default_unit_price::text,
      'sales_account_id',i.sales_account_id,'purchase_account_id',i.purchase_account_id,'tax_code_id',i.tax_code_id) ORDER BY i.name,i.id)
      FROM finance.items i WHERE i.organization_id=p_organization_id AND i.is_active),'[]'::jsonb) ELSE '[]'::jsonb END,
    'cost_centers',CASE WHEN finance_private.has_permission(p_organization_id,'catalog.read') THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',cc.id,'code',cc.code,'name',cc.name) ORDER BY cc.code)
      FROM finance.cost_centers cc WHERE cc.organization_id=p_organization_id AND cc.is_active),'[]'::jsonb) ELSE '[]'::jsonb END);
END $$;
REVOKE ALL ON FUNCTION public.list_document_draft_options(uuid,text,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_document_draft_options(uuid,text,date) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
