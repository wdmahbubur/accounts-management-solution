-- US-040: bill-linked supplier credits and paid supplier refund settlement.
BEGIN;

CREATE FUNCTION public.read_vendor_credit_source_bills(p_organization_id uuid,p_party_id uuid)
RETURNS TABLE(document_id uuid,document_number text,supplier_name text,accounting_date date,total_amount text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'purchases.write');
  IF p_party_id IS NULL OR NOT EXISTS(SELECT 1 FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=p_party_id AND c.is_vendor AND c.is_active) THEN
    RAISE EXCEPTION 'active supplier required' USING ERRCODE='22023';
  END IF;
  RETURN QUERY SELECT d.id,d.document_number,c.display_name,d.accounting_date,d.total_amount::text
    FROM finance.business_documents d JOIN finance.contacts c ON c.organization_id=d.organization_id AND c.id=d.party_id
    WHERE d.organization_id=p_organization_id AND d.party_id=p_party_id AND d.document_type='bill' AND d.state='posted'
      AND EXISTS(SELECT 1 FROM finance.document_lines l WHERE l.organization_id=d.organization_id AND l.document_id=d.id AND l.quantity>COALESCE((
        SELECT sum(cl.quantity) FROM finance.document_lines cl JOIN finance.business_documents cd ON cd.organization_id=cl.organization_id AND cd.id=cl.document_id
          WHERE cl.organization_id=l.organization_id AND cl.original_line_id=l.id AND cd.document_type='vendor_credit' AND cd.state='posted'
            AND NOT EXISTS(SELECT 1 FROM finance.business_documents rv WHERE rv.organization_id=cd.organization_id AND rv.reversal_of_document_id=cd.id AND rv.state='posted')),0))
    ORDER BY d.accounting_date DESC,d.id DESC;
END $$;
REVOKE ALL ON FUNCTION public.read_vendor_credit_source_bills(uuid,uuid) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_vendor_credit_source_bills(uuid,uuid) TO authenticated;

CREATE FUNCTION public.read_vendor_credit_bill_lines(p_organization_id uuid,p_party_id uuid,p_bill_id uuid)
RETURNS TABLE(original_document_id uuid,original_document_number text,issue_date date,original_line_id uuid,description text,quantity text,
  available_quantity text,unit_price text,discount_amount text,account_id uuid,tax_mode text,gross_amount text,available_gross text,tax_recoverability text,tax_rate text,tax_label text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'purchases.write');
  IF p_party_id IS NULL OR p_bill_id IS NULL OR NOT EXISTS(SELECT 1 FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=p_party_id AND c.is_vendor AND c.is_active) THEN
    RAISE EXCEPTION 'active supplier and bill required' USING ERRCODE='22023';
  END IF;
  RETURN QUERY SELECT d.id,d.document_number,d.issue_date,l.id,l.description,l.quantity::text,
    (l.quantity-COALESCE(used.quantity,0))::text,l.unit_price::text,l.discount_amount::text,l.account_id,l.tax_mode,l.gross_amount::text,(l.gross_amount-COALESCE(used.gross,0))::text,
    l.tax_recoverability_snapshot,l.tax_rate_snapshot::text,l.tax_label_snapshot
  FROM finance.business_documents d JOIN finance.document_lines l ON l.organization_id=d.organization_id AND l.document_id=d.id
  LEFT JOIN LATERAL (SELECT COALESCE(sum(cl.quantity),0)::finance.quantity quantity,COALESCE(sum(cl.gross_amount),0)::finance.amount gross
    FROM finance.document_lines cl JOIN finance.business_documents cd ON cd.organization_id=cl.organization_id AND cd.id=cl.document_id
    WHERE cl.organization_id=l.organization_id AND cl.original_line_id=l.id AND cd.document_type='vendor_credit' AND cd.state='posted'
      AND NOT EXISTS(SELECT 1 FROM finance.business_documents reversed WHERE reversed.organization_id=cd.organization_id AND reversed.reversal_of_document_id=cd.id AND reversed.state='posted')) used ON true
  WHERE d.organization_id=p_organization_id AND d.id=p_bill_id AND d.party_id=p_party_id AND d.document_type='bill' AND d.state='posted'
    AND l.quantity>COALESCE(used.quantity,0) AND l.gross_amount>COALESCE(used.gross,0)
  ORDER BY l.line_no;
END $$;
REVOKE ALL ON FUNCTION public.read_vendor_credit_bill_lines(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_vendor_credit_bill_lines(uuid,uuid,uuid) TO authenticated;

CREATE FUNCTION public.read_supplier_refund_allocation_options(p_organization_id uuid,p_party_id uuid,p_accounting_date date)
RETURNS TABLE(open_item_id uuid,document_id uuid,document_number text,issue_date date,due_date date,total_amount text,residual_amount text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'purchases.write');
  PERFORM finance_private.require_capability(p_organization_id,'banking.write');
  PERFORM finance_private.require_capability(p_organization_id,'dues.allocate');
  IF p_party_id IS NULL OR p_accounting_date IS NULL OR NOT isfinite(p_accounting_date) OR NOT EXISTS(
    SELECT 1 FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=p_party_id AND c.is_vendor AND c.is_active
  ) THEN RAISE EXCEPTION 'active supplier and accounting date required' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT oi.id,d.id,d.document_number,d.issue_date,d.due_date,oi.original_amount::text,
    finance_private.open_item_residual_as_of(p_organization_id,oi.id,p_accounting_date)::text
  FROM finance.open_items oi JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
    JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id
  WHERE oi.organization_id=p_organization_id AND oi.party_id=p_party_id AND oi.control_kind='ap' AND oi.side='debit'
    AND d.document_type='vendor_credit' AND d.state='posted' AND d.accounting_date<=p_accounting_date
    AND finance_private.open_item_residual_as_of(p_organization_id,oi.id,p_accounting_date)>0
  ORDER BY d.issue_date DESC,d.id DESC,oi.id;
END $$;
REVOKE ALL ON FUNCTION public.read_supplier_refund_allocation_options(uuid,uuid,date) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_supplier_refund_allocation_options(uuid,uuid,date) TO authenticated;

CREATE FUNCTION public.read_supplier_refund_register(p_organization_id uuid,p_status text DEFAULT 'all',p_search text DEFAULT NULL,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 51)
RETURNS TABLE(id uuid,document_number text,state text,supplier_name text,accounting_date date,total_amount text,cash_account_name text,method text,reference text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'purchases.read');
  IF p_status NOT IN ('all','drafts','awaiting_approval','posted') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 51 OR (p_search IS NOT NULL AND length(p_search)>100) THEN
    RAISE EXCEPTION 'invalid supplier refund register filters' USING ERRCODE='22023';
  END IF;
  RETURN QUERY SELECT d.id,d.document_number,d.state::text,c.display_name,d.accounting_date,d.total_amount::text,ca.name,mm.method::text,mm.reference
    FROM finance.business_documents d JOIN finance.contacts c ON c.organization_id=d.organization_id AND c.id=d.party_id
    LEFT JOIN finance.money_movements mm ON mm.organization_id=d.organization_id AND mm.document_id=d.id
    LEFT JOIN finance.cash_accounts ca ON ca.organization_id=mm.organization_id AND ca.id=mm.cash_account_id
    WHERE d.organization_id=p_organization_id AND d.document_type='vendor_refund'
      AND (p_status='all' OR (p_status='drafts' AND d.state='draft') OR (p_status='awaiting_approval' AND d.state='pending_approval') OR (p_status='posted' AND d.state='posted'))
      AND (p_after IS NULL OR d.id<p_after)
      AND (p_search IS NULL OR btrim(p_search)='' OR d.document_number ILIKE '%'||btrim(p_search)||'%' OR c.display_name ILIKE '%'||btrim(p_search)||'%' OR COALESCE(mm.reference,'') ILIKE '%'||btrim(p_search)||'%')
    ORDER BY d.id DESC LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.read_supplier_refund_register(uuid,text,text,uuid,integer) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_supplier_refund_register(uuid,text,text,uuid,integer) TO authenticated;

CREATE FUNCTION public.read_supplier_refund_lifecycle(p_organization_id uuid,p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_doc finance.business_documents%ROWTYPE;v_open_item uuid;v_allocated finance.amount:=0;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'purchases.read');
  SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id AND d.document_type='vendor_refund';
  IF NOT FOUND OR NOT finance_private.can_read_document(p_organization_id,p_document_id) THEN RAISE EXCEPTION 'supplier refund unavailable' USING ERRCODE='P0002'; END IF;
  SELECT oi.id INTO v_open_item FROM finance.open_items oi JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
    WHERE oi.organization_id=p_organization_id AND je.source_document_id=v_doc.id AND oi.party_id=v_doc.party_id AND oi.side='credit' ORDER BY oi.id LIMIT 1;
  IF v_doc.state='posted' AND v_open_item IS NULL THEN RAISE EXCEPTION 'refund AP control item unavailable' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(sum(a.amount),0)::finance.amount INTO v_allocated FROM finance.settlement_allocations a
    WHERE a.organization_id=p_organization_id AND (a.debit_open_item_id=v_open_item OR a.credit_open_item_id=v_open_item)
      AND NOT EXISTS(SELECT 1 FROM finance.allocation_reversals r WHERE r.organization_id=a.organization_id AND r.allocation_id=a.id);
  RETURN jsonb_build_object('state',v_doc.state::text,'total_amount',v_doc.total_amount::text,'settled_amount',v_allocated::text,
    'allocations',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'amount',a.amount::text,'effective_date',a.effective_date,
      'vendor_credit_id',other_doc.id,'vendor_credit_number',other_doc.document_number,'reversed_on',r.effective_date) ORDER BY a.effective_date,a.id)
      FROM finance.settlement_allocations a JOIN finance.open_items other_item ON other_item.organization_id=a.organization_id
        AND other_item.id=CASE WHEN a.debit_open_item_id=v_open_item THEN a.credit_open_item_id ELSE a.debit_open_item_id END
      JOIN finance.journal_lines sl ON sl.organization_id=other_item.organization_id AND sl.id=other_item.journal_line_id
      JOIN finance.journal_entries sj ON sj.organization_id=sl.organization_id AND sj.id=sl.journal_entry_id
      JOIN finance.business_documents other_doc ON other_doc.organization_id=sj.organization_id AND other_doc.id=sj.source_document_id
      LEFT JOIN finance.allocation_reversals r ON r.organization_id=a.organization_id AND r.allocation_id=a.id
      WHERE a.organization_id=p_organization_id AND v_open_item IS NOT NULL AND (a.debit_open_item_id=v_open_item OR a.credit_open_item_id=v_open_item)),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.read_supplier_refund_lifecycle(uuid,uuid) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_supplier_refund_lifecycle(uuid,uuid) TO authenticated;

