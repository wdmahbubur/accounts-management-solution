-- Add controlled AR write-offs and forward-port the affected read/approval routines.
-- US-026: controlled AR bad-debt write-offs. AP write-off accounting is not defined by the source rules.

INSERT INTO finance.permissions(code,description) VALUES('dues.adjust','Create and post controlled subledger adjustments')
  ON CONFLICT(code) DO UPDATE SET description=EXCLUDED.description;
CREATE OR REPLACE FUNCTION finance_private.template_permission_codes(p_template_key text)
RETURNS TABLE(permission_code text) LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT unnest(CASE p_template_key
  WHEN 'owner' THEN ARRAY['company.read','company.update','users.read','users.manage','sales.read','sales.write','sales.post','purchases.read','purchases.write','purchases.post','contacts.read','contacts.write','catalog.read','catalog.write','documents.read','banking.read','banking.write','dues.read','dues.allocate','dues.adjust','accounting.read','journal.write','journal.post','ledger.read','tax.read','tax.manage','approvals.read','approvals.decide','approvals.manage','periods.lock','periods.reopen','reports.read','reports.export','imports.read','imports.run','exports.read','attachments.read','attachments.write','audit.read','subscription.read','subscription.manage']::text[]
  WHEN 'admin' THEN ARRAY['company.read','company.update','users.read','users.manage']::text[]
  WHEN 'finance_manager' THEN ARRAY['sales.read','sales.write','sales.post','purchases.read','purchases.write','purchases.post','contacts.read','contacts.write','catalog.read','catalog.write','documents.read','banking.read','banking.write','dues.read','dues.allocate','dues.adjust','accounting.read','journal.write','journal.post','ledger.read','tax.read','tax.manage','approvals.read','approvals.decide','periods.lock','periods.reopen','reports.read','reports.export','imports.read','imports.run','exports.read','attachments.read','attachments.write','audit.read']::text[]
  WHEN 'accountant' THEN ARRAY['sales.read','sales.write','sales.post','purchases.read','purchases.write','purchases.post','contacts.read','contacts.write','catalog.read','catalog.write','documents.read','banking.read','banking.write','dues.read','dues.allocate','dues.adjust','accounting.read','journal.write','journal.post','ledger.read','tax.read','tax.manage','approvals.read','reports.read','reports.export','imports.read','imports.run','exports.read','attachments.read','attachments.write','audit.read']::text[]
  WHEN 'billing' THEN ARRAY['sales.read','sales.write','sales.post','contacts.write','catalog.read','dues.allocate']::text[]
  WHEN 'auditor' THEN ARRAY['company.read','sales.read','purchases.read','contacts.read','catalog.read','documents.read','banking.read','dues.read','accounting.read','ledger.read','tax.read','approvals.read','reports.read','reports.export','imports.read','exports.read','attachments.read','audit.read']::text[]
  ELSE ARRAY[]::text[] END)
$$;
REVOKE ALL ON FUNCTION finance_private.template_permission_codes(text) FROM PUBLIC,ams_runtime;
INSERT INTO finance.role_permissions(organization_id,role_id,permission_id)
SELECT r.organization_id,r.id,p.id FROM finance.roles r JOIN finance.permissions p ON p.code='dues.adjust'
WHERE r.is_system AND r.template_key IN ('owner','finance_manager','accountant') ON CONFLICT DO NOTHING;

CREATE TABLE finance.write_off_details (
 organization_id uuid NOT NULL,
 document_id uuid NOT NULL,
 target_open_item_id uuid NOT NULL,
 expense_account_id uuid NOT NULL,
 amount finance.amount NOT NULL CHECK(amount>0),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 500),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,document_id),
 FOREIGN KEY(organization_id,document_id) REFERENCES finance.business_documents(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,target_open_item_id) REFERENCES finance.open_items(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,expense_account_id) REFERENCES finance.accounts(organization_id,id) ON DELETE RESTRICT
);
REVOKE ALL ON finance.write_off_details FROM PUBLIC,ams_runtime;

CREATE FUNCTION finance_private.guard_write_off_detail()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_state text;
BEGIN
 SELECT d.state::text INTO v_state FROM finance.business_documents d WHERE d.organization_id=COALESCE(NEW.organization_id,OLD.organization_id) AND d.id=COALESCE(NEW.document_id,OLD.document_id);
 IF v_state IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'write-off details can only change on a draft' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION finance_private.guard_write_off_detail() FROM PUBLIC,ams_runtime;
CREATE TRIGGER write_off_details_draft_only BEFORE INSERT OR UPDATE OR DELETE ON finance.write_off_details
 FOR EACH ROW EXECUTE FUNCTION finance_private.guard_write_off_detail();

-- The typed command is the only way to construct write-off source rows.
CREATE FUNCTION public.save_write_off_draft(p_organization_id uuid,p_document_id uuid,p_expected_version integer,p_request_id text,
 p_idempotency_key text,p_request_hash text,p_accounting_date date,p_target_open_item_id uuid,p_expense_account_id uuid,p_amount text,p_reason text)
