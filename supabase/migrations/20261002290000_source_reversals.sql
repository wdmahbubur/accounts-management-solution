-- US-037: reverse posted sources with exact opposite lines; preserve both ledger records.
BEGIN;

CREATE FUNCTION public.reverse_posted_document(p_organization_id uuid,p_source_document_id uuid,p_reversal_date date,p_reason text,
 p_request_id text,p_idempotency_key text,p_request_hash text)
RETURNS TABLE(reversal_document_id uuid,document_number text,journal_entry_id uuid,reversal_date date,state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_source finance.business_documents%ROWTYPE; v_source_entry finance.journal_entries%ROWTYPE; v_period_id uuid;
 v_period finance.accounting_periods%ROWTYPE; v_id uuid:=gen_random_uuid(); v_entry_id uuid; v_number text; v_hash text; v_key_actor uuid; v_receipt jsonb;
 v_line record; v_source_item finance.open_items%ROWTYPE; v_reversal_item finance.open_items%ROWTYPE; v_alloc record; v_reverse_line uuid; v_amount finance.amount; v_source_date date;
 v_debits finance.amount; v_credits finance.amount; v_alloc_reversal_id uuid;
BEGIN
 PERFORM finance_private.validate_request_id(p_request_id);
 IF p_source_document_id IS NULL OR p_reversal_date IS NULL OR NOT isfinite(p_reversal_date) OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 10 AND 800 OR
  p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 22 AND 172 OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'invalid source reversal request' USING ERRCODE='22023'; END IF;
 v_actor:=finance_private.require_capability(p_organization_id,'journal.post');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':documents.reverse:'||p_source_document_id::text||':'||p_idempotency_key,0));
 SELECT i.request_hash,i.actor_member_id,i.response_body INTO v_hash,v_key_actor,v_receipt FROM finance.idempotency_requests i
  WHERE i.organization_id=p_organization_id AND i.operation='documents.reverse:'||p_source_document_id::text AND i.idempotency_key=p_idempotency_key FOR UPDATE;
 IF FOUND THEN
  IF v_hash<>p_request_hash OR v_key_actor<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505'; END IF;
  RETURN QUERY SELECT (v_receipt->>'reversal_document_id')::uuid,v_receipt->>'document_number',(v_receipt->>'journal_entry_id')::uuid,
   (v_receipt->>'reversal_date')::date,v_receipt->>'state'; RETURN;
 END IF;
 -- Period/year first, then source, then open items in UUID order, matching the posting lock protocol.
 SELECT d.accounting_date INTO v_source_date FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_source_document_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'source unavailable' USING ERRCODE='P0002'; END IF;
 IF p_reversal_date<v_source_date THEN RAISE EXCEPTION 'reversal cannot predate its source' USING ERRCODE='23514'; END IF;
 v_period_id:=finance_private.lock_accounting_date(p_organization_id,p_reversal_date,false);
 SELECT * INTO v_period FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.id=v_period_id;
 SELECT * INTO v_source FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_source_document_id FOR UPDATE;
 IF v_source.state<>'posted' OR v_source.document_type IN ('reversal','opening_balance','year_close') THEN
  RAISE EXCEPTION 'only eligible posted source documents can be reversed' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.reversal_of_document_id=v_source.id) THEN
  RAISE EXCEPTION 'source already has a reversal' USING ERRCODE='P0001'; END IF;
 IF v_period.kind<>'regular' THEN RAISE EXCEPTION 'reversal requires an open regular accounting period' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_source_entry FROM finance.journal_entries j WHERE j.organization_id=p_organization_id AND j.source_document_id=v_source.id AND j.state='posted';
 IF NOT FOUND THEN RAISE EXCEPTION 'posted source journal unavailable' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM finance.reconciliation_matches m JOIN finance.reconciliations r ON r.organization_id=m.organization_id AND r.id=m.reconciliation_id
   JOIN finance.journal_lines l ON l.organization_id=m.organization_id AND l.id=m.journal_line_id
   WHERE m.organization_id=p_organization_id AND l.journal_entry_id=v_source_entry.id AND r.state='finalized') THEN
  RAISE EXCEPTION 'reopen the finalized bank reconciliation before reversing this cash source' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM finance.reconciliation_matches m JOIN finance.journal_lines l ON l.organization_id=m.organization_id AND l.id=m.journal_line_id
   JOIN finance.reconciliations r ON r.organization_id=m.organization_id AND r.id=m.reconciliation_id
   WHERE m.organization_id=p_organization_id AND l.journal_entry_id=v_source_entry.id AND r.state='draft') THEN
  RAISE EXCEPTION 'remove draft reconciliation matches before reversing this cash source' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM finance.trade_documents td JOIN finance.business_documents child ON child.organization_id=td.organization_id AND child.id=td.document_id
   WHERE td.organization_id=p_organization_id AND td.original_document_id=v_source.id AND child.state='posted') THEN
  RAISE EXCEPTION 'reverse or resolve posted credit documents before reversing their original source' USING ERRCODE='55000'; END IF;
 -- Lock all source items and every counterparty item before appending dated allocation reversals.
 PERFORM oi.id FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND (
   EXISTS(SELECT 1 FROM finance.journal_lines l WHERE l.organization_id=oi.organization_id AND l.id=oi.journal_line_id AND l.journal_entry_id=v_source_entry.id) OR
   EXISTS(SELECT 1 FROM finance.settlement_allocations a JOIN finance.open_items own ON own.organization_id=a.organization_id AND (own.id=a.debit_open_item_id OR own.id=a.credit_open_item_id)
     JOIN finance.journal_lines sl ON sl.organization_id=own.organization_id AND sl.id=own.journal_line_id
     WHERE a.organization_id=oi.organization_id AND sl.journal_entry_id=v_source_entry.id AND (oi.id=a.debit_open_item_id OR oi.id=a.credit_open_item_id)))
   ORDER BY oi.id FOR UPDATE;
 PERFORM a.id FROM finance.settlement_allocations a WHERE a.organization_id=p_organization_id AND NOT EXISTS(
   SELECT 1 FROM finance.allocation_reversals ar WHERE ar.organization_id=a.organization_id AND ar.allocation_id=a.id) AND EXISTS(
    SELECT 1 FROM finance.open_items oi JOIN finance.journal_lines l ON l.organization_id=oi.organization_id AND l.id=oi.journal_line_id
    WHERE oi.organization_id=a.organization_id AND (oi.id=a.debit_open_item_id OR oi.id=a.credit_open_item_id) AND l.journal_entry_id=v_source_entry.id)
   ORDER BY a.id FOR UPDATE;
 FOR v_alloc IN SELECT a.* FROM finance.settlement_allocations a WHERE a.organization_id=p_organization_id AND NOT EXISTS(
   SELECT 1 FROM finance.allocation_reversals ar WHERE ar.organization_id=a.organization_id AND ar.allocation_id=a.id) AND EXISTS(
    SELECT 1 FROM finance.open_items oi JOIN finance.journal_lines l ON l.organization_id=oi.organization_id AND l.id=oi.journal_line_id
    WHERE oi.organization_id=a.organization_id AND (oi.id=a.debit_open_item_id OR oi.id=a.credit_open_item_id) AND l.journal_entry_id=v_source_entry.id)
   ORDER BY a.id LOOP
  IF p_reversal_date<v_alloc.effective_date THEN RAISE EXCEPTION 'reversal date predates a dependent settlement' USING ERRCODE='23514'; END IF;
  PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_alloc.debit_open_item_id,-v_alloc.amount,p_reversal_date);
  PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_alloc.credit_open_item_id,-v_alloc.amount,p_reversal_date);
  INSERT INTO finance.allocation_reversals(organization_id,allocation_id,effective_date,reason,created_by_member_id)
   VALUES(p_organization_id,v_alloc.id,p_reversal_date,'Source reversal: '||btrim(p_reason),v_actor) RETURNING id INTO v_alloc_reversal_id;
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'allocation.reversed_for_source','allocation_reversal',v_alloc_reversal_id,p_request_id,
   jsonb_build_object('allocation_id',v_alloc.id,'effective_date',p_reversal_date,'amount',v_alloc.amount::text,'source_document_id',v_source.id,'reason',btrim(p_reason)));
 END LOOP;
 INSERT INTO finance.business_documents(organization_id,document_type,state,fiscal_year_id,party_id,issue_date,accounting_date,description,currency,
   net_amount,tax_amount,total_amount,party_snapshot,version,created_by_member_id,reversal_of_document_id,correction_reason,material_digest)
 VALUES(p_organization_id,'reversal','approved',v_period.fiscal_year_id,v_source.party_id,p_reversal_date,p_reversal_date,
   'Reversal of '||COALESCE(v_source.document_number,v_source.id::text),v_source.currency,v_source.net_amount,v_source.tax_amount,v_source.total_amount,
   v_source.party_snapshot,1,v_actor,v_source.id,btrim(p_reason),p_request_hash) RETURNING id INTO v_id;
 v_number:=finance_private.allocate_document_number(p_organization_id,v_id);
 INSERT INTO finance.journal_entries(organization_id,source_document_id,period_id,accounting_date,state,is_opening,posted_by_member_id)
  VALUES(p_organization_id,v_id,v_period_id,p_reversal_date,'building',false,v_actor) RETURNING id INTO v_entry_id;
 FOR v_line IN SELECT l.* FROM finance.journal_lines l WHERE l.organization_id=p_organization_id AND l.journal_entry_id=v_source_entry.id ORDER BY l.line_no LOOP
  v_amount:=CASE WHEN v_line.debit>0 THEN v_line.debit ELSE v_line.credit END;
  v_reverse_line:=finance_private.insert_posting_line(p_organization_id,v_entry_id,v_line.line_no,v_line.account_id,v_line.party_id,v_line.cost_center_id,
   v_line.credit,v_line.debit,'Reversal of '||COALESCE(v_source.document_number,v_source.id::text)||': '||btrim(p_reason),v_line.cash_flow_class,
   CASE WHEN EXISTS(SELECT 1 FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=v_line.account_id AND a.control_kind IS NOT NULL) THEN v_number ELSE NULL END,NULL);
  SELECT * INTO v_source_item FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.journal_line_id=v_line.id;
  IF FOUND THEN
   SELECT * INTO v_reversal_item FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.journal_line_id=v_reverse_line;
   IF NOT FOUND OR v_reversal_item.party_id<>v_source_item.party_id OR v_reversal_item.account_id<>v_source_item.account_id OR v_reversal_item.original_amount<>v_source_item.original_amount OR v_reversal_item.side=v_source_item.side THEN
    RAISE EXCEPTION 'reversal open item does not exactly oppose its source' USING ERRCODE='23514'; END IF;
   PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_source_item.id,v_amount,p_reversal_date);
   PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_reversal_item.id,v_amount,p_reversal_date);
   INSERT INTO finance.settlement_allocations(organization_id,debit_open_item_id,credit_open_item_id,amount,effective_date,created_by_member_id,source_document_id)
    VALUES(p_organization_id,CASE WHEN v_source_item.side='debit' THEN v_source_item.id ELSE v_reversal_item.id END,
     CASE WHEN v_source_item.side='credit' THEN v_source_item.id ELSE v_reversal_item.id END,v_amount,p_reversal_date,v_actor,v_id);
  END IF;
 END LOOP;
 SELECT COALESCE(sum(l.debit),0)::finance.amount,COALESCE(sum(l.credit),0)::finance.amount INTO v_debits,v_credits FROM finance.journal_lines l
  WHERE l.organization_id=p_organization_id AND l.journal_entry_id=v_entry_id;
 IF v_debits<=0 OR v_debits<>v_credits OR v_debits<>v_source.total_amount THEN RAISE EXCEPTION 'reversal does not exactly balance to source' USING ERRCODE='23514'; END IF;
 UPDATE finance.journal_entries SET state='posted',posted_at=clock_timestamp() WHERE organization_id=p_organization_id AND id=v_entry_id;
 UPDATE finance.business_documents SET state='posted',document_number=v_number,posted_by_member_id=v_actor,posted_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE organization_id=p_organization_id AND id=v_id;
 v_receipt:=jsonb_build_object('reversal_document_id',v_id,'document_number',v_number,'journal_entry_id',v_entry_id,'reversal_date',p_reversal_date,'state','posted');
 INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body,resource_document_id)
  VALUES(p_organization_id,'documents.reverse:'||p_source_document_id::text,p_idempotency_key,p_request_hash,v_actor,200,v_receipt,v_id);
 PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'document.reverse','business_document',v_id,p_request_id,
  jsonb_build_object('source_document_id',v_source.id,'reversal_date',p_reversal_date,'reason',btrim(p_reason),'document_number',v_number,'journal_entry_id',v_entry_id,
   'debit_total',v_debits::text,'credit_total',v_credits::text));
 PERFORM finance_private.enqueue_outbox_event(p_organization_id,'document.reversed',v_id,'document.reversed:'||v_id::text,
  jsonb_build_object('source_document_id',v_source.id,'reversal_document_id',v_id,'journal_entry_id',v_entry_id,'effective_date',p_reversal_date));
 RETURN QUERY SELECT v_id,v_number,v_entry_id,p_reversal_date,'posted'::text;
END $$;
REVOKE ALL ON FUNCTION public.reverse_posted_document(uuid,uuid,date,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_posted_document(uuid,uuid,date,text,text,text,text) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