CREATE FUNCTION public.read_vendor_credit_register(p_organization_id uuid,p_search text DEFAULT NULL,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 51)
RETURNS TABLE(id uuid,document_number text,state text,supplier_name text,original_bill_number text,accounting_date date,total_amount text,available_amount text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_timezone text;v_today date;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'purchases.read');
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 51 OR (p_search IS NOT NULL AND length(p_search)>100) THEN RAISE EXCEPTION 'invalid supplier credit filters' USING ERRCODE='22023'; END IF;
  SELECT o.timezone INTO v_timezone FROM finance.organizations o WHERE o.id=p_organization_id;IF NOT FOUND THEN RAISE EXCEPTION 'organization unavailable' USING ERRCODE='P0002';END IF;v_today:=(now() AT TIME ZONE v_timezone)::date;
  RETURN QUERY SELECT d.id,d.document_number,d.state::text,c.display_name,original.document_number,d.accounting_date,d.total_amount::text,
    CASE WHEN d.state='posted' THEN finance_private.open_item_balance_at(p_organization_id,oi.id,v_today,clock_timestamp())::text ELSE '0.00' END
  FROM finance.business_documents d JOIN finance.contacts c ON c.organization_id=d.organization_id AND c.id=d.party_id
    LEFT JOIN finance.trade_documents td ON td.organization_id=d.organization_id AND td.document_id=d.id
    LEFT JOIN finance.business_documents original ON original.organization_id=td.organization_id AND original.id=td.original_document_id
    LEFT JOIN LATERAL(SELECT x.id FROM finance.open_items x JOIN finance.journal_lines jl ON jl.organization_id=x.organization_id AND jl.id=x.journal_line_id
      JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
      WHERE x.organization_id=d.organization_id AND je.source_document_id=d.id AND x.control_kind='ap' AND x.side='debit' ORDER BY x.id LIMIT 1) oi ON true
  WHERE d.organization_id=p_organization_id AND d.document_type='vendor_credit' AND (p_after IS NULL OR d.id<p_after)
    AND (p_search IS NULL OR btrim(p_search)='' OR d.document_number ILIKE '%'||btrim(p_search)||'%' OR c.display_name ILIKE '%'||btrim(p_search)||'%' OR COALESCE(original.document_number,'') ILIKE '%'||btrim(p_search)||'%')
  ORDER BY d.id DESC LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.read_vendor_credit_register(uuid,text,uuid,integer) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_vendor_credit_register(uuid,text,uuid,integer) TO authenticated;