RETURNS TABLE(document_id uuid,document_version integer,state text,total_amount finance.amount,material_digest text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_doc finance.business_documents%ROWTYPE; v_target finance.open_items%ROWTYPE; v_expense finance.accounts%ROWTYPE;
 v_period uuid; v_id uuid:=COALESCE(p_document_id,gen_random_uuid()); v_amount finance.amount; v_version integer; v_existing jsonb; v_hash text; v_existing_actor uuid;
BEGIN
 PERFORM finance_private.validate_request_id(p_request_id);
 v_actor:=finance_private.require_capability(p_organization_id,'dues.adjust');
 IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{22,172}$' OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' OR p_amount IS NULL OR
   p_accounting_date IS NULL OR NOT isfinite(p_accounting_date) OR p_target_open_item_id IS NULL OR p_expense_account_id IS NULL OR
   p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION 'invalid write-off draft' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':write-offs.save:'||p_idempotency_key,0));
 SELECT i.request_hash,i.actor_member_id,i.response_body INTO v_hash,v_existing_actor,v_existing FROM finance.idempotency_requests i
  WHERE i.organization_id=p_organization_id AND i.operation='write_offs.save' AND i.idempotency_key=p_idempotency_key FOR UPDATE;
 IF FOUND THEN
  IF v_hash<>p_request_hash OR v_existing_actor<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505'; END IF;
  RETURN QUERY SELECT (v_existing->>'document_id')::uuid,(v_existing->>'document_version')::integer,v_existing->>'state',
   (v_existing->>'total_amount')::finance.amount,v_existing->>'material_digest'; RETURN;
 END IF;
 v_period:=finance_private.lock_accounting_date(p_organization_id,p_accounting_date,false);
 SELECT * INTO v_target FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.id=p_target_open_item_id FOR UPDATE;
 IF NOT FOUND OR v_target.control_kind<>'ar' OR v_target.side<>'debit' OR v_target.issue_date>p_accounting_date THEN
  RAISE EXCEPTION 'write-off target must be a same-company receivable debit item' USING ERRCODE='23514'; END IF;
 PERFORM finance_private.require_decimal_string(to_jsonb(p_amount),2,false);
 SELECT (p_amount)::finance.amount INTO v_amount;
 IF v_amount<=0 OR finance_private.open_item_balance_at(p_organization_id,v_target.id,p_accounting_date,clock_timestamp())<v_amount THEN
  RAISE EXCEPTION 'write-off exceeds the receivable balance available on its accounting date' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_expense FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=p_expense_account_id FOR SHARE;
 IF NOT FOUND OR v_expense.account_type<>'expense' OR v_expense.control_kind IS NOT NULL OR NOT v_expense.is_active OR NOT v_expense.is_postable THEN
  RAISE EXCEPTION 'write-off requires an active postable non-control expense account' USING ERRCODE='23514'; END IF;
 IF p_document_id IS NULL THEN
  INSERT INTO finance.business_documents(id,organization_id,document_type,fiscal_year_id,party_id,issue_date,accounting_date,description,currency,
   net_amount,tax_amount,total_amount,version,created_by_member_id,party_snapshot,material_digest)
  SELECT v_id,p_organization_id,'write_off',p.fiscal_year_id,v_target.party_id,p_accounting_date,p_accounting_date,btrim(p_reason),'BDT',v_amount,0,v_amount,1,v_actor,
   jsonb_build_object('display_name',c.display_name,'legal_name',c.legal_name),p_request_hash
  FROM finance.accounting_periods p JOIN finance.contacts c ON c.organization_id=p_organization_id AND c.id=v_target.party_id
  WHERE p.organization_id=p_organization_id AND p.id=v_period;
  v_version:=1;
 ELSE
  SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=v_id FOR UPDATE;
  IF NOT FOUND OR v_doc.document_type<>'write_off' OR v_doc.state<>'draft' OR v_doc.version<>p_expected_version THEN
   RAISE EXCEPTION 'write-off draft version is stale or unavailable' USING ERRCODE='40001'; END IF;
  UPDATE finance.approval_requests SET state='superseded' WHERE organization_id=p_organization_id AND document_id=v_id AND state IN ('pending','approved');
  UPDATE finance.business_documents SET party_id=v_target.party_id,issue_date=p_accounting_date,accounting_date=p_accounting_date,description=btrim(p_reason),
   fiscal_year_id=(SELECT fiscal_year_id FROM finance.accounting_periods WHERE organization_id=p_organization_id AND id=v_period),net_amount=v_amount,total_amount=v_amount,
   version=version+1,state='draft',material_digest=p_request_hash,updated_at=clock_timestamp(),party_snapshot=(SELECT jsonb_build_object('display_name',display_name,'legal_name',legal_name) FROM finance.contacts WHERE organization_id=p_organization_id AND id=v_target.party_id)
   WHERE organization_id=p_organization_id AND id=v_id RETURNING version INTO v_version;
  DELETE FROM finance.manual_journal_rows WHERE organization_id=p_organization_id AND document_id=v_id;
  DELETE FROM finance.write_off_details WHERE organization_id=p_organization_id AND document_id=v_id;
 END IF;
 INSERT INTO finance.write_off_details(organization_id,document_id,target_open_item_id,expense_account_id,amount,reason)
  VALUES(p_organization_id,v_id,v_target.id,p_expense_account_id,v_amount,btrim(p_reason));
 INSERT INTO finance.manual_journal_rows(organization_id,document_id,line_no,account_id,party_id,debit,credit,description,open_item_reference)
 VALUES(p_organization_id,v_id,1,p_expense_account_id,NULL,v_amount,0,btrim(p_reason),NULL),
   (p_organization_id,v_id,2,v_target.account_id,v_target.party_id,0,v_amount,btrim(p_reason),v_target.reference);
 PERFORM finance_private.write_role_audit(p_organization_id,v_actor,CASE WHEN p_document_id IS NULL THEN 'write_off.draft.create' ELSE 'write_off.draft.update' END,
  'business_document',v_id,p_request_id,jsonb_build_object('version',v_version,'digest',p_request_hash,'target_open_item_id',v_target.id,'amount',v_amount::text,'reason',btrim(p_reason)));
 v_existing:=jsonb_build_object('document_id',v_id,'document_version',v_version,'state','draft','total_amount',v_amount::text,'material_digest',p_request_hash);
 INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body,resource_document_id)
 VALUES(p_organization_id,'write_offs.save',p_idempotency_key,p_request_hash,v_actor,200,v_existing,v_id);
 RETURN QUERY SELECT v_id,v_version,'draft'::text,v_amount,p_request_hash;
