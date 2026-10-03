-- US-073: describe every supported export accurately and use its own read gate.
CREATE OR REPLACE FUNCTION public.list_notification_center(p_organization_id uuid,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user uuid:=identity.current_actor_id();v_member uuid;v_items jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='28000'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid page size' USING ERRCODE='22023'; END IF;
  SELECT m.id INTO v_member FROM finance.organization_members m JOIN finance.organizations o ON o.id=m.organization_id
    WHERE m.organization_id=p_organization_id AND m.user_id=v_user AND m.status='active' AND o.status<>'archived';
  IF NOT FOUND THEN RAISE EXCEPTION 'company unavailable' USING ERRCODE='P0002'; END IF;
  WITH candidates AS (
    SELECT 'approval'::text item_kind,r.id source_id,d.id document_id,'Approval needs review'::text title,
      'A financial document is awaiting your review.'::text detail,r.created_at occurred_at
    FROM finance.approval_requests r JOIN finance.business_documents d ON d.organization_id=r.organization_id AND d.id=r.document_id
    WHERE r.organization_id=p_organization_id AND r.state='pending'
      AND finance_private.has_permission(p_organization_id,'approvals.read')
      AND finance_private.can_read_document(p_organization_id,d.id)
    UNION ALL
    SELECT 'delivery_failure',nd.id,d.id,'Document delivery failed','A document email delivery failed.',nd.created_at
    FROM finance.notification_deliveries nd JOIN finance.business_documents d
      ON d.organization_id=nd.organization_id AND d.id=nd.document_id
    WHERE nd.organization_id=p_organization_id AND nd.channel='email' AND nd.status='failed'
      AND finance_private.can_read_document(p_organization_id,d.id)
    UNION ALL
    SELECT 'export_failure',e.id,NULL::uuid,'Export failed',
      CASE e.export_type WHEN 'trial_balance' THEN 'Trial balance export needs attention'
        WHEN 'profit_and_loss' THEN 'Profit and loss export needs attention'
        WHEN 'balance_sheet' THEN 'Balance sheet export needs attention'
        WHEN 'customer_statement' THEN 'Customer statement export needs attention'
        WHEN 'vendor_statement' THEN 'Vendor statement export needs attention'
        ELSE 'Report export needs attention' END,e.created_at
    FROM finance.export_jobs e WHERE e.organization_id=p_organization_id AND e.requested_by_member_id=v_member
      AND e.status='failed' AND finance_private.export_requester_authorized_for_type(e.organization_id,v_member,e.export_type)
    UNION ALL
    SELECT 'invoice_due',d.id,d.id,'Invoice due','An outstanding invoice is due or overdue.',
      d.due_date::timestamp AT TIME ZONE o.timezone
    FROM finance.business_documents d JOIN finance.organizations o ON o.id=d.organization_id
    WHERE d.organization_id=p_organization_id AND d.document_type='invoice' AND d.state='posted'
      AND d.due_date<=(now() AT TIME ZONE o.timezone)::date AND finance_private.can_read_document(p_organization_id,d.id)
      AND EXISTS(SELECT 1 FROM finance.open_items oi JOIN finance.journal_lines jl
        ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id JOIN finance.journal_entries je
        ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
        WHERE oi.organization_id=d.organization_id AND oi.control_kind='ar' AND oi.side='debit'
          AND je.source_document_id=d.id AND finance_private.open_item_balance_at(d.organization_id,oi.id,
            (now() AT TIME ZONE o.timezone)::date,now())>0)
    UNION ALL
    SELECT 'bill_due',d.id,d.id,'Bill due','An outstanding bill is due or overdue.',
      d.due_date::timestamp AT TIME ZONE o.timezone
    FROM finance.business_documents d JOIN finance.organizations o ON o.id=d.organization_id
    WHERE d.organization_id=p_organization_id AND d.document_type='bill' AND d.state='posted'
      AND d.due_date<=(now() AT TIME ZONE o.timezone)::date AND finance_private.can_read_document(p_organization_id,d.id)
      AND EXISTS(SELECT 1 FROM finance.open_items oi JOIN finance.journal_lines jl
        ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id JOIN finance.journal_entries je
        ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
        WHERE oi.organization_id=d.organization_id AND oi.control_kind='ap' AND oi.side='credit'
          AND je.source_document_id=d.id AND finance_private.open_item_balance_at(d.organization_id,oi.id,
            (now() AT TIME ZONE o.timezone)::date,now())>0)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind',c.item_kind,'id',c.source_id,'title',c.title,'detail',c.detail,
      'occurred_at',c.occurred_at,'is_read',s.read_at IS NOT NULL,'document_id',c.document_id)
      ORDER BY c.occurred_at DESC,c.source_id DESC),'[]'::jsonb)
    INTO v_items FROM (SELECT * FROM candidates ORDER BY occurred_at DESC,source_id DESC LIMIT p_limit) c
    LEFT JOIN finance.notification_read_states s ON s.organization_id=p_organization_id AND s.member_id=v_member
      AND s.item_kind=c.item_kind AND s.source_id=c.source_id;
  RETURN v_items;
