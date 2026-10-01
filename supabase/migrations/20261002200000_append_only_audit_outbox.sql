-- US-020: append-only business audit and transaction-local outbox primitives.
BEGIN;

CREATE FUNCTION finance_private.audit_change_has_sensitive_key(p_value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_entry record;
BEGIN
  IF jsonb_typeof(p_value)='object' THEN
    FOR v_entry IN SELECT key,value FROM jsonb_each(p_value) LOOP
      IF v_entry.key ~* '(password|secret|token|credential|authorization|cookie|attachment|file[_-]?content|other[_-]?organization)' THEN RETURN true; END IF;
      IF finance_private.audit_change_has_sensitive_key(v_entry.value) THEN RETURN true; END IF;
    END LOOP;
  ELSIF jsonb_typeof(p_value)='array' THEN
    FOR v_entry IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      IF finance_private.audit_change_has_sensitive_key(v_entry.value) THEN RETURN true; END IF;
    END LOOP;
  END IF;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION finance_private.audit_change_has_sensitive_key(jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION finance_private.append_financial_audit_event(
  p_organization_id uuid,p_actor_kind text,p_actor_member_id uuid,p_action text,p_entity_type text,p_entity_id uuid,
  p_document_id uuid,p_request_id text,p_source_version_before integer,p_source_version_after integer,
  p_reason text,p_before jsonb,p_after jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_change jsonb; v_id uuid;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_actor_kind NOT IN ('user','system','support') OR (p_actor_kind='user' AND p_actor_member_id IS NULL) OR
     length(btrim(COALESCE(p_action,''))) NOT BETWEEN 1 AND 120 OR length(btrim(COALESCE(p_entity_type,''))) NOT BETWEEN 1 AND 80 OR
     (p_source_version_before IS NOT NULL AND p_source_version_before<1) OR (p_source_version_after IS NOT NULL AND p_source_version_after<1) OR
     (p_reason IS NOT NULL AND length(btrim(p_reason))>1000) THEN
    RAISE EXCEPTION 'invalid audit event fields' USING ERRCODE='22023';
  END IF;
  v_change:=jsonb_build_object('source_version_before',p_source_version_before,'source_version_after',p_source_version_after,
    'before',p_before,'after',p_after);
  IF octet_length(v_change::text)>8192 OR finance_private.audit_change_has_sensitive_key(v_change) THEN
    RAISE EXCEPTION 'audit metadata is too large or contains a protected field' USING ERRCODE='22023';
  END IF;
  IF p_document_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id) THEN
    RAISE EXCEPTION 'audit document is unavailable in this company' USING ERRCODE='23503';
  END IF;
  INSERT INTO finance.audit_events(organization_id,actor_member_id,actor_kind,action,entity_type,entity_id,document_id,request_id,reason,redacted_change)
    VALUES(p_organization_id,p_actor_member_id,p_actor_kind,p_action,p_entity_type,p_entity_id,p_document_id,p_request_id,NULLIF(btrim(p_reason),''),v_change)
    RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION finance_private.append_financial_audit_event(uuid,text,uuid,text,text,uuid,uuid,text,integer,integer,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;

-- Keep the established audit interface; enrich document events with source versions and preserve all writes in one transaction.
CREATE OR REPLACE FUNCTION finance_private.write_role_audit(
  p_organization_id uuid,p_actor_member_id uuid,p_action text,p_entity_type text,p_entity_id uuid,p_request_id text,p_change jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_after_version integer; v_before_version integer; v_document_id uuid; v_reason text;
BEGIN
  IF p_change ? 'to_version' THEN v_after_version:=NULLIF(p_change->>'to_version','')::integer;
  ELSIF p_change ? 'version' THEN v_after_version:=NULLIF(p_change->>'version','')::integer;
  ELSIF p_change ? 'row_version' THEN v_after_version:=NULLIF(p_change->>'row_version','')::integer; END IF;
  IF p_change ? 'from_version' THEN v_before_version:=NULLIF(p_change->>'from_version','')::integer;
  ELSIF p_entity_type='business_document' AND p_action IN ('document.draft.update','document.allocation-plan.update') AND v_after_version>1 THEN v_before_version:=v_after_version-1; END IF;
  IF p_entity_type='business_document' THEN v_document_id:=p_entity_id; END IF;
  v_reason:=COALESCE(NULLIF(p_change->>'reason',''),CASE WHEN p_action IN ('document.draft.create','document.draft.update','document.allocation-plan.update')
    THEN 'Source draft changed through an authorized command.' END);
  PERFORM finance_private.append_financial_audit_event(p_organization_id,'user',p_actor_member_id,p_action,p_entity_type,p_entity_id,
    v_document_id,p_request_id,v_before_version,v_after_version,v_reason,p_change->'before',COALESCE(p_change->'after',p_change));
END $$;
REVOKE ALL ON FUNCTION finance_private.write_role_audit(uuid,uuid,text,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION finance_private.enqueue_outbox_event(
  p_organization_id uuid,p_event_type text,p_document_id uuid,p_deduplication_key text,p_payload jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; v_existing finance.outbox_events%ROWTYPE;
BEGIN
  IF p_event_type NOT IN ('document.posted','document.send_requested','report.export_requested','import.validation_requested','subscription.event_received','invitation.send') OR
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
REVOKE ALL ON FUNCTION finance_private.enqueue_outbox_event(uuid,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION finance_private.reject_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'business audit events are append-only' USING ERRCODE='23514'; END $$;
REVOKE ALL ON FUNCTION finance_private.reject_audit_mutation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON finance.audit_events
  FOR EACH ROW EXECUTE FUNCTION finance_private.reject_audit_mutation();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON finance.audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION finance_private.reject_audit_mutation();

CREATE FUNCTION finance_private.guard_outbox_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' OR (NEW.organization_id,NEW.id,NEW.event_type,NEW.document_id,NEW.deduplication_key,NEW.payload,NEW.created_at)
    IS DISTINCT FROM (OLD.organization_id,OLD.id,OLD.event_type,OLD.document_id,OLD.deduplication_key,OLD.payload,OLD.created_at) THEN
    RAISE EXCEPTION 'outbox event identity and payload are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status='delivered' OR NEW.attempt_count<OLD.attempt_count OR NEW.attempt_count>OLD.attempt_count+1 OR
     NOT ((OLD.status='pending' AND NEW.status='processing') OR (OLD.status='processing' AND NEW.status IN ('pending','delivered','failed')) OR
          (OLD.status='failed' AND NEW.status='pending')) OR
     (NEW.status='processing' AND NEW.lease_until IS NULL) THEN
    RAISE EXCEPTION 'invalid outbox delivery transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_outbox_update() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER outbox_events_guard_update BEFORE UPDATE OR DELETE ON finance.outbox_events
  FOR EACH ROW EXECUTE FUNCTION finance_private.guard_outbox_update();
CREATE TRIGGER outbox_events_no_truncate BEFORE TRUNCATE ON finance.outbox_events
  FOR EACH STATEMENT EXECUTE FUNCTION finance_private.reject_audit_mutation();

NOTIFY pgrst,'reload schema';
COMMIT;
