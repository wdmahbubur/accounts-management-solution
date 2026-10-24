-- US-041 (including consolidated US-042/043), US-039/040.
-- Additive, forward-only. Roll back application code; retain posted evidence.
-- One application targets one invoice/bill; repeat for multiple targets.
CREATE TABLE finance.linked_settlement_details (
  organization_id uuid NOT NULL,
  document_id uuid NOT NULL,
  document_version integer NOT NULL CHECK (document_version > 0),
  source_open_item_id uuid NOT NULL,
  target_open_item_id uuid,
  amount finance.amount NOT NULL CHECK (amount > 0),
  PRIMARY KEY (organization_id, document_id),
  FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents(organization_id,id),
  FOREIGN KEY (organization_id, source_open_item_id) REFERENCES finance.open_items(organization_id,id),
  FOREIGN KEY (organization_id, target_open_item_id) REFERENCES finance.open_items(organization_id,id),
  CHECK (source_open_item_id IS DISTINCT FROM target_open_item_id)
);
ALTER TABLE finance.linked_settlement_details ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.linked_settlement_details FROM PUBLIC, ams_runtime;
CREATE TRIGGER linked_settlement_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON finance.linked_settlement_details
  FOR EACH ROW EXECUTE FUNCTION finance_private.guard_draft_child();

-- Shared by draft validation, preview and posting; never writes financial facts.
CREATE FUNCTION finance_private.validate_linked_settlement(p_organization_id uuid,p_document_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE d finance.business_documents%ROWTYPE; s finance.linked_settlement_details%ROWTYPE;
  a finance.open_items%ROWTYPE; t finance.open_items%ROWTYPE; v_type finance.document_type;
BEGIN
  SELECT x.* INTO d FROM finance.business_documents x WHERE x.organization_id=p_organization_id AND x.id=p_document_id;
  SELECT x.* INTO s FROM finance.linked_settlement_details x WHERE x.organization_id=p_organization_id AND x.document_id=p_document_id;
  IF s.document_id IS NULL OR s.document_version<>d.version OR s.amount<>d.total_amount OR d.currency<>'BDT' THEN
    RAISE EXCEPTION 'current linked eligible balance is required' USING ERRCODE='23514'; END IF;
  SELECT x.* INTO a FROM finance.open_items x WHERE x.organization_id=p_organization_id AND x.id=s.source_open_item_id;
  SELECT j.document_type INTO v_type FROM finance.business_documents j JOIN finance.journal_entries e
    ON e.organization_id=j.organization_id AND e.source_document_id=j.id
    JOIN finance.journal_lines l ON l.organization_id=e.organization_id AND l.journal_entry_id=e.id
    WHERE l.organization_id=p_organization_id AND l.id=a.journal_line_id AND j.state='posted' AND e.state='posted'
      AND NOT EXISTS(SELECT 1 FROM finance.business_documents r WHERE r.organization_id=j.organization_id AND r.reversal_of_document_id=j.id);
  IF v_type IS NULL OR a.party_id IS DISTINCT FROM d.party_id OR a.issue_date>d.accounting_date OR NOT EXISTS(
    SELECT 1 FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=d.party_id AND c.is_active
      AND CASE WHEN a.control_kind IN ('ar','customer_advance') THEN c.is_customer ELSE c.is_vendor END
  ) THEN RAISE EXCEPTION 'linked source is unavailable' USING ERRCODE='23514'; END IF;
  IF d.document_type='advance_application' THEN
    IF NOT ((v_type='customer_advance' AND a.control_kind='customer_advance' AND a.side='credit') OR
      (v_type='vendor_advance' AND a.control_kind='vendor_advance' AND a.side='debit')) THEN
      RAISE EXCEPTION 'application requires a true advance' USING ERRCODE='23514'; END IF;
    SELECT x.* INTO t FROM finance.open_items x WHERE x.organization_id=p_organization_id AND x.id=s.target_open_item_id;
    IF t.id IS NULL OR t.party_id<>a.party_id OR t.issue_date>d.accounting_date OR
      t.control_kind<>(CASE WHEN a.control_kind='customer_advance' THEN 'ar' ELSE 'ap' END) OR
      t.side<>(CASE WHEN a.side='credit' THEN 'debit' ELSE 'credit' END) OR NOT EXISTS(
        SELECT 1 FROM finance.journal_lines l JOIN finance.journal_entries e ON e.organization_id=l.organization_id AND e.id=l.journal_entry_id
        JOIN finance.business_documents x ON x.organization_id=e.organization_id AND x.id=e.source_document_id
        WHERE l.organization_id=p_organization_id AND l.id=t.journal_line_id AND e.state='posted' AND x.state='posted'
          AND x.document_type=CASE WHEN a.control_kind='customer_advance' THEN 'invoice'::finance.document_type ELSE 'bill'::finance.document_type END
          AND NOT EXISTS(SELECT 1 FROM finance.business_documents r WHERE r.organization_id=x.organization_id AND r.reversal_of_document_id=x.id)
      ) THEN RAISE EXCEPTION 'application requires a compatible posted invoice or bill' USING ERRCODE='23514'; END IF;
    PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,t.id,s.amount,d.accounting_date);
  ELSIF d.document_type='customer_refund' THEN
    IF s.target_open_item_id IS NOT NULL OR a.side<>'credit' OR NOT (
      (a.control_kind='customer_advance' AND v_type='customer_advance') OR
      (a.control_kind='ar' AND v_type IN ('customer_credit','receipt'))
    ) THEN RAISE EXCEPTION 'customer refund requires eligible customer credit or unused advance' USING ERRCODE='23514'; END IF;
  ELSIF d.document_type='vendor_refund' THEN
    IF s.target_open_item_id IS NOT NULL OR a.side<>'debit' OR NOT (
      (a.control_kind='vendor_advance' AND v_type='vendor_advance') OR
      (a.control_kind='ap' AND v_type IN ('vendor_credit','vendor_payment'))
    ) THEN RAISE EXCEPTION 'supplier refund requires eligible supplier credit or unused advance' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'invalid linked settlement type' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM finance.accounts x WHERE x.organization_id=p_organization_id AND x.id=a.account_id AND x.is_active AND x.is_postable)
    OR (t.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM finance.accounts x WHERE x.organization_id=p_organization_id AND x.id=t.account_id AND x.is_active AND x.is_postable)) THEN
    RAISE EXCEPTION 'linked control account is unavailable' USING ERRCODE='23514'; END IF;
  PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,a.id,s.amount,d.accounting_date);
