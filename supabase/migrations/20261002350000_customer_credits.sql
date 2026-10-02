-- US-038: invoice-line credit capacity, credit register and lifecycle reads.
BEGIN;

CREATE FUNCTION finance_private.assert_customer_credit_capacity(p_organization_id uuid,p_original_document_id uuid,p_credit_document_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF EXISTS(
    WITH original_lines AS (
      SELECT l.id,l.quantity::numeric AS original_quantity,l.gross_amount::numeric AS original_basis
      FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.document_id=p_original_document_id
    ), events AS (
      SELECT cl.original_line_id AS line_id,cd.accounting_date AS effective_date,cl.quantity::numeric AS quantity_delta,cl.gross_amount::numeric AS basis_delta
      FROM finance.document_lines cl JOIN finance.business_documents cd ON cd.organization_id=cl.organization_id AND cd.id=cl.document_id
      JOIN finance.trade_documents ctd ON ctd.organization_id=cd.organization_id AND ctd.document_id=cd.id
      WHERE cd.organization_id=p_organization_id AND cd.document_type='customer_credit' AND cd.state='posted'
        AND ctd.original_document_id=p_original_document_id AND cl.original_line_id IS NOT NULL AND cd.id<>p_credit_document_id
      UNION ALL
      SELECT cl.original_line_id,rev.accounting_date,-cl.quantity::numeric,-cl.gross_amount::numeric
      FROM finance.business_documents rev JOIN finance.business_documents cd
        ON cd.organization_id=rev.organization_id AND cd.id=rev.reversal_of_document_id AND cd.document_type='customer_credit' AND cd.state='posted'
      JOIN finance.trade_documents ctd ON ctd.organization_id=cd.organization_id AND ctd.document_id=cd.id
      JOIN finance.document_lines cl ON cl.organization_id=cd.organization_id AND cl.document_id=cd.id
      WHERE rev.organization_id=p_organization_id AND rev.state='posted' AND ctd.original_document_id=p_original_document_id
        AND cl.original_line_id IS NOT NULL AND cd.id<>p_credit_document_id
      UNION ALL
      SELECT cl.original_line_id,credit.accounting_date,cl.quantity::numeric,cl.gross_amount::numeric
      FROM finance.document_lines cl JOIN finance.business_documents credit ON credit.organization_id=cl.organization_id AND credit.id=cl.document_id
      WHERE credit.organization_id=p_organization_id AND credit.id=p_credit_document_id AND credit.document_type='customer_credit'
        AND cl.original_line_id IS NOT NULL
    ), daily AS (
      SELECT line_id,effective_date,sum(quantity_delta) AS quantity_delta,sum(basis_delta) AS basis_delta
      FROM events GROUP BY line_id,effective_date
    ), running AS (
      SELECT line_id,effective_date,sum(quantity_delta) OVER(PARTITION BY line_id ORDER BY effective_date ROWS UNBOUNDED PRECEDING) AS quantity_total,
        sum(basis_delta) OVER(PARTITION BY line_id ORDER BY effective_date ROWS UNBOUNDED PRECEDING) AS basis_total
      FROM daily
    )
    SELECT 1 FROM running r JOIN original_lines ol ON ol.id=r.line_id
    WHERE r.quantity_total<0 OR r.basis_total<0 OR r.quantity_total>ol.original_quantity OR r.basis_total>ol.original_basis
  ) THEN RAISE EXCEPTION 'customer credit exceeds original line quantity or value at an effective-date boundary' USING ERRCODE='23514'; END IF;
END $$;
REVOKE ALL ON FUNCTION finance_private.assert_customer_credit_capacity(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,ams_job_worker;

CREATE FUNCTION public.read_customer_creditable_invoices(p_organization_id uuid,p_accounting_date date,p_search text DEFAULT NULL,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50)
RETURNS TABLE(id uuid,document_number text,customer_id uuid,customer_name text,issue_date date,accounting_date date,total_amount text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'sales.write');
  IF p_accounting_date IS NULL OR NOT isfinite(p_accounting_date) OR p_limit NOT BETWEEN 1 AND 101 OR (p_search IS NOT NULL AND length(p_search)>100)
    THEN RAISE EXCEPTION 'invalid credit invoice filters' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT d.id,d.document_number,d.party_id,c.display_name,d.issue_date,d.accounting_date,d.total_amount::text
    FROM finance.business_documents d JOIN finance.contacts c ON c.organization_id=d.organization_id AND c.id=d.party_id
    WHERE d.organization_id=p_organization_id AND d.document_type='invoice' AND d.state='posted' AND d.accounting_date<=p_accounting_date
      AND (p_after IS NULL OR d.id<p_after)
      AND (p_search IS NULL OR btrim(p_search)='' OR d.document_number ILIKE '%'||btrim(p_search)||'%' OR c.display_name ILIKE '%'||btrim(p_search)||'%')
      AND EXISTS(SELECT 1 FROM finance.document_lines source_line WHERE source_line.organization_id=d.organization_id AND source_line.document_id=d.id
        AND source_line.quantity>COALESCE((SELECT sum(events.quantity_delta) FROM (
          SELECT credit_line.quantity::numeric AS quantity_delta FROM finance.document_lines credit_line
            JOIN finance.business_documents credit ON credit.organization_id=credit_line.organization_id AND credit.id=credit_line.document_id
            JOIN finance.trade_documents td ON td.organization_id=credit.organization_id AND td.document_id=credit.id
            WHERE credit.organization_id=d.organization_id AND credit.document_type='customer_credit' AND credit.state='posted'
              AND td.original_document_id=d.id AND credit_line.original_line_id=source_line.id AND credit.accounting_date<=p_accounting_date
          UNION ALL SELECT -credit_line.quantity::numeric FROM finance.document_lines credit_line
            JOIN finance.business_documents credit ON credit.organization_id=credit_line.organization_id AND credit.id=credit_line.document_id
            JOIN finance.trade_documents td ON td.organization_id=credit.organization_id AND td.document_id=credit.id
            JOIN finance.business_documents rev ON rev.organization_id=credit.organization_id AND rev.reversal_of_document_id=credit.id AND rev.state='posted'
            WHERE credit.organization_id=d.organization_id AND credit.document_type='customer_credit' AND credit.state='posted'
              AND td.original_document_id=d.id AND credit_line.original_line_id=source_line.id AND rev.accounting_date<=p_accounting_date
        ) events),0) AND source_line.gross_amount>COALESCE((SELECT sum(events.basis_delta) FROM (
          SELECT credit_line.gross_amount::numeric AS basis_delta FROM finance.document_lines credit_line
            JOIN finance.business_documents credit ON credit.organization_id=credit_line.organization_id AND credit.id=credit_line.document_id
            JOIN finance.trade_documents td ON td.organization_id=credit.organization_id AND td.document_id=credit.id
            WHERE credit.organization_id=d.organization_id AND credit.document_type='customer_credit' AND credit.state='posted'
              AND td.original_document_id=d.id AND credit_line.original_line_id=source_line.id AND credit.accounting_date<=p_accounting_date
          UNION ALL SELECT -credit_line.gross_amount::numeric FROM finance.document_lines credit_line
            JOIN finance.business_documents credit ON credit.organization_id=credit_line.organization_id AND credit.id=credit_line.document_id
            JOIN finance.trade_documents td ON td.organization_id=credit.organization_id AND td.document_id=credit.id
            JOIN finance.business_documents rev ON rev.organization_id=credit.organization_id AND rev.reversal_of_document_id=credit.id AND rev.state='posted'
            WHERE credit.organization_id=d.organization_id AND credit.document_type='customer_credit' AND credit.state='posted'
              AND td.original_document_id=d.id AND credit_line.original_line_id=source_line.id AND rev.accounting_date<=p_accounting_date
        ) events),0))
    ORDER BY d.id DESC LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.read_customer_creditable_invoices(uuid,date,text,uuid,integer) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_customer_creditable_invoices(uuid,date,text,uuid,integer) TO authenticated;

CREATE FUNCTION public.read_customer_credit_options(p_organization_id uuid,p_invoice_id uuid,p_accounting_date date)
RETURNS TABLE(invoice_id uuid,invoice_number text,customer_id uuid,customer_name text,issue_date date,accounting_date date,total_amount text,
  original_line_id uuid,line_description text,original_quantity text,remaining_quantity text,unit_price text,discount_amount text,account_id uuid,
  cost_center_id uuid,tax_code_id uuid,tax_mode text,tax_label text,tax_rate text,tax_recoverability text,original_gross text,remaining_basis text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_invoice finance.business_documents%ROWTYPE;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'sales.write');
  IF p_accounting_date IS NULL OR NOT isfinite(p_accounting_date) THEN RAISE EXCEPTION 'accounting date required' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_invoice FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_invoice_id AND d.document_type='invoice' AND d.state='posted';
  IF NOT FOUND OR NOT finance_private.can_read_document(p_organization_id,p_invoice_id) OR v_invoice.accounting_date>p_accounting_date THEN
    RAISE EXCEPTION 'posted invoice unavailable for this accounting date' USING ERRCODE='P0002'; END IF;
  RETURN QUERY SELECT d.id,d.document_number,d.party_id,c.display_name,d.issue_date,d.accounting_date,d.total_amount::text,
    source_line.id,source_line.description,source_line.quantity::text,
    GREATEST(source_line.quantity-COALESCE(events.credited_quantity,0),0)::text,source_line.unit_price::text,source_line.discount_amount::text,
    source_line.account_id,source_line.cost_center_id,source_line.tax_code_id,source_line.tax_mode,source_line.tax_label_snapshot,
    source_line.tax_rate_snapshot::text,source_line.tax_recoverability_snapshot,source_line.gross_amount::text,
    GREATEST(source_line.gross_amount-COALESCE(events.credited_basis,0),0)::text
  FROM finance.business_documents d JOIN finance.contacts c ON c.organization_id=d.organization_id AND c.id=d.party_id
    JOIN finance.document_lines source_line ON source_line.organization_id=d.organization_id AND source_line.document_id=d.id
    LEFT JOIN LATERAL (SELECT COALESCE(sum(e.quantity_delta),0)::finance.quantity AS credited_quantity,
      COALESCE(sum(e.basis_delta),0)::finance.amount AS credited_basis FROM (
        SELECT cl.quantity::numeric AS quantity_delta,cl.gross_amount::numeric AS basis_delta FROM finance.document_lines cl
          JOIN finance.business_documents credit ON credit.organization_id=cl.organization_id AND credit.id=cl.document_id
          JOIN finance.trade_documents td ON td.organization_id=credit.organization_id AND td.document_id=credit.id
          WHERE credit.organization_id=p_organization_id AND credit.document_type='customer_credit' AND credit.state='posted'
            AND td.original_document_id=d.id AND cl.original_line_id=source_line.id AND credit.accounting_date<=p_accounting_date
        UNION ALL SELECT -cl.quantity::numeric,-cl.gross_amount::numeric FROM finance.document_lines cl
          JOIN finance.business_documents credit ON credit.organization_id=cl.organization_id AND credit.id=cl.document_id
          JOIN finance.trade_documents td ON td.organization_id=credit.organization_id AND td.document_id=credit.id
          JOIN finance.business_documents rev ON rev.organization_id=credit.organization_id AND rev.reversal_of_document_id=credit.id AND rev.state='posted'
          WHERE credit.organization_id=p_organization_id AND credit.document_type='customer_credit' AND credit.state='posted'
            AND td.original_document_id=d.id AND cl.original_line_id=source_line.id AND rev.accounting_date<=p_accounting_date
      ) e) events ON true
  WHERE d.organization_id=p_organization_id AND d.id=p_invoice_id AND source_line.quantity>COALESCE(events.credited_quantity,0)
    AND source_line.gross_amount>COALESCE(events.credited_basis,0) ORDER BY source_line.line_no;
END $$;
REVOKE ALL ON FUNCTION public.read_customer_credit_options(uuid,uuid,date) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_customer_credit_options(uuid,uuid,date) TO authenticated;

CREATE FUNCTION public.read_customer_credit_register(p_organization_id uuid,p_status text DEFAULT 'all',p_search text DEFAULT NULL,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50)
RETURNS TABLE(id uuid,organization_id uuid,state text,document_number text,customer_name text,original_document_number text,accounting_date date,total_amount text,residual_amount text,duplicate_reference boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'sales.read');
  IF p_status NOT IN ('all','drafts','awaiting_approval','posted') OR p_limit NOT BETWEEN 1 AND 101 OR (p_search IS NOT NULL AND length(p_search)>100)
    THEN RAISE EXCEPTION 'invalid customer credit filters' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT d.id,d.organization_id,d.state::text,d.document_number,c.display_name,o.document_number,d.accounting_date,d.total_amount::text,
    CASE WHEN d.state='posted' THEN COALESCE(residual.amount,0)::text ELSE NULL END,
    false
  FROM finance.business_documents d JOIN finance.contacts c ON c.organization_id=d.organization_id AND c.id=d.party_id
    JOIN finance.trade_documents td ON td.organization_id=d.organization_id AND td.document_id=d.id
    JOIN finance.business_documents o ON o.organization_id=td.organization_id AND o.id=td.original_document_id AND o.document_type='invoice'
    LEFT JOIN LATERAL (SELECT GREATEST(oi.original_amount-COALESCE(sum(a.amount),0)+COALESCE(sum(r.amount),0),0)::finance.amount AS amount
      FROM finance.open_items oi JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
      JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
      LEFT JOIN finance.settlement_allocations a ON a.organization_id=oi.organization_id AND (a.debit_open_item_id=oi.id OR a.credit_open_item_id=oi.id)
        AND a.effective_date<=(now() AT TIME ZONE (SELECT timezone FROM finance.organizations WHERE id=p_organization_id))::date
      LEFT JOIN finance.allocation_reversals r ON r.organization_id=a.organization_id AND r.allocation_id=a.id
        AND r.effective_date<=(now() AT TIME ZONE (SELECT timezone FROM finance.organizations WHERE id=p_organization_id))::date
      WHERE oi.organization_id=d.organization_id AND je.source_document_id=d.id AND oi.control_kind='ar' AND oi.side='credit'
      GROUP BY oi.id,oi.original_amount) residual ON true
  WHERE d.organization_id=p_organization_id AND d.document_type='customer_credit'
    AND (p_status='all' OR (p_status='drafts' AND d.state='draft') OR (p_status='awaiting_approval' AND d.state='pending_approval') OR (p_status='posted' AND d.state='posted'))
    AND (p_after IS NULL OR d.id<p_after) AND (p_search IS NULL OR btrim(p_search)='' OR d.document_number ILIKE '%'||btrim(p_search)||'%'
      OR c.display_name ILIKE '%'||btrim(p_search)||'%' OR o.document_number ILIKE '%'||btrim(p_search)||'%')
  ORDER BY d.id DESC LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.read_customer_credit_register(uuid,text,text,uuid,integer) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_customer_credit_register(uuid,text,text,uuid,integer) TO authenticated;

CREATE FUNCTION public.read_customer_credit_lifecycle(p_organization_id uuid,p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_doc finance.business_documents%ROWTYPE;v_timezone text;v_today date;v_residual finance.amount;v_credit_open_item uuid;v_approvals jsonb:='[]'::jsonb;v_attachments jsonb:='[]'::jsonb;v_activity jsonb:='[]'::jsonb;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'sales.read');
  SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id AND d.document_type='customer_credit';
  IF NOT FOUND OR NOT finance_private.can_read_document(p_organization_id,p_document_id) THEN RAISE EXCEPTION 'customer credit unavailable' USING ERRCODE='P0002'; END IF;
  SELECT o.timezone INTO v_timezone FROM finance.organizations o WHERE o.id=p_organization_id;v_today:=(now() AT TIME ZONE v_timezone)::date;
  SELECT COALESCE(sum(GREATEST(oi.original_amount-COALESCE((SELECT sum(a.amount) FROM finance.settlement_allocations a
    WHERE a.organization_id=oi.organization_id AND (a.debit_open_item_id=oi.id OR a.credit_open_item_id=oi.id) AND a.effective_date<=v_today),0)
    +COALESCE((SELECT sum(r.amount) FROM finance.settlement_allocations a JOIN finance.allocation_reversals r ON r.organization_id=a.organization_id AND r.allocation_id=a.id
      WHERE a.organization_id=oi.organization_id AND (a.debit_open_item_id=oi.id OR a.credit_open_item_id=oi.id) AND r.effective_date<=v_today),0),0)),0)::finance.amount INTO v_residual
    FROM finance.open_items oi JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
    WHERE v_doc.state='posted' AND je.source_document_id=v_doc.id AND oi.control_kind='ar' AND oi.side='credit';
  SELECT oi.id INTO v_credit_open_item FROM finance.open_items oi JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
    WHERE v_doc.state='posted' AND je.source_document_id=v_doc.id AND oi.control_kind='ar' AND oi.side='credit' ORDER BY oi.id LIMIT 1;
  IF finance_private.has_permission(p_organization_id,'approvals.read') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',r.id,'state',r.state,'version',r.document_version,'created_at',r.created_at,'decisions',
      COALESCE((SELECT jsonb_agg(jsonb_build_object('decision',ad.decision,'reason',ad.reason,'created_at',ad.created_at,'decided_by',m.display_name_snapshot) ORDER BY ad.created_at,ad.id)
        FROM finance.approval_decisions ad JOIN finance.organization_members m ON m.organization_id=ad.organization_id AND m.id=ad.decided_by_member_id
        WHERE ad.organization_id=r.organization_id AND ad.request_id=r.id),'[]'::jsonb)) ORDER BY r.created_at DESC,r.id DESC),'[]'::jsonb)
      INTO v_approvals FROM finance.approval_requests r WHERE r.organization_id=p_organization_id AND r.document_id=v_doc.id;
  END IF;
  IF finance_private.has_permission(p_organization_id,'attachments.read') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',a.id,'filename',a.original_filename,'content_type',a.content_type,'byte_size',a.byte_size,'scan_status',a.scan_status)
      ORDER BY a.created_at,a.id),'[]'::jsonb) INTO v_attachments FROM finance.attachment_links al JOIN finance.attachments a ON a.organization_id=al.organization_id AND a.id=al.attachment_id
      WHERE al.organization_id=p_organization_id AND al.document_id=v_doc.id AND finance_private.can_read_attachment(p_organization_id,a.id);
  END IF;
  IF finance_private.has_permission(p_organization_id,'audit.read') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('action',ae.action,'actor_kind',ae.actor_kind,'created_at',ae.created_at,'reason',ae.reason) ORDER BY ae.created_at,ae.id),'[]'::jsonb)
      INTO v_activity FROM finance.audit_events ae WHERE ae.organization_id=p_organization_id AND ae.document_id=v_doc.id;
  END IF;
  RETURN jsonb_build_object('id',v_doc.id,'organization_id',p_organization_id,'state',v_doc.state::text,
    'residual_amount',CASE WHEN v_doc.state='posted' THEN v_residual::text ELSE NULL END,
    'applied_amount',CASE WHEN v_doc.state='posted' THEN (v_doc.total_amount-v_residual)::text ELSE '0.00' END,
    'credit_open_item_id',v_credit_open_item,
    'invoice_targets',COALESCE((SELECT jsonb_agg(jsonb_build_object('open_item_id',oi.id,'document_id',d.id,'document_number',d.document_number,'accounting_date',d.accounting_date,'residual_amount',
      GREATEST(oi.original_amount-COALESCE((SELECT sum(a.amount) FROM finance.settlement_allocations a WHERE a.organization_id=oi.organization_id AND (a.debit_open_item_id=oi.id OR a.credit_open_item_id=oi.id) AND a.effective_date<=v_today),0)
        +COALESCE((SELECT sum(r.amount) FROM finance.settlement_allocations a JOIN finance.allocation_reversals r ON r.organization_id=a.organization_id AND r.allocation_id=a.id WHERE a.organization_id=oi.organization_id AND (a.debit_open_item_id=oi.id OR a.credit_open_item_id=oi.id) AND r.effective_date<=v_today),0))::text ORDER BY d.accounting_date,d.id)
      FROM finance.open_items oi JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
      JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id
      WHERE v_doc.state='posted' AND d.organization_id=p_organization_id AND d.document_type='invoice' AND d.state='posted' AND d.party_id=v_doc.party_id AND oi.control_kind='ar' AND oi.side='debit'
        AND GREATEST(oi.original_amount-COALESCE((SELECT sum(a.amount) FROM finance.settlement_allocations a WHERE a.organization_id=oi.organization_id AND (a.debit_open_item_id=oi.id OR a.credit_open_item_id=oi.id) AND a.effective_date<=v_today),0)
          +COALESCE((SELECT sum(r.amount) FROM finance.settlement_allocations a JOIN finance.allocation_reversals r ON r.organization_id=a.organization_id AND r.allocation_id=a.id WHERE a.organization_id=oi.organization_id AND (a.debit_open_item_id=oi.id OR a.credit_open_item_id=oi.id) AND r.effective_date<=v_today),0))>0),'[]'::jsonb),
    'allocations',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'amount',a.amount::text,'effective_date',a.effective_date,'counter_document_type',other_doc.document_type::text,
      'counter_document_number',other_doc.document_number,'reversed_on',r.effective_date) ORDER BY a.effective_date,a.id)
      FROM finance.open_items credit_item JOIN finance.journal_lines cjl ON cjl.organization_id=credit_item.organization_id AND cjl.id=credit_item.journal_line_id
      JOIN finance.journal_entries cje ON cje.organization_id=cjl.organization_id AND cje.id=cjl.journal_entry_id AND cje.source_document_id=v_doc.id
      JOIN finance.settlement_allocations a ON a.organization_id=credit_item.organization_id AND (a.debit_open_item_id=credit_item.id OR a.credit_open_item_id=credit_item.id)
      JOIN finance.open_items other_item ON other_item.organization_id=a.organization_id AND other_item.id=CASE WHEN a.debit_open_item_id=credit_item.id THEN a.credit_open_item_id ELSE a.debit_open_item_id END
      JOIN finance.journal_lines ojl ON ojl.organization_id=other_item.organization_id AND ojl.id=other_item.journal_line_id
      JOIN finance.journal_entries oje ON oje.organization_id=ojl.organization_id AND oje.id=ojl.journal_entry_id
      JOIN finance.business_documents other_doc ON other_doc.organization_id=oje.organization_id AND other_doc.id=oje.source_document_id
      LEFT JOIN finance.allocation_reversals r ON r.organization_id=a.organization_id AND r.allocation_id=a.id
      WHERE credit_item.organization_id=p_organization_id AND credit_item.control_kind='ar' AND credit_item.side='credit'),'[]'::jsonb),
    'approvals',v_approvals,'attachments',v_attachments,'activity',v_activity,
    'corrections',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'document_type',c.document_type::text,'document_number',c.document_number,'state',c.state::text,'accounting_date',c.accounting_date,
      'reason',c.correction_reason) ORDER BY c.accounting_date,c.id) FROM finance.business_documents c WHERE c.organization_id=p_organization_id AND c.reversal_of_document_id=v_doc.id),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.read_customer_credit_lifecycle(uuid,uuid) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_customer_credit_lifecycle(uuid,uuid) TO authenticated;

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
      IF v_type='customer_credit' THEN
        PERFORM finance_private.assert_customer_credit_capacity(p_organization_id,v_original.id,p_document_id);
        v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_ar,v_doc.party_id,NULL,0,v_doc.total_amount,v_doc.description,NULL,v_number,v_doc.due_date);
        IF v_original_trade.recognition_mode='deferred_revenue' THEN
          SELECT a.id INTO v_account_id FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.code='2250' AND a.is_active AND a.is_postable;
          IF v_account_id IS NULL THEN RAISE EXCEPTION 'deferred revenue account is unavailable' USING ERRCODE='23514'; END IF;
        ELSE
          SELECT a.id INTO v_account_id FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.code='4090' AND a.is_active AND a.is_postable;
          IF v_account_id IS NULL THEN RAISE EXCEPTION 'sales return account is unavailable' USING ERRCODE='23514'; END IF;
        END IF;
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
    IF v_type IN ('receipt','vendor_payment') THEN
      FOR v_line IN SELECT oi.id,oi.side,p.amount FROM finance.document_allocation_plans p JOIN finance.open_items oi
        ON oi.organization_id=p.organization_id AND oi.id=p.target_open_item_id WHERE p.organization_id=p_organization_id AND p.document_id=p_document_id ORDER BY oi.id LOOP
        SELECT * INTO v_target FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.id=v_line.id FOR UPDATE;
        IF NOT FOUND OR v_target.party_id IS DISTINCT FROM v_doc.party_id OR v_target.account_id IS DISTINCT FROM CASE WHEN v_type='receipt' THEN v_ar ELSE v_ap END OR
           v_target.side IS DISTINCT FROM CASE WHEN v_type='receipt' THEN 'debit' ELSE 'credit' END OR v_line.amount<=0 OR v_line.amount>v_movement.amount THEN
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
END $$;
REVOKE ALL ON FUNCTION public.post_financial_document(uuid,uuid,integer,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.post_financial_document(uuid,uuid,integer,text,text,text) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