END; $$;
REVOKE ALL ON FUNCTION public.save_write_off_draft(uuid,uuid,integer,text,text,text,date,uuid,uuid,text,text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.save_write_off_draft(uuid,uuid,integer,text,text,text,date,uuid,uuid,text,text) TO ams_runtime;

CREATE FUNCTION public.list_write_off_options(p_organization_id uuid,p_as_of date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result jsonb;
BEGIN
 PERFORM finance_private.require_capability(p_organization_id,'dues.adjust');
 IF p_as_of IS NULL OR NOT isfinite(p_as_of) THEN RAISE EXCEPTION 'valid date required' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object(
  'receivables',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',oi.id,'account_id',oi.account_id,'party_id',oi.party_id,'party_name',c.display_name,
    'reference',oi.reference,'issue_date',oi.issue_date,'available_amount',finance_private.open_item_balance_at(oi.organization_id,oi.id,p_as_of,clock_timestamp())::text)
    ORDER BY oi.issue_date,oi.id) FROM finance.open_items oi JOIN finance.contacts c ON c.organization_id=oi.organization_id AND c.id=oi.party_id
    JOIN finance.journal_lines l ON l.organization_id=oi.organization_id AND l.id=oi.journal_line_id
    JOIN finance.journal_entries j ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id
    JOIN finance.business_documents d ON d.organization_id=j.organization_id AND d.id=j.source_document_id
    WHERE oi.organization_id=p_organization_id AND oi.control_kind='ar' AND oi.side='debit' AND oi.issue_date<=p_as_of AND d.state='posted'
     AND finance_private.open_item_balance_at(oi.organization_id,oi.id,p_as_of,clock_timestamp())>0),'[]'::jsonb),
  'expense_accounts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'code',a.code,'name',a.name) ORDER BY a.code,a.id)
    FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.account_type='expense' AND a.control_kind IS NULL AND a.is_active AND a.is_postable),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.list_write_off_options(uuid,date) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.list_write_off_options(uuid,date) TO ams_runtime;

CREATE FUNCTION finance_private.require_write_off_submit_capability()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.document_type='write_off' AND OLD.state='draft' AND NEW.state='pending_approval' THEN
  PERFORM finance_private.require_capability(NEW.organization_id,'dues.adjust');
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION finance_private.require_write_off_submit_capability() FROM PUBLIC,ams_runtime;
CREATE TRIGGER write_off_submit_capability BEFORE UPDATE ON finance.business_documents
 FOR EACH ROW EXECUTE FUNCTION finance_private.require_write_off_submit_capability();

CREATE FUNCTION public.post_write_off_document(p_organization_id uuid,p_document_id uuid,p_expected_version integer,
 p_request_id text,p_idempotency_key text,p_request_hash text)