END; $$;
REVOKE ALL ON FUNCTION finance_private.validate_linked_settlement(uuid,uuid) FROM PUBLIC,ams_runtime;

CREATE FUNCTION public.save_linked_settlement_draft(p_organization_id uuid,p_document_id uuid,p_expected_version integer,
  p_request_id text,p_idempotency_key text,p_request_hash text,p_payload jsonb)
RETURNS TABLE(document_id uuid,document_version integer,state text,total_amount finance.amount,material_digest text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_type finance.document_type; v_source finance.open_items%ROWTYPE; v_doc finance.business_documents%ROWTYPE;
  v_date date; v_amount finance.amount; v_id uuid:=COALESCE(p_document_id,gen_random_uuid()); v_version integer;
  v_period uuid; v_hash text; v_key_actor uuid; v_receipt jsonb; v_cash uuid;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>10000 OR
    (p_payload-'document_type'-'source_open_item_id'-'target_open_item_id'-'accounting_date'-'amount'-'description'-'cash_account_id'-'reference'-'cash_flow_class')<>'{}'::jsonb OR
    p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{22,172}$' OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid linked settlement request' USING ERRCODE='22023'; END IF;
  v_type:=(p_payload->>'document_type')::finance.document_type;
  IF v_type IS NULL OR v_type NOT IN ('advance_application','customer_refund','vendor_refund') THEN
    RAISE EXCEPTION 'invalid linked settlement type' USING ERRCODE='22023'; END IF;
  v_actor:=finance_private.require_capability(p_organization_id,CASE WHEN v_type='customer_refund' THEN 'sales.write' WHEN v_type='vendor_refund' THEN 'purchases.write' ELSE 'journal.write' END);
  PERFORM finance_private.require_capability(p_organization_id,'dues.allocate');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':linked-settlements.save:'||p_idempotency_key,0));
  SELECT i.request_hash,i.actor_member_id,i.response_body INTO v_hash,v_key_actor,v_receipt FROM finance.idempotency_requests i
    WHERE i.organization_id=p_organization_id AND i.operation='linked-settlements.save' AND i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_hash<>p_request_hash OR v_key_actor<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505'; END IF;
    RETURN QUERY SELECT (v_receipt->>'document_id')::uuid,(v_receipt->>'document_version')::integer,v_receipt->>'state',
      (v_receipt->>'total_amount')::finance.amount,v_receipt->>'material_digest'; RETURN;
  END IF;
  PERFORM finance_private.require_decimal_string(p_payload->'amount',2,false);
  v_amount:=(p_payload->>'amount')::finance.amount; v_date:=(p_payload->>'accounting_date')::date;
  IF v_date IS NULL OR NOT isfinite(v_date) OR v_amount<=0 OR length(btrim(COALESCE(p_payload->>'description',''))) NOT BETWEEN 1 AND 500
    OR length(COALESCE(p_payload->>'reference',''))>160 THEN RAISE EXCEPTION 'amount, date and description required' USING ERRCODE='22023'; END IF;
  v_period:=finance_private.lock_accounting_date(p_organization_id,v_date,false);
  IF NOT EXISTS(SELECT 1 FROM finance.organizations o WHERE o.id=p_organization_id AND o.status='active' AND o.books_start_date<=v_date) THEN
    RAISE EXCEPTION 'company is not writable on this date' USING ERRCODE='42501'; END IF;
  IF p_document_id IS NOT NULL THEN
    SELECT d.* INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=v_id FOR UPDATE;
    IF NOT FOUND OR v_doc.document_type<>v_type OR v_doc.state IN ('posted','void') OR p_expected_version IS NULL OR v_doc.version<>p_expected_version THEN
      RAISE EXCEPTION 'settlement draft version is stale' USING ERRCODE='40001'; END IF;
  END IF;
  SELECT x.* INTO v_source FROM finance.open_items x WHERE x.organization_id=p_organization_id AND x.id=(p_payload->>'source_open_item_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'eligible source unavailable' USING ERRCODE='P0002'; END IF;
  IF v_type='advance_application' AND (NULLIF(p_payload->>'cash_account_id','') IS NOT NULL OR NULLIF(p_payload->>'cash_flow_class','') IS NOT NULL) THEN
    RAISE EXCEPTION 'advance application does not move cash' USING ERRCODE='23514'; END IF;
  IF v_type<>'advance_application' THEN
    v_cash:=NULLIF(p_payload->>'cash_account_id','')::uuid;
    IF v_cash IS NULL OR NOT EXISTS(SELECT 1 FROM finance.cash_accounts c JOIN finance.accounts a ON a.organization_id=c.organization_id AND a.id=c.account_id
      WHERE c.organization_id=p_organization_id AND c.id=v_cash AND c.is_active AND a.is_active AND a.is_postable AND a.control_kind IS NULL)
      OR COALESCE(p_payload->>'cash_flow_class','') NOT IN ('operating','investing','financing') THEN
      RAISE EXCEPTION 'refund requires an active cash account and cash classification' USING ERRCODE='23514'; END IF;
  END IF;
  IF p_document_id IS NULL THEN
    INSERT INTO finance.business_documents(id,organization_id,document_type,fiscal_year_id,party_id,issue_date,accounting_date,description,currency,
      net_amount,tax_amount,total_amount,version,created_by_member_id,party_snapshot,material_digest,external_reference)
      SELECT v_id,p_organization_id,v_type,p.fiscal_year_id,v_source.party_id,v_date,v_date,btrim(p_payload->>'description'),'BDT',v_amount,0,v_amount,1,v_actor,
        jsonb_build_object('display_name',c.display_name,'legal_name',c.legal_name),p_request_hash,NULLIF(p_payload->>'reference','')
      FROM finance.accounting_periods p JOIN finance.contacts c ON c.organization_id=p_organization_id AND c.id=v_source.party_id
      WHERE p.organization_id=p_organization_id AND p.id=v_period;
    v_version:=1;
  ELSE
    UPDATE finance.approval_requests ar SET state='superseded' WHERE ar.organization_id=p_organization_id AND ar.document_id=v_id AND ar.state IN ('pending','approved');
    UPDATE finance.business_documents d SET fiscal_year_id=(SELECT p.fiscal_year_id FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.id=v_period),
      party_id=v_source.party_id,issue_date=v_date,accounting_date=v_date,description=btrim(p_payload->>'description'),external_reference=NULLIF(p_payload->>'reference',''),
      net_amount=v_amount,total_amount=v_amount,version=d.version+1,state='draft',material_digest=p_request_hash,updated_at=clock_timestamp(),
      party_snapshot=(SELECT jsonb_build_object('display_name',c.display_name,'legal_name',c.legal_name) FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=v_source.party_id)
      WHERE d.organization_id=p_organization_id AND d.id=v_id RETURNING d.version INTO v_version;
    DELETE FROM finance.linked_settlement_details s WHERE s.organization_id=p_organization_id AND s.document_id=v_id;
    DELETE FROM finance.money_movements m WHERE m.organization_id=p_organization_id AND m.document_id=v_id;
    DELETE FROM finance.document_allocation_plans p WHERE p.organization_id=p_organization_id AND p.document_id=v_id;
  END IF;
  INSERT INTO finance.linked_settlement_details(organization_id,document_id,document_version,source_open_item_id,target_open_item_id,amount)
    VALUES(p_organization_id,v_id,v_version,v_source.id,NULLIF(p_payload->>'target_open_item_id','')::uuid,v_amount);
  IF v_type<>'advance_application' THEN
    INSERT INTO finance.money_movements(organization_id,document_id,cash_account_id,direction,amount,method,reference,cash_flow_class)
      VALUES(p_organization_id,v_id,v_cash,CASE WHEN v_type='customer_refund' THEN 'out' ELSE 'in' END,v_amount,'bank_transfer',NULLIF(p_payload->>'reference',''),(p_payload->>'cash_flow_class')::finance.cash_flow_class);
  END IF;
  PERFORM finance_private.validate_linked_settlement(p_organization_id,v_id);
  v_receipt:=jsonb_build_object('document_id',v_id,'document_version',v_version,'state','draft','total_amount',v_amount::text,'material_digest',p_request_hash);
  INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body,resource_document_id)
    VALUES(p_organization_id,'linked-settlements.save',p_idempotency_key,p_request_hash,v_actor,200,v_receipt,v_id);
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'linked_settlement.draft.save','business_document',v_id,p_request_id,
    jsonb_build_object('version',v_version,'source_open_item_id',v_source.id,'target_open_item_id',p_payload->>'target_open_item_id','amount',v_amount::text));
  RETURN QUERY SELECT v_id,v_version,'draft'::text,v_amount,p_request_hash;
