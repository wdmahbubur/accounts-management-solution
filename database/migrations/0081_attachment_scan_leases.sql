-- US-068: lease attachment objects to the restricted scanner worker. Uploaded
-- bytes remain inaccessible until a worker records a digest-matched decision.
ALTER TABLE finance.attachments
  ADD COLUMN scan_attempt_count integer NOT NULL DEFAULT 0
    CHECK (scan_attempt_count BETWEEN 0 AND 8),
  ADD COLUMN scan_available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN scan_lease_token uuid,
  ADD COLUMN scan_lease_until timestamptz,
  ADD COLUMN scan_error_code text,
  ADD COLUMN scanned_at timestamptz,
  ADD COLUMN scan_engine_version text;

CREATE INDEX attachments_scan_queue_idx
  ON finance.attachments (scan_available_at,created_at,id)
  WHERE scan_status='pending' AND scan_attempt_count<8;

CREATE FUNCTION finance_private.claim_attachment_scans(
  p_limit integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 300
) RETURNS TABLE(
  attachment_id uuid,
  organization_id uuid,
  object_key text,
  byte_size bigint,
  sha256 text,
  lease_token uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_now timestamptz:=clock_timestamp();
BEGIN
  IF p_limit NOT BETWEEN 1 AND 25 OR p_lease_seconds NOT BETWEEN 60 AND 1800 THEN
    RAISE EXCEPTION 'invalid attachment scan claim' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
  WITH ready AS (
    SELECT a.organization_id,a.id
    FROM finance.attachments a
    WHERE a.scan_status='pending' AND a.scan_attempt_count<8
      AND a.scan_available_at<=v_now
      AND (a.scan_lease_until IS NULL OR a.scan_lease_until<=v_now)
      AND a.object_key=a.organization_id::text||'/attachments/'||a.id::text
    ORDER BY a.scan_available_at,a.created_at,a.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ), claimed AS (
    UPDATE finance.attachments a SET
      scan_attempt_count=a.scan_attempt_count+1,
      scan_lease_token=gen_random_uuid(),
      scan_lease_until=v_now+make_interval(secs=>p_lease_seconds),
      scan_error_code=NULL
    FROM ready r
    WHERE a.organization_id=r.organization_id AND a.id=r.id
    RETURNING a.id,a.organization_id,a.object_key,a.byte_size,a.sha256,a.scan_lease_token
  )
  SELECT c.id,c.organization_id,c.object_key,c.byte_size,c.sha256,c.scan_lease_token
  FROM claimed c;
END $$;
REVOKE ALL ON FUNCTION finance_private.claim_attachment_scans(integer,integer)
  FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION finance_private.claim_attachment_scans(integer,integer)
  TO ams_job_worker;

CREATE FUNCTION finance_private.finish_attachment_scan(
  p_organization_id uuid,
  p_attachment_id uuid,
  p_lease_token uuid,
  p_decision text,
  p_observed_sha256 text,
  p_engine_version text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN ('clean','rejected')
    OR p_observed_sha256 IS NULL OR p_observed_sha256 !~ '^[0-9a-f]{64}$'
    OR p_engine_version IS NULL OR p_engine_version !~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,99}$' THEN
    RAISE EXCEPTION 'invalid attachment scan result' USING ERRCODE='22023';
  END IF;
  UPDATE finance.attachments a SET
    scan_status=p_decision,
    scanned_at=clock_timestamp(),
    scan_engine_version=p_engine_version,
    scan_error_code=NULL,
    scan_lease_token=NULL,
    scan_lease_until=NULL
  WHERE a.organization_id=p_organization_id AND a.id=p_attachment_id
    AND a.object_key=a.organization_id::text||'/attachments/'||a.id::text
    AND a.scan_status='pending'
    AND a.sha256=p_observed_sha256
    AND a.scan_lease_token=p_lease_token
    AND a.scan_lease_until>clock_timestamp();
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION finance_private.finish_attachment_scan(uuid,uuid,uuid,text,text,text)
  FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION finance_private.finish_attachment_scan(uuid,uuid,uuid,text,text,text)
  TO ams_job_worker;

CREATE FUNCTION finance_private.fail_attachment_scan(
  p_organization_id uuid,
  p_attachment_id uuid,
  p_lease_token uuid,
  p_error_code text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_attempt integer;v_delay integer;v_now timestamptz:=clock_timestamp();
BEGIN
  IF p_error_code IS NULL OR p_error_code NOT IN ('CLAMAV_UNAVAILABLE','SCAN_TIMEOUT','SCAN_PROTOCOL_ERROR',
      'OBJECT_READ_ERROR','OBJECT_DIGEST_MISMATCH','SCAN_WORKER_ERROR') THEN
    RAISE EXCEPTION 'invalid attachment scan error code' USING ERRCODE='22023';
  END IF;
  SELECT a.scan_attempt_count INTO v_attempt
  FROM finance.attachments a
  WHERE a.organization_id=p_organization_id AND a.id=p_attachment_id
    AND a.object_key=a.organization_id::text||'/attachments/'||a.id::text
    AND a.scan_status='pending' AND a.scan_lease_token=p_lease_token
    AND a.scan_lease_until>v_now
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF v_attempt>=8 THEN
    -- Exhaustion fails closed; it is not represented as a clean scan.
    UPDATE finance.attachments SET scan_status='rejected',scanned_at=v_now,
      scan_error_code='SCAN_RETRIES_EXHAUSTED',scan_lease_token=NULL,scan_lease_until=NULL
    WHERE organization_id=p_organization_id AND id=p_attachment_id;
  ELSE
    v_delay:=LEAST(21600,30*(2^LEAST(v_attempt-1,9))::integer);
    UPDATE finance.attachments SET scan_available_at=v_now+make_interval(secs=>v_delay),
      scan_error_code=p_error_code,scan_lease_token=NULL,scan_lease_until=NULL
    WHERE organization_id=p_organization_id AND id=p_attachment_id;
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION finance_private.fail_attachment_scan(uuid,uuid,uuid,text)
  FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION finance_private.fail_attachment_scan(uuid,uuid,uuid,text)
  TO ams_job_worker;

NOTIFY pgrst,'reload schema';
