-- US-041: present customer and supplier advances as separate control ledgers.
BEGIN;

CREATE FUNCTION public.read_advance_register(p_organization_id uuid,p_scope text,p_search text DEFAULT NULL,p_limit integer DEFAULT 51)
RETURNS TABLE(open_item_id uuid,document_id uuid,document_type text,document_number text,state text,party_id uuid,party_name text,
  accounting_date date,original_amount text,applied_amount text,refunded_amount text,remaining_amount text,cash_account_name text,method text,reference text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_today date;v_timezone text;v_control text;
BEGIN
  IF p_scope IS NULL OR p_scope NOT IN ('customer','supplier') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 51 OR (p_search IS NOT NULL AND length(p_search)>100) THEN
    RAISE EXCEPTION 'invalid advance register filters' USING ERRCODE='22023';
  END IF;
  IF p_scope='customer' THEN PERFORM finance_private.require_capability(p_organization_id,'sales.read');v_control:='customer_advance';
  ELSE PERFORM finance_private.require_capability(p_organization_id,'purchases.read');v_control:='vendor_advance';END IF;
  SELECT o.timezone INTO v_timezone FROM finance.organizations o WHERE o.id=p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'organization unavailable' USING ERRCODE='P0002';END IF;
  v_today:=(now() AT TIME ZONE v_timezone)::date;
  RETURN QUERY SELECT oi.id,d.id,d.document_type::text,d.document_number,d.state::text,oi.party_id,c.display_name,d.accounting_date,
    oi.original_amount::text,COALESCE((SELECT sum(a.amount) FROM finance.settlement_allocations a JOIN finance.advance_actions aa
      ON aa.organization_id=a.organization_id AND aa.document_id=a.source_document_id AND aa.action_kind='apply'
      LEFT JOIN finance.allocation_reversals r ON r.organization_id=a.organization_id AND r.allocation_id=a.id AND r.effective_date<=v_today
      WHERE a.organization_id=p_organization_id AND (a.debit_open_item_id=oi.id OR a.credit_open_item_id=oi.id) AND a.effective_date<=v_today AND r.id IS NULL),0)::text,
    COALESCE((SELECT sum(a.amount) FROM finance.settlement_allocations a JOIN finance.advance_actions aa
      ON aa.organization_id=a.organization_id AND aa.document_id=a.source_document_id AND aa.action_kind='refund'
      LEFT JOIN finance.allocation_reversals r ON r.organization_id=a.organization_id AND r.allocation_id=a.id AND r.effective_date<=v_today
      WHERE a.organization_id=p_organization_id AND (a.debit_open_item_id=oi.id OR a.credit_open_item_id=oi.id) AND a.effective_date<=v_today AND r.id IS NULL),0)::text,
    finance_private.open_item_balance_at(p_organization_id,oi.id,v_today,clock_timestamp())::text,ca.name,mm.method::text,mm.reference
  FROM finance.open_items oi JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
    JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id AND d.state='posted'
    JOIN finance.contacts c ON c.organization_id=oi.organization_id AND c.id=oi.party_id
    LEFT JOIN finance.money_movements mm ON mm.organization_id=d.organization_id AND mm.document_id=d.id
    LEFT JOIN finance.cash_accounts ca ON ca.organization_id=mm.organization_id AND ca.id=mm.cash_account_id
  WHERE oi.organization_id=p_organization_id AND oi.control_kind=v_control AND oi.issue_date<=v_today
    AND (p_search IS NULL OR btrim(p_search)='' OR COALESCE(d.document_number,'') ILIKE '%'||btrim(p_search)||'%' OR c.display_name ILIKE '%'||btrim(p_search)||'%' OR COALESCE(mm.reference,'') ILIKE '%'||btrim(p_search)||'%')
  ORDER BY oi.issue_date DESC,oi.id DESC LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.read_advance_register(uuid,text,text,integer) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_advance_register(uuid,text,text,integer) TO authenticated;

CREATE FUNCTION public.read_advance_lifecycle(p_organization_id uuid,p_open_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_item finance.open_items%ROWTYPE;v_document finance.business_documents%ROWTYPE;v_document_id uuid;v_today date;v_timezone text;
BEGIN
  IF p_open_item_id IS NULL THEN RAISE EXCEPTION 'advance unavailable' USING ERRCODE='P0002';END IF;
  SELECT * INTO v_item FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.id=p_open_item_id
    AND oi.control_kind IN ('customer_advance','vendor_advance');
  IF NOT FOUND THEN RAISE EXCEPTION 'advance unavailable' USING ERRCODE='P0002';END IF;
  PERFORM finance_private.require_capability(p_organization_id,CASE WHEN v_item.control_kind='customer_advance' THEN 'sales.read' ELSE 'purchases.read' END);
  SELECT je.source_document_id INTO v_document_id FROM finance.journal_lines jl JOIN finance.journal_entries je
    ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
    WHERE jl.organization_id=p_organization_id AND jl.id=v_item.journal_line_id;
  SELECT * INTO v_document FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=v_document_id AND d.state='posted';
  IF NOT FOUND OR NOT finance_private.can_read_document(p_organization_id,v_document.id) THEN RAISE EXCEPTION 'advance unavailable' USING ERRCODE='P0002';END IF;
  SELECT o.timezone INTO v_timezone FROM finance.organizations o WHERE o.id=p_organization_id;v_today:=(now() AT TIME ZONE v_timezone)::date;
  RETURN jsonb_build_object('open_item_id',v_item.id,'document_id',v_document.id,'document_number',v_document.document_number,
    'document_type',v_document.document_type::text,'control_kind',v_item.control_kind,'side',v_item.side,'issue_date',v_item.issue_date,
    'party_id',v_item.party_id,'original_amount',v_item.original_amount::text,
    'remaining_amount',finance_private.open_item_balance_at(p_organization_id,v_item.id,v_today,clock_timestamp())::text,
    'applied_amount',COALESCE((SELECT sum(a.amount) FROM finance.settlement_allocations a JOIN finance.advance_actions aa
      ON aa.organization_id=a.organization_id AND aa.document_id=a.source_document_id AND aa.action_kind='apply'
      LEFT JOIN finance.allocation_reversals r ON r.organization_id=a.organization_id AND r.allocation_id=a.id AND r.effective_date<=v_today
      WHERE a.organization_id=p_organization_id AND (a.debit_open_item_id=v_item.id OR a.credit_open_item_id=v_item.id) AND a.effective_date<=v_today AND r.id IS NULL),0)::text,
    'refunded_amount',COALESCE((SELECT sum(a.amount) FROM finance.settlement_allocations a JOIN finance.advance_actions aa
      ON aa.organization_id=a.organization_id AND aa.document_id=a.source_document_id AND aa.action_kind='refund'
      LEFT JOIN finance.allocation_reversals r ON r.organization_id=a.organization_id AND r.allocation_id=a.id AND r.effective_date<=v_today
      WHERE a.organization_id=p_organization_id AND (a.debit_open_item_id=v_item.id OR a.credit_open_item_id=v_item.id) AND a.effective_date<=v_today AND r.id IS NULL),0)::text,
    'activity',COALESCE((SELECT jsonb_agg(jsonb_build_object('allocation_id',a.id,'amount',a.amount::text,'effective_date',a.effective_date,
      'other_document_id',other.id,'other_document_type',other.document_type::text,'other_document_number',other.document_number,'action_kind',aa.action_kind,'reversed_on',r.effective_date,
      'reversal_document_id',(SELECT rd.id FROM finance.business_documents rd WHERE rd.organization_id=a.organization_id AND rd.reversal_of_document_id=a.source_document_id AND rd.state='posted'),
      'reversal_document_number',(SELECT rd.document_number FROM finance.business_documents rd WHERE rd.organization_id=a.organization_id AND rd.reversal_of_document_id=a.source_document_id AND rd.state='posted'))
      ORDER BY a.effective_date,a.id) FROM finance.settlement_allocations a JOIN finance.open_items counterpart ON counterpart.organization_id=a.organization_id
      AND counterpart.id=CASE WHEN a.debit_open_item_id=v_item.id THEN a.credit_open_item_id ELSE a.debit_open_item_id END
      JOIN finance.journal_lines jl ON jl.organization_id=counterpart.organization_id AND jl.id=counterpart.journal_line_id
      JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
      JOIN finance.business_documents other ON other.organization_id=je.organization_id AND other.id=je.source_document_id
      LEFT JOIN finance.advance_actions aa ON aa.organization_id=other.organization_id AND aa.document_id=other.id
      LEFT JOIN finance.allocation_reversals r ON r.organization_id=a.organization_id AND r.allocation_id=a.id
      WHERE a.organization_id=p_organization_id AND (a.debit_open_item_id=v_item.id OR a.credit_open_item_id=v_item.id)),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.read_advance_lifecycle(uuid,uuid) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_advance_lifecycle(uuid,uuid) TO authenticated;

CREATE FUNCTION public.read_advance_application_targets(p_organization_id uuid,p_advance_open_item_id uuid,p_accounting_date date)
RETURNS TABLE(open_item_id uuid,document_id uuid,document_number text,issue_date date,available_amount text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_advance finance.open_items%ROWTYPE;v_control text;v_side text;
BEGIN
  IF p_accounting_date IS NULL OR NOT isfinite(p_accounting_date) THEN RAISE EXCEPTION 'valid date required' USING ERRCODE='22023';END IF;
  SELECT * INTO v_advance FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.id=p_advance_open_item_id
    AND oi.control_kind IN ('customer_advance','vendor_advance');
  IF NOT FOUND OR v_advance.issue_date>p_accounting_date THEN RAISE EXCEPTION 'advance item unavailable for this date' USING ERRCODE='P0002';END IF;
  PERFORM finance_private.require_capability(p_organization_id,'dues.allocate');
  IF v_advance.control_kind='customer_advance' THEN v_control:='ar';v_side:='debit';PERFORM finance_private.require_capability(p_organization_id,'sales.read');
  ELSE v_control:='ap';v_side:='credit';PERFORM finance_private.require_capability(p_organization_id,'purchases.read');END IF;
  RETURN QUERY SELECT oi.id,d.id,d.document_number,oi.issue_date,
    finance_private.open_item_balance_at(p_organization_id,oi.id,p_accounting_date,clock_timestamp())::text
  FROM finance.open_items oi JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
    JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id AND d.state='posted'
  WHERE oi.organization_id=p_organization_id AND oi.party_id=v_advance.party_id AND oi.control_kind=v_control AND oi.side=v_side
    AND oi.issue_date<=p_accounting_date AND finance_private.open_item_balance_at(p_organization_id,oi.id,p_accounting_date,clock_timestamp())>0
  ORDER BY oi.issue_date,oi.id LIMIT 200;
END $$;
REVOKE ALL ON FUNCTION public.read_advance_application_targets(uuid,uuid,date) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_advance_application_targets(uuid,uuid,date) TO authenticated;

CREATE TABLE finance.advance_actions (
  organization_id uuid NOT NULL,
  document_id uuid NOT NULL,
  action_kind text NOT NULL CHECK (action_kind IN ('apply','refund')),
  advance_open_item_id uuid NOT NULL,
  target_open_item_id uuid,
  cash_account_id uuid,
  amount finance.amount NOT NULL CHECK (amount>0),
  method text,
  reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,document_id),
  FOREIGN KEY (organization_id,document_id) REFERENCES finance.business_documents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,advance_open_item_id) REFERENCES finance.open_items(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,target_open_item_id) REFERENCES finance.open_items(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,cash_account_id) REFERENCES finance.cash_accounts(organization_id,id) ON DELETE RESTRICT,
  CHECK ((action_kind='apply' AND target_open_item_id IS NOT NULL AND cash_account_id IS NULL AND method IS NULL AND reference IS NULL)
      OR (action_kind='refund' AND target_open_item_id IS NULL AND cash_account_id IS NOT NULL AND method IS NOT NULL))
);
REVOKE ALL ON finance.advance_actions FROM PUBLIC,anon,authenticated;

CREATE FUNCTION finance_private.guard_advance_action_draft()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_state finance.document_state;
BEGIN
  SELECT d.state INTO v_state FROM finance.business_documents d WHERE d.organization_id=COALESCE(NEW.organization_id,OLD.organization_id)
    AND d.id=COALESCE(NEW.document_id,OLD.document_id);
  IF v_state IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'advance action plan is immutable after submission' USING ERRCODE='23514';END IF;
  IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_advance_action_draft() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER advance_action_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON finance.advance_actions
  FOR EACH ROW EXECUTE FUNCTION finance_private.guard_advance_action_draft();

CREATE FUNCTION public.save_advance_action_draft(
  p_organization_id uuid,p_request_id text,p_idempotency_key text,p_request_hash text,p_action_kind text,
  p_advance_open_item_id uuid,p_target_open_item_id uuid,p_cash_account_id uuid,p_amount text,p_accounting_date date,
  p_method text DEFAULT NULL,p_reference text DEFAULT NULL
) RETURNS TABLE(document_id uuid,document_version integer,state text,total_amount finance.amount,material_digest text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid;v_org_status text;v_advance finance.open_items%ROWTYPE;v_target finance.open_items%ROWTYPE;v_cash finance.cash_accounts%ROWTYPE;
  v_period uuid;v_fiscal uuid;v_amount finance.amount;v_id uuid:=gen_random_uuid();v_hash text;v_existing_actor uuid;v_receipt jsonb;
  v_scope text;v_doc_type text;v_kind text;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_action_kind IS NULL OR p_action_kind NOT IN ('apply','refund') OR p_advance_open_item_id IS NULL OR p_accounting_date IS NULL OR NOT isfinite(p_accounting_date)
    OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{22,172}$' OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid advance action request' USING ERRCODE='22023';END IF;
  PERFORM finance_private.require_decimal_string(to_jsonb(p_amount),2,false);v_amount:=p_amount::finance.amount;
  IF v_amount<=0 THEN RAISE EXCEPTION 'advance action amount must be positive' USING ERRCODE='23514';END IF;
  v_actor:=finance_private.require_capability(p_organization_id,'dues.allocate');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':advance-actions.save:'||p_idempotency_key,0));
  SELECT i.request_hash,i.actor_member_id,i.response_body INTO v_hash,v_existing_actor,v_receipt FROM finance.idempotency_requests i
    WHERE i.organization_id=p_organization_id AND i.operation='advance-actions.save' AND i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_hash<>p_request_hash OR v_existing_actor<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505';END IF;
    RETURN QUERY SELECT (v_receipt->>'document_id')::uuid,(v_receipt->>'document_version')::integer,v_receipt->>'state',
      (v_receipt->>'total_amount')::finance.amount,v_receipt->>'material_digest';RETURN;
  END IF;
  SELECT o.status INTO v_org_status FROM finance.organizations o WHERE o.id=p_organization_id FOR SHARE;
  IF NOT FOUND OR v_org_status<>'active' THEN RAISE EXCEPTION 'organization is unavailable for advance actions' USING ERRCODE='42501';END IF;
  v_period:=finance_private.lock_accounting_date(p_organization_id,p_accounting_date,false);
  SELECT p.fiscal_year_id INTO v_fiscal FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.id=v_period;
  FOR v_advance IN SELECT oi.* FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.id=p_advance_open_item_id FOR UPDATE LOOP NULL;END LOOP;
  IF v_advance.id IS NULL OR v_advance.control_kind NOT IN ('customer_advance','vendor_advance') OR v_advance.issue_date>p_accounting_date THEN
    RAISE EXCEPTION 'advance item is not eligible' USING ERRCODE='23514';END IF;
  IF v_advance.control_kind='customer_advance' THEN v_scope:='customer';v_doc_type:='customer_advance';v_kind:='sales.write';
  ELSE v_scope:='supplier';v_doc_type:='vendor_advance';v_kind:='purchases.write';END IF;
  PERFORM finance_private.require_capability(p_organization_id,v_kind);
  IF finance_private.open_item_balance_at(p_organization_id,v_advance.id,p_accounting_date,clock_timestamp())<v_amount THEN
    RAISE EXCEPTION 'advance action exceeds the historical remaining balance' USING ERRCODE='23514';END IF;
  IF p_action_kind='apply' THEN
    IF p_target_open_item_id IS NULL OR p_cash_account_id IS NOT NULL OR p_method IS NOT NULL OR p_reference IS NOT NULL THEN RAISE EXCEPTION 'application requires one trade target' USING ERRCODE='22023';END IF;
    SELECT * INTO v_target FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.id=p_target_open_item_id FOR UPDATE;
    IF NOT FOUND OR v_target.party_id<>v_advance.party_id OR v_target.issue_date>p_accounting_date OR
      (v_scope='customer' AND (v_advance.side<>'credit' OR v_target.control_kind<>'ar' OR v_target.side<>'debit')) OR
      (v_scope='supplier' AND (v_advance.side<>'debit' OR v_target.control_kind<>'ap' OR v_target.side<>'credit')) OR
      finance_private.open_item_balance_at(p_organization_id,v_target.id,p_accounting_date,clock_timestamp())<v_amount THEN
      RAISE EXCEPTION 'advance and trade item are not compatible at the requested date' USING ERRCODE='23514';END IF;
  ELSE
    IF p_target_open_item_id IS NOT NULL OR p_cash_account_id IS NULL OR p_method IS NULL OR p_method NOT IN ('cash','bank_transfer','mobile_wallet','card','other')
      OR length(btrim(COALESCE(p_reference,''))) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'refund requires a cash account, method, reference and no trade target' USING ERRCODE='22023';END IF;
    PERFORM finance_private.require_capability(p_organization_id,'banking.write');
    SELECT * INTO v_cash FROM finance.cash_accounts ca WHERE ca.organization_id=p_organization_id AND ca.id=p_cash_account_id FOR SHARE;
    IF NOT FOUND OR NOT v_cash.is_active THEN RAISE EXCEPTION 'active cash or bank account required' USING ERRCODE='23514';END IF;
  END IF;
  INSERT INTO finance.business_documents(organization_id,document_type,state,fiscal_year_id,party_id,issue_date,accounting_date,description,currency,
    net_amount,tax_amount,total_amount,version,created_by_member_id,party_snapshot,material_digest)
  SELECT p_organization_id,'advance_application','draft',v_fiscal,v_advance.party_id,p_accounting_date,p_accounting_date,
    CASE WHEN p_action_kind='apply' THEN 'Advance application' ELSE 'Unused advance refund' END,'BDT',v_amount,0,v_amount,1,v_actor,
    jsonb_build_object('display_name',c.display_name,'legal_name',c.legal_name),p_request_hash
  FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=v_advance.party_id RETURNING id INTO v_id;
  INSERT INTO finance.advance_actions(organization_id,document_id,action_kind,advance_open_item_id,target_open_item_id,cash_account_id,amount,method,reference)
    VALUES(p_organization_id,v_id,p_action_kind,v_advance.id,p_target_open_item_id,p_cash_account_id,v_amount,p_method,NULLIF(btrim(p_reference),''));
  v_receipt:=jsonb_build_object('document_id',v_id,'document_version',1,'state','draft','total_amount',v_amount::text,'material_digest',p_request_hash);
  INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body,resource_document_id)
    VALUES(p_organization_id,'advance-actions.save',p_idempotency_key,p_request_hash,v_actor,200,v_receipt,v_id);
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'advance.action.draft.create','business_document',v_id,p_request_id,
    jsonb_build_object('kind',p_action_kind,'advance_open_item_id',v_advance.id,'target_open_item_id',p_target_open_item_id,'amount',v_amount::text,'accounting_date',p_accounting_date));
  RETURN QUERY SELECT v_id,1,'draft'::text,v_amount,p_request_hash;
