-- US-018: authorized source-to-ledger posting in one database transaction.
BEGIN;

CREATE FUNCTION finance_private.reject_financial_fact_truncate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'posted financial evidence cannot be truncated' USING ERRCODE='23514'; END $$;
REVOKE ALL ON FUNCTION finance_private.reject_financial_fact_truncate() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER journal_entries_no_truncate BEFORE TRUNCATE ON finance.journal_entries FOR EACH STATEMENT EXECUTE FUNCTION finance_private.reject_financial_fact_truncate();
CREATE TRIGGER journal_lines_no_truncate BEFORE TRUNCATE ON finance.journal_lines FOR EACH STATEMENT EXECUTE FUNCTION finance_private.reject_financial_fact_truncate();

CREATE FUNCTION finance_private.guard_journal_entry_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.state='posted' THEN RAISE EXCEPTION 'posted journals are immutable' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.state='posted' OR (NEW.organization_id,NEW.id,NEW.source_document_id,NEW.period_id,NEW.accounting_date,NEW.is_opening,
      NEW.is_year_close,NEW.posted_by_member_id,NEW.created_at) IS DISTINCT FROM
     (OLD.organization_id,OLD.id,OLD.source_document_id,OLD.period_id,OLD.accounting_date,OLD.is_opening,
      OLD.is_year_close,OLD.posted_by_member_id,OLD.created_at) OR
     NOT (OLD.state='building' AND NEW.state='posted' AND OLD.posted_at IS NULL AND NEW.posted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'journal entry may only transition once from building to posted' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_journal_entry_mutation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER journal_entries_immutable BEFORE UPDATE OR DELETE ON finance.journal_entries
  FOR EACH ROW EXECUTE FUNCTION finance_private.guard_journal_entry_mutation();

CREATE FUNCTION finance_private.validate_posted_journal_complete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_org uuid; v_entry uuid; v_header finance.journal_entries%ROWTYPE; v_document finance.business_documents%ROWTYPE;
  v_count integer; v_debits finance.amount; v_credits finance.amount; v_period finance.accounting_periods%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='journal_entries' THEN
    v_org:=COALESCE(NEW.organization_id,OLD.organization_id);v_entry:=COALESCE(NEW.id,OLD.id);
  ELSE
    v_org:=COALESCE(NEW.organization_id,OLD.organization_id);v_entry:=COALESCE(NEW.journal_entry_id,OLD.journal_entry_id);
  END IF;
  SELECT * INTO v_header FROM finance.journal_entries j WHERE j.organization_id=v_org AND j.id=v_entry;
  IF NOT FOUND OR v_header.state<>'posted' OR v_header.posted_at IS NULL THEN
    RAISE EXCEPTION 'a building or incomplete journal cannot commit' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_document FROM finance.business_documents d WHERE d.organization_id=v_org AND d.id=v_header.source_document_id;
  IF NOT FOUND OR v_document.state<>'posted' OR v_document.accounting_date<>v_header.accounting_date OR v_document.currency<>'BDT' THEN
    RAISE EXCEPTION 'posted journal must agree with a posted BDT source' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_period FROM finance.accounting_periods p WHERE p.organization_id=v_org AND p.id=v_header.period_id;
  IF NOT FOUND OR v_header.accounting_date NOT BETWEEN v_period.starts_on AND v_period.ends_on OR
     (v_period.kind='opening') IS DISTINCT FROM v_header.is_opening THEN
    RAISE EXCEPTION 'journal date does not belong to its period' USING ERRCODE='23514';
  END IF;
  SELECT count(*),COALESCE(sum(l.debit),0)::finance.amount,COALESCE(sum(l.credit),0)::finance.amount
    INTO v_count,v_debits,v_credits FROM finance.journal_lines l WHERE l.organization_id=v_org AND l.journal_entry_id=v_entry;
  IF v_count<2 OR v_debits<=0 OR v_debits<>v_credits OR v_debits<>v_document.total_amount THEN
    RAISE EXCEPTION 'posted journal must have at least two balanced positive lines that agree with the source total' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM finance.journal_entries j WHERE j.organization_id=v_org AND j.source_document_id=v_header.source_document_id AND j.state='posted')<>1 THEN
    RAISE EXCEPTION 'posted source must have exactly one journal' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION finance_private.validate_posted_journal_complete() FROM PUBLIC,anon,authenticated;
CREATE CONSTRAINT TRIGGER journal_entry_complete_check AFTER INSERT OR UPDATE ON finance.journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_private.validate_posted_journal_complete();
CREATE CONSTRAINT TRIGGER journal_lines_complete_check AFTER INSERT OR UPDATE OR DELETE ON finance.journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_private.validate_posted_journal_complete();