CREATE FUNCTION public.read_vendor_credit_lifecycle(p_organization_id uuid,p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_doc finance.business_documents%ROWTYPE;v_original uuid;v_open_item uuid;v_timezone text;v_today date;v_residual finance.amount;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'purchases.read');
  SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id AND d.document_type='vendor_credit';
  IF NOT FOUND OR NOT finance_private.can_read_document(p_organization_id,p_document_id) THEN RAISE EXCEPTION 'vendor credit unavailable' USING ERRCODE='P0002';END IF;
  SELECT td.original_document_id INTO v_original FROM finance.trade_documents td WHERE td.organization_id=p_organization_id AND td.document_id=v_doc.id;
  SELECT oi.id INTO v_open_item FROM finance.open_items oi JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id WHERE oi.organization_id=p_organization_id
      AND je.source_document_id=v_doc.id AND oi.control_kind='ap' AND oi.side='debit' ORDER BY oi.id LIMIT 1;
  IF v_doc.state='posted' AND v_open_item IS NULL THEN RAISE EXCEPTION 'vendor-credit AP item unavailable' USING ERRCODE='23514';END IF;
  SELECT o.timezone INTO v_timezone FROM finance.organizations o WHERE o.id=p_organization_id;v_today:=(now() AT TIME ZONE v_timezone)::date;
  IF v_open_item IS NULL THEN v_residual:=0;ELSE v_residual:=finance_private.open_item_balance_at(p_organization_id,v_open_item,v_today,clock_timestamp());END IF;
  RETURN jsonb_build_object('id',v_doc.id,'state',v_doc.state::text,'original_document_id',v_original,'total_amount',v_doc.total_amount::text,
    'residual_amount',CASE WHEN v_doc.state='posted' THEN v_residual::text ELSE NULL END,'applied_amount',CASE WHEN v_doc.state='posted' THEN (v_doc.total_amount-v_residual)::text ELSE '0.00' END,
    'source_line_snapshots',COALESCE((SELECT jsonb_agg(jsonb_build_object('credit_line_id',cl.id,'original_line_id',ol.id,'description',ol.description,
      'original_quantity',ol.quantity::text,'credited_quantity',cl.quantity::text,'original_gross',ol.gross_amount::text,'credited_gross',cl.gross_amount::text,
      'original_account_id',ol.account_id,'tax_recoverability',ol.tax_recoverability_snapshot,'tax_rate',ol.tax_rate_snapshot::text,'tax_label',ol.tax_label_snapshot)
      ORDER BY cl.line_no) FROM finance.document_lines cl JOIN finance.document_lines ol ON ol.organization_id=cl.organization_id AND ol.id=cl.original_line_id
      WHERE cl.organization_id=p_organization_id AND cl.document_id=v_doc.id),'[]'::jsonb),
    'allocations',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'amount',a.amount::text,'effective_date',a.effective_date,'counter_document_id',other.id,
      'counter_document_type',other.document_type::text,'counter_document_number',other.document_number,'reversed_on',r.effective_date) ORDER BY a.effective_date,a.id)
      FROM finance.settlement_allocations a JOIN finance.open_items opposite ON opposite.organization_id=a.organization_id AND opposite.id=CASE WHEN a.debit_open_item_id=v_open_item THEN a.credit_open_item_id ELSE a.debit_open_item_id END
      JOIN finance.journal_lines sl ON sl.organization_id=opposite.organization_id AND sl.id=opposite.journal_line_id JOIN finance.journal_entries sj ON sj.organization_id=sl.organization_id AND sj.id=sl.journal_entry_id
      JOIN finance.business_documents other ON other.organization_id=sj.organization_id AND other.id=sj.source_document_id LEFT JOIN finance.allocation_reversals r ON r.organization_id=a.organization_id AND r.allocation_id=a.id
      WHERE a.organization_id=p_organization_id AND v_open_item IS NOT NULL AND (a.debit_open_item_id=v_open_item OR a.credit_open_item_id=v_open_item)),'[]'::jsonb),
    'approvals',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'state',r.state::text,'version',r.document_version,'created_at',r.created_at,'decisions',
      COALESCE((SELECT jsonb_agg(jsonb_build_object('decision',ad.decision::text,'created_at',ad.created_at,'reason',ad.reason) ORDER BY ad.created_at,ad.id) FROM finance.approval_decisions ad WHERE ad.organization_id=r.organization_id AND ad.request_id=r.id),'[]'::jsonb)) ORDER BY r.created_at,r.id)
      FROM finance.approval_requests r WHERE r.organization_id=p_organization_id AND r.document_id=v_doc.id),'[]'::jsonb),
    'reversals',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'document_number',r.document_number,'state',r.state::text,'accounting_date',r.accounting_date,'reason',r.correction_reason) ORDER BY r.accounting_date,r.id)
      FROM finance.business_documents r WHERE r.organization_id=p_organization_id AND r.reversal_of_document_id=v_doc.id),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.read_vendor_credit_lifecycle(uuid,uuid) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_vendor_credit_lifecycle(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_financial_document(
  p_organization_id uuid,p_document_id uuid,p_expected_version integer,p_request_id text,
  p_idempotency_key text,p_request_hash text,p_payload jsonb
) RETURNS TABLE(document_id uuid,document_version integer,state text,net_amount finance.amount,tax_amount finance.amount,
  total_amount finance.amount,material_digest text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_type finance.document_type; v_permission text; v_document finance.business_documents%ROWTYPE;
  v_id uuid:=COALESCE(p_document_id,gen_random_uuid()); v_created boolean:=p_document_id IS NULL;
  v_line jsonb; v_row jsonb; v_ord bigint; v_line_id uuid; v_keep_ids uuid[]:='{}'; v_original uuid; v_party uuid;
  v_issue date; v_accounting date; v_due date; v_books_start date; v_year_id uuid; v_currency text; v_rounding finance.amount;
  v_rounding_reason text; v_rounding_account uuid; v_rounding_row finance.accounts%ROWTYPE; v_receipt jsonb; v_existing_hash text; v_existing_actor uuid; v_result jsonb;
  v_line_count integer:=0; v_journal_count integer:=0; v_debits finance.amount; v_credits finance.amount; v_movement_amount finance.amount;
  v_plan_total finance.amount:=0; v_plan_amount finance.amount; v_target finance.open_items%ROWTYPE; v_plan_control text; v_plan_side text; v_plan jsonb;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{22,172}$' OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'valid idempotency key and request hash required' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR jsonb_typeof(p_payload->'lines') IS DISTINCT FROM 'array' OR
     jsonb_typeof(COALESCE(p_payload->'allocation_plan','[]'::jsonb)) IS DISTINCT FROM 'array' OR octet_length(p_payload::text)>1000000 THEN
    RAISE EXCEPTION 'document payload and typed arrays required' USING ERRCODE='22023';
  END IF;
  BEGIN v_type:=(p_payload->>'document_type')::finance.document_type;
    v_issue:=(p_payload->>'issue_date')::date; v_accounting:=(p_payload->>'accounting_date')::date;
    v_due:=NULLIF(p_payload->>'due_date','')::date; v_party:=NULLIF(p_payload->>'party_id','')::uuid;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'invalid document type or date' USING ERRCODE='22023'; END;
  IF v_type IS NULL OR v_issue IS NULL OR v_accounting IS NULL OR NOT isfinite(v_issue) OR NOT isfinite(v_accounting) THEN
    RAISE EXCEPTION 'document type, issue date, and accounting date are required' USING ERRCODE='22023';
  END IF;
  v_permission:=CASE WHEN v_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance') THEN 'sales.write'
    WHEN v_type IN ('bill','vendor_credit','paid_expense','vendor_payment','vendor_refund','vendor_advance') THEN 'purchases.write'
    WHEN v_type='transfer' THEN 'banking.write' ELSE 'journal.write' END;
  v_actor:=finance_private.require_capability(p_organization_id,v_permission);
  SELECT o.status,o.books_start_date INTO v_permission,v_books_start FROM finance.organizations o WHERE o.id=p_organization_id FOR SHARE;
  IF NOT FOUND OR v_permission<>'active' THEN RAISE EXCEPTION 'company is unavailable for editing' USING ERRCODE='42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text||':documents.save:'||p_idempotency_key,0));
  SELECT i.request_hash,i.actor_member_id,i.response_body INTO v_existing_hash,v_existing_actor,v_receipt FROM finance.idempotency_requests i
    WHERE i.organization_id=p_organization_id AND i.operation='documents.save' AND i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing_hash<>p_request_hash OR v_existing_actor<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505'; END IF;
    RETURN QUERY SELECT (v_receipt->>'document_id')::uuid,(v_receipt->>'document_version')::integer,
      v_receipt->>'state',(v_receipt->>'net_amount')::finance.amount,(v_receipt->>'tax_amount')::finance.amount,
      (v_receipt->>'total_amount')::finance.amount,v_receipt->>'material_digest'; RETURN;
  END IF;
  IF v_type NOT IN ('invoice','customer_credit','bill','vendor_credit','paid_expense','receipt','vendor_payment','customer_refund','vendor_refund',
     'customer_advance','vendor_advance','transfer','manual_journal','controlled_adjustment','opening_balance') THEN
    RAISE EXCEPTION 'this source type is created by its dedicated workflow' USING ERRCODE='23514';
  END IF;
  v_currency:=COALESCE(p_payload->>'currency','BDT'); IF v_currency<>'BDT' THEN RAISE EXCEPTION 'V1 supports BDT only' USING ERRCODE='23514'; END IF;
  IF length(COALESCE(p_payload->>'description',''))>2000 OR length(COALESCE(p_payload->>'external_reference',''))>160 THEN
    RAISE EXCEPTION 'document text exceeds its allowed length' USING ERRCODE='22023';
  END IF;
  v_rounding:=COALESCE(NULLIF(p_payload->>'rounding_adjustment','')::finance.amount,0);
  IF p_payload ? 'rounding_adjustment' THEN PERFORM finance_private.require_decimal_string(p_payload->'rounding_adjustment',2,true); END IF;
  v_rounding_reason:=NULLIF(btrim(p_payload->>'rounding_reason'),'');v_rounding_account:=NULLIF(p_payload->>'rounding_account_id','')::uuid;
  IF abs(v_rounding)>.05 OR (v_rounding=0 AND (v_rounding_reason IS NOT NULL OR v_rounding_account IS NOT NULL)) OR
     (v_rounding<>0 AND (v_rounding_reason IS NULL OR length(v_rounding_reason)>500 OR v_rounding_account IS NULL)) THEN
    RAISE EXCEPTION 'rounding requires an amount up to 0.05, reason, and approved account' USING ERRCODE='23514';
  END IF;
  IF v_rounding_account IS NOT NULL THEN
    SELECT * INTO v_rounding_row FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=v_rounding_account;
    IF NOT FOUND OR NOT finance_private.validate_mapping_target('rounding_difference',v_rounding_row) THEN
      RAISE EXCEPTION 'invalid rounding-difference account' USING ERRCODE='23514';
    END IF;
  END IF;
  IF v_type='opening_balance' THEN
    IF v_accounting<>v_books_start-1 THEN RAISE EXCEPTION 'opening balances use the day before books start' USING ERRCODE='23514'; END IF;
    SELECT p.fiscal_year_id INTO v_year_id FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.kind='opening'
      AND p.starts_on=v_accounting AND p.ends_on=v_accounting AND p.status='open';
    IF NOT FOUND THEN RAISE EXCEPTION 'opening period unavailable' USING ERRCODE='23514'; END IF;
  ELSE
    IF v_accounting<v_books_start THEN RAISE EXCEPTION 'accounting date precedes books start' USING ERRCODE='23514'; END IF;
    SELECT p.fiscal_year_id INTO v_year_id FROM finance.accounting_periods p JOIN finance.fiscal_years fy
      ON fy.organization_id=p.organization_id AND fy.id=p.fiscal_year_id
      WHERE p.organization_id=p_organization_id AND p.kind='regular' AND p.starts_on<=v_accounting AND p.ends_on>=v_accounting
        AND p.status='open' AND fy.status='open';
  END IF;
  IF v_type<>'opening_balance' AND v_year_id IS NULL THEN RAISE EXCEPTION 'accounting date has no open fiscal period' USING ERRCODE='23514'; END IF;
  IF v_due IS NOT NULL AND (NOT isfinite(v_due) OR v_due<v_issue) THEN RAISE EXCEPTION 'due date precedes issue date' USING ERRCODE='23514'; END IF;
  IF v_party IS NOT NULL THEN
    IF v_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance') AND NOT EXISTS
       (SELECT 1 FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=v_party AND c.is_customer AND c.is_active) THEN
      RAISE EXCEPTION 'active customer unavailable' USING ERRCODE='23514';
    END IF;
    IF v_type IN ('bill','vendor_credit','vendor_payment','vendor_refund','vendor_advance') AND NOT EXISTS
       (SELECT 1 FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=v_party AND c.is_vendor AND c.is_active) THEN
      RAISE EXCEPTION 'active supplier unavailable' USING ERRCODE='23514';
    END IF;
  ELSIF v_type IN ('invoice','customer_credit','bill','vendor_credit','receipt','vendor_payment','customer_refund','vendor_refund','customer_advance','vendor_advance') THEN
    RAISE EXCEPTION 'party is required for this source type' USING ERRCODE='23514';
  END IF;
  IF v_type IN ('customer_credit','vendor_credit') THEN
    v_original:=NULLIF(p_payload->'trade'->>'original_document_id','')::uuid;
    IF v_original IS NULL OR NOT EXISTS (SELECT 1 FROM finance.business_documents o WHERE o.organization_id=p_organization_id AND o.id=v_original
      AND o.state='posted' AND ((v_type='customer_credit' AND o.document_type='invoice') OR (v_type='vendor_credit' AND o.document_type='bill')) AND o.party_id=v_party) THEN
      RAISE EXCEPTION 'credit must reference its same-party posted original document' USING ERRCODE='23514';
    END IF;
  END IF;
  IF v_created THEN
    INSERT INTO finance.business_documents(id,organization_id,document_type,fiscal_year_id,party_id,issue_date,accounting_date,due_date,external_reference,
      description,currency,rounding_adjustment,rounding_reason,rounding_account_id,version,created_by_member_id,party_snapshot,material_digest)
    VALUES(v_id,p_organization_id,v_type,v_year_id,v_party,v_issue,v_accounting,v_due,NULLIF(p_payload->>'external_reference',''),
      COALESCE(p_payload->>'description',''),v_currency,v_rounding,v_rounding_reason,v_rounding_account,1,v_actor,
      CASE WHEN v_party IS NULL THEN '{}'::jsonb ELSE (SELECT jsonb_build_object('display_name',c.display_name,'legal_name',c.legal_name,'email',c.email,
        'phone',c.phone,'billing_address',c.billing_address,'tax_identifiers',c.tax_identifiers) FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=v_party) END,
      p_request_hash);
    v_document.version:=1;
  ELSE
    SELECT * INTO v_document FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
    IF v_document.state IN ('posted','void') THEN RAISE EXCEPTION 'posted or void sources cannot be edited' USING ERRCODE='40001'; END IF;
    IF p_expected_version IS NULL OR v_document.version<>p_expected_version THEN RAISE EXCEPTION 'document version is stale' USING ERRCODE='40001'; END IF;
    IF v_document.document_type<>v_type THEN RAISE EXCEPTION 'document type cannot change' USING ERRCODE='23514'; END IF;
    UPDATE finance.approval_requests SET state='superseded' WHERE organization_id=p_organization_id AND document_id=v_id AND state IN ('pending','approved');
    UPDATE finance.business_documents d SET fiscal_year_id=v_year_id,party_id=v_party,issue_date=v_issue,accounting_date=v_accounting,due_date=v_due,
      external_reference=NULLIF(p_payload->>'external_reference',''),description=COALESCE(p_payload->>'description',''),currency=v_currency,
      rounding_adjustment=v_rounding,rounding_reason=v_rounding_reason,rounding_account_id=v_rounding_account,state='draft',version=d.version+1,
      updated_at=clock_timestamp(),material_digest=p_request_hash,
      party_snapshot=CASE WHEN v_party IS NULL THEN '{}'::jsonb ELSE (SELECT jsonb_build_object('display_name',c.display_name,'legal_name',c.legal_name,
        'email',c.email,'phone',c.phone,'billing_address',c.billing_address,'tax_identifiers',c.tax_identifiers) FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=v_party) END
      WHERE d.organization_id=p_organization_id AND d.id=v_id;
    DELETE FROM finance.trade_documents WHERE organization_id=p_organization_id AND document_id=v_id;
    DELETE FROM finance.money_movements WHERE organization_id=p_organization_id AND document_id=v_id;
    DELETE FROM finance.transfers WHERE organization_id=p_organization_id AND document_id=v_id;
    DELETE FROM finance.manual_journal_rows WHERE organization_id=p_organization_id AND document_id=v_id;
    DELETE FROM finance.document_allocation_plans WHERE organization_id=p_organization_id AND document_id=v_id;
    v_document.version:=v_document.version+1;
  END IF;
  IF v_type IN ('invoice','customer_credit','bill','vendor_credit','paid_expense') THEN
    UPDATE finance.document_lines SET line_no=line_no+1000 WHERE organization_id=p_organization_id AND document_id=v_id;
  ELSIF jsonb_array_length(p_payload->'lines')>0 THEN
    RAISE EXCEPTION 'this document type does not accept trade lines' USING ERRCODE='23514';
  END IF;
  IF v_type IN ('invoice','customer_credit','bill','vendor_credit','paid_expense') THEN
    INSERT INTO finance.trade_documents(organization_id,document_id,original_document_id,recognition_mode,performance_confirmed,
      supplier_invoice_date,supplier_invoice_key,terms,notes)
    VALUES(p_organization_id,v_id,v_original,COALESCE(p_payload->'trade'->>'recognition_mode','earned_or_incurred'),
      COALESCE((p_payload->'trade'->>'performance_confirmed')::boolean,false),NULLIF(p_payload->'trade'->>'supplier_invoice_date','')::date,
      NULLIF(p_payload->'trade'->>'supplier_invoice_key',''),p_payload->'trade'->>'terms',p_payload->'trade'->>'notes');
  END IF;
  FOR v_line,v_ord IN SELECT value,ordinality FROM jsonb_array_elements(p_payload->'lines') WITH ORDINALITY AS x(value,ordinality) LOOP
    v_line_count:=v_line_count+1; IF v_line_count>500 THEN RAISE EXCEPTION 'too many document lines' USING ERRCODE='22023'; END IF;
    IF v_line->>'description' IS NULL OR length(btrim(v_line->>'description')) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'line description required' USING ERRCODE='22023'; END IF;
    PERFORM finance_private.require_decimal_string(v_line->'quantity',6,false);
    PERFORM finance_private.require_decimal_string(v_line->'unit_price',6,false);
    PERFORM finance_private.require_decimal_string(COALESCE(v_line->'discount_amount','"0.00"'::jsonb),2,false);
    v_line_id:=NULLIF(v_line->>'id','')::uuid;
    IF v_line_id IS NOT NULL THEN
      UPDATE finance.document_lines SET line_no=v_ord,item_id=NULLIF(v_line->>'item_id','')::uuid,
        original_line_id=NULLIF(v_line->>'original_line_id','')::uuid,description=btrim(COALESCE(v_line->>'description','')),
        quantity=(v_line->>'quantity')::finance.quantity,unit_price=(v_line->>'unit_price')::finance.unit_price,
        discount_amount=COALESCE(NULLIF(v_line->>'discount_amount','')::finance.amount,0),account_id=(v_line->>'account_id')::uuid,
        cost_center_id=NULLIF(v_line->>'cost_center_id','')::uuid,tax_code_id=NULLIF(v_line->>'tax_code_id','')::uuid,
        tax_mode=COALESCE(v_line->>'tax_mode','exclusive'),cash_flow_class=NULLIF(v_line->>'cash_flow_class','')::finance.cash_flow_class
        WHERE organization_id=p_organization_id AND document_id=v_id AND id=v_line_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'line does not belong to this draft' USING ERRCODE='23514'; END IF;
    ELSE
      INSERT INTO finance.document_lines(organization_id,document_id,line_no,item_id,original_line_id,description,quantity,unit_price,discount_amount,
        account_id,cost_center_id,tax_code_id,tax_mode,net_amount,tax_amount,gross_amount,cash_flow_class)
      VALUES(p_organization_id,v_id,v_ord,NULLIF(v_line->>'item_id','')::uuid,NULLIF(v_line->>'original_line_id','')::uuid,
        btrim(COALESCE(v_line->>'description','')),(v_line->>'quantity')::finance.quantity,(v_line->>'unit_price')::finance.unit_price,
        COALESCE(NULLIF(v_line->>'discount_amount','')::finance.amount,0),(v_line->>'account_id')::uuid,
        NULLIF(v_line->>'cost_center_id','')::uuid,NULLIF(v_line->>'tax_code_id','')::uuid,COALESCE(v_line->>'tax_mode','exclusive'),
        0,0,0,NULLIF(v_line->>'cash_flow_class','')::finance.cash_flow_class) RETURNING id INTO v_line_id;
    END IF;
    v_keep_ids:=array_append(v_keep_ids,v_line_id);
  END LOOP;
  IF v_type IN ('invoice','customer_credit','bill','vendor_credit','paid_expense') AND v_line_count=0 THEN RAISE EXCEPTION 'trade source requires at least one line' USING ERRCODE='23514'; END IF;
  IF v_type IN ('customer_credit','vendor_credit') AND EXISTS(SELECT 1 FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.document_id=v_id
    AND (l.original_line_id IS NULL OR NOT EXISTS(SELECT 1 FROM finance.document_lines source_line WHERE source_line.organization_id=p_organization_id
      AND source_line.id=l.original_line_id AND source_line.document_id=v_original))) THEN
    RAISE EXCEPTION 'every credit line must reference a line on the selected original' USING ERRCODE='23514';
  END IF;
  IF v_type IN ('invoice','customer_credit','bill','vendor_credit','paid_expense') AND p_document_id IS NOT NULL THEN
    DELETE FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.document_id=v_id AND NOT (l.id=ANY(v_keep_ids));
  END IF;
  IF p_payload ? 'movement' AND jsonb_typeof(p_payload->'movement')='object' THEN
    IF v_type NOT IN ('receipt','vendor_payment','customer_refund','vendor_refund','customer_advance','vendor_advance','paid_expense') THEN
      RAISE EXCEPTION 'cash movement is not valid for this source type' USING ERRCODE='23514';
    END IF;
    v_row:=p_payload->'movement';
    IF length(COALESCE(v_row->>'reference',''))>160 THEN RAISE EXCEPTION 'movement reference is too long' USING ERRCODE='22023'; END IF;
    PERFORM finance_private.require_decimal_string(v_row->'amount',2,false);
    IF (v_type IN ('receipt','customer_advance','vendor_refund') AND COALESCE(v_row->>'direction','in')<>'in') OR
       (v_type IN ('vendor_payment','customer_refund','vendor_advance','paid_expense') AND COALESCE(v_row->>'direction','out')<>'out') THEN
      RAISE EXCEPTION 'cash direction does not match source type' USING ERRCODE='23514';
    END IF;
    INSERT INTO finance.money_movements(organization_id,document_id,cash_account_id,direction,amount,method,reference,cash_flow_class)
    VALUES(p_organization_id,v_id,(v_row->>'cash_account_id')::uuid,COALESCE(v_row->>'direction','out'),(v_row->>'amount')::finance.amount,
      COALESCE(v_row->>'method','other'),NULLIF(v_row->>'reference',''),COALESCE(v_row->>'cash_flow_class','unclassified')::finance.cash_flow_class);
  END IF;
  IF v_type IN ('receipt','vendor_payment','customer_refund','vendor_refund','customer_advance','vendor_advance','paid_expense') AND
     NOT EXISTS(SELECT 1 FROM finance.money_movements m WHERE m.organization_id=p_organization_id AND m.document_id=v_id) THEN
    RAISE EXCEPTION 'this source type requires a cash movement' USING ERRCODE='23514';
  END IF;
  IF jsonb_array_length(COALESCE(p_payload->'allocation_plan','[]'::jsonb))>0 THEN
    IF v_type NOT IN ('receipt','vendor_payment','vendor_refund') OR v_party IS NULL OR
       jsonb_array_length(p_payload->'allocation_plan')>100 THEN
      RAISE EXCEPTION 'settlement plans are not supported for this document' USING ERRCODE='23514';
    END IF;
    PERFORM finance_private.require_capability(p_organization_id,'dues.read');
    v_plan_control:=CASE WHEN v_type='receipt' THEN 'ar' ELSE 'ap' END;
    v_plan_side:=CASE WHEN v_type='receipt' THEN 'debit' WHEN v_type='vendor_refund' THEN 'debit' ELSE 'credit' END;
    FOR v_plan IN SELECT value FROM jsonb_array_elements(p_payload->'allocation_plan') LOOP
      IF jsonb_typeof(v_plan) IS DISTINCT FROM 'object' OR jsonb_object_length(v_plan)<>2 OR
         NOT (v_plan ? 'target_open_item_id' AND v_plan ? 'amount') THEN
        RAISE EXCEPTION 'invalid allocation plan row' USING ERRCODE='22023';
      END IF;
      PERFORM finance_private.require_decimal_string(v_plan->'amount',2,false);
      v_plan_amount:=(v_plan->>'amount')::finance.amount;
      IF v_plan_amount<=0 THEN RAISE EXCEPTION 'allocation amount must be positive' USING ERRCODE='23514'; END IF;
      SELECT * INTO v_target FROM finance.open_items oi WHERE oi.organization_id=p_organization_id
        AND oi.id=(v_plan->>'target_open_item_id')::uuid AND oi.party_id=v_party
        AND oi.control_kind=v_plan_control AND oi.side=v_plan_side AND oi.issue_date<=v_accounting
        AND (v_type<>'vendor_refund' OR EXISTS(SELECT 1 FROM finance.journal_lines sl JOIN finance.journal_entries sj ON sj.organization_id=sl.organization_id AND sj.id=sl.journal_entry_id
          JOIN finance.business_documents sd ON sd.organization_id=sj.organization_id AND sd.id=sj.source_document_id
          WHERE sl.organization_id=oi.organization_id AND sl.id=oi.journal_line_id AND sj.state='posted' AND sd.document_type='vendor_credit' AND sd.party_id=v_party)) FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'allocation target is incompatible or unavailable' USING ERRCODE='23514'; END IF;
      IF v_plan_amount>v_target.original_amount-COALESCE((
        SELECT sum(a.amount) FROM finance.settlement_allocations a LEFT JOIN finance.allocation_reversals r
          ON r.organization_id=a.organization_id AND r.allocation_id=a.id AND r.effective_date<=v_accounting
        WHERE a.organization_id=p_organization_id AND a.effective_date<=v_accounting AND r.id IS NULL
          AND (a.debit_open_item_id=v_target.id OR a.credit_open_item_id=v_target.id)),0) THEN
        RAISE EXCEPTION 'allocation exceeds historical open-item capacity' USING ERRCODE='23514';
      END IF;
      INSERT INTO finance.document_allocation_plans(organization_id,document_id,target_open_item_id,amount)
        VALUES(p_organization_id,v_id,v_target.id,v_plan_amount);
      v_plan_total:=v_plan_total+v_plan_amount;
    END LOOP;
    SELECT m.amount INTO v_movement_amount FROM finance.money_movements m
      WHERE m.organization_id=p_organization_id AND m.document_id=v_id;
    IF v_movement_amount IS NULL OR v_plan_total>v_movement_amount OR (v_type='vendor_refund' AND v_plan_total<>v_movement_amount) THEN
      RAISE EXCEPTION 'supplier refund settlement must equal the cash received and fit the draft movement' USING ERRCODE='23514';
    END IF;
  END IF;
  IF v_type='vendor_refund' AND NOT EXISTS(SELECT 1 FROM finance.document_allocation_plans p WHERE p.organization_id=p_organization_id AND p.document_id=v_id) THEN
    RAISE EXCEPTION 'supplier refunds require an eligible posted vendor credit' USING ERRCODE='23514';
  END IF;
  IF p_payload ? 'transfer' AND jsonb_typeof(p_payload->'transfer')='object' THEN
    v_row:=p_payload->'transfer';
    PERFORM finance_private.require_decimal_string(v_row->'amount',2,false);
    PERFORM finance_private.require_decimal_string(COALESCE(v_row->'fee_amount','"0.00"'::jsonb),2,false);
    INSERT INTO finance.transfers(organization_id,document_id,from_cash_account_id,to_cash_account_id,amount,fee_amount,fee_account_id)
    VALUES(p_organization_id,v_id,(v_row->>'from_cash_account_id')::uuid,(v_row->>'to_cash_account_id')::uuid,(v_row->>'amount')::finance.amount,
      COALESCE(NULLIF(v_row->>'fee_amount','')::finance.amount,0),(NULLIF(v_row->>'fee_account_id',''))::uuid);
  END IF;
  IF v_type='transfer' AND NOT EXISTS(SELECT 1 FROM finance.transfers t WHERE t.organization_id=p_organization_id AND t.document_id=v_id) THEN
    RAISE EXCEPTION 'transfer details required' USING ERRCODE='23514';
  END IF;
  IF v_type<>'transfer' AND p_payload ? 'transfer' AND jsonb_typeof(p_payload->'transfer')='object' THEN RAISE EXCEPTION 'transfer details are not valid for this source type' USING ERRCODE='23514'; END IF;
  IF jsonb_typeof(p_payload->'journal_rows') IS DISTINCT FROM 'array' AND v_type IN ('manual_journal','controlled_adjustment','opening_balance') THEN
    RAISE EXCEPTION 'journal row array required' USING ERRCODE='22023';
  END IF;
  IF v_type NOT IN ('manual_journal','controlled_adjustment','opening_balance') AND jsonb_typeof(p_payload->'journal_rows')='array'
     AND jsonb_array_length(p_payload->'journal_rows')>0 THEN RAISE EXCEPTION 'journal rows are only valid for journal sources' USING ERRCODE='23514'; END IF;
  IF jsonb_typeof(p_payload->'journal_rows')='array' THEN
    FOR v_line,v_ord IN SELECT value,ordinality FROM jsonb_array_elements(p_payload->'journal_rows') WITH ORDINALITY AS x(value,ordinality) LOOP
      v_journal_count:=v_journal_count+1; IF v_journal_count>1000 THEN RAISE EXCEPTION 'too many source rows' USING ERRCODE='22023'; END IF;
      PERFORM finance_private.require_decimal_string(COALESCE(v_line->'debit','"0.00"'::jsonb),2,false);
      PERFORM finance_private.require_decimal_string(COALESCE(v_line->'credit','"0.00"'::jsonb),2,false);
      INSERT INTO finance.manual_journal_rows(organization_id,document_id,line_no,account_id,party_id,cost_center_id,debit,credit,description,
        cash_flow_class,open_item_reference,open_item_due_date)
      VALUES(p_organization_id,v_id,v_ord,(v_line->>'account_id')::uuid,(NULLIF(v_line->>'party_id',''))::uuid,
        (NULLIF(v_line->>'cost_center_id',''))::uuid,COALESCE(NULLIF(v_line->>'debit','')::finance.amount,0),
        COALESCE(NULLIF(v_line->>'credit','')::finance.amount,0),btrim(COALESCE(v_line->>'description','')),
        (NULLIF(v_line->>'cash_flow_class',''))::finance.cash_flow_class,NULLIF(v_line->>'open_item_reference',''),
        NULLIF(v_line->>'open_item_due_date','')::date);
      IF length(btrim(COALESCE(v_line->>'description','')))=0 OR length(v_line->>'description')>500 THEN
        RAISE EXCEPTION 'journal row description required' USING ERRCODE='22023';
      END IF;
    END LOOP;
  END IF;
  SELECT COALESCE(sum(r.debit),0)::finance.amount,COALESCE(sum(r.credit),0)::finance.amount INTO v_debits,v_credits
    FROM finance.manual_journal_rows r WHERE r.organization_id=p_organization_id AND r.document_id=v_id;
  IF NOT EXISTS(SELECT 1 FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.document_id=v_id) THEN
    SELECT COALESCE(sum(m.amount),0)::finance.amount INTO v_movement_amount FROM finance.money_movements m WHERE m.organization_id=p_organization_id AND m.document_id=v_id;
    IF v_movement_amount=0 THEN SELECT COALESCE(sum(t.amount+t.fee_amount),0)::finance.amount INTO v_movement_amount FROM finance.transfers t WHERE t.organization_id=p_organization_id AND t.document_id=v_id; END IF;
    IF v_movement_amount=0 THEN v_movement_amount:=GREATEST(v_debits,v_credits); END IF;
    UPDATE finance.business_documents d SET net_amount=v_movement_amount,tax_amount=0,total_amount=v_movement_amount+d.rounding_adjustment
      WHERE d.organization_id=p_organization_id AND d.id=v_id;
  END IF;
  SELECT jsonb_build_object('document_id',d.id,'document_version',d.version,'state',d.state,'net_amount',d.net_amount::text,
    'tax_amount',d.tax_amount::text,'total_amount',d.total_amount::text,'material_digest',d.material_digest) INTO v_result
    FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=v_id;
  INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body,resource_document_id)
    VALUES(p_organization_id,'documents.save',p_idempotency_key,p_request_hash,v_actor,200,v_result,v_id);
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,CASE WHEN v_created THEN 'document.draft.create' ELSE 'document.draft.update' END,
    'business_document',v_id,p_request_id,jsonb_build_object('document_type',v_type,'version',v_document.version,'digest',p_request_hash));
  RETURN QUERY SELECT v_id,(v_result->>'document_version')::integer,v_result->>'state',(v_result->>'net_amount')::finance.amount,
    (v_result->>'tax_amount')::finance.amount,(v_result->>'total_amount')::finance.amount,v_result->>'material_digest';
