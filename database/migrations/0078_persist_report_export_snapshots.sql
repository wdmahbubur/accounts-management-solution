-- Bind queued report exports to the exact immutable snapshot shown by the
-- report page. Snapshot rows are private to SECURITY DEFINER routines and
-- expire after a short window so they cannot be reused as durable evidence.

CREATE TABLE finance.report_export_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  created_by_member_id uuid NOT NULL,
  report_type text NOT NULL CHECK (report_type IN
    ('trial_balance','profit_and_loss','balance_sheet','customer_statement','vendor_statement')),
  filters jsonb NOT NULL CHECK (jsonb_typeof(filters)='object'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  ledger_cutoff_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (transaction_timestamp()+interval '30 minutes'),
  revoked_at timestamptz,
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,created_by_member_id)
    REFERENCES finance.organization_members(organization_id,id) ON DELETE RESTRICT,
  CHECK (expires_at>created_at)
);
CREATE INDEX report_export_snapshots_expiry_idx
  ON finance.report_export_snapshots(expires_at,id);
ALTER TABLE finance.report_export_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.report_export_snapshots FROM PUBLIC,ams_runtime,ams_job_worker;

CREATE FUNCTION public.capture_report_export_snapshot(
  p_organization_id uuid,p_report_type text,p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_actor uuid;
  v_member uuid;
  v_snapshot jsonb;
  v_filters jsonb;
  v_id uuid;
  v_scope text;
  v_party uuid;
  v_from date;
  v_to date;
BEGIN
  v_actor:=identity.current_actor_id();
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='28000'; END IF;
  IF p_report_type NOT IN ('trial_balance','profit_and_loss','balance_sheet','customer_statement','vendor_statement')
     OR p_filters IS NULL OR jsonb_typeof(p_filters) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid report snapshot request' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM finance.organizations o WHERE o.id=p_organization_id AND o.status<>'archived') THEN
    RAISE EXCEPTION 'company unavailable' USING ERRCODE='P0002';
  END IF;
  SELECT m.id INTO v_member FROM finance.organization_members m
   WHERE m.organization_id=p_organization_id AND m.user_id=v_actor AND m.status='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'company unavailable' USING ERRCODE='P0002'; END IF;

  CASE p_report_type
    WHEN 'trial_balance' THEN
      PERFORM finance_private.require_capability(p_organization_id,'reports.read');
      PERFORM finance_private.require_capability(p_organization_id,'accounting.read');
      PERFORM finance_private.require_capability(p_organization_id,'ledger.read');
      v_snapshot:=public.read_report_snapshot(p_organization_id,'trial_balance',p_filters);
    WHEN 'profit_and_loss' THEN
      PERFORM finance_private.require_capability(p_organization_id,'reports.read');
      v_snapshot:=public.read_profit_loss_snapshot(p_organization_id,
        (p_filters->>'from')::date,(p_filters->>'to')::date,
        NULLIF(p_filters->>'cost_center','')::uuid,
        NULLIF(p_filters->>'comparison_from','')::date,NULLIF(p_filters->>'comparison_to','')::date);
    WHEN 'balance_sheet' THEN
      PERFORM finance_private.require_capability(p_organization_id,'reports.read');
      v_snapshot:=public.read_balance_sheet_snapshot(p_organization_id,
        (p_filters->>'as_of')::date,NULLIF(p_filters->>'comparison_as_of','')::date);
    ELSE
      v_scope:=CASE WHEN p_report_type='customer_statement' THEN 'customer' ELSE 'vendor' END;
      IF NOT finance_private.has_permission(p_organization_id,'dues.read') AND
         NOT finance_private.has_permission(p_organization_id,CASE v_scope WHEN 'customer' THEN 'sales.read' ELSE 'purchases.read' END) THEN
        RAISE EXCEPTION 'permission denied' USING ERRCODE='42501';
      END IF;
      v_party:=(p_filters->>'party_id')::uuid;
      v_from:=(p_filters->>'from')::date;
      v_to:=(p_filters->>'to')::date;
      v_snapshot:=public.read_party_statement_snapshot(p_organization_id,v_scope,v_party,v_from,v_to);
  END CASE;

  IF v_snapshot IS NULL OR jsonb_typeof(v_snapshot) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_snapshot->'filters') IS DISTINCT FROM 'object'
     OR NULLIF(v_snapshot->>'ledger_cutoff_at','') IS NULL THEN
    RAISE EXCEPTION 'report snapshot unavailable' USING ERRCODE='P0002';
  END IF;
  -- Preserve the exact filter object the UI will submit on export. Report
  -- readers add normalized/display-only fields (for example null comparison
  -- dates and statement scope), which are already bound by report_type or
  -- represented in the immutable payload.
  v_filters:=p_filters;
  v_id:=gen_random_uuid();
  v_snapshot:=v_snapshot||jsonb_build_object('snapshot_id',v_id);
  INSERT INTO finance.report_export_snapshots(id,organization_id,created_by_member_id,report_type,filters,payload,ledger_cutoff_at)
  VALUES(v_id,p_organization_id,v_member,p_report_type,v_filters,v_snapshot,(v_snapshot->>'ledger_cutoff_at')::timestamptz);
  RETURN v_snapshot;
END $$;
REVOKE ALL ON FUNCTION public.capture_report_export_snapshot(uuid,text,jsonb) FROM PUBLIC,ams_runtime,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.capture_report_export_snapshot(uuid,text,jsonb) TO ams_runtime;

