-- US-073: opt-in notification channels and idempotent daily reminder enqueue.
-- Source documentation defines no delivery cadence. The implementation queues
-- at most one event per member/category/company-local date when this scheduler runs.
CREATE TABLE finance.notification_preferences (
  organization_id uuid NOT NULL,
  member_id uuid NOT NULL,
  email_approvals boolean NOT NULL DEFAULT false,
  email_invoice_reminders boolean NOT NULL DEFAULT false,
  email_bill_reminders boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,member_id),
  FOREIGN KEY (organization_id,member_id) REFERENCES finance.organization_members(organization_id,id) ON DELETE RESTRICT
);
ALTER TABLE finance.notification_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.notification_preferences FROM PUBLIC,ams_runtime;

ALTER TABLE finance.notification_read_states DROP CONSTRAINT IF EXISTS notification_read_states_item_kind_check;
ALTER TABLE finance.notification_read_states ADD CONSTRAINT notification_read_states_item_kind_check
  CHECK (item_kind IN ('approval','delivery_failure','export_failure','invoice_due','bill_due'));

CREATE FUNCTION public.read_notification_preferences(p_organization_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user uuid:=identity.current_actor_id();v_member uuid;v_result jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='28000'; END IF;
  SELECT m.id INTO v_member FROM finance.organization_members m JOIN finance.organizations o ON o.id=m.organization_id
    WHERE m.organization_id=p_organization_id AND m.user_id=v_user AND m.status='active' AND o.status<>'archived';
  IF NOT FOUND THEN RAISE EXCEPTION 'company unavailable' USING ERRCODE='P0002'; END IF;
  SELECT jsonb_build_object('email_approvals',COALESCE(p.email_approvals,false),
      'email_invoice_reminders',COALESCE(p.email_invoice_reminders,false),
      'email_bill_reminders',COALESCE(p.email_bill_reminders,false),'updated_at',p.updated_at)
    INTO v_result FROM (SELECT 1) seed LEFT JOIN finance.notification_preferences p
      ON p.organization_id=p_organization_id AND p.member_id=v_member;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.read_notification_preferences(uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_notification_preferences(uuid) TO ams_runtime;

CREATE FUNCTION public.save_notification_preferences(
  p_organization_id uuid,p_email_approvals boolean,p_email_invoice_reminders boolean,p_email_bill_reminders boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user uuid:=identity.current_actor_id();v_member uuid;v_updated timestamptz;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='28000'; END IF;
  IF p_email_approvals IS NULL OR p_email_invoice_reminders IS NULL OR p_email_bill_reminders IS NULL THEN
    RAISE EXCEPTION 'all preferences must be explicit' USING ERRCODE='22023'; END IF;
  SELECT m.id INTO v_member FROM finance.organization_members m JOIN finance.organizations o ON o.id=m.organization_id
    WHERE m.organization_id=p_organization_id AND m.user_id=v_user AND m.status='active' AND o.status<>'archived';
  IF NOT FOUND THEN RAISE EXCEPTION 'company unavailable' USING ERRCODE='P0002'; END IF;
  IF p_email_approvals AND NOT finance_private.has_permission(p_organization_id,'approvals.read') OR
     p_email_invoice_reminders AND NOT finance_private.has_permission(p_organization_id,'sales.read') OR
     p_email_bill_reminders AND NOT finance_private.has_permission(p_organization_id,'purchases.read') THEN
    RAISE EXCEPTION 'email preference requires the matching company capability' USING ERRCODE='42501';
  END IF;
  INSERT INTO finance.notification_preferences(organization_id,member_id,email_approvals,email_invoice_reminders,email_bill_reminders,updated_at)
    VALUES(p_organization_id,v_member,p_email_approvals,p_email_invoice_reminders,p_email_bill_reminders,clock_timestamp())
    ON CONFLICT(organization_id,member_id) DO UPDATE SET email_approvals=EXCLUDED.email_approvals,
      email_invoice_reminders=EXCLUDED.email_invoice_reminders,email_bill_reminders=EXCLUDED.email_bill_reminders,
      updated_at=EXCLUDED.updated_at RETURNING updated_at INTO v_updated;
  RETURN jsonb_build_object('email_approvals',p_email_approvals,'email_invoice_reminders',p_email_invoice_reminders,
    'email_bill_reminders',p_email_bill_reminders,'updated_at',v_updated);
END $$;
REVOKE ALL ON FUNCTION public.save_notification_preferences(uuid,boolean,boolean,boolean) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.save_notification_preferences(uuid,boolean,boolean,boolean) TO ams_runtime;

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
    SELECT 'export_failure',e.id,NULL::uuid,'Export failed','Trial balance export needs attention',e.created_at
    FROM finance.export_jobs e WHERE e.organization_id=p_organization_id AND e.requested_by_member_id=v_member
      AND e.status='failed' AND finance_private.has_permission(p_organization_id,'exports.read')
      AND finance_private.has_permission(p_organization_id,'reports.read')
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
      AND finance_private.has_permission(p_organization_id,'exports.read')
      AND finance_private.has_permission(p_organization_id,'reports.read')) INTO v_visible;
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

CREATE FUNCTION finance_private.member_has_permission(p_organization_id uuid,p_member_id uuid,p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM finance.organization_members m
    JOIN finance.member_roles mr ON mr.organization_id=m.organization_id AND mr.member_id=m.id
    JOIN finance.role_permissions rp ON rp.organization_id=mr.organization_id AND rp.role_id=mr.role_id
    JOIN finance.permissions pe ON pe.id=rp.permission_id
    WHERE m.organization_id=p_organization_id AND m.id=p_member_id AND m.status='active' AND pe.code=p_permission)
$$;
REVOKE ALL ON FUNCTION finance_private.member_has_permission(uuid,uuid,text) FROM PUBLIC,ams_runtime;

CREATE FUNCTION finance_private.member_can_read_document(p_organization_id uuid,p_document_id uuid,p_member_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM finance.business_documents d
    WHERE d.organization_id=p_organization_id AND d.id=p_document_id AND (
      finance_private.member_has_permission(d.organization_id,p_member_id,'documents.read') OR
      (d.document_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance') AND
        finance_private.member_has_permission(d.organization_id,p_member_id,'sales.read')) OR
      (d.document_type IN ('bill','vendor_credit','paid_expense','vendor_payment','vendor_refund','vendor_advance') AND
        finance_private.member_has_permission(d.organization_id,p_member_id,'purchases.read')) OR
      (d.document_type='transfer' AND finance_private.member_has_permission(d.organization_id,p_member_id,'banking.read')) OR
      (d.document_type NOT IN ('invoice','customer_credit','receipt','customer_refund','customer_advance','bill','vendor_credit',
        'paid_expense','vendor_payment','vendor_refund','vendor_advance','transfer') AND
        finance_private.member_has_permission(d.organization_id,p_member_id,'accounting.read'))
    ))
$$;
REVOKE ALL ON FUNCTION finance_private.member_can_read_document(uuid,uuid,uuid) FROM PUBLIC,ams_runtime;

CREATE FUNCTION finance_private.enqueue_due_notification_reminders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_now timestamptz:=transaction_timestamp();v_member record;v_kind text;v_date date;v_queued integer:=0;v_count integer;
BEGIN
  FOR v_member IN
    SELECT m.organization_id,m.id member_id,m.user_id,o.timezone,p.email_approvals,p.email_invoice_reminders,p.email_bill_reminders,
      u.email_normalized,(v_now AT TIME ZONE o.timezone)::date local_date
    FROM finance.notification_preferences p
    JOIN finance.organization_members m ON m.organization_id=p.organization_id AND m.id=p.member_id AND m.status='active'
    JOIN finance.organizations o ON o.id=m.organization_id AND o.status='active'
    JOIN identity.users u ON u.id=m.user_id AND u.disabled_at IS NULL AND u.email_verified_at IS NOT NULL
    WHERE p.email_approvals OR p.email_invoice_reminders OR p.email_bill_reminders
  LOOP
    IF v_member.email_approvals AND finance_private.member_has_permission(v_member.organization_id,v_member.member_id,'approvals.read') AND EXISTS(
      SELECT 1 FROM finance.approval_requests r JOIN finance.business_documents d
        ON d.organization_id=r.organization_id AND d.id=r.document_id
      WHERE r.organization_id=v_member.organization_id AND r.state='pending' AND d.state='pending_approval'
        AND d.version=r.document_version AND d.material_digest=r.document_digest
        AND finance_private.member_can_read_document(v_member.organization_id,d.id,v_member.member_id)
    ) THEN
      v_kind:='approval';v_date:=v_member.local_date;
      INSERT INTO finance.outbox_events(organization_id,event_type,deduplication_key,payload)
        VALUES(v_member.organization_id,'financial.reminder','financial.reminder:'||v_member.member_id||':'||v_kind||':'||v_date,
          jsonb_build_object('member_id',v_member.member_id,'category',v_kind,'scheduled_date',v_date)) ON CONFLICT(organization_id,deduplication_key) DO NOTHING;
      GET DIAGNOSTICS v_count=ROW_COUNT;v_queued:=v_queued+v_count;
    END IF;
    IF v_member.email_invoice_reminders AND finance_private.member_has_permission(v_member.organization_id,v_member.member_id,'sales.read') AND EXISTS(
      SELECT 1 FROM finance.open_items oi
      JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
      JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
      JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id AND d.state='posted'
      WHERE oi.organization_id=v_member.organization_id AND oi.control_kind='ar' AND oi.side='debit'
        AND d.document_type='invoice' AND oi.due_date<=v_member.local_date
        AND finance_private.open_item_balance_at(v_member.organization_id,oi.id,v_member.local_date,v_now)>0
    ) THEN
      v_kind:='invoice_due';v_date:=v_member.local_date;
      INSERT INTO finance.outbox_events(organization_id,event_type,deduplication_key,payload)
        VALUES(v_member.organization_id,'financial.reminder','financial.reminder:'||v_member.member_id||':'||v_kind||':'||v_date,
          jsonb_build_object('member_id',v_member.member_id,'category',v_kind,'scheduled_date',v_date)) ON CONFLICT(organization_id,deduplication_key) DO NOTHING;
      GET DIAGNOSTICS v_count=ROW_COUNT;v_queued:=v_queued+v_count;
    END IF;
    IF v_member.email_bill_reminders AND finance_private.member_has_permission(v_member.organization_id,v_member.member_id,'purchases.read') AND EXISTS(
      SELECT 1 FROM finance.open_items oi
      JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
      JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
      JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id AND d.state='posted'
      WHERE oi.organization_id=v_member.organization_id AND oi.control_kind='ap' AND oi.side='credit'
        AND d.document_type='bill' AND oi.due_date<=v_member.local_date
        AND finance_private.open_item_balance_at(v_member.organization_id,oi.id,v_member.local_date,v_now)>0
    ) THEN
      v_kind:='bill_due';v_date:=v_member.local_date;
      INSERT INTO finance.outbox_events(organization_id,event_type,deduplication_key,payload)
        VALUES(v_member.organization_id,'financial.reminder','financial.reminder:'||v_member.member_id||':'||v_kind||':'||v_date,
          jsonb_build_object('member_id',v_member.member_id,'category',v_kind,'scheduled_date',v_date)) ON CONFLICT(organization_id,deduplication_key) DO NOTHING;
      GET DIAGNOSTICS v_count=ROW_COUNT;v_queued:=v_queued+v_count;
    END IF;
  END LOOP;
  RETURN v_queued;
END $$;
REVOKE ALL ON FUNCTION finance_private.enqueue_due_notification_reminders() FROM PUBLIC,ams_runtime;
GRANT USAGE ON SCHEMA finance_private TO ams_runtime;
GRANT EXECUTE ON FUNCTION finance_private.enqueue_due_notification_reminders() TO ams_runtime;

CREATE FUNCTION finance_private.read_claimed_financial_reminder(p_event_id uuid,p_lease_token uuid)
RETURNS TABLE(event_id uuid,organization_id uuid,organization_name text,category text,scheduled_date date,recipient text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_event finance.outbox_events%ROWTYPE;v_member uuid;v_category text;v_date date;v_today date;
BEGIN
  SELECT * INTO v_event FROM finance.outbox_events e WHERE e.id=p_event_id AND e.event_type='financial.reminder'
    AND e.status='processing' AND e.lease_token=p_lease_token AND e.lease_until>clock_timestamp();
  IF NOT FOUND THEN RETURN; END IF;
  IF jsonb_typeof(v_event.payload) IS DISTINCT FROM 'object' THEN RETURN; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(v_event.payload))<>3 OR
     NOT (v_event.payload ?& ARRAY['member_id','category','scheduled_date']) OR
     COALESCE(v_event.payload->>'member_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
     COALESCE(v_event.payload->>'scheduled_date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN; END IF;
  v_member:=(v_event.payload->>'member_id')::uuid;v_category:=v_event.payload->>'category';v_date:=(v_event.payload->>'scheduled_date')::date;
  IF v_category NOT IN ('approval','invoice_due','bill_due') THEN RETURN; END IF;
  SELECT (clock_timestamp() AT TIME ZONE o.timezone)::date INTO v_today FROM finance.organizations o
    WHERE o.id=v_event.organization_id AND o.status='active';
  IF NOT FOUND OR v_today IS NULL OR v_date>v_today THEN RETURN; END IF;
  RETURN QUERY SELECT v_event.id,v_event.organization_id,o.name,v_category,v_date,u.email_normalized
    FROM finance.organization_members m JOIN finance.organizations o ON o.id=m.organization_id AND o.status='active'
    JOIN identity.users u ON u.id=m.user_id AND u.disabled_at IS NULL AND u.email_verified_at IS NOT NULL
    JOIN finance.notification_preferences p ON p.organization_id=m.organization_id AND p.member_id=m.id
    WHERE m.organization_id=v_event.organization_id AND m.id=v_member AND m.status='active'
      AND CASE v_category WHEN 'approval' THEN p.email_approvals AND finance_private.member_has_permission(m.organization_id,m.id,'approvals.read')
        WHEN 'invoice_due' THEN p.email_invoice_reminders AND finance_private.member_has_permission(m.organization_id,m.id,'sales.read')
        WHEN 'bill_due' THEN p.email_bill_reminders AND finance_private.member_has_permission(m.organization_id,m.id,'purchases.read') END
      AND CASE v_category
        WHEN 'approval' THEN EXISTS(SELECT 1 FROM finance.approval_requests r JOIN finance.business_documents d
          ON d.organization_id=r.organization_id AND d.id=r.document_id WHERE r.organization_id=m.organization_id
          AND r.state='pending' AND d.state='pending_approval' AND d.version=r.document_version AND d.material_digest=r.document_digest
          AND finance_private.member_can_read_document(m.organization_id,d.id,m.id))
        WHEN 'invoice_due' THEN EXISTS(SELECT 1 FROM finance.open_items oi JOIN finance.journal_lines jl
          ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id JOIN finance.journal_entries je
          ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
          JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id AND d.state='posted'
          WHERE oi.organization_id=m.organization_id AND oi.control_kind='ar' AND oi.side='debit' AND d.document_type='invoice'
            AND oi.due_date<=v_today AND finance_private.open_item_balance_at(m.organization_id,oi.id,v_today,clock_timestamp())>0)
        WHEN 'bill_due' THEN EXISTS(SELECT 1 FROM finance.open_items oi JOIN finance.journal_lines jl
          ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id JOIN finance.journal_entries je
          ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
          JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id AND d.state='posted'
          WHERE oi.organization_id=m.organization_id AND oi.control_kind='ap' AND oi.side='credit' AND d.document_type='bill'
            AND oi.due_date<=v_today AND finance_private.open_item_balance_at(m.organization_id,oi.id,v_today,clock_timestamp())>0)
      END;
END $$;
REVOKE ALL ON FUNCTION finance_private.read_claimed_financial_reminder(uuid,uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION finance_private.read_claimed_financial_reminder(uuid,uuid) TO ams_runtime;
NOTIFY pgrst,'reload schema';