END $$;
REVOKE ALL ON FUNCTION public.save_advance_action_draft(uuid,text,text,text,text,uuid,uuid,uuid,text,date,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_advance_action_draft(uuid,text,text,text,text,uuid,uuid,uuid,text,date,text,text) TO authenticated;

CREATE FUNCTION public.submit_advance_action(p_organization_id uuid,p_document_id uuid,p_expected_version integer,p_request_id text,
  p_idempotency_key text,p_request_hash text)
RETURNS TABLE(document_id uuid,document_version integer,state text,approval_request_id uuid,approval_required boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid;v_doc finance.business_documents%ROWTYPE;v_action finance.advance_actions%ROWTYPE;v_request uuid;v_policy finance.approval_policies%ROWTYPE;
  v_policy_count integer;v_threshold finance.amount;v_required boolean;v_snapshot jsonb;v_hash text;v_existing_actor uuid;v_receipt jsonb;
  v_item finance.open_items%ROWTYPE;v_advance finance.open_items%ROWTYPE;v_target finance.open_items%ROWTYPE;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_document_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1 OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 200
    OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid advance submission' USING ERRCODE='22023';END IF;
  v_actor:=finance_private.require_capability(p_organization_id,'dues.allocate');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':advance-actions.submit:'||p_idempotency_key,0));
  SELECT i.request_hash,i.actor_member_id,i.response_body INTO v_hash,v_existing_actor,v_receipt FROM finance.idempotency_requests i
    WHERE i.organization_id=p_organization_id AND i.operation='advance-actions.submit:'||p_document_id::text AND i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_hash<>p_request_hash OR v_existing_actor<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505';END IF;
    RETURN QUERY SELECT (v_receipt->>'document_id')::uuid,(v_receipt->>'document_version')::integer,v_receipt->>'state',
      (v_receipt->>'approval_request_id')::uuid,(v_receipt->>'approval_required')::boolean;RETURN;
  END IF;
  SELECT d.accounting_date INTO v_doc.accounting_date FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id AND d.document_type='advance_application';
  IF NOT FOUND THEN RAISE EXCEPTION 'advance draft is unavailable' USING ERRCODE='P0002';END IF;
  PERFORM finance_private.lock_accounting_date(p_organization_id,v_doc.accounting_date,false);
  SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id AND d.document_type='advance_application' FOR UPDATE;
  SELECT * INTO v_action FROM finance.advance_actions a WHERE a.organization_id=p_organization_id AND a.document_id=p_document_id;
  IF v_doc.id IS NULL OR v_action.document_id IS NULL OR v_doc.state<>'draft' OR v_doc.version<>p_expected_version OR v_doc.material_digest IS NULL THEN
    RAISE EXCEPTION 'advance draft is stale or unavailable' USING ERRCODE='40001';END IF;
  FOR v_item IN SELECT oi.* FROM finance.open_items oi WHERE oi.organization_id=p_organization_id
    AND oi.id IN (v_action.advance_open_item_id,v_action.target_open_item_id) ORDER BY oi.id FOR UPDATE LOOP
    IF v_item.id=v_action.advance_open_item_id THEN v_advance:=v_item;ELSE v_target:=v_item;END IF;
  END LOOP;
  IF v_advance.id IS NULL OR v_advance.party_id<>v_doc.party_id OR v_advance.control_kind NOT IN ('customer_advance','vendor_advance') OR
    finance_private.open_item_balance_at(p_organization_id,v_advance.id,v_doc.accounting_date,clock_timestamp())<v_action.amount THEN
    RAISE EXCEPTION 'advance balance changed before submission' USING ERRCODE='40001';END IF;
  PERFORM finance_private.require_capability(p_organization_id,CASE WHEN v_advance.control_kind='customer_advance' THEN 'sales.write' ELSE 'purchases.write' END);
  IF v_action.action_kind='apply' THEN
    IF v_target.id IS NULL OR v_target.party_id<>v_doc.party_id OR v_target.issue_date>v_doc.accounting_date OR
      (v_advance.control_kind='customer_advance' AND (v_advance.side<>'credit' OR v_target.control_kind<>'ar' OR v_target.side<>'debit')) OR
      (v_advance.control_kind='vendor_advance' AND (v_advance.side<>'debit' OR v_target.control_kind<>'ap' OR v_target.side<>'credit')) OR
      finance_private.open_item_balance_at(p_organization_id,v_target.id,v_doc.accounting_date,clock_timestamp())<v_action.amount THEN
      RAISE EXCEPTION 'trade balance changed before submission' USING ERRCODE='40001';END IF;
  ELSE
    PERFORM finance_private.require_capability(p_organization_id,'banking.write');
    IF NOT EXISTS(SELECT 1 FROM finance.cash_accounts ca WHERE ca.organization_id=p_organization_id AND ca.id=v_action.cash_account_id AND ca.is_active) THEN
      RAISE EXCEPTION 'refund cash account is no longer active' USING ERRCODE='40001';END IF;
  END IF;
  SELECT count(*) INTO v_policy_count FROM finance.approval_policies p WHERE p.organization_id=p_organization_id AND p.document_type='advance_application' AND p.is_active;
  SELECT max(p.threshold_amount) INTO v_threshold FROM finance.approval_policies p WHERE p.organization_id=p_organization_id
    AND p.document_type='advance_application' AND p.is_active AND p.threshold_amount<=v_doc.total_amount;
  v_required:=v_threshold IS NOT NULL;
  IF v_required THEN
    SELECT * INTO v_policy FROM finance.approval_policies p WHERE p.organization_id=p_organization_id AND p.document_type='advance_application'
      AND p.is_active AND p.threshold_amount=v_threshold FOR SHARE;
    IF NOT FOUND OR (SELECT count(*) FROM finance.approval_policies p WHERE p.organization_id=p_organization_id AND p.document_type='advance_application'
      AND p.is_active AND p.threshold_amount=v_threshold)<>1 THEN RAISE EXCEPTION 'advance approval policy is ambiguous' USING ERRCODE='22023';END IF;
    IF NOT EXISTS(SELECT 1 FROM finance.role_permissions rp JOIN finance.permissions pe ON pe.id=rp.permission_id
      WHERE rp.organization_id=p_organization_id AND rp.role_id=v_policy.approver_role_id AND pe.code='approvals.decide') THEN
      RAISE EXCEPTION 'advance approval role cannot decide' USING ERRCODE='23514';END IF;
    v_snapshot:=jsonb_build_object('approval_required',true,'policy_id',v_policy.id,'policy_name',v_policy.name,'policy_version',v_policy.version_no,'document_type','advance_application',
      'threshold_amount',v_policy.threshold_amount::text,'approver_role_id',v_policy.approver_role_id,'required_approvals',v_policy.required_approvals,
      'allow_self_approval',v_policy.allow_self_approval);
  ELSE
    v_snapshot:=jsonb_build_object('approval_required',false,'document_type','advance_application','total_amount',v_doc.total_amount::text,
      'threshold_result',CASE WHEN v_policy_count=0 THEN 'no_active_policy' ELSE 'below_all_active_thresholds' END);
  END IF;
  UPDATE finance.business_documents d SET state=CASE WHEN v_required THEN 'pending_approval'::finance.document_state ELSE 'approved'::finance.document_state END
    WHERE d.organization_id=p_organization_id AND d.id=p_document_id;
  INSERT INTO finance.approval_requests(organization_id,document_id,document_version,document_digest,policy_snapshot,requested_by_member_id,state)
    VALUES(p_organization_id,p_document_id,v_doc.version,v_doc.material_digest,v_snapshot,v_actor,CASE WHEN v_required THEN 'pending' ELSE 'approved' END) RETURNING id INTO v_request;
  v_receipt:=jsonb_build_object('document_id',p_document_id,'document_version',v_doc.version,'state',CASE WHEN v_required THEN 'pending_approval' ELSE 'approved' END,
    'approval_request_id',v_request,'approval_required',v_required);
  INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body,resource_document_id)
    VALUES(p_organization_id,'advance-actions.submit:'||p_document_id::text,p_idempotency_key,p_request_hash,v_actor,200,v_receipt,p_document_id);
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'advance.action.submit','business_document',p_document_id,p_request_id,
    jsonb_build_object('version',v_doc.version,'digest',v_doc.material_digest,'approval_required',v_required,'approval_request_id',v_request));
  RETURN QUERY SELECT p_document_id,v_doc.version,CASE WHEN v_required THEN 'pending_approval' ELSE 'approved' END::text,v_request,v_required;
