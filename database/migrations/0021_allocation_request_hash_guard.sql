-- Reject a null request digest on allocation replay.
CREATE OR REPLACE FUNCTION public.allocate_open_items(
  p_organization_id uuid,p_request_id text,p_idempotency_key text,p_request_hash text,
  p_debit_open_item_id uuid,p_credit_open_item_id uuid,p_amount text,p_effective_date date
) RETURNS TABLE(allocation_id uuid,amount finance.amount,effective_date date,available_debit finance.amount,available_credit finance.amount)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_item finance.open_items%ROWTYPE; v_debit finance.open_items%ROWTYPE; v_credit finance.open_items%ROWTYPE;
  v_hash text; v_existing_actor uuid; v_receipt jsonb; v_amount finance.amount; v_year_id uuid; v_year_status text;
  v_period_id uuid; v_id uuid; v_debit_balance finance.amount; v_credit_balance finance.amount;
  v_org_status text;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_debit_open_item_id IS NULL OR p_credit_open_item_id IS NULL OR p_debit_open_item_id=p_credit_open_item_id OR
     p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 200 OR p_request_hash !~ '^[0-9a-f]{64}$' OR
     p_effective_date IS NULL OR NOT isfinite(p_effective_date) THEN
    RAISE EXCEPTION 'invalid allocation request' USING ERRCODE='22023';
  END IF;
  PERFORM finance_private.require_decimal_string(to_jsonb(p_amount),2,false);
  v_amount:=p_amount::finance.amount;
  IF v_amount<=0 THEN RAISE EXCEPTION 'allocation amount must be positive' USING ERRCODE='23514'; END IF;
  SELECT o.status INTO v_org_status FROM finance.organizations o WHERE o.id=p_organization_id FOR SHARE;
  IF NOT FOUND OR v_org_status='archived' THEN RAISE EXCEPTION 'organization unavailable' USING ERRCODE='P0002'; END IF;
  IF v_org_status<>'active' THEN RAISE EXCEPTION 'organization is not writable' USING ERRCODE='42501'; END IF;
  v_actor:=finance_private.require_capability(p_organization_id,'dues.allocate');
  -- Serialize a duplicate key before either item lock so a racing replay reads the committed receipt.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':allocations.create:'||p_idempotency_key,0));
  SELECT i.request_hash,i.actor_member_id,i.response_body INTO v_hash,v_existing_actor,v_receipt FROM finance.idempotency_requests i
    WHERE i.organization_id=p_organization_id AND i.operation='allocations.create' AND i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_hash<>p_request_hash OR v_existing_actor<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505'; END IF;
    RETURN QUERY SELECT (v_receipt->>'allocation_id')::uuid,(v_receipt->>'amount')::finance.amount,
      (v_receipt->>'effective_date')::date,(v_receipt->>'available_debit')::finance.amount,(v_receipt->>'available_credit')::finance.amount;
    RETURN;
  END IF;
  -- Match the shared protocol: organization, fiscal year, period, then subledger rows.
  SELECT fy.id,fy.status INTO v_year_id,v_year_status FROM finance.fiscal_years fy
    WHERE fy.organization_id=p_organization_id AND fy.starts_on<=p_effective_date AND fy.ends_on>=p_effective_date FOR UPDATE;
  IF NOT FOUND OR v_year_status<>'open' THEN RAISE EXCEPTION 'fiscal year is locked or unavailable' USING ERRCODE='55P03'; END IF;
  SELECT ap.id INTO v_period_id FROM finance.accounting_periods ap WHERE ap.organization_id=p_organization_id AND
    ap.kind='regular' AND ap.fiscal_year_id=v_year_id AND ap.starts_on<=p_effective_date AND ap.ends_on>=p_effective_date
    FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM finance.accounting_periods ap WHERE ap.organization_id=p_organization_id AND ap.id=v_period_id AND ap.status='open') THEN
    RAISE EXCEPTION 'accounting period is locked or unavailable' USING ERRCODE='55P03';
  END IF;
  -- Always acquire both item locks in UUID order so inverse requests cannot deadlock.
  FOR v_item IN SELECT oi.* FROM finance.open_items oi WHERE oi.organization_id=p_organization_id
    AND oi.id IN (p_debit_open_item_id,p_credit_open_item_id) ORDER BY oi.id FOR UPDATE
  LOOP
    IF v_item.id=p_debit_open_item_id THEN v_debit:=v_item; ELSE v_credit:=v_item; END IF;
  END LOOP;
  IF v_debit.id IS NULL OR v_credit.id IS NULL THEN RAISE EXCEPTION 'open item unavailable' USING ERRCODE='P0002'; END IF;
  IF v_debit.side<>'debit' OR v_credit.side<>'credit' OR v_debit.party_id<>v_credit.party_id OR
     v_debit.account_id<>v_credit.account_id OR v_debit.control_kind<>v_credit.control_kind THEN
    RAISE EXCEPTION 'open items are not compatible opposites' USING ERRCODE='22023';
  END IF;
  IF p_effective_date<v_debit.issue_date OR p_effective_date<v_credit.issue_date THEN
    RAISE EXCEPTION 'allocation predates a source item' USING ERRCODE='23514';
  END IF;
  PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,p_debit_open_item_id,v_amount,p_effective_date);
  PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,p_credit_open_item_id,v_amount,p_effective_date);
  INSERT INTO finance.settlement_allocations(organization_id,debit_open_item_id,credit_open_item_id,amount,effective_date,created_by_member_id)
    VALUES(p_organization_id,p_debit_open_item_id,p_credit_open_item_id,v_amount,p_effective_date,v_actor) RETURNING id INTO v_id;
  v_debit_balance:=finance_private.open_item_balance_at(p_organization_id,p_debit_open_item_id,p_effective_date,clock_timestamp());
  v_credit_balance:=finance_private.open_item_balance_at(p_organization_id,p_credit_open_item_id,p_effective_date,clock_timestamp());
  SELECT jsonb_build_object('allocation_id',v_id,'amount',v_amount::text,'effective_date',p_effective_date,
    'available_debit',v_debit_balance::text,'available_credit',v_credit_balance::text) INTO v_receipt;
  INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body)
    VALUES(p_organization_id,'allocations.create',p_idempotency_key,p_request_hash,v_actor,200,v_receipt);
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'allocation.created','settlement_allocation',v_id,p_request_id,
    jsonb_build_object('amount',v_amount::text,'effective_date',p_effective_date,'debit_open_item_id',p_debit_open_item_id,
      'credit_open_item_id',p_credit_open_item_id));
  RETURN QUERY SELECT v_id,v_amount,p_effective_date,v_debit_balance,v_credit_balance;
END; $$;