END $$;;

CREATE OR REPLACE FUNCTION public.save_document_allocation_plan(
  p_organization_id uuid,p_document_id uuid,p_expected_version integer,p_request_id text,
  p_idempotency_key text,p_request_hash text,p_allocation_plan jsonb
) RETURNS TABLE(document_id uuid,document_version integer,state text,net_amount finance.amount,tax_amount finance.amount,
  total_amount finance.amount,material_digest text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_type finance.document_type; v_state finance.document_state; v_party uuid; v_date date; v_period_id uuid;
  v_year_id uuid; v_status text; v_plan jsonb; v_target finance.open_items%ROWTYPE; v_side text; v_control text;
  v_amount finance.amount; v_total finance.amount:=0; v_payment finance.amount; v_hash text; v_existing_actor uuid;
  v_existing_document uuid; v_receipt jsonb; v_result jsonb; v_doc finance.business_documents%ROWTYPE;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_expected_version IS NULL OR p_expected_version<1 OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{22,172}$'
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' OR jsonb_typeof(p_allocation_plan) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_allocation_plan)>100 THEN RAISE EXCEPTION 'invalid allocation-plan request' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text||':documents.allocation-plan:'||p_idempotency_key,0));
  SELECT o.status INTO v_status FROM finance.organizations o WHERE o.id=p_organization_id FOR SHARE;
  IF NOT FOUND OR v_status<>'active' THEN RAISE EXCEPTION 'company is not writable' USING ERRCODE='42501'; END IF;
  SELECT d.document_type,d.state,d.party_id,d.accounting_date,d.fiscal_year_id INTO v_type,v_state,v_party,v_date,v_year_id
    FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
  IF v_type NOT IN ('receipt','vendor_payment','vendor_refund') OR v_party IS NULL THEN
    RAISE EXCEPTION 'settlement plans require an editable receipt, supplier payment, or supplier refund' USING ERRCODE='23514';
  END IF;
  v_actor:=finance_private.require_capability(p_organization_id,CASE WHEN v_type='receipt' THEN 'sales.write' ELSE 'purchases.write' END);
  PERFORM finance_private.require_capability(p_organization_id,'dues.read');
  SELECT i.request_hash,i.actor_member_id,i.response_body,i.resource_document_id INTO v_hash,v_existing_actor,v_receipt,v_existing_document FROM finance.idempotency_requests i
    WHERE i.organization_id=p_organization_id AND i.operation='documents.allocation-plan' AND i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_hash<>p_request_hash OR v_existing_actor<>v_actor OR v_existing_document<>p_document_id THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505'; END IF;
    RETURN QUERY SELECT (v_receipt->>'document_id')::uuid,(v_receipt->>'document_version')::integer,v_receipt->>'state',
      (v_receipt->>'net_amount')::finance.amount,(v_receipt->>'tax_amount')::finance.amount,
      (v_receipt->>'total_amount')::finance.amount,v_receipt->>'material_digest'; RETURN;
  END IF;
  IF v_state IN ('posted','void') THEN RAISE EXCEPTION 'posted and void documents are immutable' USING ERRCODE='23514'; END IF;
  SELECT fy.status INTO v_status FROM finance.fiscal_years fy WHERE fy.organization_id=p_organization_id AND fy.id=v_year_id FOR UPDATE;
  IF NOT FOUND OR v_status<>'open' THEN RAISE EXCEPTION 'fiscal year is locked' USING ERRCODE='23514'; END IF;
  SELECT p.id INTO v_period_id FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.fiscal_year_id=v_year_id
    AND p.kind='regular' AND p.starts_on<=v_date AND p.ends_on>=v_date FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.id=v_period_id AND p.status='open') THEN
    RAISE EXCEPTION 'accounting period is locked or unavailable' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id FOR UPDATE;
  IF v_doc.version<>p_expected_version THEN RAISE EXCEPTION 'document version is stale' USING ERRCODE='40001'; END IF;
  IF v_doc.state IN ('posted','void') OR v_doc.accounting_date<>v_date OR v_doc.document_type<>v_type THEN
    RAISE EXCEPTION 'document changed while saving allocation plan' USING ERRCODE='40001';
  END IF;
  v_control:=CASE WHEN v_type='receipt' THEN 'ar' ELSE 'ap' END;
  v_side:=CASE WHEN v_type IN ('receipt','vendor_refund') THEN 'debit' ELSE 'credit' END;
  SELECT m.amount INTO v_payment FROM finance.money_movements m WHERE m.organization_id=p_organization_id
    AND m.document_id=p_document_id AND m.direction=CASE WHEN v_type='receipt' THEN 'in' ELSE 'out' END;
  IF NOT FOUND THEN RAISE EXCEPTION 'cash movement is required before settlement planning' USING ERRCODE='23514'; END IF;
  UPDATE finance.approval_requests SET state='superseded' WHERE organization_id=p_organization_id AND document_id=p_document_id AND state IN ('pending','approved');
  UPDATE finance.business_documents d SET state='draft',version=d.version+1,material_digest=p_request_hash,updated_at=clock_timestamp()
    WHERE d.organization_id=p_organization_id AND d.id=p_document_id RETURNING * INTO v_doc;
  DELETE FROM finance.document_allocation_plans WHERE organization_id=p_organization_id AND document_id=p_document_id;
  FOR v_plan IN SELECT value FROM jsonb_array_elements(p_allocation_plan) LOOP
    IF jsonb_typeof(v_plan) IS DISTINCT FROM 'object' OR jsonb_object_length(v_plan)<>2 OR
       NOT (v_plan ? 'target_open_item_id' AND v_plan ? 'amount') THEN RAISE EXCEPTION 'invalid allocation-plan row' USING ERRCODE='22023'; END IF;
    PERFORM finance_private.require_decimal_string(v_plan->'amount',2,false);
    v_amount:=(v_plan->>'amount')::finance.amount;
    IF v_amount<=0 THEN RAISE EXCEPTION 'allocation amount must be positive' USING ERRCODE='23514'; END IF;
    SELECT * INTO v_target FROM finance.open_items oi WHERE oi.organization_id=p_organization_id
      AND oi.id=(v_plan->>'target_open_item_id')::uuid AND oi.party_id=v_party AND oi.control_kind=v_control
      AND oi.side=v_side AND oi.issue_date<=v_date AND (v_type<>'vendor_refund' OR EXISTS(SELECT 1 FROM finance.journal_lines sl
        JOIN finance.journal_entries sj ON sj.organization_id=sl.organization_id AND sj.id=sl.journal_entry_id
        JOIN finance.business_documents sd ON sd.organization_id=sj.organization_id AND sd.id=sj.source_document_id
        WHERE sl.organization_id=oi.organization_id AND sl.id=oi.journal_line_id AND sj.state='posted' AND sd.document_type='vendor_credit' AND sd.party_id=v_party));
    IF NOT FOUND THEN RAISE EXCEPTION 'allocation target is incompatible or unavailable' USING ERRCODE='23514'; END IF;
    IF v_amount>v_target.original_amount-COALESCE((
      SELECT sum(a.amount) FROM finance.settlement_allocations a LEFT JOIN finance.allocation_reversals r
        ON r.organization_id=a.organization_id AND r.allocation_id=a.id AND r.effective_date<=v_date
      WHERE a.organization_id=p_organization_id AND a.effective_date<=v_date AND r.id IS NULL
        AND (a.debit_open_item_id=v_target.id OR a.credit_open_item_id=v_target.id)),0) THEN
      RAISE EXCEPTION 'allocation exceeds historical open-item capacity' USING ERRCODE='23514';
    END IF;
    INSERT INTO finance.document_allocation_plans(organization_id,document_id,target_open_item_id,amount)
      VALUES(p_organization_id,p_document_id,v_target.id,v_amount);
    v_total:=v_total+v_amount;
  END LOOP;
  IF v_total>v_payment OR (v_type='vendor_refund' AND v_total<>v_payment) THEN RAISE EXCEPTION 'supplier refund settlement must equal the cash received' USING ERRCODE='23514'; END IF;
  IF v_type='vendor_refund' AND jsonb_array_length(p_allocation_plan)=0 THEN RAISE EXCEPTION 'supplier refunds require eligible vendor-credit settlement' USING ERRCODE='23514'; END IF;
  SELECT jsonb_build_object('document_id',v_doc.id,'document_version',v_doc.version,'state',v_doc.state,'net_amount',v_doc.net_amount::text,
    'tax_amount',v_doc.tax_amount::text,'total_amount',v_doc.total_amount::text,'material_digest',v_doc.material_digest) INTO v_result;
  INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body,resource_document_id)
    VALUES(p_organization_id,'documents.allocation-plan',p_idempotency_key,p_request_hash,v_actor,200,v_result,p_document_id);
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'document.allocation-plan.update','business_document',p_document_id,p_request_id,
    jsonb_build_object('version',v_doc.version,'target_count',jsonb_array_length(p_allocation_plan),'amount',v_total::text,'digest',p_request_hash));
  RETURN QUERY SELECT p_document_id,v_doc.version,v_doc.state::text,v_doc.net_amount,v_doc.tax_amount,v_doc.total_amount,v_doc.material_digest;
