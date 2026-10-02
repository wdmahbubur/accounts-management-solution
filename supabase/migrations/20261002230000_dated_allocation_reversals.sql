-- US-024: unapply an allocation by appending one dated reversal.
BEGIN;

CREATE FUNCTION finance_private.guard_allocation_reversal_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_allocation_date date;
BEGIN
  SELECT a.effective_date INTO v_allocation_date FROM finance.settlement_allocations a
    WHERE a.organization_id=NEW.organization_id AND a.id=NEW.allocation_id;
  IF NOT FOUND OR NEW.effective_date<v_allocation_date THEN
    RAISE EXCEPTION 'allocation reversal must be dated on or after its allocation' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM finance.accounting_periods p WHERE p.organization_id=NEW.organization_id
    AND p.kind='regular' AND p.starts_on<=NEW.effective_date AND p.ends_on>=NEW.effective_date AND p.status='open') THEN
    RAISE EXCEPTION 'allocation reversal period is locked or unavailable' USING ERRCODE='55P03';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_allocation_reversal_insert() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER allocation_reversal_source_guard BEFORE INSERT ON finance.allocation_reversals
  FOR EACH ROW EXECUTE FUNCTION finance_private.guard_allocation_reversal_insert();

CREATE FUNCTION finance_private.reject_allocation_reversal_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'allocation reversals are append-only' USING ERRCODE='23514'; END $$;
REVOKE ALL ON FUNCTION finance_private.reject_allocation_reversal_mutation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER allocation_reversals_append_only BEFORE UPDATE OR DELETE ON finance.allocation_reversals
  FOR EACH ROW EXECUTE FUNCTION finance_private.reject_allocation_reversal_mutation();
CREATE TRIGGER allocation_reversals_no_truncate BEFORE TRUNCATE ON finance.allocation_reversals
  FOR EACH STATEMENT EXECUTE FUNCTION finance_private.reject_allocation_reversal_mutation();

