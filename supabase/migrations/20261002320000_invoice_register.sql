-- US-030: permission-scoped invoice register with ledger-derived residuals.
BEGIN;

CREATE FUNCTION public.read_invoice_register(
  p_organization_id uuid,
  p_status text DEFAULT 'all',
  p_search text DEFAULT NULL,
  p_after uuid DEFAULT NULL,
  p_limit integer DEFAULT 50
) RETURNS TABLE(
  id uuid,
  organization_id uuid,
  state text,
  document_number text,
  customer_name text,
  issue_date date,
  due_date date,
  total_amount text,
  residual_amount text,
  settlement_status text,
  delivery_status text,
  overdue boolean
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_today date; v_timezone text;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'sales.read');
  IF p_status NOT IN ('all','drafts','awaiting_approval','posted') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 101
     OR (p_search IS NOT NULL AND length(p_search)>100) THEN
    RAISE EXCEPTION 'invalid invoice register filters' USING ERRCODE='22023';
  END IF;
  SELECT o.timezone INTO v_timezone FROM finance.organizations o WHERE o.id=p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'organization unavailable' USING ERRCODE='P0002'; END IF;
  v_today:=(now() AT TIME ZONE v_timezone)::date;

  RETURN QUERY
  SELECT d.id,d.organization_id,d.state::text,d.document_number,c.display_name,d.issue_date,d.due_date,
    d.total_amount::text,CASE WHEN d.state='posted' THEN balances.residual::text ELSE NULL END,
    CASE WHEN d.state<>'posted' THEN 'not_posted'
      WHEN balances.residual=0 THEN 'paid' WHEN balances.residual<d.total_amount THEN 'partially_paid' ELSE 'unpaid' END,
    COALESCE(delivery.status,'not_sent'),
    COALESCE(d.state='posted' AND d.due_date<v_today AND balances.residual>0,false)
  FROM finance.business_documents d
  JOIN finance.contacts c ON c.organization_id=d.organization_id AND c.id=d.party_id
  CROSS JOIN LATERAL (
    SELECT CASE WHEN d.state<>'posted' THEN 0::finance.amount ELSE COALESCE(sum(
      GREATEST(oi.original_amount-COALESCE(applied.amount,0),0)),0)::finance.amount END AS residual
    FROM finance.open_items oi
    JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(events.delta),0)::finance.amount AS amount FROM (
        SELECT a.amount AS delta FROM finance.settlement_allocations a
          WHERE a.organization_id=oi.organization_id AND (a.debit_open_item_id=oi.id OR a.credit_open_item_id=oi.id)
            AND a.effective_date<=v_today
        UNION ALL
        SELECT -a.amount FROM finance.settlement_allocations a
          JOIN finance.allocation_reversals r ON r.organization_id=a.organization_id AND r.allocation_id=a.id
          WHERE a.organization_id=oi.organization_id AND (a.debit_open_item_id=oi.id OR a.credit_open_item_id=oi.id)
            AND r.effective_date<=v_today
      ) events
    ) applied ON true
    WHERE d.state='posted' AND je.source_document_id=d.id AND oi.control_kind='ar' AND oi.side='debit'
  ) balances
  LEFT JOIN LATERAL (
    SELECT nd.status FROM finance.notification_deliveries nd
    WHERE nd.organization_id=d.organization_id AND nd.document_id=d.id AND nd.channel='email'
    ORDER BY nd.created_at DESC,nd.id DESC LIMIT 1
  ) delivery ON true
  WHERE d.organization_id=p_organization_id AND d.document_type='invoice'
    AND (p_status='all' OR (p_status='drafts' AND d.state='draft')
      OR (p_status='awaiting_approval' AND d.state='pending_approval') OR (p_status='posted' AND d.state='posted'))
    AND (p_after IS NULL OR d.id<p_after)
    AND (p_search IS NULL OR btrim(p_search)='' OR d.document_number ILIKE '%'||btrim(p_search)||'%'
      OR c.display_name ILIKE '%'||btrim(p_search)||'%' OR COALESCE(d.external_reference,'') ILIKE '%'||btrim(p_search)||'%')
  ORDER BY d.id DESC LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.read_invoice_register(uuid,text,text,uuid,integer) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_invoice_register(uuid,text,text,uuid,integer) TO authenticated;

