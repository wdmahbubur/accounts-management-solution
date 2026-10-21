-- Preserve reviewed management cash-flow evidence; never change the ledger.
CREATE TABLE finance.cash_flow_finalizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  starts_on date NOT NULL, ends_on date NOT NULL,
  material_digest text NOT NULL CHECK(material_digest ~ '^[0-9a-f]{64}$'),
  snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND (snapshot->>'provisional')::boolean=false),
  created_by_member_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE(organization_id,id), UNIQUE(organization_id,starts_on,ends_on,material_digest),
  FOREIGN KEY(organization_id,created_by_member_id) REFERENCES finance.organization_members(organization_id,id) ON DELETE RESTRICT,
  CHECK(isfinite(starts_on) AND isfinite(ends_on) AND starts_on<=ends_on)
);
ALTER TABLE finance.cash_flow_finalizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.cash_flow_finalizations FROM PUBLIC,ams_runtime,ams_job_worker;
CREATE FUNCTION finance_private.guard_cash_flow_finalization() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'finalized report evidence is immutable' USING ERRCODE='55000'; END $$;
REVOKE ALL ON FUNCTION finance_private.guard_cash_flow_finalization() FROM PUBLIC,ams_runtime;
CREATE TRIGGER cash_flow_finalization_immutable BEFORE UPDATE OR DELETE ON finance.cash_flow_finalizations
FOR EACH ROW EXECUTE FUNCTION finance_private.guard_cash_flow_finalization();

CREATE FUNCTION public.read_cash_flow_review(p_organization_id uuid,p_from date,p_to date,p_finalization_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_snapshot jsonb;v_record finance.cash_flow_finalizations%ROWTYPE;v_digest text;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'reports.read');
  IF p_finalization_id IS NOT NULL THEN
    SELECT * INTO v_record FROM finance.cash_flow_finalizations f WHERE f.organization_id=p_organization_id AND f.id=p_finalization_id;
    IF NOT FOUND OR v_record.starts_on<>p_from OR v_record.ends_on<>p_to THEN RAISE EXCEPTION 'report evidence unavailable' USING ERRCODE='P0002'; END IF;
    RETURN jsonb_build_object('snapshot',v_record.snapshot,'material_digest',v_record.material_digest,'finalization_id',v_record.id,'finalized_at',v_record.created_at);
  END IF;
  v_snapshot:=public.read_cash_flow_snapshot(p_organization_id,p_from,p_to);
  v_digest:=encode(sha256(convert_to((v_snapshot->'data'-'cutoff_at')::text,'UTF8')),'hex');
  SELECT * INTO v_record FROM finance.cash_flow_finalizations f WHERE f.organization_id=p_organization_id AND f.starts_on=p_from AND f.ends_on=p_to
    ORDER BY f.created_at DESC,f.id DESC LIMIT 1;
  RETURN jsonb_build_object('snapshot',v_snapshot,'material_digest',v_digest,'latest_finalization_id',v_record.id,
    'latest_finalized_at',v_record.created_at,'matches_latest',COALESCE(v_record.material_digest=v_digest,false));
END $$;
REVOKE ALL ON FUNCTION public.read_cash_flow_review(uuid,date,date,uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_cash_flow_review(uuid,date,date,uuid) TO ams_runtime;

CREATE FUNCTION public.finalize_cash_flow_report(p_organization_id uuid,p_from date,p_to date,p_expected_digest text,
  p_request_id text,p_idempotency_key text,p_request_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid;v_snapshot jsonb;v_digest text;v_id uuid;v_receipt jsonb;v_old finance.idempotency_requests%ROWTYPE;v_new boolean:=false;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_from>p_to OR
    p_expected_digest IS NULL OR p_expected_digest !~ '^[0-9a-f]{64}$' OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' OR
    p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{22,172}$' THEN RAISE EXCEPTION 'invalid finalization request' USING ERRCODE='22023'; END IF;
  v_actor:=finance_private.require_period_action(p_organization_id,'periods.lock');
  PERFORM finance_private.require_capability(p_organization_id,'reports.read');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':cash-flow.finalize:'||p_idempotency_key,0));
  SELECT * INTO v_old FROM finance.idempotency_requests i WHERE i.organization_id=p_organization_id AND i.operation='cash-flow.finalize' AND i.idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_old.request_hash<>p_request_hash OR v_old.actor_member_id<>v_actor THEN RAISE EXCEPTION 'idempotency conflict' USING ERRCODE='23505'; END IF;
    RETURN v_old.response_body;
  END IF;
  -- Posting and close use organization -> year -> period locks. Finalization
  -- holds that same order, then takes a fresh report snapshot under those locks.
  PERFORM fy.id FROM finance.fiscal_years fy WHERE fy.organization_id=p_organization_id AND fy.starts_on<=p_to AND fy.ends_on>=p_from ORDER BY fy.id FOR UPDATE;
  PERFORM p.id FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.starts_on<=p_to AND p.ends_on>=p_from ORDER BY p.id FOR UPDATE;
  v_snapshot:=public.read_cash_flow_snapshot(p_organization_id,p_from,p_to);
  v_digest:=encode(sha256(convert_to((v_snapshot->'data'-'cutoff_at')::text,'UTF8')),'hex');
  IF v_digest<>p_expected_digest THEN RAISE EXCEPTION 'cash flow changed; refresh before finalizing' USING ERRCODE='40001'; END IF;
  IF COALESCE((v_snapshot->>'provisional')::boolean,true) OR (v_snapshot->'data'->>'reconciliation_difference')::numeric<>0 THEN
    RAISE EXCEPTION 'unclassified or unreconciled cash flow cannot be finalized' USING ERRCODE='23514'; END IF;
  INSERT INTO finance.cash_flow_finalizations(organization_id,starts_on,ends_on,material_digest,snapshot,created_by_member_id)
    VALUES(p_organization_id,p_from,p_to,v_digest,v_snapshot,v_actor) ON CONFLICT(organization_id,starts_on,ends_on,material_digest) DO NOTHING RETURNING id INTO v_id;
  v_new:=FOUND;
  IF NOT v_new THEN SELECT f.id INTO v_id FROM finance.cash_flow_finalizations f WHERE f.organization_id=p_organization_id AND f.starts_on=p_from AND f.ends_on=p_to AND f.material_digest=v_digest; END IF;
  v_receipt:=jsonb_build_object('finalization_id',v_id,'material_digest',v_digest,'from',p_from,'to',p_to);
  IF v_new THEN PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'cash-flow.finalize','cash_flow_finalization',v_id,p_request_id,
    jsonb_build_object('from',p_from,'to',p_to,'material_digest',v_digest)); END IF;
  INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body)
    VALUES(p_organization_id,'cash-flow.finalize',p_idempotency_key,p_request_hash,v_actor,200,v_receipt);
  RETURN v_receipt;
END $$;
REVOKE ALL ON FUNCTION public.finalize_cash_flow_report(uuid,date,date,text,text,text,text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.finalize_cash_flow_report(uuid,date,date,text,text,text,text) TO ams_runtime;
NOTIFY pgrst,'reload schema';