END $$;
REVOKE ALL ON FUNCTION public.list_notification_center(uuid,integer) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.list_notification_center(uuid,integer) TO ams_runtime;

CREATE OR REPLACE FUNCTION public.mark_notification_read(p_organization_id uuid,p_item_kind text,p_source_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user uuid:=identity.current_actor_id();v_member uuid;v_visible boolean:=false;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='28000'; END IF;
  SELECT m.id INTO v_member FROM finance.organization_members m JOIN finance.organizations o ON o.id=m.organization_id
    WHERE m.organization_id=p_organization_id AND m.user_id=v_user AND m.status='active' AND o.status<>'archived';
  IF NOT FOUND THEN RAISE EXCEPTION 'company unavailable' USING ERRCODE='P0002'; END IF;
  IF p_item_kind='approval' THEN
    SELECT EXISTS(SELECT 1 FROM finance.approval_requests r WHERE r.organization_id=p_organization_id AND r.id=p_source_id
      AND r.state='pending' AND finance_private.has_permission(p_organization_id,'approvals.read')
      AND finance_private.can_read_document(p_organization_id,r.document_id)) INTO v_visible;
  ELSIF p_item_kind='delivery_failure' THEN
    SELECT EXISTS(SELECT 1 FROM finance.notification_deliveries nd WHERE nd.organization_id=p_organization_id
      AND nd.id=p_source_id AND nd.channel='email' AND nd.status='failed'
      AND nd.document_id IS NOT NULL AND finance_private.can_read_document(p_organization_id,nd.document_id)) INTO v_visible;
  ELSIF p_item_kind='export_failure' THEN
    SELECT EXISTS(SELECT 1 FROM finance.export_jobs e WHERE e.organization_id=p_organization_id AND e.id=p_source_id
      AND e.requested_by_member_id=v_member AND e.status='failed'
      AND finance_private.export_requester_authorized_for_type(e.organization_id,v_member,e.export_type)) INTO v_visible;
  ELSIF p_item_kind='invoice_due' THEN
    SELECT EXISTS(SELECT 1 FROM finance.business_documents d JOIN finance.organizations o ON o.id=d.organization_id
      WHERE d.organization_id=p_organization_id AND d.id=p_source_id AND d.document_type='invoice' AND d.state='posted'
        AND d.due_date<=(now() AT TIME ZONE o.timezone)::date AND finance_private.can_read_document(p_organization_id,d.id)
        AND EXISTS(SELECT 1 FROM finance.open_items oi JOIN finance.journal_lines jl
          ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id JOIN finance.journal_entries je
          ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
          WHERE oi.organization_id=d.organization_id AND oi.control_kind='ar' AND oi.side='debit' AND je.source_document_id=d.id
            AND finance_private.open_item_balance_at(d.organization_id,oi.id,(now() AT TIME ZONE o.timezone)::date,now())>0)) INTO v_visible;
  ELSIF p_item_kind='bill_due' THEN
    SELECT EXISTS(SELECT 1 FROM finance.business_documents d JOIN finance.organizations o ON o.id=d.organization_id
      WHERE d.organization_id=p_organization_id AND d.id=p_source_id AND d.document_type='bill' AND d.state='posted'
        AND d.due_date<=(now() AT TIME ZONE o.timezone)::date AND finance_private.can_read_document(p_organization_id,d.id)
        AND EXISTS(SELECT 1 FROM finance.open_items oi JOIN finance.journal_lines jl
          ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id JOIN finance.journal_entries je
          ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
          WHERE oi.organization_id=d.organization_id AND oi.control_kind='ap' AND oi.side='credit' AND je.source_document_id=d.id
            AND finance_private.open_item_balance_at(d.organization_id,oi.id,(now() AT TIME ZONE o.timezone)::date,now())>0)) INTO v_visible;
  ELSE RAISE EXCEPTION 'invalid notification kind' USING ERRCODE='22023'; END IF;
  IF NOT v_visible THEN RAISE EXCEPTION 'notification unavailable' USING ERRCODE='P0002'; END IF;
  INSERT INTO finance.notification_read_states(organization_id,member_id,item_kind,source_id)
    VALUES(p_organization_id,v_member,p_item_kind,p_source_id) ON CONFLICT DO NOTHING;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.mark_notification_read(uuid,text,uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid,text,uuid) TO ams_runtime;
NOTIFY pgrst,'reload schema';
