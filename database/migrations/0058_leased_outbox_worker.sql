-- US-069: bounded leases, fenced acknowledgements and retryable delivery state.
ALTER TABLE finance.outbox_events ADD COLUMN lease_token uuid;

CREATE OR REPLACE FUNCTION finance_private.guard_outbox_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' OR (NEW.organization_id,NEW.id,NEW.event_type,NEW.document_id,NEW.deduplication_key,NEW.payload,NEW.created_at)
    IS DISTINCT FROM (OLD.organization_id,OLD.id,OLD.event_type,OLD.document_id,OLD.deduplication_key,OLD.payload,OLD.created_at) THEN
    RAISE EXCEPTION 'outbox event identity and payload are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status='delivered' OR NEW.attempt_count<OLD.attempt_count OR NEW.attempt_count>OLD.attempt_count+1 OR
    NOT ((OLD.status='pending' AND NEW.status IN ('processing','failed')) OR
      (OLD.status='processing' AND NEW.status IN ('pending','processing','delivered','failed')) OR
      (OLD.status='failed' AND NEW.status='pending')) OR
    (NEW.status='processing' AND (NEW.lease_until IS NULL OR NEW.lease_token IS NULL)) OR
    (NEW.status<>'processing' AND (NEW.lease_until IS NOT NULL OR NEW.lease_token IS NOT NULL)) OR
    (NEW.status='processing' AND OLD.status='processing' AND OLD.lease_until>clock_timestamp()) THEN
    RAISE EXCEPTION 'invalid outbox delivery transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION finance_private.claim_outbox_batch(p_event_types text[],p_limit integer,p_lease_seconds integer)
RETURNS TABLE(event_id uuid,organization_id uuid,organization_name text,event_type text,document_id uuid,
  payload jsonb,attempt_count integer,lease_token uuid,recipient text,invitation_role text,token_hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_now timestamptz:=clock_timestamp();
BEGIN
  IF p_limit NOT BETWEEN 1 AND 25 OR p_lease_seconds NOT BETWEEN 30 AND 900 OR
    p_event_types IS NULL OR cardinality(p_event_types)=0 OR
    EXISTS(SELECT 1 FROM unnest(p_event_types) AS e(kind) WHERE e.kind NOT IN ('invitation.send','document.send_requested')) THEN
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

CREATE FUNCTION finance_private.complete_outbox_delivery(p_event_id uuid,p_lease_token uuid,p_provider_message_id text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_event finance.outbox_events%ROWTYPE;v_now timestamptz:=clock_timestamp();
BEGIN
  SELECT * INTO v_event FROM finance.outbox_events e WHERE e.id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.status<>'processing' OR v_event.lease_token IS DISTINCT FROM p_lease_token OR v_event.lease_until<=v_now THEN
    RAISE EXCEPTION 'worker lease unavailable' USING ERRCODE='40001'; END IF;
  IF p_provider_message_id IS NOT NULL AND length(p_provider_message_id)>255 THEN RAISE EXCEPTION 'invalid provider receipt' USING ERRCODE='22023'; END IF;
  UPDATE finance.notification_deliveries SET status='sent',delivered_at=v_now,provider_message_id=p_provider_message_id
    WHERE organization_id=v_event.organization_id AND outbox_event_id=v_event.id AND status='queued';
  UPDATE finance.outbox_events SET status='delivered',lease_until=NULL,lease_token=NULL WHERE id=v_event.id;
END $$;
REVOKE ALL ON FUNCTION finance_private.complete_outbox_delivery(uuid,uuid,text) FROM PUBLIC,ams_runtime;

CREATE FUNCTION finance_private.fail_outbox_delivery(p_event_id uuid,p_lease_token uuid,p_error_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_event finance.outbox_events%ROWTYPE;v_now timestamptz:=clock_timestamp();v_delay integer;
BEGIN
  IF p_error_code IS NULL OR p_error_code !~ '^[A-Z][A-Z0-9_]{2,63}$' THEN RAISE EXCEPTION 'invalid worker error code' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_event FROM finance.outbox_events e WHERE e.id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.status<>'processing' OR v_event.lease_token IS DISTINCT FROM p_lease_token OR v_event.lease_until<=v_now THEN
    RAISE EXCEPTION 'worker lease unavailable' USING ERRCODE='40001'; END IF;
  v_delay:=LEAST(43200,30*(2^LEAST(v_event.attempt_count-1,10))::integer);
  UPDATE finance.notification_deliveries SET status='failed'
    WHERE organization_id=v_event.organization_id AND outbox_event_id=v_event.id AND status='queued';
  UPDATE finance.outbox_events SET status=CASE WHEN v_event.attempt_count>=8 THEN 'failed' ELSE 'pending' END,
    available_at=v_now+make_interval(secs=>v_delay),lease_until=NULL,lease_token=NULL,last_error_code=p_error_code WHERE id=v_event.id;
END $$;
REVOKE ALL ON FUNCTION finance_private.fail_outbox_delivery(uuid,uuid,text) FROM PUBLIC,ams_runtime;

CREATE FUNCTION finance_private.read_outbox_dead_letters(p_limit integer DEFAULT 50)
RETURNS TABLE(event_id uuid,organization_id uuid,organization_name text,event_type text,attempt_count integer,error_code text,created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid worker result limit' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT e.id,e.organization_id,o.name,e.event_type,e.attempt_count,e.last_error_code,e.created_at
    FROM finance.outbox_events e JOIN finance.organizations o ON o.id=e.organization_id
    WHERE e.status='failed' ORDER BY e.created_at DESC,e.id DESC LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION finance_private.read_outbox_dead_letters(integer) FROM PUBLIC,ams_runtime;
GRANT USAGE ON SCHEMA finance_private TO ams_runtime;
GRANT EXECUTE ON FUNCTION finance_private.claim_outbox_batch(text[],integer,integer) TO ams_runtime;
GRANT EXECUTE ON FUNCTION finance_private.complete_outbox_delivery(uuid,uuid,text) TO ams_runtime;
GRANT EXECUTE ON FUNCTION finance_private.fail_outbox_delivery(uuid,uuid,text) TO ams_runtime;
GRANT EXECUTE ON FUNCTION finance_private.read_outbox_dead_letters(integer) TO ams_runtime;

CREATE OR REPLACE FUNCTION finance_private.cancel_invitation_delivery(p_invitation_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  UPDATE finance.outbox_events SET payload=payload-'delivery',
    status=CASE WHEN status IN ('pending','processing') THEN 'failed' ELSE status END,
    lease_until=NULL,lease_token=NULL,
    last_error_code=CASE WHEN status IN ('pending','processing') THEN 'INVITATION_SUPERSEDED' ELSE last_error_code END
  WHERE event_type='invitation.send' AND payload->>'invitation_id'=p_invitation_id::text
$$;
REVOKE ALL ON FUNCTION finance_private.cancel_invitation_delivery(uuid) FROM PUBLIC,ams_runtime;
NOTIFY pgrst,'reload schema';
