-- US-073: claim and deliver generic reminders through the same fenced outbox.
CREATE OR REPLACE FUNCTION finance_private.claim_outbox_batch(p_event_types text[],p_limit integer,p_lease_seconds integer)
RETURNS TABLE(event_id uuid,organization_id uuid,organization_name text,event_type text,document_id uuid,
  payload jsonb,attempt_count integer,lease_token uuid,recipient text,invitation_role text,token_hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_now timestamptz:=clock_timestamp();
BEGIN
  IF p_limit NOT BETWEEN 1 AND 25 OR p_lease_seconds NOT BETWEEN 30 AND 900 OR
    p_event_types IS NULL OR cardinality(p_event_types)=0 OR
    EXISTS(SELECT 1 FROM unnest(p_event_types) AS e(kind)
      WHERE e.kind NOT IN ('invitation.send','document.send_requested','financial.reminder')) THEN
    RAISE EXCEPTION 'invalid worker claim filters' USING ERRCODE='22023';
  END IF;
  UPDATE finance.outbox_events e SET status='failed',lease_until=NULL,lease_token=NULL,last_error_code='LEASE_EXPIRED_MAX_ATTEMPTS'
    WHERE e.status='processing' AND e.lease_until<=v_now AND e.attempt_count>=8 AND e.event_type=ANY(p_event_types);
  UPDATE finance.outbox_events e SET status='failed',last_error_code='INVITATION_NOT_DELIVERABLE'
    WHERE e.status='pending' AND e.event_type='invitation.send' AND 'invitation.send'=ANY(p_event_types)
      AND NOT EXISTS(SELECT 1 FROM finance.invitations i WHERE i.organization_id=e.organization_id
        AND i.id=(e.payload->>'invitation_id')::uuid AND i.status='pending' AND i.expires_at>v_now
        AND i.generation=(e.payload->>'generation')::integer);
  RETURN QUERY
  WITH ready AS (
    SELECT e.organization_id,e.id FROM finance.outbox_events e
    WHERE e.event_type=ANY(p_event_types) AND e.attempt_count<8 AND
      ((e.status='pending' AND e.available_at<=v_now) OR (e.status='processing' AND e.lease_until<=v_now))
    ORDER BY e.available_at,e.created_at,e.id FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), claimed AS (
    UPDATE finance.outbox_events e SET status='processing',attempt_count=e.attempt_count+1,
      lease_until=v_now+make_interval(secs=>p_lease_seconds),lease_token=gen_random_uuid(),last_error_code=NULL
    FROM ready r WHERE e.organization_id=r.organization_id AND e.id=r.id
    RETURNING e.id,e.organization_id,e.event_type,e.document_id,e.payload,e.attempt_count,e.lease_token
  )
  SELECT c.id,c.organization_id,o.name,c.event_type,c.document_id,c.payload,c.attempt_count,c.lease_token,
    CASE WHEN c.event_type='invitation.send' THEN i.email_normalized END,
    CASE WHEN c.event_type='invitation.send' THEN r.name END,
    CASE WHEN c.event_type='invitation.send' THEN i.token_hash END
  FROM claimed c JOIN finance.organizations o ON o.id=c.organization_id
  LEFT JOIN finance.invitations i ON c.event_type='invitation.send' AND i.organization_id=c.organization_id
    AND i.id=(c.payload->>'invitation_id')::uuid AND i.status='pending' AND i.expires_at>v_now
    AND i.generation=(c.payload->>'generation')::integer
  LEFT JOIN finance.roles r ON r.organization_id=i.organization_id AND r.id=i.role_id;
  INSERT INTO finance.notification_deliveries(organization_id,outbox_event_id,document_id,channel,recipient,status)
    SELECT e.organization_id,e.id,e.document_id,'email',i.email_normalized,'queued'
    FROM finance.outbox_events e JOIN finance.invitations i ON i.organization_id=e.organization_id
      AND i.id=(e.payload->>'invitation_id')::uuid
      AND i.status='pending' AND i.expires_at>v_now AND i.generation=(e.payload->>'generation')::integer
    WHERE e.status='processing' AND e.lease_until>v_now AND e.event_type='invitation.send'
    ON CONFLICT(organization_id,outbox_event_id,channel,recipient) DO UPDATE
      SET status='queued',delivered_at=NULL,provider_message_id=NULL
      WHERE finance.notification_deliveries.status='failed';
END $$;
REVOKE ALL ON FUNCTION finance_private.claim_outbox_batch(text[],integer,integer) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION finance_private.claim_outbox_batch(text[],integer,integer) TO ams_runtime;

CREATE FUNCTION finance_private.queue_claimed_reminder_delivery() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_recipient text;
BEGIN
  IF NEW.event_type='financial.reminder' AND NEW.status='processing' AND OLD.status IN ('pending','processing') THEN
    SELECT u.email_normalized INTO v_recipient
    FROM finance.organization_members m
    JOIN finance.organizations o ON o.id=m.organization_id AND o.status='active'
    JOIN identity.users u ON u.id=m.user_id AND u.disabled_at IS NULL AND u.email_verified_at IS NOT NULL
    JOIN finance.notification_preferences p ON p.organization_id=m.organization_id AND p.member_id=m.id
    WHERE m.organization_id=NEW.organization_id AND m.id=(NEW.payload->>'member_id')::uuid AND m.status='active'
      AND CASE NEW.payload->>'category'
        WHEN 'approval' THEN p.email_approvals AND finance_private.member_has_permission(m.organization_id,m.id,'approvals.read')
        WHEN 'invoice_due' THEN p.email_invoice_reminders AND finance_private.member_has_permission(m.organization_id,m.id,'sales.read')
        WHEN 'bill_due' THEN p.email_bill_reminders AND finance_private.member_has_permission(m.organization_id,m.id,'purchases.read')
        ELSE false END;
    IF v_recipient IS NOT NULL THEN
      INSERT INTO finance.notification_deliveries(organization_id,outbox_event_id,document_id,channel,recipient,status)
        VALUES(NEW.organization_id,NEW.id,NULL,'email',v_recipient,'queued')
        ON CONFLICT(organization_id,outbox_event_id,channel,recipient) DO UPDATE
          SET status='queued',delivered_at=NULL,provider_message_id=NULL
          WHERE finance.notification_deliveries.status='failed';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.queue_claimed_reminder_delivery() FROM PUBLIC,ams_runtime;
CREATE TRIGGER outbox_reminder_delivery AFTER UPDATE OF status ON finance.outbox_events
  FOR EACH ROW WHEN (NEW.event_type='financial.reminder' AND NEW.status='processing')
  EXECUTE FUNCTION finance_private.queue_claimed_reminder_delivery();
NOTIFY pgrst,'reload schema';