END $$;;

CREATE OR REPLACE FUNCTION public.post_financial_document(p_organization_id uuid,p_document_id uuid,p_expected_version integer,
  p_request_id text,p_idempotency_key text,p_request_hash text)
RETURNS TABLE(document_id uuid,document_number text,document_version integer,journal_entry_id uuid,state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_doc finance.business_documents%ROWTYPE; v_type finance.document_type; v_permission text; v_period_id uuid;
  v_year_id uuid; v_journal_id uuid; v_number text; v_hash text; v_existing_actor uuid; v_receipt jsonb; v_account_id uuid;
  v_ar uuid; v_ap uuid; v_customer_advance uuid; v_vendor_advance uuid; v_output_tax uuid; v_input_tax uuid; v_rounding uuid;
  v_cash_account uuid; v_total_debit finance.amount:=0; v_total_credit finance.amount:=0; v_base finance.amount:=0; v_line_no integer:=0;
  v_line record; v_movement finance.money_movements%ROWTYPE; v_transfer finance.transfers%ROWTYPE; v_trade finance.trade_documents%ROWTYPE;
  v_original finance.business_documents%ROWTYPE; v_original_trade finance.trade_documents%ROWTYPE; v_original_line finance.document_lines%ROWTYPE;
  v_request finance.approval_requests%ROWTYPE; v_policy finance.approval_policies%ROWTYPE;
  v_open_item_id uuid; v_target finance.open_items%ROWTYPE; v_plan record; v_period finance.accounting_periods%ROWTYPE;
  v_prior_qty finance.quantity;v_prior_gross finance.amount;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_document_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1 OR p_idempotency_key IS NULL OR
     length(p_idempotency_key) NOT BETWEEN 1 AND 200 OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid posting request' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':documents.post:'||p_document_id::text||':'||p_idempotency_key,0));
  IF NOT finance_private.can_read_document(p_organization_id,p_document_id) THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
  SELECT d.document_type INTO v_type FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
  v_permission:=CASE WHEN v_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance') THEN 'sales.post'
    WHEN v_type IN ('bill','vendor_credit','paid_expense','vendor_payment','vendor_refund','vendor_advance') THEN 'purchases.post'
    WHEN v_type='transfer' THEN 'banking.write' ELSE 'journal.post' END;
  v_actor:=finance_private.require_capability(p_organization_id,v_permission);
  IF v_type='vendor_refund' THEN PERFORM finance_private.require_capability(p_organization_id,'banking.write');END IF;
  SELECT i.request_hash,i.actor_member_id,i.response_body INTO v_hash,v_existing_actor,v_receipt FROM finance.idempotency_requests i
    WHERE i.organization_id=p_organization_id AND i.operation='documents.post:'||p_document_id::text AND i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_hash<>p_request_hash OR v_existing_actor<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505'; END IF;
    RETURN QUERY SELECT (v_receipt->>'document_id')::uuid,v_receipt->>'document_number',(v_receipt->>'document_version')::integer,
      (v_receipt->>'journal_entry_id')::uuid,v_receipt->>'state'; RETURN;
  END IF;
  -- Resolve the date without locking the source, then lock organization/year/period before the document.
  SELECT d.accounting_date,d.fiscal_year_id INTO v_doc.accounting_date,v_year_id FROM finance.business_documents d
    WHERE d.organization_id=p_organization_id AND d.id=p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
  v_period_id:=finance_private.lock_accounting_date(p_organization_id,v_doc.accounting_date,v_type='opening_balance');
  SELECT * INTO v_period FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.id=v_period_id;
  SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
  IF v_doc.document_type<>v_type OR v_doc.version<>p_expected_version THEN RAISE EXCEPTION 'source version is stale' USING ERRCODE='40001'; END IF;
  IF (v_period.kind='regular' AND v_doc.fiscal_year_id IS DISTINCT FROM v_period.fiscal_year_id) OR
     (v_period.kind='opening' AND v_type<>'opening_balance') THEN RAISE EXCEPTION 'source fiscal year does not match its accounting period' USING ERRCODE='23514'; END IF;
  IF v_doc.state='posted' THEN RAISE EXCEPTION 'source is already posted' USING ERRCODE='23505'; END IF;
  IF v_doc.state<>'approved' OR v_doc.currency<>'BDT' THEN RAISE EXCEPTION 'source must be approved in BDT before posting' USING ERRCODE='P0001'; END IF;
  IF v_doc.total_amount<=0 THEN RAISE EXCEPTION 'zero-value financial sources cannot post' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_request FROM finance.approval_requests r WHERE r.organization_id=p_organization_id AND r.document_id=p_document_id
    AND r.document_version=v_doc.version ORDER BY r.created_at DESC,r.id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_request.state<>'approved' OR v_request.document_digest<>v_doc.material_digest THEN
    RAISE EXCEPTION 'approved source version or digest is stale' USING ERRCODE='40001';
  END IF;
  IF v_request.policy_snapshot->>'approval_required' NOT IN ('true','false') THEN RAISE EXCEPTION 'approval policy snapshot is incomplete' USING ERRCODE='40001'; END IF;
  IF v_request.policy_snapshot->>'approval_required'='true' THEN
    SELECT * INTO v_policy FROM finance.approval_policies p WHERE p.organization_id=p_organization_id
      AND p.id=(v_request.policy_snapshot->>'policy_id')::uuid FOR SHARE;
    IF NOT FOUND OR NOT v_policy.is_active OR v_policy.version_no<>(v_request.policy_snapshot->>'policy_version')::integer OR
       v_policy.document_type<>v_type OR v_policy.threshold_amount::text<>v_request.policy_snapshot->>'threshold_amount' OR
       v_policy.approver_role_id<>(v_request.policy_snapshot->>'approver_role_id')::uuid OR
       v_policy.required_approvals<>(v_request.policy_snapshot->>'required_approvals')::integer OR
       v_policy.allow_self_approval<>(v_request.policy_snapshot->>'allow_self_approval')::boolean OR
       NOT EXISTS(SELECT 1 FROM finance.role_permissions rp JOIN finance.permissions pe ON pe.id=rp.permission_id
         WHERE rp.organization_id=p_organization_id AND rp.role_id=v_policy.approver_role_id AND pe.code='approvals.decide') THEN
      RAISE EXCEPTION 'approval policy snapshot is stale or incomplete' USING ERRCODE='40001';
    END IF;
    PERFORM m.id FROM finance.approval_decisions ad JOIN finance.organization_members m
      ON m.organization_id=ad.organization_id AND m.id=ad.decided_by_member_id
      JOIN finance.member_roles mr ON mr.organization_id=m.organization_id AND mr.member_id=m.id AND mr.role_id=v_policy.approver_role_id
      JOIN finance.role_permissions rp ON rp.organization_id=mr.organization_id AND rp.role_id=mr.role_id
      JOIN finance.permissions pe ON pe.id=rp.permission_id AND pe.code='approvals.decide'
      WHERE ad.organization_id=p_organization_id AND ad.request_id=v_request.id AND ad.decision='approve' AND m.status='active'
      ORDER BY m.id FOR KEY SHARE OF m,mr,rp;
    IF (SELECT count(DISTINCT ad.decided_by_member_id) FROM finance.approval_decisions ad
        JOIN finance.organization_members m ON m.organization_id=ad.organization_id AND m.id=ad.decided_by_member_id AND m.status='active'
        JOIN finance.member_roles mr ON mr.organization_id=m.organization_id AND mr.member_id=m.id AND mr.role_id=v_policy.approver_role_id
        JOIN finance.role_permissions rp ON rp.organization_id=mr.organization_id AND rp.role_id=mr.role_id
        JOIN finance.permissions pe ON pe.id=rp.permission_id AND pe.code='approvals.decide'
        WHERE ad.organization_id=p_organization_id AND ad.request_id=v_request.id AND ad.decision='approve')<v_policy.required_approvals THEN
      RAISE EXCEPTION 'current eligible approvals no longer meet the policy requirement' USING ERRCODE='40001';
    END IF;
    IF EXISTS(SELECT 1 FROM finance.approval_decisions ad WHERE ad.organization_id=p_organization_id AND ad.request_id=v_request.id
        AND ad.decision='approve' AND ad.decided_by_member_id=v_request.requested_by_member_id) AND
       (NOT v_policy.allow_self_approval OR (SELECT count(*) FROM finance.organization_members m WHERE m.organization_id=p_organization_id AND m.status='active')<>1 OR
        NOT finance_private.is_active_owner(p_organization_id,v_request.requested_by_member_id)) THEN
      RAISE EXCEPTION 'sole-operator approval exception is no longer valid' USING ERRCODE='40001';
    END IF;
  END IF;
  SELECT m.account_id INTO v_ar FROM finance.account_mappings m JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id
    WHERE m.organization_id=p_organization_id AND m.mapping_key='ar' AND a.is_active AND a.is_postable AND a.control_kind='ar';
  SELECT m.account_id INTO v_ap FROM finance.account_mappings m JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id
    WHERE m.organization_id=p_organization_id AND m.mapping_key='ap' AND a.is_active AND a.is_postable AND a.control_kind='ap';
  SELECT m.account_id INTO v_customer_advance FROM finance.account_mappings m JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id
    WHERE m.organization_id=p_organization_id AND m.mapping_key='customer_advance' AND a.is_active AND a.is_postable AND a.control_kind='customer_advance';
  SELECT m.account_id INTO v_vendor_advance FROM finance.account_mappings m JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id
    WHERE m.organization_id=p_organization_id AND m.mapping_key='vendor_advance' AND a.is_active AND a.is_postable AND a.control_kind='vendor_advance';
  SELECT m.account_id INTO v_output_tax FROM finance.account_mappings m JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id
    WHERE m.organization_id=p_organization_id AND m.mapping_key='output_tax' AND a.is_active AND a.is_postable;
  SELECT m.account_id INTO v_input_tax FROM finance.account_mappings m JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id
    WHERE m.organization_id=p_organization_id AND m.mapping_key='input_tax' AND a.is_active AND a.is_postable;
  SELECT m.account_id INTO v_rounding FROM finance.account_mappings m JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id
    WHERE m.organization_id=p_organization_id AND m.mapping_key='rounding_difference' AND a.is_active AND a.is_postable;
  IF v_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance') AND v_ar IS NULL THEN RAISE EXCEPTION 'AR mapping is required' USING ERRCODE='23514'; END IF;
  IF v_type IN ('bill','vendor_credit','vendor_payment','vendor_refund') AND v_ap IS NULL THEN RAISE EXCEPTION 'AP mapping is required' USING ERRCODE='23514'; END IF;
  -- Lock all planned source balances before the document sequence row, following the shared lock order.
  IF EXISTS(SELECT 1 FROM finance.document_allocation_plans p WHERE p.organization_id=p_organization_id AND p.document_id=p_document_id) THEN
    PERFORM finance_private.require_capability(p_organization_id,'dues.allocate');
  END IF;
  PERFORM oi.id FROM finance.open_items oi JOIN finance.document_allocation_plans p
    ON p.organization_id=oi.organization_id AND p.target_open_item_id=oi.id
    WHERE p.organization_id=p_organization_id AND p.document_id=p_document_id ORDER BY oi.id FOR UPDATE OF oi;
  v_number:=finance_private.allocate_document_number(p_organization_id,p_document_id);
  INSERT INTO finance.journal_entries(organization_id,source_document_id,period_id,accounting_date,state,is_opening,posted_by_member_id)
    VALUES(p_organization_id,p_document_id,v_period_id,v_doc.accounting_date,'building',v_type='opening_balance',v_actor) RETURNING id INTO v_journal_id;
  IF v_type IN ('invoice','customer_credit','bill','vendor_credit','paid_expense') THEN
    SELECT * INTO v_trade FROM finance.trade_documents td WHERE td.organization_id=p_organization_id AND td.document_id=p_document_id;
    IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id) THEN
      RAISE EXCEPTION 'trade source requires typed details and lines' USING ERRCODE='23514'; END IF;
    IF v_type='invoice' THEN
      v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_ar,v_doc.party_id,NULL,v_doc.total_amount,0,v_doc.description,NULL,v_number,v_doc.due_date);
      IF v_trade.recognition_mode='deferred_revenue' THEN
        SELECT a.id INTO v_account_id FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.code='2250' AND a.is_active AND a.is_postable;
        IF v_account_id IS NULL THEN RAISE EXCEPTION 'deferred revenue account is unavailable' USING ERRCODE='23514'; END IF;
        v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_account_id,NULL,NULL,0,v_doc.net_amount,v_doc.description,NULL);
        IF v_doc.tax_amount>0 THEN
          IF v_output_tax IS NULL THEN RAISE EXCEPTION 'output tax mapping is required' USING ERRCODE='23514'; END IF;
          v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_output_tax,NULL,NULL,0,v_doc.tax_amount,'Output tax',NULL);
        END IF;
      ELSE
        IF NOT v_trade.performance_confirmed THEN RAISE EXCEPTION 'earned invoice requires service performance confirmation' USING ERRCODE='23514'; END IF;
        FOR v_line IN SELECT l.* FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id ORDER BY l.line_no LOOP
          IF NOT EXISTS(SELECT 1 FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=v_line.account_id
            AND a.account_type='income' AND a.control_kind IS NULL AND a.is_active AND a.is_postable) THEN
            RAISE EXCEPTION 'invoice lines require active income accounts' USING ERRCODE='23514'; END IF;
          v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_line.account_id,NULL,v_line.cost_center_id,0,v_line.net_amount,v_line.description,v_line.cash_flow_class);
          IF v_line.tax_amount>0 THEN
            v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,COALESCE(v_line.tax_account_id,v_output_tax),NULL,NULL,0,v_line.tax_amount,'Output tax · '||v_line.description,NULL);
          END IF;
        END LOOP;
      END IF;
      SELECT COALESCE(sum(l.gross_amount),0)::finance.amount INTO v_base FROM finance.document_lines l
        WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id;
      IF v_doc.total_amount<>v_base THEN
        IF v_rounding IS NULL OR abs(v_doc.total_amount-v_base)>0.05 OR v_doc.rounding_adjustment<>v_doc.total_amount-v_base THEN
          RAISE EXCEPTION 'invoice rounding does not agree with its explicit source adjustment' USING ERRCODE='23514';
        END IF;
        v_line_no:=v_line_no+1;
        IF v_doc.total_amount>v_base THEN PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,0,v_doc.total_amount-v_base,'Explicit rounding adjustment',NULL);
        ELSE PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,v_base-v_doc.total_amount,0,'Explicit rounding adjustment',NULL); END IF;
      END IF;
    ELSIF v_type='bill' OR v_type='paid_expense' THEN
      FOR v_line IN SELECT l.* FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id ORDER BY l.line_no LOOP
        IF NOT EXISTS(SELECT 1 FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=v_line.account_id
          AND a.account_type IN ('expense','asset') AND a.control_kind IS NULL AND a.is_active AND a.is_postable) THEN
          RAISE EXCEPTION 'bill and expense lines require active expense or asset accounts' USING ERRCODE='23514'; END IF;
        v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_line.account_id,NULL,v_line.cost_center_id,
          CASE WHEN v_line.tax_recoverability_snapshot='full' THEN v_line.net_amount ELSE v_line.gross_amount END,0,v_line.description,v_line.cash_flow_class);
        IF v_line.tax_amount>0 AND v_line.tax_recoverability_snapshot='full' THEN
          v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,COALESCE(v_line.tax_account_id,v_input_tax),NULL,NULL,v_line.tax_amount,0,'Recoverable input tax · '||v_line.description,NULL);
        END IF;
      END LOOP;
      SELECT COALESCE(sum(l.gross_amount),0)::finance.amount INTO v_base FROM finance.document_lines l
        WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id;
      IF v_doc.total_amount<>v_base THEN
        IF v_rounding IS NULL OR abs(v_doc.total_amount-v_base)>0.05 OR v_doc.rounding_adjustment<>v_doc.total_amount-v_base THEN
          RAISE EXCEPTION 'expense rounding does not agree with its explicit source adjustment' USING ERRCODE='23514';
        END IF;
        v_line_no:=v_line_no+1;
        IF v_type='bill' THEN
          IF v_doc.total_amount>v_base THEN PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,v_doc.total_amount-v_base,0,'Explicit rounding adjustment',NULL);
          ELSE PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,0,v_base-v_doc.total_amount,'Explicit rounding adjustment',NULL); END IF;
        ELSE
          IF v_doc.total_amount>v_base THEN PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,v_doc.total_amount-v_base,0,'Explicit rounding adjustment',NULL);
          ELSE PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,0,v_base-v_doc.total_amount,'Explicit rounding adjustment',NULL); END IF;
        END IF;
      END IF;
      IF v_type='bill' THEN
        v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_ap,v_doc.party_id,NULL,0,v_doc.total_amount,v_doc.description,NULL,v_number,v_doc.due_date);
      ELSE
        SELECT mm.amount,ca.account_id INTO v_movement.amount,v_cash_account FROM finance.money_movements mm JOIN finance.cash_accounts ca
          ON ca.organization_id=mm.organization_id AND ca.id=mm.cash_account_id AND ca.is_active WHERE mm.organization_id=p_organization_id AND mm.document_id=p_document_id;
        IF v_cash_account IS NULL OR v_movement.amount<>v_doc.total_amount THEN RAISE EXCEPTION 'cash movement must agree with the paid expense total' USING ERRCODE='23514'; END IF;
        v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_cash_account,NULL,NULL,0,v_doc.total_amount,v_doc.description,'operating');
      END IF;
    ELSIF v_type IN ('customer_credit','vendor_credit') THEN
      IF v_trade.original_document_id IS NULL THEN RAISE EXCEPTION 'credit must reference its posted source document' USING ERRCODE='23514'; END IF;
      SELECT * INTO v_original FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=v_trade.original_document_id FOR UPDATE;
      IF NOT FOUND OR v_original.state<>'posted' OR v_original.party_id IS DISTINCT FROM v_doc.party_id OR
         (v_type='customer_credit' AND v_original.document_type<>'invoice') OR (v_type='vendor_credit' AND v_original.document_type<>'bill') THEN
        RAISE EXCEPTION 'credit source is not eligible for this party and document type' USING ERRCODE='23514';
      END IF;
      SELECT * INTO v_original_trade FROM finance.trade_documents td WHERE td.organization_id=p_organization_id AND td.document_id=v_original.id;
      IF v_type='customer_credit' AND v_original_trade.recognition_mode='deferred_revenue' THEN
        RAISE EXCEPTION 'deferred-revenue credits require a separately allocated earned/unearned basis' USING ERRCODE='23514';
      END IF;
      IF v_type='customer_credit' THEN
        v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_ar,v_doc.party_id,NULL,0,v_doc.total_amount,v_doc.description,NULL,v_number,v_doc.due_date);
        SELECT a.id INTO v_account_id FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.code='4090' AND a.is_active AND a.is_postable;
        IF v_account_id IS NULL THEN RAISE EXCEPTION 'sales return account is unavailable' USING ERRCODE='23514'; END IF;
        FOR v_line IN SELECT l.* FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id ORDER BY l.line_no LOOP
          SELECT * INTO v_original_line FROM finance.document_lines ol WHERE ol.organization_id=p_organization_id AND ol.id=v_line.original_line_id AND ol.document_id=v_original.id;
          IF NOT FOUND THEN RAISE EXCEPTION 'credit line has no matching original line' USING ERRCODE='23514'; END IF;
          v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_account_id,NULL,v_original_line.cost_center_id,v_line.net_amount,0,v_line.description,NULL);
          IF v_line.tax_amount>0 THEN
            v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,COALESCE(v_original_line.tax_account_id,v_output_tax),NULL,NULL,v_line.tax_amount,0,'Tax reversal · '||v_line.description,NULL);
          END IF;
        END LOOP;
      ELSE
        v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_ap,v_doc.party_id,NULL,v_doc.total_amount,0,v_doc.description,NULL,v_number,v_doc.due_date);
        FOR v_line IN SELECT l.* FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id ORDER BY l.line_no LOOP
          SELECT * INTO v_original_line FROM finance.document_lines ol WHERE ol.organization_id=p_organization_id AND ol.id=v_line.original_line_id AND ol.document_id=v_original.id;
          IF NOT FOUND THEN RAISE EXCEPTION 'credit line has no matching original line' USING ERRCODE='23514'; END IF;
          SELECT COALESCE(sum(cl.quantity),0)::finance.quantity,COALESCE(sum(cl.gross_amount),0)::finance.amount INTO v_prior_qty,v_prior_gross
            FROM finance.document_lines cl JOIN finance.business_documents cd ON cd.organization_id=cl.organization_id AND cd.id=cl.document_id
            WHERE cl.organization_id=p_organization_id AND cl.original_line_id=v_original_line.id AND cd.document_type='vendor_credit' AND cd.state='posted'
              AND NOT EXISTS(SELECT 1 FROM finance.business_documents reversed WHERE reversed.organization_id=cd.organization_id AND reversed.reversal_of_document_id=cd.id AND reversed.state='posted');
          IF v_prior_qty+v_line.quantity>v_original_line.quantity OR v_prior_gross+v_line.gross_amount>v_original_line.gross_amount THEN
            RAISE EXCEPTION 'vendor credit exceeds the eligible original bill-line quantity or gross basis' USING ERRCODE='23514';
          END IF;
          IF v_original_line.tax_recoverability_snapshot='full' THEN
            v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_original_line.account_id,NULL,v_original_line.cost_center_id,0,v_line.net_amount,v_line.description,NULL);
            IF v_line.tax_amount>0 THEN v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,COALESCE(v_original_line.tax_account_id,v_input_tax),NULL,NULL,0,v_line.tax_amount,'Input tax reversal · '||v_line.description,NULL); END IF;
          ELSE
            v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_original_line.account_id,NULL,v_original_line.cost_center_id,0,v_line.gross_amount,v_line.description,NULL);
          END IF;
        END LOOP;
      END IF;
      SELECT COALESCE(sum(l.gross_amount),0)::finance.amount INTO v_base FROM finance.document_lines l
        WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id;
      IF v_doc.total_amount<>v_base THEN
        IF v_rounding IS NULL OR abs(v_doc.total_amount-v_base)>0.05 OR v_doc.rounding_adjustment<>v_doc.total_amount-v_base THEN
          RAISE EXCEPTION 'credit rounding does not agree with its explicit source adjustment' USING ERRCODE='23514';
        END IF;
        v_line_no:=v_line_no+1;
        IF v_type='customer_credit' THEN
          IF v_doc.total_amount>v_base THEN PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,v_doc.total_amount-v_base,0,'Explicit rounding adjustment',NULL);
          ELSE PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,0,v_base-v_doc.total_amount,'Explicit rounding adjustment',NULL); END IF;
        ELSE
          IF v_doc.total_amount>v_base THEN PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,0,v_doc.total_amount-v_base,'Explicit rounding adjustment',NULL);
          ELSE PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,v_base-v_doc.total_amount,0,'Explicit rounding adjustment',NULL); END IF;
        END IF;
      END IF;
    END IF;
  ELSIF v_type IN ('receipt','vendor_payment','customer_refund','vendor_refund','customer_advance','vendor_advance') THEN
    SELECT mm.* INTO v_movement FROM finance.money_movements mm WHERE mm.organization_id=p_organization_id AND mm.document_id=p_document_id;
    IF NOT FOUND OR v_movement.amount<>v_doc.total_amount THEN RAISE EXCEPTION 'cash movement must agree with source total' USING ERRCODE='23514'; END IF;
    SELECT ca.account_id INTO v_cash_account FROM finance.cash_accounts ca WHERE ca.organization_id=p_organization_id AND ca.id=v_movement.cash_account_id AND ca.is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'cash account is unavailable' USING ERRCODE='23514'; END IF;
    IF v_type IN ('receipt','customer_advance','vendor_refund') THEN
      v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_cash_account,NULL,NULL,v_movement.amount,0,v_doc.description,v_movement.cash_flow_class);
    ELSE
      v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_cash_account,NULL,NULL,0,v_movement.amount,v_doc.description,v_movement.cash_flow_class);
    END IF;
    v_line_no:=v_line_no+1;
    CASE v_type
      WHEN 'receipt' THEN v_account_id:=v_ar;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_account_id,v_doc.party_id,NULL,0,v_movement.amount,v_doc.description,v_movement.cash_flow_class,v_number,v_doc.due_date);
      WHEN 'vendor_payment' THEN v_account_id:=v_ap;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_account_id,v_doc.party_id,NULL,v_movement.amount,0,v_doc.description,v_movement.cash_flow_class,v_number,v_doc.due_date);
      WHEN 'customer_refund' THEN v_account_id:=v_ar;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_account_id,v_doc.party_id,NULL,v_movement.amount,0,v_doc.description,v_movement.cash_flow_class,v_number,v_doc.due_date);
      WHEN 'vendor_refund' THEN v_account_id:=v_ap;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_account_id,v_doc.party_id,NULL,0,v_movement.amount,v_doc.description,v_movement.cash_flow_class,v_number,v_doc.due_date);
      WHEN 'customer_advance' THEN v_account_id:=v_customer_advance;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_account_id,v_doc.party_id,NULL,0,v_movement.amount,v_doc.description,v_movement.cash_flow_class,v_number,v_doc.due_date);
      WHEN 'vendor_advance' THEN v_account_id:=v_vendor_advance;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_account_id,v_doc.party_id,NULL,v_movement.amount,0,v_doc.description,v_movement.cash_flow_class,v_number,v_doc.due_date);
    END CASE;
    IF v_type IN ('receipt','vendor_payment','vendor_refund') THEN
      FOR v_line IN SELECT oi.id,oi.side,p.amount FROM finance.document_allocation_plans p JOIN finance.open_items oi
        ON oi.organization_id=p.organization_id AND oi.id=p.target_open_item_id WHERE p.organization_id=p_organization_id AND p.document_id=p_document_id ORDER BY oi.id LOOP
        SELECT * INTO v_target FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.id=v_line.id FOR UPDATE;
        IF NOT FOUND OR v_target.party_id IS DISTINCT FROM v_doc.party_id OR v_target.account_id IS DISTINCT FROM CASE WHEN v_type='receipt' THEN v_ar ELSE v_ap END OR
           v_target.side IS DISTINCT FROM CASE WHEN v_type IN ('receipt','vendor_refund') THEN 'debit' ELSE 'credit' END OR
           (v_type='vendor_refund' AND (v_target.control_kind<>'ap' OR NOT EXISTS(SELECT 1 FROM finance.journal_lines sl
             JOIN finance.journal_entries sj ON sj.organization_id=sl.organization_id AND sj.id=sl.journal_entry_id
             JOIN finance.business_documents sd ON sd.organization_id=sj.organization_id AND sd.id=sj.source_document_id
             WHERE sl.organization_id=v_target.organization_id AND sl.id=v_target.journal_line_id AND sj.state='posted'
               AND sd.document_type='vendor_credit' AND sd.party_id=v_doc.party_id))) OR v_line.amount<=0 OR v_line.amount>v_movement.amount THEN
          RAISE EXCEPTION 'settlement plan target is no longer compatible' USING ERRCODE='23514';
        END IF;
        SELECT oi.id INTO v_open_item_id FROM finance.open_items oi JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
          WHERE jl.organization_id=p_organization_id AND jl.journal_entry_id=v_journal_id AND oi.id<>v_target.id ORDER BY oi.id LIMIT 1;
        IF v_open_item_id IS NULL THEN RAISE EXCEPTION 'new settlement control item unavailable' USING ERRCODE='23514'; END IF;
        -- The new opposite item is found from this journal's control line; references cannot cross organizations.
        IF v_target.side='debit' THEN
          PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_target.id,v_line.amount,v_doc.accounting_date);
          PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_open_item_id,v_line.amount,v_doc.accounting_date);
          INSERT INTO finance.settlement_allocations(organization_id,debit_open_item_id,credit_open_item_id,amount,effective_date,created_by_member_id,source_document_id)
            VALUES(p_organization_id,v_target.id,v_open_item_id,v_line.amount,v_doc.accounting_date,v_actor,p_document_id) RETURNING id INTO v_alloc_id;
        ELSE
          PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_open_item_id,v_line.amount,v_doc.accounting_date);
          PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_target.id,v_line.amount,v_doc.accounting_date);
          INSERT INTO finance.settlement_allocations(organization_id,debit_open_item_id,credit_open_item_id,amount,effective_date,created_by_member_id,source_document_id)
            VALUES(p_organization_id,v_open_item_id,v_target.id,v_line.amount,v_doc.accounting_date,v_actor,p_document_id) RETURNING id INTO v_alloc_id;
        END IF;
        PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'allocation.created','settlement_allocation',v_alloc_id,p_request_id,
          jsonb_build_object('amount',v_line.amount::text,'effective_date',v_doc.accounting_date,'source_document_id',p_document_id,
            'target_open_item_id',v_target.id,'settlement_open_item_id',v_open_item_id));
      END LOOP;
    END IF;
  ELSIF v_type='transfer' THEN
    SELECT * INTO v_transfer FROM finance.transfers t WHERE t.organization_id=p_organization_id AND t.document_id=p_document_id;
    IF NOT FOUND OR v_transfer.amount+v_transfer.fee_amount<>v_doc.total_amount THEN RAISE EXCEPTION 'transfer details must agree with the source total' USING ERRCODE='23514'; END IF;
    SELECT ca.account_id INTO v_cash_account FROM finance.cash_accounts ca WHERE ca.organization_id=p_organization_id AND ca.id=v_transfer.to_cash_account_id AND ca.is_active;
    IF v_cash_account IS NULL THEN RAISE EXCEPTION 'destination cash account is unavailable' USING ERRCODE='23514'; END IF;
    v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_cash_account,NULL,NULL,v_transfer.amount,0,v_doc.description,'internal');
    SELECT ca.account_id INTO v_cash_account FROM finance.cash_accounts ca WHERE ca.organization_id=p_organization_id AND ca.id=v_transfer.from_cash_account_id AND ca.is_active;
    IF v_cash_account IS NULL THEN RAISE EXCEPTION 'source cash account is unavailable' USING ERRCODE='23514'; END IF;
    IF v_transfer.fee_amount>0 THEN
      v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_transfer.fee_account_id,NULL,NULL,v_transfer.fee_amount,0,'Transfer fee','operating');
    END IF;
    v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_cash_account,NULL,NULL,0,v_transfer.amount+v_transfer.fee_amount,v_doc.description,'internal');
  ELSIF v_type IN ('manual_journal','controlled_adjustment','opening_balance') THEN
    FOR v_line IN SELECT r.* FROM finance.manual_journal_rows r WHERE r.organization_id=p_organization_id AND r.document_id=p_document_id ORDER BY r.line_no LOOP
      v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_line.account_id,v_line.party_id,v_line.cost_center_id,
        v_line.debit,v_line.credit,v_line.description,v_line.cash_flow_class,
        CASE WHEN EXISTS(SELECT 1 FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=v_line.account_id AND a.control_kind IS NOT NULL)
          THEN COALESCE(v_line.open_item_reference,v_number) ELSE v_line.open_item_reference END,v_line.open_item_due_date);
    END LOOP;
  ELSE
    RAISE EXCEPTION 'this source type requires a dedicated controlled posting command' USING ERRCODE='23514';
  END IF;
  SELECT COALESCE(sum(l.debit),0)::finance.amount,COALESCE(sum(l.credit),0)::finance.amount INTO v_total_debit,v_total_credit
    FROM finance.journal_lines l WHERE l.organization_id=p_organization_id AND l.journal_entry_id=v_journal_id;
  IF v_total_debit<=0 OR v_total_debit<>v_total_credit THEN RAISE EXCEPTION 'journal is unbalanced' USING ERRCODE='23514'; END IF;
  UPDATE finance.journal_entries j SET state='posted',posted_at=clock_timestamp() WHERE j.organization_id=p_organization_id AND j.id=v_journal_id;
  UPDATE finance.business_documents d SET state='posted',document_number=v_number,posted_by_member_id=v_actor,posted_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE d.organization_id=p_organization_id AND d.id=p_document_id;
  SELECT jsonb_build_object('document_id',p_document_id,'document_number',v_number,'document_version',v_doc.version,'journal_entry_id',v_journal_id,'state','posted') INTO v_receipt;
  INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body,resource_document_id)
    VALUES(p_organization_id,'documents.post:'||p_document_id::text,p_idempotency_key,p_request_hash,v_actor,200,v_receipt,p_document_id);
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'document.post','business_document',p_document_id,p_request_id,
    jsonb_build_object('version',v_doc.version,'document_number',v_number,'journal_entry_id',v_journal_id,'debit_total',v_total_debit::text,'credit_total',v_total_credit::text));
  PERFORM finance_private.enqueue_outbox_event(p_organization_id,'document.posted',p_document_id,'document.posted:'||p_document_id::text,
    jsonb_build_object('document_id',p_document_id,'document_version',v_doc.version,'journal_entry_id',v_journal_id));
  RETURN QUERY SELECT p_document_id,v_number,v_doc.version,v_journal_id,'posted'::text;
END $$;;
REVOKE ALL ON FUNCTION public.save_financial_document(uuid,uuid,integer,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_financial_document(uuid,uuid,integer,text,text,text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.save_document_allocation_plan(uuid,uuid,integer,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_document_allocation_plan(uuid,uuid,integer,text,text,text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.post_financial_document(uuid,uuid,integer,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.post_financial_document(uuid,uuid,integer,text,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