END $$;
REVOKE ALL ON FUNCTION public.submit_advance_action(uuid,uuid,integer,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_advance_action(uuid,uuid,integer,text,text,text) TO authenticated;

CREATE FUNCTION public.post_advance_action(p_organization_id uuid,p_document_id uuid,p_expected_version integer,p_request_id text,
  p_idempotency_key text,p_request_hash text)
RETURNS TABLE(document_id uuid,document_number text,document_version integer,journal_entry_id uuid,state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid;v_doc finance.business_documents%ROWTYPE;v_action finance.advance_actions%ROWTYPE;v_advance finance.open_items%ROWTYPE;v_target finance.open_items%ROWTYPE;
  v_cash finance.cash_accounts%ROWTYPE;v_period_id uuid;v_period finance.accounting_periods%ROWTYPE;v_number text;v_journal uuid;v_cash_account uuid;
  v_advance_line uuid;v_target_line uuid;v_advance_item uuid;v_target_item uuid;v_total_debit finance.amount;v_total_credit finance.amount;
  v_request finance.approval_requests%ROWTYPE;v_policy finance.approval_policies%ROWTYPE;v_hash text;v_existing_actor uuid;v_receipt jsonb;v_existing jsonb;
  v_item finance.open_items%ROWTYPE;v_operation text:='advance-actions.post:'||p_document_id::text;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_document_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1 OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 200
    OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid advance posting request' USING ERRCODE='22023';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||v_operation||':'||p_idempotency_key,0));
  IF NOT finance_private.can_read_document(p_organization_id,p_document_id) THEN RAISE EXCEPTION 'advance action unavailable' USING ERRCODE='P0002';END IF;
  SELECT * INTO v_action FROM finance.advance_actions a WHERE a.organization_id=p_organization_id AND a.document_id=p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'advance action unavailable' USING ERRCODE='P0002';END IF;
  SELECT i.request_hash,i.actor_member_id,i.response_body INTO v_hash,v_existing_actor,v_receipt FROM finance.idempotency_requests i
    WHERE i.organization_id=p_organization_id AND i.operation=v_operation AND i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    v_actor:=finance_private.require_capability(p_organization_id,'dues.allocate');
    IF v_hash<>p_request_hash OR v_existing_actor<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505';END IF;
    RETURN QUERY SELECT (v_receipt->>'document_id')::uuid,v_receipt->>'document_number',(v_receipt->>'document_version')::integer,
      (v_receipt->>'journal_entry_id')::uuid,v_receipt->>'state';RETURN;
  END IF;
  SELECT d.accounting_date INTO v_doc.accounting_date FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'advance action unavailable' USING ERRCODE='P0002';END IF;
  v_period_id:=finance_private.lock_accounting_date(p_organization_id,v_doc.accounting_date,false);
  SELECT * INTO v_period FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.id=v_period_id;
  SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id FOR UPDATE;
  IF NOT FOUND OR v_doc.document_type<>'advance_application' OR v_doc.version<>p_expected_version OR v_doc.state<>'approved' OR v_doc.total_amount<>v_action.amount THEN
    RAISE EXCEPTION 'advance source version is stale or not approved' USING ERRCODE='40001';END IF;
  v_actor:=finance_private.require_capability(p_organization_id,'dues.allocate');
  SELECT * INTO v_advance FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.id=v_action.advance_open_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'advance item unavailable' USING ERRCODE='P0002';END IF;
  PERFORM finance_private.require_capability(p_organization_id,CASE WHEN v_advance.control_kind='customer_advance' THEN 'sales.post' ELSE 'purchases.post' END);
  IF v_action.action_kind='refund' THEN PERFORM finance_private.require_capability(p_organization_id,'banking.write');END IF;
  IF v_action.target_open_item_id IS NOT NULL THEN SELECT * INTO v_target FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.id=v_action.target_open_item_id;END IF;
  IF v_action.cash_account_id IS NOT NULL THEN SELECT * INTO v_cash FROM finance.cash_accounts ca WHERE ca.organization_id=p_organization_id AND ca.id=v_action.cash_account_id;END IF;
  FOR v_item IN SELECT oi.* FROM finance.open_items oi WHERE oi.organization_id=p_organization_id
    AND oi.id IN (v_action.advance_open_item_id,v_action.target_open_item_id) ORDER BY oi.id FOR UPDATE LOOP
    IF v_item.id=v_action.advance_open_item_id THEN v_advance:=v_item;ELSE v_target:=v_item;END IF;
  END LOOP;
  IF v_action.action_kind='refund' THEN
    SELECT * INTO v_cash FROM finance.cash_accounts ca WHERE ca.organization_id=p_organization_id AND ca.id=v_action.cash_account_id FOR SHARE;
  END IF;
  IF v_advance.party_id<>v_doc.party_id OR v_advance.issue_date>v_doc.accounting_date OR
    finance_private.open_item_balance_at(p_organization_id,v_advance.id,v_doc.accounting_date,clock_timestamp())<v_action.amount THEN
    RAISE EXCEPTION 'advance residual changed before posting' USING ERRCODE='40001';END IF;
  IF v_action.action_kind='apply' THEN
    IF v_target.id IS NULL OR v_target.party_id<>v_advance.party_id OR v_target.issue_date>v_doc.accounting_date OR
      finance_private.open_item_balance_at(p_organization_id,v_target.id,v_doc.accounting_date,clock_timestamp())<v_action.amount OR
      (v_advance.control_kind='customer_advance' AND (v_advance.side<>'credit' OR v_target.control_kind<>'ar' OR v_target.side<>'debit')) OR
      (v_advance.control_kind='vendor_advance' AND (v_advance.side<>'debit' OR v_target.control_kind<>'ap' OR v_target.side<>'credit')) THEN
      RAISE EXCEPTION 'approved advance application targets are no longer compatible' USING ERRCODE='40001';END IF;
  ELSE
    IF v_cash.id IS NULL OR NOT v_cash.is_active THEN RAISE EXCEPTION 'approved refund cash account is unavailable' USING ERRCODE='40001';END IF;
    PERFORM finance_private.require_capability(p_organization_id,'banking.write');
  END IF;
  SELECT * INTO v_request FROM finance.approval_requests r WHERE r.organization_id=p_organization_id AND r.document_id=p_document_id
    AND r.document_version=v_doc.version ORDER BY r.created_at DESC,r.id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_request.state<>'approved' OR v_request.document_digest<>v_doc.material_digest OR
    v_request.policy_snapshot->>'approval_required' NOT IN ('true','false') THEN RAISE EXCEPTION 'approved advance plan is missing or stale' USING ERRCODE='40001';END IF;
  IF v_request.policy_snapshot->>'approval_required'='true' THEN
    SELECT * INTO v_policy FROM finance.approval_policies p WHERE p.organization_id=p_organization_id AND p.id=(v_request.policy_snapshot->>'policy_id')::uuid FOR SHARE;
    IF NOT FOUND OR NOT v_policy.is_active OR v_policy.name<>v_request.policy_snapshot->>'policy_name' OR v_policy.document_type<>'advance_application' OR v_policy.version_no<>(v_request.policy_snapshot->>'policy_version')::integer OR
      v_policy.threshold_amount::text<>v_request.policy_snapshot->>'threshold_amount' OR v_policy.approver_role_id<>(v_request.policy_snapshot->>'approver_role_id')::uuid OR
      v_policy.required_approvals<>(v_request.policy_snapshot->>'required_approvals')::integer OR v_policy.allow_self_approval<>(v_request.policy_snapshot->>'allow_self_approval')::boolean THEN
      RAISE EXCEPTION 'advance approval policy changed' USING ERRCODE='40001';END IF;
    IF (SELECT count(DISTINCT ad.decided_by_member_id) FROM finance.approval_decisions ad JOIN finance.organization_members m
      ON m.organization_id=ad.organization_id AND m.id=ad.decided_by_member_id AND m.status='active'
      JOIN finance.member_roles mr ON mr.organization_id=m.organization_id AND mr.member_id=m.id AND mr.role_id=v_policy.approver_role_id
      JOIN finance.role_permissions rp ON rp.organization_id=mr.organization_id AND rp.role_id=mr.role_id
      JOIN finance.permissions pe ON pe.id=rp.permission_id AND pe.code='approvals.decide'
      WHERE ad.organization_id=p_organization_id AND ad.request_id=v_request.id AND ad.decision='approve')<v_policy.required_approvals THEN
      RAISE EXCEPTION 'current eligible approvals no longer meet the policy' USING ERRCODE='40001';END IF;
    IF EXISTS(SELECT 1 FROM finance.approval_decisions ad WHERE ad.organization_id=p_organization_id AND ad.request_id=v_request.id
      AND ad.decision='approve' AND ad.decided_by_member_id=v_request.requested_by_member_id) AND
      (NOT v_policy.allow_self_approval OR (SELECT count(*) FROM finance.organization_members m WHERE m.organization_id=p_organization_id AND m.status='active')<>1 OR
       NOT finance_private.is_active_owner(p_organization_id,v_request.requested_by_member_id)) THEN
      RAISE EXCEPTION 'advance sole-operator approval exception is no longer valid' USING ERRCODE='40001';END IF;
  END IF;
  v_number:=finance_private.allocate_document_number(p_organization_id,p_document_id);
  INSERT INTO finance.journal_entries(organization_id,source_document_id,period_id,accounting_date,state,is_opening,posted_by_member_id)
    VALUES(p_organization_id,p_document_id,v_period_id,v_doc.accounting_date,'building',false,v_actor) RETURNING id INTO v_journal;
  IF v_action.action_kind='apply' THEN
    IF v_advance.control_kind='customer_advance' THEN
      v_advance_line:=finance_private.insert_posting_line(p_organization_id,v_journal,1,v_advance.account_id,v_doc.party_id,NULL,v_action.amount,0,v_doc.description,'operating',v_number);
      v_target_line:=finance_private.insert_posting_line(p_organization_id,v_journal,2,v_target.account_id,v_doc.party_id,NULL,0,v_action.amount,v_doc.description,'operating',v_number);
    ELSE
      v_target_line:=finance_private.insert_posting_line(p_organization_id,v_journal,1,v_target.account_id,v_doc.party_id,NULL,v_action.amount,0,v_doc.description,'operating',v_number);
      v_advance_line:=finance_private.insert_posting_line(p_organization_id,v_journal,2,v_advance.account_id,v_doc.party_id,NULL,0,v_action.amount,v_doc.description,'operating',v_number);
    END IF;
  ELSE
    IF v_advance.control_kind='customer_advance' THEN
      v_advance_line:=finance_private.insert_posting_line(p_organization_id,v_journal,1,v_advance.account_id,v_doc.party_id,NULL,v_action.amount,0,v_doc.description,'operating',v_number);
      PERFORM finance_private.insert_posting_line(p_organization_id,v_journal,2,v_cash.account_id,NULL,NULL,0,v_action.amount,v_doc.description,'operating');
    ELSE
      PERFORM finance_private.insert_posting_line(p_organization_id,v_journal,1,v_cash.account_id,NULL,NULL,v_action.amount,0,v_doc.description,'operating');
      v_advance_line:=finance_private.insert_posting_line(p_organization_id,v_journal,2,v_advance.account_id,v_doc.party_id,NULL,0,v_action.amount,v_doc.description,'operating',v_number);
    END IF;
    INSERT INTO finance.money_movements(organization_id,document_id,cash_account_id,direction,amount,method,reference,cash_flow_class)
      VALUES(p_organization_id,p_document_id,v_cash.id,CASE WHEN v_advance.control_kind='customer_advance' THEN 'out' ELSE 'in' END,
        v_action.amount,v_action.method,v_action.reference,'operating');
  END IF;
  SELECT oi.id INTO v_advance_item FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.journal_line_id=v_advance_line;
  IF v_advance_item IS NULL THEN RAISE EXCEPTION 'advance reclassification control item missing' USING ERRCODE='23514';END IF;
  PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_advance.id,v_action.amount,v_doc.accounting_date);
  PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_advance_item,v_action.amount,v_doc.accounting_date);
  IF v_advance.side='credit' THEN
    INSERT INTO finance.settlement_allocations(organization_id,debit_open_item_id,credit_open_item_id,amount,effective_date,created_by_member_id,source_document_id)
      VALUES(p_organization_id,v_advance_item,v_advance.id,v_action.amount,v_doc.accounting_date,v_actor,p_document_id);
  ELSE
    INSERT INTO finance.settlement_allocations(organization_id,debit_open_item_id,credit_open_item_id,amount,effective_date,created_by_member_id,source_document_id)
      VALUES(p_organization_id,v_advance.id,v_advance_item,v_action.amount,v_doc.accounting_date,v_actor,p_document_id);
  END IF;
  IF v_action.action_kind='apply' THEN
    SELECT oi.id INTO v_target_item FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.journal_line_id=v_target_line;
    IF v_target_item IS NULL THEN RAISE EXCEPTION 'trade reclassification control item missing' USING ERRCODE='23514';END IF;
    PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_target.id,v_action.amount,v_doc.accounting_date);
    PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,v_target_item,v_action.amount,v_doc.accounting_date);
    IF v_target.side='debit' THEN
      INSERT INTO finance.settlement_allocations(organization_id,debit_open_item_id,credit_open_item_id,amount,effective_date,created_by_member_id,source_document_id)
        VALUES(p_organization_id,v_target.id,v_target_item,v_action.amount,v_doc.accounting_date,v_actor,p_document_id);
    ELSE
      INSERT INTO finance.settlement_allocations(organization_id,debit_open_item_id,credit_open_item_id,amount,effective_date,created_by_member_id,source_document_id)
        VALUES(p_organization_id,v_target_item,v_target.id,v_action.amount,v_doc.accounting_date,v_actor,p_document_id);
    END IF;
  END IF;
  SELECT COALESCE(sum(l.debit),0)::finance.amount,COALESCE(sum(l.credit),0)::finance.amount INTO v_total_debit,v_total_credit
    FROM finance.journal_lines l WHERE l.organization_id=p_organization_id AND l.journal_entry_id=v_journal;
  IF v_total_debit<=0 OR v_total_debit<>v_total_credit OR v_total_debit<>v_action.amount THEN RAISE EXCEPTION 'advance journal is not balanced to source' USING ERRCODE='23514';END IF;
  UPDATE finance.journal_entries j SET state='posted',posted_at=clock_timestamp() WHERE j.organization_id=p_organization_id AND j.id=v_journal;
  UPDATE finance.business_documents d SET state='posted',document_number=v_number,posted_by_member_id=v_actor,posted_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE d.organization_id=p_organization_id AND d.id=p_document_id;
  v_receipt:=jsonb_build_object('document_id',p_document_id,'document_number',v_number,'document_version',v_doc.version,'journal_entry_id',v_journal,'state','posted');
  INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body,resource_document_id)
    VALUES(p_organization_id,v_operation,p_idempotency_key,p_request_hash,v_actor,200,v_receipt,p_document_id);
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'advance.action.post','business_document',p_document_id,p_request_id,
    jsonb_build_object('kind',v_action.action_kind,'amount',v_action.amount::text,'advance_open_item_id',v_advance.id,'target_open_item_id',v_target.id,'journal_entry_id',v_journal));
  PERFORM finance_private.enqueue_outbox_event(p_organization_id,'document.posted',p_document_id,'document.posted:'||p_document_id::text,
    jsonb_build_object('document_id',p_document_id,'document_version',v_doc.version,'journal_entry_id',v_journal));
  RETURN QUERY SELECT p_document_id,v_number,v_doc.version,v_journal,'posted'::text;