RETURNS TABLE(document_id uuid,document_number text,document_version integer,journal_entry_id uuid,state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_doc finance.business_documents%ROWTYPE; v_detail finance.write_off_details%ROWTYPE; v_target finance.open_items%ROWTYPE;
 v_period uuid; v_period_row finance.accounting_periods%ROWTYPE; v_request finance.approval_requests%ROWTYPE; v_policy finance.approval_policies%ROWTYPE;
 v_hash text; v_owner uuid; v_receipt jsonb; v_number text; v_journal uuid; v_expense_line uuid; v_control_line uuid; v_credit_item uuid; v_debits finance.amount; v_credits finance.amount;
BEGIN
 PERFORM finance_private.validate_request_id(p_request_id);
 IF p_document_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1 OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 200 OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'invalid write-off posting request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':documents.post:'||p_document_id::text||':'||p_idempotency_key,0));
 IF NOT finance_private.can_read_document(p_organization_id,p_document_id) THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
 v_actor:=finance_private.require_capability(p_organization_id,'dues.adjust');
 SELECT i.request_hash,i.actor_member_id,i.response_body INTO v_hash,v_owner,v_receipt FROM finance.idempotency_requests i
  WHERE i.organization_id=p_organization_id AND i.operation='documents.post:'||p_document_id::text AND i.idempotency_key=p_idempotency_key FOR UPDATE;
 IF FOUND THEN
  IF v_hash<>p_request_hash OR v_owner<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505'; END IF;
  RETURN QUERY SELECT (v_receipt->>'document_id')::uuid,v_receipt->>'document_number',(v_receipt->>'document_version')::integer,(v_receipt->>'journal_entry_id')::uuid,v_receipt->>'state'; RETURN;
 END IF;
 SELECT d.accounting_date INTO v_doc.accounting_date FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
 v_period:=finance_private.lock_accounting_date(p_organization_id,v_doc.accounting_date,false);
 SELECT * INTO v_period_row FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.id=v_period;
 SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id FOR UPDATE;
 IF v_doc.document_type<>'write_off' OR v_doc.version<>p_expected_version THEN RAISE EXCEPTION 'source version is stale' USING ERRCODE='40001'; END IF;
 IF v_period_row.kind<>'regular' OR v_doc.fiscal_year_id IS DISTINCT FROM v_period_row.fiscal_year_id THEN RAISE EXCEPTION 'source fiscal year does not match its accounting period' USING ERRCODE='23514'; END IF;
 IF v_doc.state<>'approved' OR v_doc.currency<>'BDT' OR v_doc.total_amount<=0 THEN RAISE EXCEPTION 'write-off must be approved and positive in BDT' USING ERRCODE='P0001'; END IF;
 SELECT * INTO v_request FROM finance.approval_requests r WHERE r.organization_id=p_organization_id AND r.document_id=p_document_id
  AND r.document_version=v_doc.version ORDER BY r.created_at DESC,r.id DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND OR v_request.state<>'approved' OR v_request.document_digest<>v_doc.material_digest OR v_request.policy_snapshot->>'approval_required' NOT IN ('true','false') THEN
  RAISE EXCEPTION 'approved source version or digest is stale' USING ERRCODE='40001'; END IF;
 IF v_request.policy_snapshot->>'approval_required'='true' THEN
  SELECT * INTO v_policy FROM finance.approval_policies p WHERE p.organization_id=p_organization_id AND p.id=(v_request.policy_snapshot->>'policy_id')::uuid FOR SHARE;
  IF NOT FOUND OR NOT v_policy.is_active OR v_policy.version_no<>(v_request.policy_snapshot->>'policy_version')::integer OR v_policy.document_type<>'write_off' OR
   v_policy.threshold_amount::text<>v_request.policy_snapshot->>'threshold_amount' OR v_policy.approver_role_id<>(v_request.policy_snapshot->>'approver_role_id')::uuid OR v_policy.required_approvals<>(v_request.policy_snapshot->>'required_approvals')::integer OR
   v_policy.allow_self_approval<>(v_request.policy_snapshot->>'allow_self_approval')::boolean THEN RAISE EXCEPTION 'approval policy snapshot is stale' USING ERRCODE='40001'; END IF;
  IF NOT EXISTS(SELECT 1 FROM finance.role_permissions rp JOIN finance.permissions pe ON pe.id=rp.permission_id
   WHERE rp.organization_id=p_organization_id AND rp.role_id=v_policy.approver_role_id AND pe.code='approvals.decide') THEN RAISE EXCEPTION 'approval role no longer has decision capability' USING ERRCODE='40001'; END IF;
  IF (SELECT count(DISTINCT ad.decided_by_member_id) FROM finance.approval_decisions ad JOIN finance.organization_members m ON m.organization_id=ad.organization_id AND m.id=ad.decided_by_member_id AND m.status='active'
    JOIN finance.member_roles mr ON mr.organization_id=m.organization_id AND mr.member_id=m.id AND mr.role_id=v_policy.approver_role_id
    JOIN finance.role_permissions rp ON rp.organization_id=mr.organization_id AND rp.role_id=mr.role_id JOIN finance.permissions pe ON pe.id=rp.permission_id AND pe.code='approvals.decide'
    WHERE ad.organization_id=p_organization_id AND ad.request_id=v_request.id AND ad.decision='approve')<v_policy.required_approvals THEN
   RAISE EXCEPTION 'current approvals no longer meet policy' USING ERRCODE='40001'; END IF;
  IF EXISTS(SELECT 1 FROM finance.approval_decisions ad WHERE ad.organization_id=p_organization_id AND ad.request_id=v_request.id
    AND ad.decision='approve' AND ad.decided_by_member_id=v_request.requested_by_member_id) AND
    (NOT v_policy.allow_self_approval OR (SELECT count(*) FROM finance.organization_members m WHERE m.organization_id=p_organization_id AND m.status='active')<>1 OR
     NOT finance_private.is_active_owner(p_organization_id,v_request.requested_by_member_id)) THEN
   RAISE EXCEPTION 'sole-operator approval exception is no longer valid' USING ERRCODE='40001'; END IF;
 END IF;
 SELECT * INTO v_detail FROM finance.write_off_details x WHERE x.organization_id=p_organization_id AND x.document_id=p_document_id;
 IF NOT FOUND OR v_detail.amount<>v_doc.total_amount THEN RAISE EXCEPTION 'write-off details do not match source total' USING ERRCODE='23514'; END IF;
 PERFORM oi.id FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.id=v_detail.target_open_item_id FOR UPDATE;
 SELECT * INTO v_target FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.id=v_detail.target_open_item_id;
 IF v_target.control_kind<>'ar' OR v_target.side<>'debit' OR v_target.party_id<>v_doc.party_id OR v_target.issue_date>v_doc.accounting_date OR
  finance_private.open_item_balance_at(p_organization_id,v_target.id,v_doc.accounting_date,clock_timestamp())<v_detail.amount THEN
  RAISE EXCEPTION 'receivable capacity or party changed after approval' USING ERRCODE='23P01'; END IF;
 IF NOT EXISTS(SELECT 1 FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=v_detail.expense_account_id AND a.account_type='expense' AND a.control_kind IS NULL AND a.is_active AND a.is_postable) THEN
  RAISE EXCEPTION 'write-off expense account is unavailable' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM finance.manual_journal_rows r WHERE r.organization_id=p_organization_id AND r.document_id=p_document_id)<>2 THEN
  RAISE EXCEPTION 'write-off source lines are incomplete' USING ERRCODE='23514'; END IF;
 v_number:=finance_private.allocate_document_number(p_organization_id,p_document_id);
 INSERT INTO finance.journal_entries(organization_id,source_document_id,period_id,accounting_date,state,is_opening,posted_by_member_id)
  VALUES(p_organization_id,p_document_id,v_period,v_doc.accounting_date,'building',false,v_actor) RETURNING id INTO v_journal;
 v_expense_line:=finance_private.insert_posting_line(p_organization_id,v_journal,1,v_detail.expense_account_id,NULL,NULL,v_detail.amount,0,v_detail.reason,'operating');
 v_control_line:=finance_private.insert_posting_line(p_organization_id,v_journal,2,v_target.account_id,v_target.party_id,NULL,0,v_detail.amount,v_detail.reason,'operating',v_target.reference);
 SELECT oi.id INTO v_credit_item FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.journal_line_id=v_control_line;
 PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_target.id,v_detail.amount,v_doc.accounting_date);
 PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_credit_item,v_detail.amount,v_doc.accounting_date);
 INSERT INTO finance.settlement_allocations(organization_id,debit_open_item_id,credit_open_item_id,amount,effective_date,created_by_member_id,source_document_id)
  VALUES(p_organization_id,v_target.id,v_credit_item,v_detail.amount,v_doc.accounting_date,v_actor,p_document_id);
 SELECT COALESCE(sum(l.debit),0)::finance.amount,COALESCE(sum(l.credit),0)::finance.amount INTO v_debits,v_credits FROM finance.journal_lines l
  WHERE l.organization_id=p_organization_id AND l.journal_entry_id=v_journal;
 IF v_debits<>v_credits OR v_debits<>v_doc.total_amount THEN RAISE EXCEPTION 'write-off journal is not balanced to source' USING ERRCODE='23514'; END IF;
 UPDATE finance.journal_entries SET state='posted',posted_at=clock_timestamp() WHERE organization_id=p_organization_id AND id=v_journal;
 UPDATE finance.business_documents SET state='posted',document_number=v_number,posted_by_member_id=v_actor,posted_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE organization_id=p_organization_id AND id=p_document_id;
 v_receipt:=jsonb_build_object('document_id',p_document_id,'document_number',v_number,'document_version',v_doc.version,'journal_entry_id',v_journal,'state','posted');
 INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body,resource_document_id)
  VALUES(p_organization_id,'documents.post:'||p_document_id::text,p_idempotency_key,p_request_hash,v_actor,200,v_receipt,p_document_id);
 PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'write_off.post','business_document',p_document_id,p_request_id,
  jsonb_build_object('version',v_doc.version,'document_number',v_number,'journal_entry_id',v_journal,'amount',v_detail.amount::text,'target_open_item_id',v_target.id,'settlement_open_item_id',v_credit_item,'reason',v_detail.reason));
 PERFORM finance_private.enqueue_outbox_event(p_organization_id,'document.posted',p_document_id,'document.posted:'||p_document_id::text,
  jsonb_build_object('document_id',p_document_id,'document_version',v_doc.version,'journal_entry_id',v_journal));
 RETURN QUERY SELECT p_document_id,v_number,v_doc.version,v_journal,'posted'::text;
