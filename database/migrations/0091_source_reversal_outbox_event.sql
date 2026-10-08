-- A source reversal records its journal and document.reversed outbox event atomically.
-- Permit that existing financial-record event without changing delivery consumers or guards.

CREATE OR REPLACE FUNCTION finance_private.enqueue_outbox_event(
  p_organization_id uuid,p_event_type text,p_document_id uuid,p_deduplication_key text,p_payload jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; v_existing finance.outbox_events%ROWTYPE;
BEGIN
  IF p_event_type NOT IN ('document.posted','document.reversed','document.send_requested','report.export_requested','import.validation_requested','subscription.event_received','invitation.send') OR
     p_deduplication_key IS NULL OR length(p_deduplication_key) NOT BETWEEN 1 AND 200 OR
     jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>32768 OR
     finance_private.audit_change_has_sensitive_key(p_payload) THEN
    RAISE EXCEPTION 'invalid or sensitive outbox event' USING ERRCODE='22023';
  END IF;
  INSERT INTO finance.outbox_events(organization_id,event_type,document_id,deduplication_key,payload)
    VALUES(p_organization_id,p_event_type,p_document_id,p_deduplication_key,p_payload)
    ON CONFLICT(organization_id,deduplication_key) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT * INTO v_existing FROM finance.outbox_events e WHERE e.organization_id=p_organization_id
    AND e.deduplication_key=p_deduplication_key FOR UPDATE;
  IF NOT FOUND OR v_existing.event_type<>p_event_type OR v_existing.document_id IS DISTINCT FROM p_document_id OR v_existing.payload IS DISTINCT FROM p_payload THEN
    RAISE EXCEPTION 'outbox deduplication key reused with different event data' USING ERRCODE='23505';
  END IF;
  RETURN v_existing.id;
END $$;
REVOKE ALL ON FUNCTION finance_private.enqueue_outbox_event(uuid,text,uuid,text,jsonb) FROM PUBLIC,ams_runtime;