END $$;
REVOKE ALL ON FUNCTION public.post_advance_action(uuid,uuid,integer,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.post_advance_action(uuid,uuid,integer,text,text,text) TO authenticated;

CREATE FUNCTION public.read_advance_action_lifecycle(p_organization_id uuid,p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_action finance.advance_actions%ROWTYPE;v_doc finance.business_documents%ROWTYPE;v_source_doc uuid;v_target_doc uuid;
BEGIN
  SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id AND d.document_type='advance_application';
  IF NOT FOUND OR NOT finance_private.can_read_document(p_organization_id,p_document_id) THEN RAISE EXCEPTION 'advance action unavailable' USING ERRCODE='P0002';END IF;
  SELECT * INTO v_action FROM finance.advance_actions a WHERE a.organization_id=p_organization_id AND a.document_id=p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'advance action details unavailable' USING ERRCODE='P0002';END IF;
  SELECT je.source_document_id INTO v_source_doc FROM finance.journal_lines jl JOIN finance.journal_entries je
    ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id WHERE jl.organization_id=p_organization_id
      AND jl.id=(SELECT oi.journal_line_id FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.id=v_action.advance_open_item_id);
  IF v_action.target_open_item_id IS NOT NULL THEN
    SELECT je.source_document_id INTO v_target_doc FROM finance.journal_lines jl JOIN finance.journal_entries je
      ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id WHERE jl.organization_id=p_organization_id
        AND jl.id=(SELECT oi.journal_line_id FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.id=v_action.target_open_item_id);
  END IF;
  RETURN jsonb_build_object('action_kind',v_action.action_kind,'amount',v_action.amount::text,'advance_open_item_id',v_action.advance_open_item_id,
    'reversed_by_document_id',(SELECT rd.id FROM finance.business_documents rd WHERE rd.organization_id=p_organization_id AND rd.reversal_of_document_id=p_document_id AND rd.state='posted'),
    'reversed_by_document_number',(SELECT rd.document_number FROM finance.business_documents rd WHERE rd.organization_id=p_organization_id AND rd.reversal_of_document_id=p_document_id AND rd.state='posted'),
    'advance_document_id',v_source_doc,'target_open_item_id',v_action.target_open_item_id,'target_document_id',v_target_doc,'cash_account_id',v_action.cash_account_id,
    'cash_account_name',(SELECT ca.name FROM finance.cash_accounts ca WHERE ca.organization_id=p_organization_id AND ca.id=v_action.cash_account_id),
    'method',v_action.method,'reference',v_action.reference,'source_control_kind',(SELECT oi.control_kind FROM finance.open_items oi
      WHERE oi.organization_id=p_organization_id AND oi.id=v_action.advance_open_item_id),
    'approvals',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'state',r.state,'version',r.document_version,'created_at',r.created_at,
      'decisions',COALESCE((SELECT jsonb_agg(jsonb_build_object('decision',ad.decision,'reason',ad.reason,'created_at',ad.created_at) ORDER BY ad.created_at,ad.id)
        FROM finance.approval_decisions ad WHERE ad.organization_id=r.organization_id AND ad.request_id=r.id),'[]'::jsonb)) ORDER BY r.created_at,r.id)
      FROM finance.approval_requests r WHERE r.organization_id=p_organization_id AND r.document_id=p_document_id),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.read_advance_action_lifecycle(uuid,uuid) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_advance_action_lifecycle(uuid,uuid) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