END; $$;
REVOKE ALL ON FUNCTION public.save_linked_settlement_draft(uuid,uuid,integer,text,text,text,jsonb) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.save_linked_settlement_draft(uuid,uuid,integer,text,text,text,jsonb) TO ams_runtime;

CREATE FUNCTION finance_private.post_linked_settlement(p_organization_id uuid,p_document_id uuid,p_journal_id uuid,p_number text,p_actor uuid,p_request_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d finance.business_documents%ROWTYPE; s finance.linked_settlement_details%ROWTYPE; a finance.open_items%ROWTYPE; t finance.open_items%ROWTYPE;
  v_line uuid; v_item uuid; v_alloc uuid; v_customer boolean; v_pair record;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'dues.allocate');
  PERFORM finance_private.validate_linked_settlement(p_organization_id,p_document_id);
  SELECT x.* INTO d FROM finance.business_documents x WHERE x.organization_id=p_organization_id AND x.id=p_document_id;
  SELECT x.* INTO s FROM finance.linked_settlement_details x WHERE x.organization_id=p_organization_id AND x.document_id=p_document_id;
  SELECT x.* INTO a FROM finance.open_items x WHERE x.organization_id=p_organization_id AND x.id=s.source_open_item_id;
  IF d.document_type='advance_application' THEN
    SELECT x.* INTO t FROM finance.open_items x WHERE x.organization_id=p_organization_id AND x.id=s.target_open_item_id;
    FOR v_pair IN SELECT p.* FROM finance_private.cash_document_posting_plan(p_organization_id,p_document_id) p ORDER BY p.line_no LOOP
      PERFORM finance_private.insert_posting_line(p_organization_id,p_journal_id,v_pair.line_no,v_pair.account_id,v_pair.party_id,NULL,
        v_pair.debit,v_pair.credit,v_pair.description,NULL,p_number,NULL);
    END LOOP;
  END IF;
  -- Cash refund lines have already been constructed by the same preview planner.
  FOR v_pair IN SELECT x.* FROM finance.open_items x WHERE x.organization_id=p_organization_id AND x.id IN (s.source_open_item_id,s.target_open_item_id) ORDER BY x.id LOOP
    SELECT oi.id INTO v_item FROM finance.open_items oi JOIN finance.journal_lines l ON l.organization_id=oi.organization_id AND l.id=oi.journal_line_id
      WHERE l.organization_id=p_organization_id AND l.journal_entry_id=p_journal_id AND oi.account_id=v_pair.account_id AND oi.side<>v_pair.side;
    IF v_item IS NULL THEN RAISE EXCEPTION 'settlement opposite item unavailable' USING ERRCODE='23514'; END IF;
    PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_pair.id,s.amount,d.accounting_date);
    PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_item,s.amount,d.accounting_date);
    INSERT INTO finance.settlement_allocations(organization_id,debit_open_item_id,credit_open_item_id,amount,effective_date,created_by_member_id,source_document_id)
      VALUES(p_organization_id,CASE WHEN v_pair.side='debit' THEN v_pair.id ELSE v_item END,
        CASE WHEN v_pair.side='credit' THEN v_pair.id ELSE v_item END,s.amount,d.accounting_date,p_actor,p_document_id) RETURNING id INTO v_alloc;
    PERFORM finance_private.write_role_audit(p_organization_id,p_actor,'allocation.created','settlement_allocation',v_alloc,p_request_id,
      jsonb_build_object('amount',s.amount::text,'source_document_id',p_document_id,'target_open_item_id',v_pair.id,'settlement_open_item_id',v_item,'effective_date',d.accounting_date));
  END LOOP;