CREATE FUNCTION public.reverse_open_item_allocation(
  p_organization_id uuid,p_allocation_id uuid,p_operation text,p_request_id text,p_idempotency_key text,p_request_hash text,
  p_effective_date date,p_reason text
) RETURNS TABLE(reversal_id uuid,allocation_id uuid,effective_date date,reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_org_status text; v_hash text; v_existing_actor uuid; v_receipt jsonb;
  v_allocation finance.settlement_allocations%ROWTYPE; v_debit finance.open_items%ROWTYPE; v_credit finance.open_items%ROWTYPE;
  v_item finance.open_items%ROWTYPE; v_year_id uuid; v_year_status text; v_period_id uuid; v_reversal_id uuid;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_allocation_id IS NULL OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 200 OR
     p_operation IS DISTINCT FROM 'allocations.reverse:'||p_allocation_id::text OR
     p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' OR p_effective_date IS NULL OR NOT isfinite(p_effective_date) OR
     p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'invalid allocation reversal request' USING ERRCODE='22023';
  END IF;
  SELECT o.status INTO v_org_status FROM finance.organizations o WHERE o.id=p_organization_id FOR SHARE;
  IF NOT FOUND OR v_org_status='archived' THEN RAISE EXCEPTION 'organization unavailable' USING ERRCODE='P0002'; END IF;
  IF v_org_status<>'active' THEN RAISE EXCEPTION 'organization is not writable' USING ERRCODE='42501'; END IF;
  v_actor:=finance_private.require_capability(p_organization_id,'dues.allocate');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_operation||':'||p_idempotency_key,0));
  SELECT i.request_hash,i.actor_member_id,i.response_body INTO v_hash,v_existing_actor,v_receipt FROM finance.idempotency_requests i
    WHERE i.organization_id=p_organization_id AND i.operation=p_operation AND i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_hash<>p_request_hash OR v_existing_actor<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505'; END IF;
    RETURN QUERY SELECT (v_receipt->>'reversal_id')::uuid,(v_receipt->>'allocation_id')::uuid,
      (v_receipt->>'effective_date')::date,v_receipt->>'reason';
    RETURN;
  END IF;
  -- Read the date without a row lock to acquire the shared period locks first.
  SELECT * INTO v_allocation FROM finance.settlement_allocations a WHERE a.organization_id=p_organization_id AND a.id=p_allocation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'allocation unavailable' USING ERRCODE='P0002'; END IF;
  IF p_effective_date<v_allocation.effective_date THEN RAISE EXCEPTION 'reversal predates allocation' USING ERRCODE='22023'; END IF;
  SELECT fy.id,fy.status INTO v_year_id,v_year_status FROM finance.fiscal_years fy
    WHERE fy.organization_id=p_organization_id AND fy.starts_on<=p_effective_date AND fy.ends_on>=p_effective_date FOR UPDATE;
  IF NOT FOUND OR v_year_status<>'open' THEN RAISE EXCEPTION 'fiscal year is locked or unavailable' USING ERRCODE='55P03'; END IF;
  SELECT ap.id INTO v_period_id FROM finance.accounting_periods ap WHERE ap.organization_id=p_organization_id AND
    ap.kind='regular' AND ap.fiscal_year_id=v_year_id AND ap.starts_on<=p_effective_date AND ap.ends_on>=p_effective_date FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM finance.accounting_periods ap WHERE ap.organization_id=p_organization_id AND ap.id=v_period_id AND ap.status='open') THEN
    RAISE EXCEPTION 'accounting period is locked or unavailable' USING ERRCODE='55P03';
  END IF;
  SELECT * INTO v_allocation FROM finance.settlement_allocations a WHERE a.organization_id=p_organization_id AND a.id=p_allocation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'allocation unavailable' USING ERRCODE='P0002'; END IF;
  IF p_effective_date<v_allocation.effective_date THEN RAISE EXCEPTION 'reversal predates allocation' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM finance.allocation_reversals r WHERE r.organization_id=p_organization_id AND r.allocation_id=p_allocation_id) THEN
    RAISE EXCEPTION 'allocation already reversed' USING ERRCODE='P0001';
  END IF;
  -- Match allocation lock order so concurrent allocation/reversal commands serialize safely.
  FOR v_item IN SELECT oi.* FROM finance.open_items oi WHERE oi.organization_id=p_organization_id
    AND oi.id IN (v_allocation.debit_open_item_id,v_allocation.credit_open_item_id) ORDER BY oi.id FOR UPDATE
  LOOP
    IF v_item.id=v_allocation.debit_open_item_id THEN v_debit:=v_item; ELSE v_credit:=v_item; END IF;
  END LOOP;
  IF v_debit.id IS NULL OR v_credit.id IS NULL THEN RAISE EXCEPTION 'allocation items unavailable' USING ERRCODE='P0002'; END IF;
  PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_debit.id,-v_allocation.amount,p_effective_date);
  PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_credit.id,-v_allocation.amount,p_effective_date);
  INSERT INTO finance.allocation_reversals(organization_id,allocation_id,effective_date,reason,created_by_member_id)
    VALUES(p_organization_id,p_allocation_id,p_effective_date,btrim(p_reason),v_actor) RETURNING id INTO v_reversal_id;
  SELECT jsonb_build_object('reversal_id',v_reversal_id,'allocation_id',p_allocation_id,'effective_date',p_effective_date,'reason',btrim(p_reason)) INTO v_receipt;
  INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body)
    VALUES(p_organization_id,p_operation,p_idempotency_key,p_request_hash,v_actor,200,v_receipt);
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'allocation.reversed','allocation_reversal',v_reversal_id,p_request_id,
    jsonb_build_object('allocation_id',p_allocation_id,'effective_date',p_effective_date,'reason',btrim(p_reason)));
  RETURN QUERY SELECT v_reversal_id,p_allocation_id,p_effective_date,btrim(p_reason);
END $$;
REVOKE ALL ON FUNCTION public.reverse_open_item_allocation(uuid,uuid,text,text,text,text,date,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_open_item_allocation(uuid,uuid,text,text,text,text,date,text) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