CREATE FUNCTION finance_private.insert_posting_line(p_organization_id uuid,p_journal_entry_id uuid,p_line_no integer,p_account_id uuid,
  p_party_id uuid,p_cost_center_id uuid,p_debit finance.amount,p_credit finance.amount,p_description text,p_cash_flow_class finance.cash_flow_class,
  p_open_item_reference text DEFAULT NULL,p_open_item_due_date date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_account finance.accounts%ROWTYPE; v_line_id uuid;
BEGIN
  SELECT * INTO v_account FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=p_account_id FOR SHARE;
  IF NOT FOUND OR NOT v_account.is_active OR NOT v_account.is_postable THEN RAISE EXCEPTION 'posting account is unavailable' USING ERRCODE='23514'; END IF;
  IF p_debit IS NULL OR p_credit IS NULL OR ((p_debit>0)=(p_credit>0)) THEN RAISE EXCEPTION 'journal line must have exactly one positive side' USING ERRCODE='23514'; END IF;
  INSERT INTO finance.journal_lines(organization_id,journal_entry_id,line_no,account_id,party_id,cost_center_id,debit,credit,description,cash_flow_class)
    VALUES(p_organization_id,p_journal_entry_id,p_line_no,p_account_id,p_party_id,p_cost_center_id,p_debit,p_credit,COALESCE(p_description,''),p_cash_flow_class)
    RETURNING id INTO v_line_id;
  IF v_account.control_kind IS NOT NULL THEN
    PERFORM finance_private.create_open_item_for_control_line(p_organization_id,v_line_id,p_open_item_reference,p_open_item_due_date);
  ELSIF p_party_id IS NOT NULL AND p_open_item_reference IS NOT NULL THEN
    RAISE EXCEPTION 'non-control lines cannot create open items' USING ERRCODE='23514';
  END IF;
  RETURN v_line_id;
END $$;
REVOKE ALL ON FUNCTION finance_private.insert_posting_line(uuid,uuid,integer,uuid,uuid,uuid,finance.amount,finance.amount,text,finance.cash_flow_class,text,date) FROM PUBLIC,anon,authenticated;

-- Use one public error contract for the posting and period-lock race.
CREATE OR REPLACE FUNCTION finance_private.lock_accounting_date(p_organization_id uuid,p_accounting_date date,p_allow_opening boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_books_start date; v_org_status text; v_period finance.accounting_periods%ROWTYPE; v_year_status text;
BEGIN
  IF p_accounting_date IS NULL OR NOT isfinite(p_accounting_date) THEN RAISE EXCEPTION 'accounting date required' USING ERRCODE='22023'; END IF;
  SELECT o.books_start_date,o.status INTO v_books_start,v_org_status FROM finance.organizations o WHERE o.id=p_organization_id FOR SHARE;
  IF NOT FOUND OR v_org_status='archived' THEN RAISE EXCEPTION 'organization unavailable' USING ERRCODE='P0002'; END IF;
  IF v_org_status<>'active' THEN RAISE EXCEPTION 'organization is not writable' USING ERRCODE='42501'; END IF;
  IF p_allow_opening AND p_accounting_date=v_books_start-1 THEN
    SELECT * INTO v_period FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.kind='opening' AND p.starts_on=p_accounting_date FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'opening period is unavailable' USING ERRCODE='23514'; END IF;
    IF v_period.status<>'open' THEN RAISE EXCEPTION 'accounting period is locked' USING ERRCODE='55P03'; END IF;
    RETURN v_period.id;
  END IF;
  IF p_accounting_date<v_books_start THEN RAISE EXCEPTION 'accounting date precedes books start' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_period FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.kind='regular'
    AND p.starts_on<=p_accounting_date AND p.ends_on>=p_accounting_date;
  IF NOT FOUND THEN RAISE EXCEPTION 'accounting date has no fiscal period' USING ERRCODE='23514'; END IF;
  SELECT fy.status INTO v_year_status FROM finance.fiscal_years fy WHERE fy.organization_id=p_organization_id AND fy.id=v_period.fiscal_year_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fiscal year unavailable' USING ERRCODE='23514'; END IF;
  IF v_year_status<>'open' THEN RAISE EXCEPTION 'fiscal year is closed' USING ERRCODE='55P03'; END IF;
  SELECT * INTO v_period FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.id=v_period.id FOR UPDATE;
  IF v_period.status<>'open' THEN RAISE EXCEPTION 'accounting period is locked' USING ERRCODE='55P03'; END IF;
  IF p_accounting_date NOT BETWEEN v_period.starts_on AND v_period.ends_on THEN RAISE EXCEPTION 'accounting date has no fiscal period' USING ERRCODE='23514'; END IF;
  RETURN v_period.id;
END $$;
REVOKE ALL ON FUNCTION finance_private.lock_accounting_date(uuid,date,boolean) FROM PUBLIC,anon,authenticated;

-- Posting is a controlled state transition on the same approved material version.
CREATE OR REPLACE FUNCTION finance_private.guard_source_document()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.state<>'draft' THEN RAISE EXCEPTION 'posted and approved documents cannot be deleted' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.state IN ('posted','void') THEN RAISE EXCEPTION 'posted and void documents are immutable' USING ERRCODE='23514'; END IF;
  IF NEW.version=OLD.version AND OLD.state='approved' AND NEW.state='posted' AND OLD.document_number IS NULL AND NEW.document_number IS NOT NULL AND
     NEW.posted_by_member_id IS NOT NULL AND NEW.posted_at IS NOT NULL AND
     (to_jsonb(NEW)-'state'-'document_number'-'posted_by_member_id'-'posted_at'-'updated_at')=
     (to_jsonb(OLD)-'state'-'document_number'-'posted_by_member_id'-'posted_at'-'updated_at') THEN RETURN NEW; END IF;
  IF NEW.version=OLD.version AND NEW.state IS DISTINCT FROM OLD.state AND (to_jsonb(NEW)-'state')=(to_jsonb(OLD)-'state') AND
    ((OLD.state='draft' AND NEW.state='pending_approval') OR (OLD.state='pending_approval' AND NEW.state IN ('approved','draft'))) THEN RETURN NEW; END IF;
  IF NEW.version=OLD.version AND
    (NEW.organization_id,NEW.id,NEW.document_type,NEW.state,NEW.document_number,NEW.fiscal_year_id,NEW.party_id,NEW.issue_date,
     NEW.accounting_date,NEW.due_date,NEW.external_reference,NEW.description,NEW.currency,NEW.rounding_adjustment,NEW.rounding_reason,NEW.rounding_account_id,NEW.party_snapshot,
     NEW.material_digest,NEW.created_by_member_id,NEW.posted_by_member_id,NEW.posted_at,NEW.reversal_of_document_id,NEW.correction_reason,
     NEW.import_source_key,NEW.updated_at,NEW.created_at)
    IS NOT DISTINCT FROM
    (OLD.organization_id,OLD.id,OLD.document_type,OLD.state,OLD.document_number,OLD.fiscal_year_id,OLD.party_id,OLD.issue_date,
     OLD.accounting_date,OLD.due_date,OLD.external_reference,OLD.description,OLD.currency,OLD.rounding_adjustment,OLD.rounding_reason,OLD.rounding_account_id,OLD.party_snapshot,
     OLD.material_digest,OLD.created_by_member_id,OLD.posted_by_member_id,OLD.posted_at,OLD.reversal_of_document_id,OLD.correction_reason,
     OLD.import_source_key,OLD.updated_at,OLD.created_at) THEN RETURN NEW; END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.document_type IS DISTINCT FROM OLD.document_type OR
     NEW.created_by_member_id IS DISTINCT FROM OLD.created_by_member_id OR
     (NEW.document_number IS DISTINCT FROM OLD.document_number AND NOT (OLD.document_number IS NULL AND NEW.document_number IS NOT NULL AND NEW.state='posted')) OR
     (NEW.state<>'posted' AND (NEW.posted_at IS NOT NULL OR NEW.posted_by_member_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'source identity or issued fields cannot be changed by draft save' USING ERRCODE='23514';
  END IF;
  IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'document version must advance by one' USING ERRCODE='40001'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_source_document() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.post_financial_document(p_organization_id uuid,p_document_id uuid,p_expected_version integer,
  p_request_id text,p_idempotency_key text,p_request_hash text)
RETURNS TABLE(document_id uuid,document_number text,document_version integer,journal_entry_id uuid,state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_doc finance.business_documents%ROWTYPE; v_type finance.document_type; v_permission text; v_period_id uuid;
  v_year_id uuid; v_journal_id uuid; v_number text; v_hash text; v_existing_actor uuid; v_receipt jsonb; v_account_id uuid;
  v_ar uuid; v_ap uuid; v_customer_advance uuid; v_vendor_advance uuid; v_output_tax uuid; v_input_tax uuid; v_rounding uuid;
  v_cash_account uuid; v_total_debit finance.amount:=0; v_total_credit finance.amount:=0; v_base finance.amount:=0; v_line_no integer:=0;
  v_line record; v_movement finance.money_movements%ROWTYPE; v_transfer finance.transfers%ROWTYPE; v_trade finance.trade_documents%ROWTYPE;
  v_original finance.business_documents%ROWTYPE; v_original_trade finance.trade_documents%ROWTYPE; v_original_line finance.document_lines%ROWTYPE;
  v_request finance.approval_requests%ROWTYPE; v_policy finance.approval_policies%ROWTYPE;
  v_open_item_id uuid; v_target finance.open_items%ROWTYPE; v_plan record; v_period finance.accounting_periods%ROWTYPE;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_document_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1 OR p_idempotency_key IS NULL OR
     length(p_idempotency_key) NOT BETWEEN 1 AND 200 OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid posting request' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':documents.post:'||p_document_id::text||':'||p_idempotency_key,0));
  IF NOT finance_private.can_read_document(p_organization_id,p_document_id) THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
  SELECT d.document_type INTO v_type FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
  v_permission:=CASE WHEN v_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance') THEN 'sales.post'
    WHEN v_type IN ('bill','vendor_credit','paid_expense','vendor_payment','vendor_refund','vendor_advance') THEN 'purchases.post'
    WHEN v_type='transfer' THEN 'banking.write' ELSE 'journal.post' END;
  v_actor:=finance_private.require_capability(p_organization_id,v_permission);
  SELECT i.request_hash,i.actor_member_id,i.response_body INTO v_hash,v_existing_actor,v_receipt FROM finance.idempotency_requests i
    WHERE i.organization_id=p_organization_id AND i.operation='documents.post:'||p_document_id::text AND i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_hash<>p_request_hash OR v_existing_actor<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505'; END IF;
    RETURN QUERY SELECT (v_receipt->>'document_id')::uuid,v_receipt->>'document_number',(v_receipt->>'document_version')::integer,
      (v_receipt->>'journal_entry_id')::uuid,v_receipt->>'state'; RETURN;
  END IF;
  -- Resolve the date without locking the source, then lock organization/year/period before the document.
  SELECT d.accounting_date,d.fiscal_year_id INTO v_doc.accounting_date,v_year_id FROM finance.business_documents d
    WHERE d.organization_id=p_organization_id AND d.id=p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
  v_period_id:=finance_private.lock_accounting_date(p_organization_id,v_doc.accounting_date,v_type='opening_balance');
  SELECT * INTO v_period FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.id=v_period_id;
  SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
  IF v_doc.document_type<>v_type OR v_doc.version<>p_expected_version THEN RAISE EXCEPTION 'source version is stale' USING ERRCODE='40001'; END IF;
  IF (v_period.kind='regular' AND v_doc.fiscal_year_id IS DISTINCT FROM v_period.fiscal_year_id) OR
     (v_period.kind='opening' AND v_type<>'opening_balance') THEN RAISE EXCEPTION 'source fiscal year does not match its accounting period' USING ERRCODE='23514'; END IF;
  IF v_doc.state='posted' THEN RAISE EXCEPTION 'source is already posted' USING ERRCODE='23505'; END IF;
  IF v_doc.state<>'approved' OR v_doc.currency<>'BDT' THEN RAISE EXCEPTION 'source must be approved in BDT before posting' USING ERRCODE='P0001'; END IF;
  IF v_doc.total_amount<=0 THEN RAISE EXCEPTION 'zero-value financial sources cannot post' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_request FROM finance.approval_requests r WHERE r.organization_id=p_organization_id AND r.document_id=p_document_id
    AND r.document_version=v_doc.version ORDER BY r.created_at DESC,r.id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_request.state<>'approved' OR v_request.document_digest<>v_doc.material_digest THEN
    RAISE EXCEPTION 'approved source version or digest is stale' USING ERRCODE='40001';
  END IF;
  IF v_request.policy_snapshot->>'approval_required' NOT IN ('true','false') THEN RAISE EXCEPTION 'approval policy snapshot is incomplete' USING ERRCODE='40001'; END IF;
  IF v_request.policy_snapshot->>'approval_required'='true' THEN
    SELECT * INTO v_policy FROM finance.approval_policies p WHERE p.organization_id=p_organization_id
      AND p.id=(v_request.policy_snapshot->>'policy_id')::uuid FOR SHARE;
    IF NOT FOUND OR NOT v_policy.is_active OR v_policy.version_no<>(v_request.policy_snapshot->>'policy_version')::integer OR
       v_policy.document_type<>v_type OR v_policy.threshold_amount::text<>v_request.policy_snapshot->>'threshold_amount' OR
       v_policy.approver_role_id<>(v_request.policy_snapshot->>'approver_role_id')::uuid OR
       v_policy.required_approvals<>(v_request.policy_snapshot->>'required_approvals')::integer OR
       v_policy.allow_self_approval<>(v_request.policy_snapshot->>'allow_self_approval')::boolean OR
       NOT EXISTS(SELECT 1 FROM finance.role_permissions rp JOIN finance.permissions pe ON pe.id=rp.permission_id
         WHERE rp.organization_id=p_organization_id AND rp.role_id=v_policy.approver_role_id AND pe.code='approvals.decide') THEN
      RAISE EXCEPTION 'approval policy snapshot is stale or incomplete' USING ERRCODE='40001';
    END IF;
    PERFORM m.id FROM finance.approval_decisions ad JOIN finance.organization_members m
      ON m.organization_id=ad.organization_id AND m.id=ad.decided_by_member_id
      JOIN finance.member_roles mr ON mr.organization_id=m.organization_id AND mr.member_id=m.id AND mr.role_id=v_policy.approver_role_id
      JOIN finance.role_permissions rp ON rp.organization_id=mr.organization_id AND rp.role_id=mr.role_id
      JOIN finance.permissions pe ON pe.id=rp.permission_id AND pe.code='approvals.decide'
      WHERE ad.organization_id=p_organization_id AND ad.request_id=v_request.id AND ad.decision='approve' AND m.status='active'
      ORDER BY m.id FOR KEY SHARE OF m,mr,rp;
    IF (SELECT count(DISTINCT ad.decided_by_member_id) FROM finance.approval_decisions ad
        JOIN finance.organization_members m ON m.organization_id=ad.organization_id AND m.id=ad.decided_by_member_id AND m.status='active'
        JOIN finance.member_roles mr ON mr.organization_id=m.organization_id AND mr.member_id=m.id AND mr.role_id=v_policy.approver_role_id
        JOIN finance.role_permissions rp ON rp.organization_id=mr.organization_id AND rp.role_id=mr.role_id
        JOIN finance.permissions pe ON pe.id=rp.permission_id AND pe.code='approvals.decide'
        WHERE ad.organization_id=p_organization_id AND ad.request_id=v_request.id AND ad.decision='approve')<v_policy.required_approvals THEN
      RAISE EXCEPTION 'current eligible approvals no longer meet the policy requirement' USING ERRCODE='40001';
    END IF;
    IF EXISTS(SELECT 1 FROM finance.approval_decisions ad WHERE ad.organization_id=p_organization_id AND ad.request_id=v_request.id
        AND ad.decision='approve' AND ad.decided_by_member_id=v_request.requested_by_member_id) AND
       (NOT v_policy.allow_self_approval OR (SELECT count(*) FROM finance.organization_members m WHERE m.organization_id=p_organization_id AND m.status='active')<>1 OR
        NOT finance_private.is_active_owner(p_organization_id,v_request.requested_by_member_id)) THEN
      RAISE EXCEPTION 'sole-operator approval exception is no longer valid' USING ERRCODE='40001';
    END IF;
  END IF;
  SELECT m.account_id INTO v_ar FROM finance.account_mappings m JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id
    WHERE m.organization_id=p_organization_id AND m.mapping_key='ar' AND a.is_active AND a.is_postable AND a.control_kind='ar';
  SELECT m.account_id INTO v_ap FROM finance.account_mappings m JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id
    WHERE m.organization_id=p_organization_id AND m.mapping_key='ap' AND a.is_active AND a.is_postable AND a.control_kind='ap';
  SELECT m.account_id INTO v_customer_advance FROM finance.account_mappings m JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id
    WHERE m.organization_id=p_organization_id AND m.mapping_key='customer_advance' AND a.is_active AND a.is_postable AND a.control_kind='customer_advance';
  SELECT m.account_id INTO v_vendor_advance FROM finance.account_mappings m JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id
    WHERE m.organization_id=p_organization_id AND m.mapping_key='vendor_advance' AND a.is_active AND a.is_postable AND a.control_kind='vendor_advance';
  SELECT m.account_id INTO v_output_tax FROM finance.account_mappings m JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id
    WHERE m.organization_id=p_organization_id AND m.mapping_key='output_tax' AND a.is_active AND a.is_postable;
  SELECT m.account_id INTO v_input_tax FROM finance.account_mappings m JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id
    WHERE m.organization_id=p_organization_id AND m.mapping_key='input_tax' AND a.is_active AND a.is_postable;
  SELECT m.account_id INTO v_rounding FROM finance.account_mappings m JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id
    WHERE m.organization_id=p_organization_id AND m.mapping_key='rounding_difference' AND a.is_active AND a.is_postable;
  IF v_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance') AND v_ar IS NULL THEN RAISE EXCEPTION 'AR mapping is required' USING ERRCODE='23514'; END IF;
  IF v_type IN ('bill','vendor_credit','vendor_payment','vendor_refund') AND v_ap IS NULL THEN RAISE EXCEPTION 'AP mapping is required' USING ERRCODE='23514'; END IF;
  -- Lock all planned source balances before the document sequence row, following the shared lock order.
  IF EXISTS(SELECT 1 FROM finance.document_allocation_plans p WHERE p.organization_id=p_organization_id AND p.document_id=p_document_id) THEN
    PERFORM finance_private.require_capability(p_organization_id,'dues.allocate');
  END IF;
  PERFORM oi.id FROM finance.open_items oi JOIN finance.document_allocation_plans p
    ON p.organization_id=oi.organization_id AND p.target_open_item_id=oi.id
    WHERE p.organization_id=p_organization_id AND p.document_id=p_document_id ORDER BY oi.id FOR UPDATE OF oi;
  v_number:=finance_private.allocate_document_number(p_organization_id,p_document_id);
  INSERT INTO finance.journal_entries(organization_id,source_document_id,period_id,accounting_date,state,is_opening,posted_by_member_id)
    VALUES(p_organization_id,p_document_id,v_period_id,v_doc.accounting_date,'building',v_type='opening_balance',v_actor) RETURNING id INTO v_journal_id;
  IF v_type IN ('invoice','customer_credit','bill','vendor_credit','paid_expense') THEN
    SELECT * INTO v_trade FROM finance.trade_documents td WHERE td.organization_id=p_organization_id AND td.document_id=p_document_id;
    IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id) THEN
      RAISE EXCEPTION 'trade source requires typed details and lines' USING ERRCODE='23514'; END IF;
    IF v_type='invoice' THEN
      v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_ar,v_doc.party_id,NULL,v_doc.total_amount,0,v_doc.description,NULL,v_number,v_doc.due_date);
      IF v_trade.recognition_mode='deferred_revenue' THEN
        SELECT a.id INTO v_account_id FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.code='2250' AND a.is_active AND a.is_postable;
        IF v_account_id IS NULL THEN RAISE EXCEPTION 'deferred revenue account is unavailable' USING ERRCODE='23514'; END IF;
        v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_account_id,NULL,NULL,0,v_doc.net_amount,v_doc.description,NULL);
        IF v_doc.tax_amount>0 THEN
          IF v_output_tax IS NULL THEN RAISE EXCEPTION 'output tax mapping is required' USING ERRCODE='23514'; END IF;
          v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_output_tax,NULL,NULL,0,v_doc.tax_amount,'Output tax',NULL);
        END IF;
      ELSE
        IF NOT v_trade.performance_confirmed THEN RAISE EXCEPTION 'earned invoice requires service performance confirmation' USING ERRCODE='23514'; END IF;
        FOR v_line IN SELECT l.* FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id ORDER BY l.line_no LOOP
          IF NOT EXISTS(SELECT 1 FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=v_line.account_id
            AND a.account_type='income' AND a.control_kind IS NULL AND a.is_active AND a.is_postable) THEN
            RAISE EXCEPTION 'invoice lines require active income accounts' USING ERRCODE='23514'; END IF;
          v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_line.account_id,NULL,v_line.cost_center_id,0,v_line.net_amount,v_line.description,v_line.cash_flow_class);
          IF v_line.tax_amount>0 THEN
            v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,COALESCE(v_line.tax_account_id,v_output_tax),NULL,NULL,0,v_line.tax_amount,'Output tax · '||v_line.description,NULL);
          END IF;
        END LOOP;
      END IF;
      SELECT COALESCE(sum(l.gross_amount),0)::finance.amount INTO v_base FROM finance.document_lines l
        WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id;
      IF v_doc.total_amount<>v_base THEN
        IF v_rounding IS NULL OR abs(v_doc.total_amount-v_base)>0.05 OR v_doc.rounding_adjustment<>v_doc.total_amount-v_base THEN
          RAISE EXCEPTION 'invoice rounding does not agree with its explicit source adjustment' USING ERRCODE='23514';
        END IF;
        v_line_no:=v_line_no+1;
        IF v_doc.total_amount>v_base THEN PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,0,v_doc.total_amount-v_base,'Explicit rounding adjustment',NULL);
        ELSE PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,v_base-v_doc.total_amount,0,'Explicit rounding adjustment',NULL); END IF;
      END IF;
    ELSIF v_type='bill' OR v_type='paid_expense' THEN
      FOR v_line IN SELECT l.* FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id ORDER BY l.line_no LOOP
        IF NOT EXISTS(SELECT 1 FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=v_line.account_id
          AND a.account_type IN ('expense','asset') AND a.control_kind IS NULL AND a.is_active AND a.is_postable) THEN
          RAISE EXCEPTION 'bill and expense lines require active expense or asset accounts' USING ERRCODE='23514'; END IF;
        v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_line.account_id,NULL,v_line.cost_center_id,
          CASE WHEN v_line.tax_recoverability_snapshot='full' THEN v_line.net_amount ELSE v_line.gross_amount END,0,v_line.description,v_line.cash_flow_class);
        IF v_line.tax_amount>0 AND v_line.tax_recoverability_snapshot='full' THEN
          v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,COALESCE(v_line.tax_account_id,v_input_tax),NULL,NULL,v_line.tax_amount,0,'Recoverable input tax · '||v_line.description,NULL);
        END IF;
      END LOOP;
      SELECT COALESCE(sum(l.gross_amount),0)::finance.amount INTO v_base FROM finance.document_lines l
        WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id;
      IF v_doc.total_amount<>v_base THEN
        IF v_rounding IS NULL OR abs(v_doc.total_amount-v_base)>0.05 OR v_doc.rounding_adjustment<>v_doc.total_amount-v_base THEN
          RAISE EXCEPTION 'expense rounding does not agree with its explicit source adjustment' USING ERRCODE='23514';
        END IF;
        v_line_no:=v_line_no+1;
        IF v_type='bill' THEN
          IF v_doc.total_amount>v_base THEN PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,v_doc.total_amount-v_base,0,'Explicit rounding adjustment',NULL);
          ELSE PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,0,v_base-v_doc.total_amount,'Explicit rounding adjustment',NULL); END IF;
        ELSE
          IF v_doc.total_amount>v_base THEN PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,v_doc.total_amount-v_base,0,'Explicit rounding adjustment',NULL);
          ELSE PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,0,v_base-v_doc.total_amount,'Explicit rounding adjustment',NULL); END IF;
        END IF;
      END IF;
      IF v_type='bill' THEN
        v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_ap,v_doc.party_id,NULL,0,v_doc.total_amount,v_doc.description,NULL,v_number,v_doc.due_date);
      ELSE
        SELECT mm.amount,ca.account_id INTO v_movement.amount,v_cash_account FROM finance.money_movements mm JOIN finance.cash_accounts ca
          ON ca.organization_id=mm.organization_id AND ca.id=mm.cash_account_id AND ca.is_active WHERE mm.organization_id=p_organization_id AND mm.document_id=p_document_id;
        IF v_cash_account IS NULL OR v_movement.amount<>v_doc.total_amount THEN RAISE EXCEPTION 'cash movement must agree with the paid expense total' USING ERRCODE='23514'; END IF;
        v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_cash_account,NULL,NULL,0,v_doc.total_amount,v_doc.description,'operating');
      END IF;
    ELSIF v_type IN ('customer_credit','vendor_credit') THEN
      IF v_trade.original_document_id IS NULL THEN RAISE EXCEPTION 'credit must reference its posted source document' USING ERRCODE='23514'; END IF;
      SELECT * INTO v_original FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=v_trade.original_document_id FOR SHARE;
      IF NOT FOUND OR v_original.state<>'posted' OR v_original.party_id IS DISTINCT FROM v_doc.party_id OR
         (v_type='customer_credit' AND v_original.document_type<>'invoice') OR (v_type='vendor_credit' AND v_original.document_type<>'bill') THEN
        RAISE EXCEPTION 'credit source is not eligible for this party and document type' USING ERRCODE='23514';
      END IF;
      SELECT * INTO v_original_trade FROM finance.trade_documents td WHERE td.organization_id=p_organization_id AND td.document_id=v_original.id;
      IF v_type='customer_credit' AND v_original_trade.recognition_mode='deferred_revenue' THEN
        RAISE EXCEPTION 'deferred-revenue credits require a separately allocated earned/unearned basis' USING ERRCODE='23514';
      END IF;
      IF v_type='customer_credit' THEN
        v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_ar,v_doc.party_id,NULL,0,v_doc.total_amount,v_doc.description,NULL,v_number,v_doc.due_date);
        SELECT a.id INTO v_account_id FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.code='4090' AND a.is_active AND a.is_postable;
        IF v_account_id IS NULL THEN RAISE EXCEPTION 'sales return account is unavailable' USING ERRCODE='23514'; END IF;
        FOR v_line IN SELECT l.* FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id ORDER BY l.line_no LOOP
          SELECT * INTO v_original_line FROM finance.document_lines ol WHERE ol.organization_id=p_organization_id AND ol.id=v_line.original_line_id AND ol.document_id=v_original.id;
          IF NOT FOUND THEN RAISE EXCEPTION 'credit line has no matching original line' USING ERRCODE='23514'; END IF;
          v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_account_id,NULL,v_original_line.cost_center_id,v_line.net_amount,0,v_line.description,NULL);
          IF v_line.tax_amount>0 THEN
            v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,COALESCE(v_original_line.tax_account_id,v_output_tax),NULL,NULL,v_line.tax_amount,0,'Tax reversal · '||v_line.description,NULL);
          END IF;
        END LOOP;
      ELSE
        v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_ap,v_doc.party_id,NULL,v_doc.total_amount,0,v_doc.description,NULL,v_number,v_doc.due_date);
        FOR v_line IN SELECT l.* FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id ORDER BY l.line_no LOOP
          SELECT * INTO v_original_line FROM finance.document_lines ol WHERE ol.organization_id=p_organization_id AND ol.id=v_line.original_line_id AND ol.document_id=v_original.id;
          IF NOT FOUND THEN RAISE EXCEPTION 'credit line has no matching original line' USING ERRCODE='23514'; END IF;
          IF v_original_line.tax_recoverability_snapshot='full' THEN
            v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_original_line.account_id,NULL,v_original_line.cost_center_id,0,v_line.net_amount,v_line.description,NULL);
            IF v_line.tax_amount>0 THEN v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,COALESCE(v_original_line.tax_account_id,v_input_tax),NULL,NULL,0,v_line.tax_amount,'Input tax reversal · '||v_line.description,NULL); END IF;
          ELSE
            v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_original_line.account_id,NULL,v_original_line.cost_center_id,0,v_line.gross_amount,v_line.description,NULL);
          END IF;
        END LOOP;
      END IF;
      SELECT COALESCE(sum(l.gross_amount),0)::finance.amount INTO v_base FROM finance.document_lines l
        WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id;
      IF v_doc.total_amount<>v_base THEN
        IF v_rounding IS NULL OR abs(v_doc.total_amount-v_base)>0.05 OR v_doc.rounding_adjustment<>v_doc.total_amount-v_base THEN
          RAISE EXCEPTION 'credit rounding does not agree with its explicit source adjustment' USING ERRCODE='23514';
        END IF;
        v_line_no:=v_line_no+1;
        IF v_type='customer_credit' THEN
          IF v_doc.total_amount>v_base THEN PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,v_doc.total_amount-v_base,0,'Explicit rounding adjustment',NULL);
          ELSE PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,0,v_base-v_doc.total_amount,'Explicit rounding adjustment',NULL); END IF;
        ELSE
          IF v_doc.total_amount>v_base THEN PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,0,v_doc.total_amount-v_base,'Explicit rounding adjustment',NULL);
          ELSE PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_rounding,NULL,NULL,v_base-v_doc.total_amount,0,'Explicit rounding adjustment',NULL); END IF;
        END IF;
      END IF;
    END IF;
  ELSIF v_type IN ('receipt','vendor_payment','customer_refund','vendor_refund','customer_advance','vendor_advance') THEN
    SELECT mm.* INTO v_movement FROM finance.money_movements mm WHERE mm.organization_id=p_organization_id AND mm.document_id=p_document_id;
    IF NOT FOUND OR v_movement.amount<>v_doc.total_amount THEN RAISE EXCEPTION 'cash movement must agree with source total' USING ERRCODE='23514'; END IF;
    SELECT ca.account_id INTO v_cash_account FROM finance.cash_accounts ca WHERE ca.organization_id=p_organization_id AND ca.id=v_movement.cash_account_id AND ca.is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'cash account is unavailable' USING ERRCODE='23514'; END IF;
    IF v_type IN ('receipt','customer_advance','vendor_refund') THEN
      v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_cash_account,NULL,NULL,v_movement.amount,0,v_doc.description,v_movement.cash_flow_class);
    ELSE
      v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_cash_account,NULL,NULL,0,v_movement.amount,v_doc.description,v_movement.cash_flow_class);
    END IF;
    v_line_no:=v_line_no+1;
    CASE v_type
      WHEN 'receipt' THEN v_account_id:=v_ar;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_account_id,v_doc.party_id,NULL,0,v_movement.amount,v_doc.description,v_movement.cash_flow_class,v_number,v_doc.due_date);
      WHEN 'vendor_payment' THEN v_account_id:=v_ap;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_account_id,v_doc.party_id,NULL,v_movement.amount,0,v_doc.description,v_movement.cash_flow_class,v_number,v_doc.due_date);
      WHEN 'customer_refund' THEN v_account_id:=v_ar;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_account_id,v_doc.party_id,NULL,v_movement.amount,0,v_doc.description,v_movement.cash_flow_class,v_number,v_doc.due_date);
      WHEN 'vendor_refund' THEN v_account_id:=v_ap;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_account_id,v_doc.party_id,NULL,0,v_movement.amount,v_doc.description,v_movement.cash_flow_class,v_number,v_doc.due_date);
      WHEN 'customer_advance' THEN v_account_id:=v_customer_advance;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_account_id,v_doc.party_id,NULL,0,v_movement.amount,v_doc.description,v_movement.cash_flow_class,v_number,v_doc.due_date);
      WHEN 'vendor_advance' THEN v_account_id:=v_vendor_advance;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_account_id,v_doc.party_id,NULL,v_movement.amount,0,v_doc.description,v_movement.cash_flow_class,v_number,v_doc.due_date);
    END CASE;
    IF v_type IN ('receipt','vendor_payment') THEN
      FOR v_line IN SELECT oi.id,oi.side,p.amount FROM finance.document_allocation_plans p JOIN finance.open_items oi
        ON oi.organization_id=p.organization_id AND oi.id=p.target_open_item_id WHERE p.organization_id=p_organization_id AND p.document_id=p_document_id ORDER BY oi.id LOOP
        SELECT * INTO v_target FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.id=v_line.id FOR UPDATE;
        IF NOT FOUND OR v_target.party_id IS DISTINCT FROM v_doc.party_id OR v_target.account_id IS DISTINCT FROM CASE WHEN v_type='receipt' THEN v_ar ELSE v_ap END OR
           v_target.side IS DISTINCT FROM CASE WHEN v_type='receipt' THEN 'debit' ELSE 'credit' END OR v_line.amount<=0 OR v_line.amount>v_movement.amount THEN
          RAISE EXCEPTION 'settlement plan target is no longer compatible' USING ERRCODE='23514';
        END IF;
        SELECT oi.id INTO v_open_item_id FROM finance.open_items oi JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
          WHERE jl.organization_id=p_organization_id AND jl.journal_entry_id=v_journal_id AND oi.id<>v_target.id ORDER BY oi.id LIMIT 1;
        IF v_open_item_id IS NULL THEN RAISE EXCEPTION 'new settlement control item unavailable' USING ERRCODE='23514'; END IF;
        -- The new opposite item is found from this journal's control line; references cannot cross organizations.
        IF v_target.side='debit' THEN
          PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_target.id,v_line.amount,v_doc.accounting_date);
          PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_open_item_id,v_line.amount,v_doc.accounting_date);
          INSERT INTO finance.settlement_allocations(organization_id,debit_open_item_id,credit_open_item_id,amount,effective_date,created_by_member_id,source_document_id)
            VALUES(p_organization_id,v_target.id,v_open_item_id,v_line.amount,v_doc.accounting_date,v_actor,p_document_id) RETURNING id INTO v_alloc_id;
        ELSE
          PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_open_item_id,v_line.amount,v_doc.accounting_date);
          PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_target.id,v_line.amount,v_doc.accounting_date);
          INSERT INTO finance.settlement_allocations(organization_id,debit_open_item_id,credit_open_item_id,amount,effective_date,created_by_member_id,source_document_id)
            VALUES(p_organization_id,v_open_item_id,v_target.id,v_line.amount,v_doc.accounting_date,v_actor,p_document_id) RETURNING id INTO v_alloc_id;
        END IF;
        PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'allocation.created','settlement_allocation',v_alloc_id,p_request_id,
          jsonb_build_object('amount',v_line.amount::text,'effective_date',v_doc.accounting_date,'source_document_id',p_document_id,
            'target_open_item_id',v_target.id,'settlement_open_item_id',v_open_item_id));
      END LOOP;
    END IF;
  ELSIF v_type='transfer' THEN
    SELECT * INTO v_transfer FROM finance.transfers t WHERE t.organization_id=p_organization_id AND t.document_id=p_document_id;
    IF NOT FOUND OR v_transfer.amount+v_transfer.fee_amount<>v_doc.total_amount THEN RAISE EXCEPTION 'transfer details must agree with the source total' USING ERRCODE='23514'; END IF;
    SELECT ca.account_id INTO v_cash_account FROM finance.cash_accounts ca WHERE ca.organization_id=p_organization_id AND ca.id=v_transfer.to_cash_account_id AND ca.is_active;
    IF v_cash_account IS NULL THEN RAISE EXCEPTION 'destination cash account is unavailable' USING ERRCODE='23514'; END IF;
    v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_cash_account,NULL,NULL,v_transfer.amount,0,v_doc.description,'internal');
    SELECT ca.account_id INTO v_cash_account FROM finance.cash_accounts ca WHERE ca.organization_id=p_organization_id AND ca.id=v_transfer.from_cash_account_id AND ca.is_active;
    IF v_cash_account IS NULL THEN RAISE EXCEPTION 'source cash account is unavailable' USING ERRCODE='23514'; END IF;
    IF v_transfer.fee_amount>0 THEN
      v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_transfer.fee_account_id,NULL,NULL,v_transfer.fee_amount,0,'Transfer fee','operating');
    END IF;
    v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_cash_account,NULL,NULL,0,v_transfer.amount+v_transfer.fee_amount,v_doc.description,'internal');
  ELSIF v_type IN ('manual_journal','controlled_adjustment','opening_balance') THEN
    FOR v_line IN SELECT r.* FROM finance.manual_journal_rows r WHERE r.organization_id=p_organization_id AND r.document_id=p_document_id ORDER BY r.line_no LOOP
      v_line_no:=v_line_no+1;PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,v_line.account_id,v_line.party_id,v_line.cost_center_id,
        v_line.debit,v_line.credit,v_line.description,v_line.cash_flow_class,
        CASE WHEN EXISTS(SELECT 1 FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=v_line.account_id AND a.control_kind IS NOT NULL)
          THEN COALESCE(v_line.open_item_reference,v_number) ELSE v_line.open_item_reference END,v_line.open_item_due_date);
    END LOOP;
  ELSE
    RAISE EXCEPTION 'this source type requires a dedicated controlled posting command' USING ERRCODE='23514';
  END IF;
  SELECT COALESCE(sum(l.debit),0)::finance.amount,COALESCE(sum(l.credit),0)::finance.amount INTO v_total_debit,v_total_credit
    FROM finance.journal_lines l WHERE l.organization_id=p_organization_id AND l.journal_entry_id=v_journal_id;
  IF v_total_debit<=0 OR v_total_debit<>v_total_credit THEN RAISE EXCEPTION 'journal is unbalanced' USING ERRCODE='23514'; END IF;
  UPDATE finance.journal_entries j SET state='posted',posted_at=clock_timestamp() WHERE j.organization_id=p_organization_id AND j.id=v_journal_id;
  UPDATE finance.business_documents d SET state='posted',document_number=v_number,posted_by_member_id=v_actor,posted_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE d.organization_id=p_organization_id AND d.id=p_document_id;
  SELECT jsonb_build_object('document_id',p_document_id,'document_number',v_number,'document_version',v_doc.version,'journal_entry_id',v_journal_id,'state','posted') INTO v_receipt;
  INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body,resource_document_id)
    VALUES(p_organization_id,'documents.post:'||p_document_id::text,p_idempotency_key,p_request_hash,v_actor,200,v_receipt,p_document_id);
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'document.post','business_document',p_document_id,p_request_id,
    jsonb_build_object('version',v_doc.version,'document_number',v_number,'journal_entry_id',v_journal_id,'debit_total',v_total_debit::text,'credit_total',v_total_credit::text));
  PERFORM finance_private.enqueue_outbox_event(p_organization_id,'document.posted',p_document_id,'document.posted:'||p_document_id::text,
    jsonb_build_object('document_id',p_document_id,'document_version',v_doc.version,'journal_entry_id',v_journal_id));
  RETURN QUERY SELECT p_document_id,v_number,v_doc.version,v_journal_id,'posted'::text;
END $$;
REVOKE ALL ON FUNCTION public.post_financial_document(uuid,uuid,integer,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.post_financial_document(uuid,uuid,integer,text,text,text) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