END; $$;
REVOKE ALL ON FUNCTION finance_private.post_linked_settlement(uuid,uuid,uuid,text,uuid,text) FROM PUBLIC,ams_runtime;

-- Surgical extensions keep the shared approval, number, locking, audit, outbox
-- and cash-floor command authoritative. Normalize only for cross-platform anchors.
DO $$
DECLARE f text;
BEGIN
  f:=replace(pg_get_functiondef('finance_private.cash_document_posting_plan(uuid,uuid)'::regprocedure),E'\r\n',E'\n');
  f:=replace(f,$old$  IF v_doc.document_type IN ('receipt','vendor_payment','customer_refund','vendor_refund','customer_advance','vendor_advance') THEN$old$,
    $new$  IF v_doc.document_type='advance_application' THEN
    PERFORM finance_private.validate_linked_settlement(p_organization_id,p_document_id);
    RETURN QUERY SELECT row_number() OVER (ORDER BY x.ord)::integer,oi.account_id,v_doc.party_id,NULL::uuid,
      CASE WHEN oi.side='credit' THEN s.amount ELSE 0::finance.amount END,
      CASE WHEN oi.side='debit' THEN s.amount ELSE 0::finance.amount END,
      v_doc.description,NULL::finance.cash_flow_class,true,NULL::date
      FROM finance.linked_settlement_details s
      CROSS JOIN LATERAL (VALUES(s.source_open_item_id,1),(s.target_open_item_id,2)) x(id,ord)
      JOIN finance.open_items oi ON oi.organization_id=s.organization_id AND oi.id=x.id
      WHERE s.organization_id=p_organization_id AND s.document_id=p_document_id;
  ELSIF v_doc.document_type IN ('receipt','vendor_payment','customer_refund','vendor_refund','customer_advance','vendor_advance') THEN$new$);
  f:=replace(f,$old$RAISE EXCEPTION 'linked eligible-credit refund workflow is not enabled' USING ERRCODE = '23514';$old$,
    $new$PERFORM finance_private.validate_linked_settlement(p_organization_id,p_document_id);$new$);
  f:=replace(f,'    -- Retain the posting command''s existing AR prerequisite',
    $new$    IF v_doc.document_type IN ('customer_refund','vendor_refund') THEN
      SELECT oi.account_id,oi.control_kind INTO v_control,v_control_kind FROM finance.linked_settlement_details s
        JOIN finance.open_items oi ON oi.organization_id=s.organization_id AND oi.id=s.source_open_item_id
        WHERE s.organization_id=p_organization_id AND s.document_id=p_document_id;
    END IF;
    -- Retain the posting command's existing AR prerequisite$new$);
  EXECUTE f;
  f:=replace(pg_get_functiondef('public.preview_cash_document_posting(uuid,uuid,integer)'::regprocedure),
    $old$WHEN v_doc.document_type = 'transfer' THEN 'banking.write' END$old$,
    $new$WHEN v_doc.document_type = 'advance_application' THEN 'journal.write'
    WHEN v_doc.document_type = 'transfer' THEN 'banking.write' END$new$);
  EXECUTE f;
  f:=replace(pg_get_functiondef('public.post_financial_document(uuid,uuid,integer,text,text,text)'::regprocedure),E'\r\n',E'\n');
  f:=replace(f,'  v_number:=finance_private.allocate_document_number',
    $new$  PERFORM oi.id FROM finance.open_items oi JOIN finance.linked_settlement_details s
    ON s.organization_id=oi.organization_id AND oi.id IN (s.source_open_item_id,s.target_open_item_id)
    WHERE s.organization_id=p_organization_id AND s.document_id=p_document_id ORDER BY oi.id FOR UPDATE OF oi;
  IF v_type IN ('advance_application','customer_refund','vendor_refund') THEN
    PERFORM finance_private.require_capability(p_organization_id,'dues.allocate');
    PERFORM finance_private.validate_linked_settlement(p_organization_id,p_document_id);
  END IF;
  v_number:=finance_private.allocate_document_number$new$);
  f:=replace(f,$old$  ELSIF v_type IN ('manual_journal','controlled_adjustment','opening_balance') THEN$old$,
    $new$  ELSIF v_type='advance_application' THEN
    PERFORM finance_private.post_linked_settlement(p_organization_id,p_document_id,v_journal_id,v_number,v_actor,p_request_id);
  ELSIF v_type IN ('manual_journal','controlled_adjustment','opening_balance') THEN$new$);
  f:=replace(f,'  SELECT COALESCE(sum(l.debit),0)::finance.amount,COALESCE(sum(l.credit),0)::finance.amount INTO v_total_debit,v_total_credit',
    $new$  IF v_type IN ('customer_refund','vendor_refund') THEN
    PERFORM finance_private.post_linked_settlement(p_organization_id,p_document_id,v_journal_id,v_number,v_actor,p_request_id);
  END IF;
  SELECT COALESCE(sum(l.debit),0)::finance.amount,COALESCE(sum(l.credit),0)::finance.amount INTO v_total_debit,v_total_credit$new$);
  IF position('ELSIF v_type=''advance_application''' IN f)=0 OR position('JOIN finance.linked_settlement_details s' IN f)=0 THEN RAISE EXCEPTION 'posting extension anchor missing'; END IF;
  EXECUTE f;
  f:=replace(pg_get_functiondef('public.reverse_open_item_allocation(uuid,uuid,text,text,text,text,date,text)'::regprocedure),E'\r\n',E'\n');
  f:=replace(f,'  IF p_effective_date<v_allocation.effective_date THEN',
    $new$  IF EXISTS(SELECT 1 FROM finance.linked_settlement_details s WHERE s.organization_id=p_organization_id AND s.document_id=v_allocation.source_document_id) THEN
    RAISE EXCEPTION 'reverse the linked settlement document to undo its allocations together' USING ERRCODE='55000'; END IF;
  IF p_effective_date<v_allocation.effective_date THEN$new$);
  EXECUTE f;
  f:=replace(pg_get_functiondef('public.reverse_posted_document(uuid,uuid,date,text,text,text,text)'::regprocedure),E'\r\n',E'\n');
  f:=replace(f,' -- Lock all source items and every counterparty item',
    $new$ IF EXISTS(SELECT 1 FROM finance.linked_settlement_details s JOIN finance.business_documents linked ON linked.organization_id=s.organization_id AND linked.id=s.document_id
   JOIN finance.open_items oi ON oi.organization_id=s.organization_id AND oi.id IN (s.source_open_item_id,s.target_open_item_id)
   JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
   WHERE s.organization_id=p_organization_id AND jl.journal_entry_id=v_source_entry.id AND linked.state='posted'
     AND NOT EXISTS(SELECT 1 FROM finance.business_documents r WHERE r.organization_id=linked.organization_id AND r.reversal_of_document_id=linked.id)) THEN
   RAISE EXCEPTION 'reverse dependent linked settlements before their source' USING ERRCODE='55000'; END IF;
 -- Lock all source items and every counterparty item$new$);
  EXECUTE f;
END $$;

NOTIFY pgrst,'reload schema';
