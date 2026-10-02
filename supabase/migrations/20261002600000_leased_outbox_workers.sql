-- US-069: bounded organization-scoped leases for at-least-once outbox delivery.
BEGIN;

ALTER TABLE finance.outbox_events ADD COLUMN lease_owner uuid;
CREATE INDEX outbox_lease_owner_idx ON finance.outbox_events (organization_id, lease_owner)
  WHERE status='processing';

CREATE OR REPLACE FUNCTION finance_private.guard_outbox_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' OR (NEW.organization_id,NEW.id,NEW.event_type,NEW.document_id,NEW.deduplication_key,NEW.payload,NEW.created_at)
    IS DISTINCT FROM (OLD.organization_id,OLD.id,OLD.event_type,OLD.document_id,OLD.deduplication_key,OLD.payload,OLD.created_at) THEN
    RAISE EXCEPTION 'outbox event identity and payload are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status='delivered' OR NEW.attempt_count<OLD.attempt_count OR NEW.attempt_count>OLD.attempt_count+1 OR
     NOT ((OLD.status='pending' AND NEW.status='processing') OR
       (OLD.status='processing' AND NEW.status IN ('pending','delivered','failed')) OR
       (OLD.status='processing' AND NEW.status='processing' AND OLD.lease_until<=clock_timestamp()) OR
       (OLD.status='failed' AND NEW.status='pending')) OR
     (NEW.status='processing' AND (NEW.lease_until IS NULL OR NEW.lease_owner IS NULL)) OR
     (NEW.status<>'processing' AND (NEW.lease_until IS NOT NULL OR NEW.lease_owner IS NOT NULL)) THEN
    RAISE EXCEPTION 'invalid outbox delivery transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_outbox_update() FROM PUBLIC,anon,authenticated,service_role,ams_job_worker;

CREATE FUNCTION public.claim_outbox_events(
  p_organization_id uuid,p_worker_id uuid,p_limit integer DEFAULT 20,p_lease_seconds integer DEFAULT 300
) RETURNS TABLE(id uuid,organization_id uuid,event_type text,document_id uuid,deduplication_key text,payload jsonb,attempt_count integer,lease_until timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_organization_id IS NULL OR p_worker_id IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR p_lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION 'invalid outbox claim scope' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT e.id FROM finance.outbox_events e
    WHERE e.organization_id=p_organization_id AND e.attempt_count<8 AND
      ((e.status='pending' AND e.available_at<=clock_timestamp()) OR (e.status='processing' AND e.lease_until<=clock_timestamp()))
    ORDER BY e.available_at,e.created_at,e.id
    LIMIT p_limit FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE finance.outbox_events e SET status='processing',attempt_count=e.attempt_count+1,
      lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),lease_owner=p_worker_id
    FROM candidates c WHERE e.organization_id=p_organization_id AND e.id=c.id
    RETURNING e.id,e.organization_id,e.event_type,e.document_id,e.deduplication_key,e.payload,e.attempt_count,e.lease_until
  ) SELECT c.id,c.organization_id,c.event_type,c.document_id,c.deduplication_key,c.payload,c.attempt_count,c.lease_until FROM claimed c;
END $$;
REVOKE ALL ON FUNCTION public.claim_outbox_events(uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_outbox_events(uuid,uuid,integer,integer) TO service_role,ams_job_worker;

CREATE FUNCTION public.ack_outbox_event(p_organization_id uuid,p_event_id uuid,p_worker_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_count integer;
BEGIN
  IF p_organization_id IS NULL OR p_event_id IS NULL OR p_worker_id IS NULL THEN RAISE EXCEPTION 'invalid outbox acknowledgement' USING ERRCODE='22023'; END IF;
  UPDATE finance.outbox_events SET status='delivered',lease_until=NULL,lease_owner=NULL
    WHERE organization_id=p_organization_id AND id=p_event_id AND status='processing' AND lease_owner=p_worker_id AND lease_until>clock_timestamp();
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>1 THEN RAISE EXCEPTION 'outbox lease is no longer owned' USING ERRCODE='55P03'; END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.ack_outbox_event(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ack_outbox_event(uuid,uuid,uuid) TO service_role,ams_job_worker;

CREATE FUNCTION public.fail_outbox_event(p_organization_id uuid,p_event_id uuid,p_worker_id uuid,p_error_code text,p_retryable boolean DEFAULT true)
RETURNS TABLE(status text,available_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_event finance.outbox_events%ROWTYPE; v_status text; v_available timestamptz;
BEGIN
  IF p_organization_id IS NULL OR p_event_id IS NULL OR p_worker_id IS NULL OR p_error_code IS NULL OR p_error_code !~ '^[A-Z][A-Z0-9_]{0,79}$' THEN
    RAISE EXCEPTION 'invalid outbox failure metadata' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_event FROM finance.outbox_events e WHERE e.organization_id=p_organization_id AND e.id=p_event_id
    AND e.status='processing' AND e.lease_owner=p_worker_id AND e.lease_until>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'outbox lease is no longer owned' USING ERRCODE='55P03'; END IF;
  v_status:=CASE WHEN p_retryable AND v_event.attempt_count<8 THEN 'pending' ELSE 'failed' END;
  v_available:=CASE WHEN v_status='pending' THEN clock_timestamp()+make_interval(secs=>LEAST(3600,5*(2^LEAST(v_event.attempt_count-1,10))::integer)) ELSE v_event.available_at END;
  UPDATE finance.outbox_events SET status=v_status,available_at=v_available,last_error_code=p_error_code,lease_until=NULL,lease_owner=NULL
    WHERE organization_id=p_organization_id AND id=p_event_id;
  RETURN QUERY SELECT v_status,v_available;
END $$;
REVOKE ALL ON FUNCTION public.fail_outbox_event(uuid,uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fail_outbox_event(uuid,uuid,uuid,text,boolean) TO service_role,ams_job_worker;

CREATE FUNCTION public.list_failed_outbox_events(p_organization_id uuid,p_limit integer DEFAULT 50)
RETURNS TABLE(id uuid,event_type text,document_id uuid,attempt_count integer,error_code text,created_at timestamptz,available_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_organization_id IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid outbox dead-letter scope' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT e.id,e.event_type,e.document_id,e.attempt_count,e.last_error_code,e.created_at,e.available_at
    FROM finance.outbox_events e WHERE e.organization_id=p_organization_id AND e.status='failed'
    ORDER BY e.created_at DESC,e.id DESC LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.list_failed_outbox_events(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_failed_outbox_events(uuid,integer) TO service_role,ams_job_worker;

COMMENT ON FUNCTION public.claim_outbox_events(uuid,uuid,integer,integer) IS 'Claims only events for the supplied organization under a bounded lease; worker uses event deduplication_key for external idempotency.';
COMMENT ON FUNCTION public.ack_outbox_event(uuid,uuid,uuid) IS 'Acknowledges delivery only while the supplied worker still owns an unexpired organization-scoped lease.';
COMMENT ON FUNCTION public.fail_outbox_event(uuid,uuid,uuid,text,boolean) IS 'Stores safe error codes only and retries with capped exponential backoff; terminal events remain visible through list_failed_outbox_events.';
NOTIFY pgrst,'reload schema';
COMMIT;