-- The export request keeps its existing RPC contract. Its parameters include
-- export_snapshot_id alongside the exact normalized filters returned above.
CREATE OR REPLACE FUNCTION finance_private.snapshot_export_company_name() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_snapshot finance.report_export_snapshots%ROWTYPE; v_snapshot_id uuid; v_as_of date;
BEGIN
  IF NEW.company_name_snapshot IS NULL THEN
    SELECT o.name INTO NEW.company_name_snapshot FROM finance.organizations o WHERE o.id=NEW.organization_id;
  END IF;
  IF NEW.export_type='trial_balance' AND NEW.format='csv' THEN
    -- Keep the existing trial-balance CSV contract intact. It predates the
    -- report-page snapshot binding and still captures rows in this transaction.
    IF jsonb_typeof(NEW.parameters) IS DISTINCT FROM 'object' OR
       COALESCE(NEW.parameters->>'as_of','') !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION 'invalid saved export filters' USING ERRCODE='22023';
    END IF;
    v_as_of:=(NEW.parameters->>'as_of')::date;
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.account_code),'[]'::jsonb) INTO NEW.snapshot_data
      FROM public.read_trial_balance(NEW.organization_id,v_as_of,NULL) t;
  ELSIF NEW.export_type IN ('profit_and_loss','balance_sheet','customer_statement','vendor_statement')
     AND NEW.format IN ('csv','pdf','xlsx') THEN
    IF jsonb_typeof(NEW.parameters) IS DISTINCT FROM 'object'
       OR COALESCE(NEW.parameters->>'export_snapshot_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'report export snapshot required' USING ERRCODE='22023';
    END IF;
    v_snapshot_id:=(NEW.parameters->>'export_snapshot_id')::uuid;
    SELECT s.* INTO v_snapshot FROM finance.report_export_snapshots s
      WHERE s.organization_id=NEW.organization_id AND s.id=v_snapshot_id FOR SHARE;
    IF NOT FOUND OR v_snapshot.created_by_member_id IS DISTINCT FROM NEW.requested_by_member_id
       OR v_snapshot.report_type IS DISTINCT FROM NEW.export_type
       OR v_snapshot.filters IS DISTINCT FROM (NEW.parameters-'export_snapshot_id')
       OR v_snapshot.expires_at<=clock_timestamp() OR v_snapshot.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'report export snapshot unavailable or mismatched' USING ERRCODE='22023';
    END IF;
    NEW.ledger_cutoff_at:=v_snapshot.ledger_cutoff_at;
    NEW.snapshot_data:=jsonb_build_array(v_snapshot.payload||jsonb_build_object('export_format',NEW.format));
  END IF;
  IF octet_length(NEW.snapshot_data::text)>8000000 THEN
    RAISE EXCEPTION 'report exceeds export capacity' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.snapshot_export_company_name() FROM PUBLIC,ams_runtime,ams_job_worker;

-- Expired snapshot payloads are scrubbed in bounded batches whenever the
-- existing worker-only expired-export cleanup path runs. CREATE OR REPLACE
-- retains the worker grant established by 0077.
CREATE OR REPLACE FUNCTION finance_private.claim_expired_export_cleanup(p_limit integer DEFAULT 10,p_lease_seconds integer DEFAULT 600)
RETURNS TABLE(job_id uuid,organization_id uuid,object_key text,lease_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_now timestamptz:=clock_timestamp();
BEGIN
  IF p_limit NOT BETWEEN 1 AND 25 OR p_lease_seconds NOT BETWEEN 60 AND 1800 THEN
    RAISE EXCEPTION 'invalid export cleanup claim' USING ERRCODE='22023';
  END IF;
  WITH expired AS (
    SELECT s.id FROM finance.report_export_snapshots s
    WHERE s.expires_at<=v_now OR s.revoked_at IS NOT NULL
    ORDER BY s.expires_at,s.id FOR UPDATE SKIP LOCKED LIMIT 500
  )
  DELETE FROM finance.report_export_snapshots s USING expired x WHERE s.id=x.id;
  UPDATE finance.export_jobs e SET status='expired',lease_token=NULL,lease_until=NULL
    WHERE e.status='completed' AND e.expires_at<=v_now;
  RETURN QUERY WITH ready AS (
    SELECT e.organization_id,e.id FROM finance.export_jobs e
    WHERE e.status IN ('expired','failed') AND e.object_key=e.organization_id||'/exports/'||e.id AND e.object_cleanup_at IS NULL
      AND e.object_cleanup_attempt_count<8 AND e.object_cleanup_available_at<=v_now
      AND (e.object_cleanup_lease_until IS NULL OR e.object_cleanup_lease_until<=v_now)
    ORDER BY COALESCE(e.expires_at,e.created_at),e.id FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), claimed AS (
    UPDATE finance.export_jobs e SET object_cleanup_attempt_count=e.object_cleanup_attempt_count+1,
      object_cleanup_lease_token=gen_random_uuid(),object_cleanup_lease_until=v_now+make_interval(secs=>p_lease_seconds),
      object_cleanup_error_code=NULL FROM ready r
    WHERE e.organization_id=r.organization_id AND e.id=r.id
    RETURNING e.id,e.organization_id,e.object_key,e.object_cleanup_lease_token
  ) SELECT c.id,c.organization_id,c.object_key,c.object_cleanup_lease_token FROM claimed c;
END $$;
REVOKE ALL ON FUNCTION finance_private.claim_expired_export_cleanup(integer,integer) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION finance_private.claim_expired_export_cleanup(integer,integer) TO ams_job_worker;
NOTIFY pgrst,'reload schema';