CREATE FUNCTION public.read_invoice_lifecycle(p_organization_id uuid,p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_doc finance.business_documents%ROWTYPE; v_timezone text; v_today date; v_residual finance.amount;
  v_approvals jsonb:='[]'::jsonb; v_attachments jsonb:='[]'::jsonb; v_activity jsonb:='[]'::jsonb;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'sales.read');
  SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id AND d.document_type='invoice';
  IF NOT FOUND OR NOT finance_private.can_read_document(p_organization_id,p_document_id) THEN RAISE EXCEPTION 'invoice unavailable' USING ERRCODE='P0002'; END IF;
  SELECT o.timezone INTO v_timezone FROM finance.organizations o WHERE o.id=p_organization_id;
  v_today:=(now() AT TIME ZONE v_timezone)::date;
  SELECT COALESCE(sum(GREATEST(oi.original_amount-COALESCE(applied.amount,0),0)),0)::finance.amount INTO v_residual
  FROM finance.open_items oi JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(events.delta),0)::finance.amount AS amount FROM (
        SELECT a.amount AS delta FROM finance.settlement_allocations a WHERE a.organization_id=oi.organization_id
          AND (a.debit_open_item_id=oi.id OR a.credit_open_item_id=oi.id) AND a.effective_date<=v_today
        UNION ALL SELECT -a.amount FROM finance.settlement_allocations a JOIN finance.allocation_reversals r
          ON r.organization_id=a.organization_id AND r.allocation_id=a.id WHERE a.organization_id=oi.organization_id
          AND (a.debit_open_item_id=oi.id OR a.credit_open_item_id=oi.id) AND r.effective_date<=v_today
      ) events
    ) applied ON true
  WHERE v_doc.state='posted' AND je.source_document_id=v_doc.id AND oi.control_kind='ar' AND oi.side='debit';
  IF finance_private.has_permission(p_organization_id,'approvals.read') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',r.id,'state',r.state,'version',r.document_version,'created_at',r.created_at,
      'decisions',COALESCE((SELECT jsonb_agg(jsonb_build_object('decision',ad.decision,'reason',ad.reason,'created_at',ad.created_at,
        'decided_by',m.display_name_snapshot) ORDER BY ad.created_at,ad.id)
        FROM finance.approval_decisions ad JOIN finance.organization_members m ON m.organization_id=ad.organization_id AND m.id=ad.decided_by_member_id
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
      ORDER BY ae.created_at,ae.id),'[]'::jsonb) INTO v_activity FROM finance.audit_events ae
      WHERE ae.organization_id=p_organization_id AND ae.document_id=v_doc.id;
  END IF;
  RETURN jsonb_build_object('id',v_doc.id,'organization_id',v_doc.organization_id,'state',v_doc.state::text,
    'residual_amount',CASE WHEN v_doc.state='posted' THEN v_residual::text ELSE NULL END,
    'overdue',COALESCE(v_doc.state='posted' AND v_doc.due_date<v_today AND v_residual>0,false),
    'settlement_status',CASE WHEN v_doc.state<>'posted' THEN 'not_posted' WHEN v_residual=0 THEN 'paid'
      WHEN v_residual<v_doc.total_amount THEN 'partially_paid' ELSE 'unpaid' END,
    'allocations',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'amount',a.amount::text,'effective_date',a.effective_date,
      'counter_document_type',other_doc.document_type::text,'counter_document_number',other_doc.document_number,'reversed_on',ar.effective_date)
      ORDER BY a.effective_date,a.id) FROM finance.open_items invoice_item
      JOIN finance.journal_lines ijl ON ijl.organization_id=invoice_item.organization_id AND ijl.id=invoice_item.journal_line_id
      JOIN finance.journal_entries ije ON ije.organization_id=ijl.organization_id AND ije.id=ijl.journal_entry_id AND ije.source_document_id=v_doc.id
      JOIN finance.settlement_allocations a ON a.organization_id=invoice_item.organization_id AND (a.debit_open_item_id=invoice_item.id OR a.credit_open_item_id=invoice_item.id)
      JOIN finance.open_items other_item ON other_item.organization_id=a.organization_id AND other_item.id=CASE WHEN a.debit_open_item_id=invoice_item.id THEN a.credit_open_item_id ELSE a.debit_open_item_id END
      JOIN finance.journal_lines ojl ON ojl.organization_id=other_item.organization_id AND ojl.id=other_item.journal_line_id
      JOIN finance.journal_entries oje ON oje.organization_id=ojl.organization_id AND oje.id=ojl.journal_entry_id
      JOIN finance.business_documents other_doc ON other_doc.organization_id=oje.organization_id AND other_doc.id=oje.source_document_id
      LEFT JOIN finance.allocation_reversals ar ON ar.organization_id=a.organization_id AND ar.allocation_id=a.id
      WHERE invoice_item.organization_id=p_organization_id AND invoice_item.control_kind='ar' AND invoice_item.side='debit'),'[]'::jsonb),
    'delivery_attempts',COALESCE((SELECT jsonb_agg(jsonb_build_object('status',nd.status,'channel',nd.channel,'created_at',nd.created_at,'delivered_at',nd.delivered_at)
      ORDER BY nd.created_at,nd.id) FROM finance.notification_deliveries nd WHERE nd.organization_id=p_organization_id AND nd.document_id=v_doc.id),'[]'::jsonb),
    'approvals',v_approvals,
    'corrections',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'document_type',c.document_type::text,'document_number',c.document_number,
      'state',c.state::text,'accounting_date',c.accounting_date,'reason',c.correction_reason) ORDER BY c.accounting_date,c.id)
      FROM finance.business_documents c WHERE c.organization_id=p_organization_id AND c.reversal_of_document_id=v_doc.id),'[]'::jsonb),
    'attachments',v_attachments,'activity',v_activity);
END $$;
REVOKE ALL ON FUNCTION public.read_invoice_lifecycle(uuid,uuid) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_invoice_lifecycle(uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