END; $$;
REVOKE ALL ON FUNCTION public.post_write_off_document(uuid,uuid,integer,text,text,text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.post_write_off_document(uuid,uuid,integer,text,text,text) TO ams_runtime;

-- Prevent manual journals and generic controlled adjustments from bypassing the subledger.
CREATE FUNCTION finance_private.reject_generic_control_posting()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_doc finance.business_documents%ROWTYPE;
BEGIN
 SELECT d.* INTO v_doc FROM finance.journal_entries j JOIN finance.business_documents d ON d.organization_id=j.organization_id AND d.id=j.source_document_id
  WHERE j.organization_id=NEW.organization_id AND j.id=NEW.journal_entry_id;
 IF v_doc.document_type IN ('manual_journal','controlled_adjustment') AND EXISTS(
  SELECT 1 FROM finance.journal_lines l JOIN finance.accounts a ON a.organization_id=l.organization_id AND a.id=l.account_id
  WHERE l.organization_id=NEW.organization_id AND l.journal_entry_id=NEW.journal_entry_id AND a.control_kind IS NOT NULL) THEN
  RAISE EXCEPTION 'manual journals and generic adjustments cannot post control accounts' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION finance_private.reject_generic_control_posting() FROM PUBLIC,ams_runtime;
CREATE CONSTRAINT TRIGGER generic_control_posting_guard AFTER INSERT OR UPDATE ON finance.journal_lines
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_private.reject_generic_control_posting();

NOTIFY pgrst,'reload schema';

CREATE OR REPLACE FUNCTION public.read_financial_document(p_organization_id uuid,p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_document finance.business_documents%ROWTYPE; v_result jsonb;
BEGIN
  IF NOT finance_private.can_read_document(p_organization_id,p_document_id) THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_document FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id;
  SELECT jsonb_build_object('id',d.id,'document_type',d.document_type,'state',d.state,'document_number',d.document_number,'party_id',d.party_id,
    'party_snapshot',d.party_snapshot,'issue_date',d.issue_date,'accounting_date',d.accounting_date,'due_date',d.due_date,'external_reference',d.external_reference,
    'description',d.description,'currency',d.currency,'net_amount',d.net_amount::text,'tax_amount',d.tax_amount::text,'rounding_adjustment',d.rounding_adjustment::text,
    'rounding_reason',d.rounding_reason,'rounding_account_id',d.rounding_account_id,
    'total_amount',d.total_amount::text,'version',d.version,'material_digest',d.material_digest,
    'trade',CASE WHEN td.document_id IS NULL THEN NULL ELSE jsonb_build_object('original_document_id',td.original_document_id,'recognition_mode',td.recognition_mode,
      'performance_confirmed',td.performance_confirmed,'supplier_invoice_date',td.supplier_invoice_date,'supplier_invoice_key',td.supplier_invoice_key,'terms',td.terms,'notes',td.notes) END,
    'movement',CASE WHEN mm.document_id IS NULL THEN NULL ELSE jsonb_build_object('cash_account_id',mm.cash_account_id,'direction',mm.direction,'amount',mm.amount::text,
      'method',mm.method,'reference',mm.reference,'cash_flow_class',mm.cash_flow_class) END,
    'transfer',CASE WHEN tr.document_id IS NULL THEN NULL ELSE jsonb_build_object('from_cash_account_id',tr.from_cash_account_id,'to_cash_account_id',tr.to_cash_account_id,
      'amount',tr.amount::text,'fee_amount',tr.fee_amount::text,'fee_account_id',tr.fee_account_id) END,
    'lines',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',l.id,'line_no',l.line_no,'item_id',l.item_id,'original_line_id',l.original_line_id,'description',l.description,
      'quantity',l.quantity::text,'unit_price',l.unit_price::text,'discount_amount',l.discount_amount::text,'account_id',l.account_id,'cost_center_id',l.cost_center_id,
      'tax_code_id',l.tax_code_id,'tax_label_snapshot',l.tax_label_snapshot,'tax_rate_snapshot',l.tax_rate_snapshot::text,'tax_mode',l.tax_mode,
      'tax_recoverability_snapshot',l.tax_recoverability_snapshot,'tax_account_id',l.tax_account_id,'net_amount',l.net_amount::text,'tax_amount',l.tax_amount::text,
      'gross_amount',l.gross_amount::text,'cash_flow_class',l.cash_flow_class) ORDER BY l.line_no) FROM finance.document_lines l
      WHERE l.organization_id=d.organization_id AND l.document_id=d.id),'[]'::jsonb),
    'journal_rows',COALESCE((SELECT jsonb_agg(jsonb_build_object('line_no',j.line_no,'account_id',j.account_id,'party_id',j.party_id,'cost_center_id',j.cost_center_id,
      'debit',j.debit::text,'credit',j.credit::text,'description',j.description,'cash_flow_class',j.cash_flow_class,'open_item_reference',j.open_item_reference,
      'open_item_due_date',j.open_item_due_date) ORDER BY j.line_no) FROM finance.manual_journal_rows j WHERE j.organization_id=d.organization_id AND j.document_id=d.id),'[]'::jsonb),
    'posted_journal',(SELECT jsonb_build_object('id',je.id,'accounting_date',je.accounting_date,'lines',COALESCE((SELECT jsonb_agg(jsonb_build_object('line_id',jl.id,'account_id',jl.account_id,'party_id',jl.party_id,
      'debit',jl.debit::text,'credit',jl.credit::text,'open_item_id',oi.id) ORDER BY jl.line_no) FROM finance.journal_lines jl LEFT JOIN finance.open_items oi ON oi.organization_id=jl.organization_id AND oi.journal_line_id=jl.id
      WHERE jl.organization_id=je.organization_id AND jl.journal_entry_id=je.id),'[]'::jsonb)) FROM finance.journal_entries je WHERE je.organization_id=d.organization_id AND je.source_document_id=d.id AND je.state='posted'),
    'write_off',(SELECT jsonb_build_object('target_open_item_id',w.target_open_item_id,'expense_account_id',w.expense_account_id,'amount',w.amount::text,'reason',w.reason)
      FROM finance.write_off_details w WHERE w.organization_id=d.organization_id AND w.document_id=d.id),
    'allocation_plan',COALESCE((SELECT jsonb_agg(jsonb_build_object('target_open_item_id',p.target_open_item_id,'amount',p.amount::text) ORDER BY p.target_open_item_id)
      FROM finance.document_allocation_plans p WHERE p.organization_id=d.organization_id AND p.document_id=d.id),'[]'::jsonb))
    INTO v_result FROM finance.business_documents d LEFT JOIN finance.trade_documents td ON td.organization_id=d.organization_id AND td.document_id=d.id
      LEFT JOIN finance.money_movements mm ON mm.organization_id=d.organization_id AND mm.document_id=d.id
      LEFT JOIN finance.transfers tr ON tr.organization_id=d.organization_id AND tr.document_id=d.id
    WHERE d.organization_id=p_organization_id AND d.id=p_document_id;
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.read_financial_document(uuid,uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_financial_document(uuid,uuid) TO ams_runtime;

CREATE OR REPLACE FUNCTION public.submit_financial_document(
  p_organization_id uuid,p_document_id uuid,p_expected_version integer,p_operation text,p_request_id text,
  p_idempotency_key text,p_request_hash text
) RETURNS TABLE(approval_request_id uuid,document_id uuid,document_version integer,state text,approval_required boolean,policy_snapshot jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_type finance.document_type; v_doc finance.business_documents%ROWTYPE; v_policy finance.approval_policies%ROWTYPE;
  v_hash text; v_existing_actor uuid; v_receipt jsonb; v_snapshot jsonb; v_max_threshold finance.amount; v_policy_count integer;
  v_required boolean; v_request_id uuid; v_rank_count integer; v_permission text; v_needs_allocation boolean;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_document_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1 OR p_operation IS DISTINCT FROM 'documents.submit:'||p_document_id::text OR
     p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 200 OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid approval submission request' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_operation||':'||p_idempotency_key,0));
  IF NOT finance_private.can_read_document(p_organization_id,p_document_id) THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
  SELECT d.document_type INTO v_type FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
  v_permission:=CASE WHEN v_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance') THEN 'sales.write'
    WHEN v_type IN ('bill','vendor_credit','paid_expense','vendor_payment','vendor_refund','vendor_advance') THEN 'purchases.write'
    WHEN v_type='transfer' THEN 'banking.write' WHEN v_type='write_off' THEN 'dues.adjust' ELSE 'journal.write' END;
  v_actor:=finance_private.require_capability(p_organization_id,v_permission);
  v_needs_allocation:=v_type IN ('receipt','vendor_payment');
  IF v_needs_allocation THEN PERFORM finance_private.require_capability(p_organization_id,'dues.read'); END IF;
  SELECT i.request_hash,i.actor_member_id,i.response_body INTO v_hash,v_existing_actor,v_receipt FROM finance.idempotency_requests i
    WHERE i.organization_id=p_organization_id AND i.operation=p_operation AND i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_hash<>p_request_hash OR v_existing_actor<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505'; END IF;
    RETURN QUERY SELECT (v_receipt->>'approval_request_id')::uuid,(v_receipt->>'document_id')::uuid,
      (v_receipt->>'document_version')::integer,v_receipt->>'state',(v_receipt->>'approval_required')::boolean,v_receipt->'policy_snapshot'; RETURN;
  END IF;
  SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
  IF v_doc.state<>'draft' OR (v_needs_allocation AND v_doc.party_id IS NULL) THEN RAISE EXCEPTION 'only a valid editable draft can be submitted' USING ERRCODE='23514'; END IF;
  IF v_doc.version<>p_expected_version THEN RAISE EXCEPTION 'source version is stale' USING ERRCODE='40001'; END IF;
  IF v_doc.document_type<>v_type THEN RAISE EXCEPTION 'source type changed' USING ERRCODE='40001'; END IF;
  IF v_needs_allocation AND NOT EXISTS(SELECT 1 FROM finance.document_allocation_plans p WHERE p.organization_id=p_organization_id AND p.document_id=p_document_id) THEN
    RAISE EXCEPTION 'an allocation plan is required before settlement submission' USING ERRCODE='23514';
  END IF;
  SELECT count(*) INTO v_policy_count FROM finance.approval_policies p WHERE p.organization_id=p_organization_id AND p.document_type=v_doc.document_type AND p.is_active;
  IF v_policy_count=0 THEN RAISE EXCEPTION 'approval policy is not configured' USING ERRCODE='P0001'; END IF;
  SELECT max(p.threshold_amount) INTO v_max_threshold FROM finance.approval_policies p WHERE p.organization_id=p_organization_id
    AND p.document_type=v_doc.document_type AND p.is_active AND p.threshold_amount<=v_doc.total_amount;
  v_required:=v_max_threshold IS NOT NULL;
  IF v_required THEN
    SELECT count(*) INTO v_rank_count FROM finance.approval_policies p WHERE p.organization_id=p_organization_id AND p.document_type=v_doc.document_type
      AND p.is_active AND p.threshold_amount=v_max_threshold;
    IF v_rank_count<>1 THEN RAISE EXCEPTION 'approval policy threshold is ambiguous' USING ERRCODE='22023'; END IF;
    SELECT * INTO v_policy FROM finance.approval_policies p WHERE p.organization_id=p_organization_id AND p.document_type=v_doc.document_type
      AND p.is_active AND p.threshold_amount=v_max_threshold FOR SHARE;
    IF NOT EXISTS(SELECT 1 FROM finance.role_permissions rp JOIN finance.permissions pe ON pe.id=rp.permission_id
      WHERE rp.organization_id=p_organization_id AND rp.role_id=v_policy.approver_role_id AND pe.code='approvals.decide') THEN
      RAISE EXCEPTION 'approval role cannot decide approvals' USING ERRCODE='23514';
    END IF;
    v_snapshot:=jsonb_build_object('approval_required',true,'policy_id',v_policy.id,'policy_name',v_policy.name,'policy_version',v_policy.version_no,
      'document_type',v_policy.document_type,'threshold_amount',v_policy.threshold_amount::text,'approver_role_id',v_policy.approver_role_id,
      'required_approvals',v_policy.required_approvals,'allow_self_approval',v_policy.allow_self_approval);
  ELSE
    v_snapshot:=jsonb_build_object('approval_required',false,'document_type',v_doc.document_type,'total_amount',v_doc.total_amount::text,
      'threshold_result','below_all_active_thresholds');
  END IF;
  UPDATE finance.business_documents d SET state='pending_approval' WHERE d.organization_id=p_organization_id AND d.id=p_document_id;
  INSERT INTO finance.approval_requests(organization_id,document_id,document_version,document_digest,policy_snapshot,requested_by_member_id,state)
    VALUES(p_organization_id,p_document_id,v_doc.version,v_doc.material_digest,v_snapshot,v_actor,CASE WHEN v_required THEN 'pending' ELSE 'approved' END)
    RETURNING id INTO v_request_id;
  IF NOT v_required THEN UPDATE finance.business_documents d SET state='approved' WHERE d.organization_id=p_organization_id AND d.id=p_document_id; END IF;
  SELECT jsonb_build_object('approval_request_id',v_request_id,'document_id',p_document_id,'document_version',v_doc.version,
    'state',CASE WHEN v_required THEN 'pending' ELSE 'approved' END,'approval_required',v_required,'policy_snapshot',v_snapshot) INTO v_receipt;
  INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body,resource_document_id)
    VALUES(p_organization_id,p_operation,p_idempotency_key,p_request_hash,v_actor,200,v_receipt,p_document_id);
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'document.approval.submit','business_document',p_document_id,p_request_id,
    jsonb_build_object('version',v_doc.version,'digest',v_doc.material_digest,'approval_request_id',v_request_id,'approval_required',v_required,'policy_snapshot',v_snapshot));
  RETURN QUERY SELECT v_request_id,p_document_id,v_doc.version,CASE WHEN v_required THEN 'pending' ELSE 'approved' END,v_required,v_snapshot;
END; $$;
REVOKE ALL ON FUNCTION public.submit_financial_document(uuid,uuid,integer,text,text,text,text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.submit_financial_document(uuid,uuid,integer,text,text,text,text) TO ams_runtime;
