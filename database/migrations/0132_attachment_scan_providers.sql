-- US-068: retain a cloud scan reference behind the existing organization/lease fence.
-- No provider keys, signed upload fields, filenames or file bytes are stored here.
CREATE TABLE finance_private.attachment_provider_scans (
  organization_id uuid NOT NULL,
  attachment_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider='bouncer'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  remote_id text CHECK (remote_id ~ '^scan_[A-Za-z0-9_-]{8,128}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id,attachment_id,provider),
  UNIQUE (provider,remote_id),
  FOREIGN KEY (organization_id,attachment_id) REFERENCES finance.attachments(organization_id,id) ON DELETE RESTRICT
);
ALTER TABLE finance_private.attachment_provider_scans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance_private.attachment_provider_scans FROM PUBLIC,ams_runtime,ams_job_worker;

CREATE FUNCTION finance_private.begin_attachment_provider_scan(
  p_organization_id uuid,p_attachment_id uuid,p_lease_token uuid,p_provider text,p_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row finance_private.attachment_provider_scans%ROWTYPE;v_created boolean:=false;
BEGIN
  IF p_provider IS DISTINCT FROM 'bouncer' OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid scan provider reference' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM finance.attachments a WHERE a.organization_id=p_organization_id AND a.id=p_attachment_id
    AND a.scan_status='pending' AND a.scan_lease_token=p_lease_token AND a.scan_lease_until>clock_timestamp()
    AND a.sha256=p_sha256 AND a.object_key=a.organization_id::text||'/attachments/'||a.id::text FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'scan lease unavailable' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_row FROM finance_private.attachment_provider_scans s
    WHERE s.organization_id=p_organization_id AND s.attachment_id=p_attachment_id AND s.provider=p_provider;
  IF NOT FOUND THEN
    INSERT INTO finance_private.attachment_provider_scans(organization_id,attachment_id,provider,sha256)
      VALUES(p_organization_id,p_attachment_id,p_provider,p_sha256) RETURNING * INTO v_row;
    v_created:=true;
  END IF;
  IF v_row.sha256<>p_sha256 THEN RAISE EXCEPTION 'scan digest changed' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('created',v_created,'remote_id',v_row.remote_id,'created_at',v_row.created_at);
END $$;

CREATE FUNCTION finance_private.record_attachment_provider_scan(
  p_organization_id uuid,p_attachment_id uuid,p_lease_token uuid,p_provider text,p_sha256 text,p_remote_id text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_provider IS DISTINCT FROM 'bouncer' OR p_remote_id IS NULL OR p_remote_id !~ '^scan_[A-Za-z0-9_-]{8,128}$' THEN
    RAISE EXCEPTION 'invalid scan provider reference' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM finance.attachments a WHERE a.organization_id=p_organization_id AND a.id=p_attachment_id
    AND a.scan_status='pending' AND a.scan_lease_token=p_lease_token AND a.scan_lease_until>clock_timestamp()
    AND a.sha256=p_sha256 AND a.object_key=a.organization_id::text||'/attachments/'||a.id::text FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE finance_private.attachment_provider_scans SET remote_id=p_remote_id
    WHERE organization_id=p_organization_id AND attachment_id=p_attachment_id AND provider=p_provider
      AND sha256=p_sha256 AND (remote_id IS NULL OR remote_id=p_remote_id);
  RETURN FOUND;
END $$;

-- Only a definitely unsubmitted local reservation may be released. An unknown
-- POST outcome keeps its marker: do not consume another free scan on blind retry.
CREATE FUNCTION finance_private.abandon_unsubmitted_attachment_scan(
  p_organization_id uuid,p_attachment_id uuid,p_lease_token uuid,p_provider text,p_sha256 text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM 1 FROM finance.attachments a WHERE a.organization_id=p_organization_id AND a.id=p_attachment_id
    AND a.scan_status='pending' AND a.scan_lease_token=p_lease_token AND a.scan_lease_until>clock_timestamp()
    AND a.sha256=p_sha256 AND a.object_key=a.organization_id::text||'/attachments/'||a.id::text FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  DELETE FROM finance_private.attachment_provider_scans
    WHERE organization_id=p_organization_id AND attachment_id=p_attachment_id AND provider=p_provider AND sha256=p_sha256 AND remote_id IS NULL;
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION finance_private.begin_attachment_provider_scan(uuid,uuid,uuid,text,text),
  finance_private.record_attachment_provider_scan(uuid,uuid,uuid,text,text,text),
  finance_private.abandon_unsubmitted_attachment_scan(uuid,uuid,uuid,text,text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION finance_private.begin_attachment_provider_scan(uuid,uuid,uuid,text,text),
  finance_private.record_attachment_provider_scan(uuid,uuid,uuid,text,text,text),
  finance_private.abandon_unsubmitted_attachment_scan(uuid,uuid,uuid,text,text) TO ams_job_worker;

CREATE OR REPLACE FUNCTION finance_private.fail_attachment_scan(
  p_organization_id uuid,p_attachment_id uuid,p_lease_token uuid,p_error_code text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_attempt integer;v_delay integer;v_now timestamptz:=clock_timestamp();
BEGIN
  IF p_error_code IS NULL OR p_error_code NOT IN ('CLAMAV_UNAVAILABLE','SCAN_TIMEOUT','SCAN_PROTOCOL_ERROR',
      'OBJECT_READ_ERROR','OBJECT_DIGEST_MISMATCH','SCAN_WORKER_ERROR','SCAN_PROVIDER_UNAVAILABLE',
      'SCAN_QUOTA_EXCEEDED','SCAN_RESULT_MISMATCH','SCAN_SUBMISSION_UNCONFIRMED','SCAN_PENDING') THEN
    RAISE EXCEPTION 'invalid attachment scan error code' USING ERRCODE='22023'; END IF;
  SELECT a.scan_attempt_count INTO v_attempt FROM finance.attachments a
    WHERE a.organization_id=p_organization_id AND a.id=p_attachment_id
      AND a.object_key=a.organization_id::text||'/attachments/'||a.id::text
      AND a.scan_status='pending' AND a.scan_lease_token=p_lease_token AND a.scan_lease_until>v_now FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_error_code IN ('SCAN_PENDING','SCAN_QUOTA_EXCEEDED') THEN
    UPDATE finance.attachments SET scan_available_at=CASE WHEN p_error_code='SCAN_PENDING' THEN v_now+interval '60 seconds'
      ELSE ((date_trunc('month',v_now AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC')+interval '60 seconds' END,
      scan_attempt_count=GREATEST(v_attempt-1,0),scan_error_code=p_error_code,scan_lease_token=NULL,scan_lease_until=NULL
      WHERE organization_id=p_organization_id AND id=p_attachment_id;
  ELSIF v_attempt>=8 THEN
    UPDATE finance.attachments SET scan_status='rejected',scanned_at=v_now,scan_error_code='SCAN_RETRIES_EXHAUSTED',
      scan_lease_token=NULL,scan_lease_until=NULL WHERE organization_id=p_organization_id AND id=p_attachment_id;
  ELSE
    v_delay:=LEAST(21600,30*(2^LEAST(v_attempt-1,9))::integer);
    UPDATE finance.attachments SET scan_available_at=v_now+make_interval(secs=>v_delay),scan_error_code=p_error_code,
      scan_lease_token=NULL,scan_lease_until=NULL WHERE organization_id=p_organization_id AND id=p_attachment_id;
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION finance_private.fail_attachment_scan(uuid,uuid,uuid,text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION finance_private.fail_attachment_scan(uuid,uuid,uuid,text) TO ams_job_worker;
NOTIFY pgrst,'reload schema';
