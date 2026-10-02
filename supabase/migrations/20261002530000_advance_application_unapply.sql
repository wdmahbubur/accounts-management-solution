-- US-041: reverse an advance application with its paired settlements atomically.
BEGIN;

CREATE OR REPLACE FUNCTION finance_private.can_read_document(p_organization_id uuid,p_document_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS(
    SELECT 1 FROM finance.business_documents d
    WHERE d.organization_id=p_organization_id AND d.id=p_document_id AND (
      finance_private.has_permission(d.organization_id,'documents.read')
      OR (d.document_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance') AND finance_private.has_permission(d.organization_id,'sales.read'))
      OR (d.document_type IN ('bill','vendor_credit','vendor_payment','vendor_refund','vendor_advance','paid_expense') AND finance_private.has_permission(d.organization_id,'purchases.read'))
      OR (d.document_type='transfer' AND finance_private.has_permission(d.organization_id,'banking.read'))
      OR (d.document_type='advance_application' AND EXISTS(SELECT 1 FROM finance.advance_actions a JOIN finance.open_items oi
        ON oi.organization_id=a.organization_id AND oi.id=a.advance_open_item_id WHERE a.organization_id=d.organization_id AND a.document_id=d.id
        AND finance_private.has_permission(d.organization_id,CASE WHEN oi.control_kind='customer_advance' THEN 'sales.read' ELSE 'purchases.read' END)))
      OR (d.document_type='reversal' AND EXISTS(SELECT 1 FROM finance.business_documents original
        JOIN finance.advance_actions a ON a.organization_id=original.organization_id AND a.document_id=original.id AND a.action_kind='apply'
        JOIN finance.open_items oi ON oi.organization_id=a.organization_id AND oi.id=a.advance_open_item_id
        WHERE original.organization_id=d.organization_id AND original.id=d.reversal_of_document_id
          AND finance_private.has_permission(d.organization_id,CASE WHEN oi.control_kind='customer_advance' THEN 'sales.read' ELSE 'purchases.read' END)))
    )
  );
$$;
REVOKE ALL ON FUNCTION finance_private.can_read_document(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION finance_private.can_read_document(uuid,uuid) TO authenticated;

CREATE FUNCTION public.unapply_advance_application(
  p_organization_id uuid,p_document_id uuid,p_request_id text,p_idempotency_key text,p_request_hash text,
  p_effective_date date,p_reason text
) RETURNS TABLE(reversal_document_id uuid,reversal_document_number text,journal_entry_id uuid,effective_date date)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_actor uuid;v_operation text:='advance-applications.unapply:'||p_document_id::text;v_hash text;v_existing_actor uuid;v_receipt jsonb;
  v_original finance.business_documents%ROWTYPE;v_action finance.advance_actions%ROWTYPE;v_period_id uuid;v_period finance.accounting_periods%ROWTYPE;
  v_rows integer;v_amount finance.amount;v_number text;v_reversal_id uuid:=gen_random_uuid();v_journal_id uuid;
  v_items uuid[];v_item finance.open_items%ROWTYPE;v_application_advance finance.open_items%ROWTYPE;v_application_trade finance.open_items%ROWTYPE;
  v_reversal_advance uuid;v_reversal_trade uuid;v_application_advance_id uuid;v_application_trade_id uuid;
  v_advance finance.open_items%ROWTYPE;v_trade finance.open_items%ROWTYPE;v_line record;v_line_no integer:=0;
  v_debits finance.amount;v_credits finance.amount;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_document_id IS NULL OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 200 OR
    p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' OR p_effective_date IS NULL OR NOT isfinite(p_effective_date) OR
    p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'invalid advance unapply request' USING ERRCODE='22023';
  END IF;
  v_actor:=finance_private.require_capability(p_organization_id,'dues.allocate');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||v_operation||':'||p_idempotency_key,0));
  SELECT i.request_hash,i.actor_member_id,i.response_body INTO v_hash,v_existing_actor,v_receipt FROM finance.idempotency_requests i
    WHERE i.organization_id=p_organization_id AND i.operation=v_operation AND i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_hash<>p_request_hash OR v_existing_actor<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505';END IF;
    RETURN QUERY SELECT (v_receipt->>'reversal_document_id')::uuid,v_receipt->>'reversal_document_number',
      (v_receipt->>'journal_entry_id')::uuid,(v_receipt->>'effective_date')::date;RETURN;
  END IF;

  -- Lock the period before the source document and all four open items.
  SELECT d.accounting_date INTO v_original.accounting_date FROM finance.business_documents d
    WHERE d.organization_id=p_organization_id AND d.id=p_document_id AND d.document_type='advance_application';
  IF NOT FOUND THEN RAISE EXCEPTION 'advance application unavailable' USING ERRCODE='P0002';END IF;
  IF p_effective_date<v_original.accounting_date THEN RAISE EXCEPTION 'unapply date cannot precede the application' USING ERRCODE='22023';END IF;
  v_period_id:=finance_private.lock_accounting_date(p_organization_id,p_effective_date,false);
  SELECT * INTO v_period FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.id=v_period_id;
  SELECT * INTO v_original FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id
    AND d.document_type='advance_application' AND d.state='posted' FOR UPDATE;
  IF NOT FOUND OR NOT finance_private.can_read_document(p_organization_id,p_document_id) THEN
    RAISE EXCEPTION 'posted advance application unavailable' USING ERRCODE='P0002';
  END IF;
  SELECT * INTO v_action FROM finance.advance_actions a WHERE a.organization_id=p_organization_id AND a.document_id=p_document_id AND a.action_kind='apply';
  IF NOT FOUND THEN RAISE EXCEPTION 'only an advance application can be unapplied' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.reversal_of_document_id=p_document_id AND d.state='posted') THEN
    RAISE EXCEPTION 'advance application has already been unapplied' USING ERRCODE='P0001';
  END IF;
  PERFORM finance_private.require_capability(p_organization_id,CASE WHEN v_action.advance_open_item_id IS NOT NULL AND
    (SELECT oi.control_kind FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.id=v_action.advance_open_item_id)='customer_advance'
    THEN 'sales.post' ELSE 'purchases.post' END);
  PERFORM finance_private.require_capability(p_organization_id,'journal.post');

  -- A valid advance application has exactly one advance-control and one trade-control match.
  SELECT count(*),array_agg(DISTINCT id ORDER BY id) INTO v_rows,v_items FROM (
    SELECT oi.id FROM finance.settlement_allocations a JOIN finance.open_items oi ON oi.organization_id=a.organization_id
      AND oi.id IN (a.debit_open_item_id,a.credit_open_item_id)
      WHERE a.organization_id=p_organization_id AND a.source_document_id=p_document_id
  ) matched;
  IF v_rows<>4 OR cardinality(v_items)<>4 THEN RAISE EXCEPTION 'advance application settlement evidence is incomplete' USING ERRCODE='23514';END IF;
  SELECT count(*) INTO v_rows FROM finance.settlement_allocations a WHERE a.organization_id=p_organization_id AND a.source_document_id=p_document_id;
  IF v_rows<>2 THEN RAISE EXCEPTION 'advance application must have two paired allocations' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM finance.settlement_allocations a JOIN finance.allocation_reversals r
    ON r.organization_id=a.organization_id AND r.allocation_id=a.id WHERE a.organization_id=p_organization_id AND a.source_document_id=p_document_id) THEN
    RAISE EXCEPTION 'advance application allocations were already reversed' USING ERRCODE='P0001';
  END IF;
  -- Match the single-allocation reversal protocol: allocation rows precede open-item locks.
  FOR v_line IN SELECT a.* FROM finance.settlement_allocations a WHERE a.organization_id=p_organization_id
    AND a.source_document_id=p_document_id ORDER BY a.id FOR UPDATE LOOP NULL;END LOOP;
  IF EXISTS(SELECT 1 FROM finance.settlement_allocations a JOIN finance.allocation_reversals r
    ON r.organization_id=a.organization_id AND r.allocation_id=a.id WHERE a.organization_id=p_organization_id AND a.source_document_id=p_document_id) THEN
    RAISE EXCEPTION 'advance application allocations were already reversed' USING ERRCODE='P0001';
  END IF;
  FOR v_item IN SELECT oi.* FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.id=ANY(v_items) ORDER BY oi.id FOR UPDATE LOOP
    IF v_action.advance_open_item_id IS NOT NULL AND v_item.id=v_action.advance_open_item_id THEN v_advance:=v_item;END IF;
  END LOOP;
  -- Reload all settlement rows after acquiring item locks, then classify each control pair.
  SELECT count(*),sum(a.amount)::finance.amount INTO v_rows,v_amount FROM finance.settlement_allocations a
    WHERE a.organization_id=p_organization_id AND a.source_document_id=p_document_id;
  IF v_rows<>2 OR v_amount<>v_original.total_amount OR v_action.amount<>v_original.total_amount OR v_advance.id IS NULL OR
    EXISTS(SELECT 1 FROM finance.settlement_allocations a WHERE a.organization_id=p_organization_id AND a.source_document_id=p_document_id AND a.amount<>v_action.amount) THEN
    RAISE EXCEPTION 'advance application amount or source changed' USING ERRCODE='23514';
  END IF;
  SELECT oi.id INTO v_application_advance_id FROM finance.settlement_allocations a JOIN finance.open_items oi
    ON oi.organization_id=a.organization_id AND oi.id IN (a.debit_open_item_id,a.credit_open_item_id)
    WHERE a.organization_id=p_organization_id AND a.source_document_id=p_document_id AND oi.control_kind=v_advance.control_kind
      AND oi.id<>v_advance.id;
  -- The plan stores the original trade item; the counterpart is the reclassification line.
  SELECT oi.id INTO v_application_trade_id FROM finance.settlement_allocations a JOIN finance.open_items oi
    ON oi.organization_id=a.organization_id AND oi.id IN (a.debit_open_item_id,a.credit_open_item_id)
    WHERE a.organization_id=p_organization_id AND a.source_document_id=p_document_id AND oi.control_kind IN ('ar','ap')
      AND oi.id<>v_action.target_open_item_id;
  SELECT * INTO v_application_advance FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.id=v_application_advance_id;
  SELECT * INTO v_application_trade FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.id=v_application_trade_id;
  SELECT * INTO v_trade FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.id=v_action.target_open_item_id;
  IF v_application_advance.id IS NULL OR v_application_trade.id IS NULL OR v_trade.id IS NULL OR
    v_trade.party_id<>v_advance.party_id OR v_application_advance.party_id<>v_advance.party_id OR
    v_application_trade.party_id<>v_advance.party_id OR v_application_advance.control_kind<>v_advance.control_kind OR
    (v_advance.control_kind='customer_advance' AND (v_trade.control_kind<>'ar' OR v_advance.side<>'credit' OR v_application_advance.side<>'debit' OR v_trade.side<>'debit' OR v_application_trade.side<>'credit')) OR
    (v_advance.control_kind='vendor_advance' AND (v_trade.control_kind<>'ap' OR v_advance.side<>'debit' OR v_application_advance.side<>'credit' OR v_trade.side<>'credit' OR v_application_trade.side<>'debit')) THEN
    RAISE EXCEPTION 'advance application open items do not form compatible pairs' USING ERRCODE='23514';
  END IF;

  -- Append both allocation reversals before adding the offsetting pairs.
  FOR v_line IN SELECT a.* FROM finance.settlement_allocations a WHERE a.organization_id=p_organization_id AND a.source_document_id=p_document_id ORDER BY a.id LOOP
    IF p_effective_date<v_line.effective_date THEN RAISE EXCEPTION 'unapply date predates an application allocation' USING ERRCODE='23514';END IF;
    PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_line.debit_open_item_id,-v_line.amount,p_effective_date);
    PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_line.credit_open_item_id,-v_line.amount,p_effective_date);
    INSERT INTO finance.allocation_reversals(organization_id,allocation_id,effective_date,reason,created_by_member_id)
      VALUES(p_organization_id,v_line.id,p_effective_date,btrim(p_reason),v_actor);
  END LOOP;

  INSERT INTO finance.business_documents(organization_id,document_type,state,fiscal_year_id,party_id,issue_date,accounting_date,
    description,currency,net_amount,tax_amount,total_amount,party_snapshot,version,created_by_member_id,reversal_of_document_id,
    correction_reason,material_digest)
    VALUES(p_organization_id,'reversal','approved',v_period.fiscal_year_id,v_original.party_id,p_effective_date,p_effective_date,
      'Unapply advance application '||v_original.document_number,'BDT',v_amount,0,v_amount,v_original.party_snapshot,1,v_actor,
      p_document_id,btrim(p_reason),p_request_hash) RETURNING id INTO v_reversal_id;
  v_number:=finance_private.allocate_document_number(p_organization_id,v_reversal_id);
  INSERT INTO finance.journal_entries(organization_id,source_document_id,period_id,accounting_date,state,is_opening,posted_by_member_id)
    VALUES(p_organization_id,v_reversal_id,v_period_id,p_effective_date,'building',false,v_actor) RETURNING id INTO v_journal_id;
  FOR v_line IN SELECT l.* FROM finance.journal_lines l JOIN finance.journal_entries j
    ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id AND j.source_document_id=p_document_id AND j.state='posted'
    WHERE l.organization_id=p_organization_id ORDER BY l.line_no LOOP
    v_line_no:=v_line_no+1;
    PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_line.account_id,v_line.party_id,v_line.cost_center_id,
      v_line.credit,v_line.debit,v_line.description||' · unapply',v_line.cash_flow_class);
    IF v_line.account_id=v_application_advance.account_id AND v_line.party_id=v_advance.party_id THEN
      SELECT oi.id INTO v_reversal_advance FROM finance.open_items oi JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
        WHERE oi.organization_id=p_organization_id AND jl.journal_entry_id=v_journal_id AND oi.control_kind=v_advance.control_kind;
    ELSIF v_line.account_id=v_application_trade.account_id AND v_line.party_id=v_advance.party_id THEN
      SELECT oi.id INTO v_reversal_trade FROM finance.open_items oi JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
        WHERE oi.organization_id=p_organization_id AND jl.journal_entry_id=v_journal_id AND oi.control_kind=v_application_trade.control_kind;
    END IF;
  END LOOP;
  IF v_line_no<>2 OR v_reversal_advance IS NULL OR v_reversal_trade IS NULL THEN RAISE EXCEPTION 'advance reversal journal lines are incomplete' USING ERRCODE='23514';END IF;
  PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_application_advance.id,v_amount,p_effective_date);
  PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_reversal_advance,v_amount,p_effective_date);
  PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_application_trade.id,v_amount,p_effective_date);
  PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_reversal_trade,v_amount,p_effective_date);
  IF v_application_advance.side='debit' THEN
    INSERT INTO finance.settlement_allocations(organization_id,debit_open_item_id,credit_open_item_id,amount,effective_date,created_by_member_id,source_document_id)
      VALUES(p_organization_id,v_application_advance.id,v_reversal_advance,v_amount,p_effective_date,v_actor,v_reversal_id);
  ELSE
    INSERT INTO finance.settlement_allocations(organization_id,debit_open_item_id,credit_open_item_id,amount,effective_date,created_by_member_id,source_document_id)
      VALUES(p_organization_id,v_reversal_advance,v_application_advance.id,v_amount,p_effective_date,v_actor,v_reversal_id);
  END IF;
  IF v_application_trade.side='debit' THEN
    INSERT INTO finance.settlement_allocations(organization_id,debit_open_item_id,credit_open_item_id,amount,effective_date,created_by_member_id,source_document_id)
      VALUES(p_organization_id,v_application_trade.id,v_reversal_trade,v_amount,p_effective_date,v_actor,v_reversal_id);
  ELSE
    INSERT INTO finance.settlement_allocations(organization_id,debit_open_item_id,credit_open_item_id,amount,effective_date,created_by_member_id,source_document_id)
      VALUES(p_organization_id,v_reversal_trade,v_application_trade.id,v_amount,p_effective_date,v_actor,v_reversal_id);
  END IF;
  SELECT COALESCE(sum(l.debit),0)::finance.amount,COALESCE(sum(l.credit),0)::finance.amount INTO v_debits,v_credits
    FROM finance.journal_lines l WHERE l.organization_id=p_organization_id AND l.journal_entry_id=v_journal_id;
  IF v_debits<>v_credits OR v_debits<>v_amount THEN RAISE EXCEPTION 'advance reversal journal is not balanced' USING ERRCODE='23514';END IF;
  UPDATE finance.journal_entries j SET state='posted',posted_at=clock_timestamp() WHERE j.organization_id=p_organization_id AND j.id=v_journal_id;
  UPDATE finance.business_documents d SET state='posted',document_number=v_number,posted_by_member_id=v_actor,posted_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE d.organization_id=p_organization_id AND d.id=v_reversal_id;
  v_receipt:=jsonb_build_object('reversal_document_id',v_reversal_id,'reversal_document_number',v_number,'journal_entry_id',v_journal_id,'effective_date',p_effective_date);
  INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body,resource_document_id)
    VALUES(p_organization_id,v_operation,p_idempotency_key,p_request_hash,v_actor,200,v_receipt,v_reversal_id);
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'advance.application.unapplied','business_document',v_reversal_id,p_request_id,
    jsonb_build_object('original_document_id',p_document_id,'effective_date',p_effective_date,'amount',v_amount::text,'reason',btrim(p_reason),'journal_entry_id',v_journal_id));
  PERFORM finance_private.enqueue_outbox_event(p_organization_id,'document.posted',v_reversal_id,'document.posted:'||v_reversal_id::text,
    jsonb_build_object('document_id',v_reversal_id,'reversal_of_document_id',p_document_id,'journal_entry_id',v_journal_id));
  RETURN QUERY SELECT v_reversal_id,v_number,v_journal_id,p_effective_date;
END $$;
REVOKE ALL ON FUNCTION public.unapply_advance_application(uuid,uuid,text,text,text,date,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.unapply_advance_application(uuid,uuid,text,text,text,date,text) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
