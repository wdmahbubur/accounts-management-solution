-- Cash previews and posting consume the same ordered accounting plan.
-- The planner never allocates numbers or writes journals, open items or settlements.
CREATE FUNCTION finance_private.cash_document_posting_plan(
  p_organization_id uuid, p_document_id uuid
) RETURNS TABLE(
  line_no integer, account_id uuid, party_id uuid, cost_center_id uuid,
  debit finance.amount, credit finance.amount, description text,
  cash_flow_class finance.cash_flow_class, creates_open_item boolean, open_item_due_date date
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_doc finance.business_documents%ROWTYPE;
  v_movement finance.money_movements%ROWTYPE;
  v_transfer finance.transfers%ROWTYPE;
  v_cash uuid;
  v_destination uuid;
  v_control uuid;
  v_control_kind text;
  v_incoming boolean;
BEGIN
  SELECT d.* INTO v_doc FROM finance.business_documents d
    WHERE d.organization_id = p_organization_id AND d.id = p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE = 'P0002'; END IF;
  IF v_doc.currency <> 'BDT' OR v_doc.total_amount <= 0 THEN
    RAISE EXCEPTION 'cash source must have a positive BDT total' USING ERRCODE = '23514';
  END IF;

  IF v_doc.document_type IN ('receipt','vendor_payment','customer_refund','vendor_refund','customer_advance','vendor_advance') THEN
    SELECT m.* INTO v_movement FROM finance.money_movements m
      WHERE m.organization_id = p_organization_id AND m.document_id = p_document_id;
    IF NOT FOUND OR v_movement.amount <> v_doc.total_amount THEN
      RAISE EXCEPTION 'cash movement must agree with source total' USING ERRCODE = '23514';
    END IF;
    SELECT ca.account_id INTO v_cash FROM finance.cash_accounts ca
      JOIN finance.accounts a ON a.organization_id = ca.organization_id AND a.id = ca.account_id
      WHERE ca.organization_id = p_organization_id AND ca.id = v_movement.cash_account_id
        AND ca.is_active AND a.is_active AND a.is_postable AND a.control_kind IS NULL;
    IF v_cash IS NULL THEN RAISE EXCEPTION 'cash account is unavailable' USING ERRCODE = '23514'; END IF;

    v_control_kind := CASE
      WHEN v_doc.document_type IN ('receipt','customer_refund') THEN 'ar'
      WHEN v_doc.document_type IN ('vendor_payment','vendor_refund') THEN 'ap'
      WHEN v_doc.document_type = 'customer_advance' THEN 'customer_advance'
      ELSE 'vendor_advance' END;
    SELECT m.account_id INTO v_control FROM finance.account_mappings m
      JOIN finance.accounts a ON a.organization_id = m.organization_id AND a.id = m.account_id
      WHERE m.organization_id = p_organization_id AND m.mapping_key = v_control_kind
        AND a.is_active AND a.is_postable AND a.control_kind::text = v_control_kind;
    IF v_control IS NULL THEN RAISE EXCEPTION 'control-account mapping is required' USING ERRCODE = '23514'; END IF;
    -- Retain the posting command's existing AR prerequisite for customer advances.
    IF v_doc.document_type = 'customer_advance' AND NOT EXISTS (
      SELECT 1 FROM finance.account_mappings m JOIN finance.accounts a
        ON a.organization_id = m.organization_id AND a.id = m.account_id
      WHERE m.organization_id = p_organization_id AND m.mapping_key = 'ar'
        AND a.is_active AND a.is_postable AND a.control_kind = 'ar'
    ) THEN RAISE EXCEPTION 'AR mapping is required' USING ERRCODE = '23514'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM finance.contacts c WHERE c.organization_id = p_organization_id
        AND c.id = v_doc.party_id AND c.is_active
        AND CASE WHEN v_control_kind IN ('ar','customer_advance') THEN c.is_customer ELSE c.is_vendor END
    ) THEN RAISE EXCEPTION 'party does not match the control-account type' USING ERRCODE = '23514'; END IF;
    IF v_doc.due_date IS NOT NULL AND (NOT isfinite(v_doc.due_date) OR v_doc.due_date < v_doc.accounting_date) THEN
      RAISE EXCEPTION 'open-item due date is invalid' USING ERRCODE = '22023';
    END IF;
    v_incoming := v_doc.document_type IN ('receipt','customer_advance','vendor_refund');
    RETURN QUERY SELECT 1, v_cash, NULL::uuid, NULL::uuid,
      CASE WHEN v_incoming THEN v_movement.amount ELSE 0::finance.amount END,
      CASE WHEN v_incoming THEN 0::finance.amount ELSE v_movement.amount END,
      v_doc.description, v_movement.cash_flow_class, false, NULL::date;
    RETURN QUERY SELECT 2, v_control, v_doc.party_id, NULL::uuid,
      CASE WHEN v_incoming THEN 0::finance.amount ELSE v_movement.amount END,
      CASE WHEN v_incoming THEN v_movement.amount ELSE 0::finance.amount END,
      v_doc.description, v_movement.cash_flow_class, true, v_doc.due_date;
  ELSIF v_doc.document_type = 'transfer' THEN
    SELECT t.* INTO v_transfer FROM finance.transfers t
      WHERE t.organization_id = p_organization_id AND t.document_id = p_document_id;
    IF NOT FOUND OR v_transfer.amount + v_transfer.fee_amount <> v_doc.total_amount THEN
      RAISE EXCEPTION 'transfer details must agree with the source total' USING ERRCODE = '23514';
    END IF;
    SELECT ca.account_id INTO v_destination FROM finance.cash_accounts ca
      JOIN finance.accounts a ON a.organization_id = ca.organization_id AND a.id = ca.account_id
      WHERE ca.organization_id = p_organization_id AND ca.id = v_transfer.to_cash_account_id
        AND ca.is_active AND a.is_active AND a.is_postable AND a.control_kind IS NULL;
    IF v_destination IS NULL THEN RAISE EXCEPTION 'destination cash account is unavailable' USING ERRCODE = '23514'; END IF;
    SELECT ca.account_id INTO v_cash FROM finance.cash_accounts ca
      JOIN finance.accounts a ON a.organization_id = ca.organization_id AND a.id = ca.account_id
      WHERE ca.organization_id = p_organization_id AND ca.id = v_transfer.from_cash_account_id
        AND ca.is_active AND a.is_active AND a.is_postable AND a.control_kind IS NULL;
    IF v_cash IS NULL THEN RAISE EXCEPTION 'source cash account is unavailable' USING ERRCODE = '23514'; END IF;
    IF v_transfer.fee_amount > 0 AND NOT EXISTS (
      SELECT 1 FROM finance.accounts a WHERE a.organization_id = p_organization_id
        AND a.id = v_transfer.fee_account_id AND a.is_active AND a.is_postable AND a.control_kind IS NULL
    ) THEN RAISE EXCEPTION 'transfer fee account is unavailable' USING ERRCODE = '23514'; END IF;
    RETURN QUERY SELECT 1, v_destination, NULL::uuid, NULL::uuid, v_transfer.amount, 0::finance.amount,
      v_doc.description, 'internal'::finance.cash_flow_class, false, NULL::date;
    IF v_transfer.fee_amount > 0 THEN
      RETURN QUERY SELECT 2, v_transfer.fee_account_id, NULL::uuid, NULL::uuid, v_transfer.fee_amount, 0::finance.amount,
        'Transfer fee'::text, 'operating'::finance.cash_flow_class, false, NULL::date;
    END IF;
    RETURN QUERY SELECT CASE WHEN v_transfer.fee_amount > 0 THEN 3 ELSE 2 END, v_cash, NULL::uuid, NULL::uuid,
      0::finance.amount, (v_transfer.amount + v_transfer.fee_amount)::finance.amount,
      v_doc.description, 'internal'::finance.cash_flow_class, false, NULL::date;
  ELSE
    RAISE EXCEPTION 'this source is not a cash document' USING ERRCODE = '22023';
  END IF;
END; $$;
REVOKE ALL ON FUNCTION finance_private.cash_document_posting_plan(uuid,uuid) FROM PUBLIC, ams_runtime;

CREATE FUNCTION finance_private.cash_document_preview(p_organization_id uuid, p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_doc finance.business_documents%ROWTYPE;
  v_lines jsonb;
  v_debit finance.amount;
  v_credit finance.amount;
  v_control uuid;
  v_plan record;
  v_allocated finance.amount := 0;
  v_allocations jsonb := '[]'::jsonb;
BEGIN
  SELECT d.* INTO v_doc FROM finance.business_documents d
    WHERE d.organization_id = p_organization_id AND d.id = p_document_id;
  SELECT jsonb_agg(jsonb_build_object(
      'line_no', p.line_no, 'account_id', p.account_id, 'account_code', a.code, 'account_name', a.name,
      'party_id', p.party_id, 'party_name', c.display_name, 'debit', p.debit::text, 'credit', p.credit::text,
      'description', p.description, 'cash_flow_class', p.cash_flow_class, 'creates_open_item', p.creates_open_item
    ) ORDER BY p.line_no), sum(p.debit)::finance.amount, sum(p.credit)::finance.amount,
    (array_agg(p.account_id) FILTER (WHERE p.creates_open_item))[1]
    INTO v_lines, v_debit, v_credit, v_control
    FROM finance_private.cash_document_posting_plan(p_organization_id, p_document_id) p
      JOIN finance.accounts a ON a.organization_id = p_organization_id AND a.id = p.account_id
      LEFT JOIN finance.contacts c ON c.organization_id = p_organization_id AND c.id = p.party_id;
  IF v_debit IS NULL OR v_debit <= 0 OR v_debit <> v_credit OR v_debit <> v_doc.total_amount THEN
    RAISE EXCEPTION 'cash posting plan must balance and agree with the source total' USING ERRCODE = '23514';
  END IF;
  FOR v_plan IN
    SELECT p.target_open_item_id, p.amount, oi.party_id, oi.account_id, oi.side,
      d.id AS target_document_id, d.document_number,
      finance_private.open_item_residual_as_of(p_organization_id, oi.id, v_doc.accounting_date) AS available
    FROM finance.document_allocation_plans p
      JOIN finance.open_items oi ON oi.organization_id = p.organization_id AND oi.id = p.target_open_item_id
      JOIN finance.journal_lines jl ON jl.organization_id = oi.organization_id AND jl.id = oi.journal_line_id
      JOIN finance.journal_entries je ON je.organization_id = jl.organization_id AND je.id = jl.journal_entry_id
      JOIN finance.business_documents d ON d.organization_id = je.organization_id AND d.id = je.source_document_id
    WHERE p.organization_id = p_organization_id AND p.document_id = p_document_id ORDER BY p.target_open_item_id
  LOOP
    IF v_doc.document_type NOT IN ('receipt','vendor_payment') OR v_plan.party_id IS DISTINCT FROM v_doc.party_id
      OR v_plan.account_id IS DISTINCT FROM v_control OR v_plan.amount <= 0
      OR v_plan.side IS DISTINCT FROM (CASE WHEN v_doc.document_type = 'receipt' THEN 'debit' ELSE 'credit' END) THEN
      RAISE EXCEPTION 'settlement plan target is no longer compatible' USING ERRCODE = '23514';
    END IF;
    -- This existing helper checks every historical boundary; no allocation is inserted here.
    PERFORM finance_private.assert_open_item_allocation_capacity(
      p_organization_id, v_plan.target_open_item_id, v_plan.amount, v_doc.accounting_date
    );
    v_allocated := v_allocated + v_plan.amount;
    v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
      'target_open_item_id', v_plan.target_open_item_id, 'amount', v_plan.amount::text,
      'document_number', CASE WHEN finance_private.can_read_document(p_organization_id, v_plan.target_document_id)
        THEN v_plan.document_number ELSE NULL END,
      'available_amount', v_plan.available::text
    ));
  END LOOP;
  IF v_allocated > v_doc.total_amount THEN
    RAISE EXCEPTION 'planned settlements exceed the payment amount' USING ERRCODE = '23P01';
  END IF;
  RETURN jsonb_build_object(
    'document_id', v_doc.id, 'document_version', v_doc.version, 'document_type', v_doc.document_type,
    'currency', 'BDT', 'debit', v_debit::text, 'credit', v_credit::text, 'balanced', true, 'lines', v_lines,
    'allocations', v_allocations, 'allocated_amount', v_allocated::text,
    'unallocated_amount', CASE WHEN v_doc.document_type IN ('receipt','vendor_payment')
      THEN (v_doc.total_amount - v_allocated)::finance.amount::text ELSE NULL END
  );
END; $$;
REVOKE ALL ON FUNCTION finance_private.cash_document_preview(uuid,uuid) FROM PUBLIC, ams_runtime;

CREATE FUNCTION public.preview_cash_document_posting(
  p_organization_id uuid, p_document_id uuid, p_expected_version integer
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_doc finance.business_documents%ROWTYPE; v_capability text;
BEGIN
  IF NOT finance_private.can_read_document(p_organization_id, p_document_id) THEN
    RAISE EXCEPTION 'document unavailable' USING ERRCODE = 'P0002';
  END IF;
  SELECT d.* INTO v_doc FROM finance.business_documents d
    WHERE d.organization_id = p_organization_id AND d.id = p_document_id;
  v_capability := CASE
    WHEN v_doc.document_type IN ('receipt','customer_refund','customer_advance') THEN 'sales.write'
    WHEN v_doc.document_type IN ('vendor_payment','vendor_refund','vendor_advance') THEN 'purchases.write'
    WHEN v_doc.document_type = 'transfer' THEN 'banking.write' END;
  IF v_capability IS NULL THEN RAISE EXCEPTION 'this source is not a cash document' USING ERRCODE = '22023'; END IF;
  PERFORM finance_private.require_capability(p_organization_id, v_capability);
  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'current document version required' USING ERRCODE = '22023';
  END IF;
  IF v_doc.version <> p_expected_version THEN RAISE EXCEPTION 'stale document version' USING ERRCODE = '40001'; END IF;
  IF v_doc.state IN ('posted','void') THEN RAISE EXCEPTION 'source is not previewable' USING ERRCODE = '23514'; END IF;
  RETURN finance_private.cash_document_preview(p_organization_id, p_document_id);
END; $$;
REVOKE ALL ON FUNCTION public.preview_cash_document_posting(uuid,uuid,integer) FROM PUBLIC, ams_runtime;
GRANT EXECUTE ON FUNCTION public.preview_cash_document_posting(uuid,uuid,integer) TO ams_runtime;

CREATE FUNCTION public.preview_approval_cash_posting(
  p_organization_id uuid, p_approval_request_id uuid, p_expected_version integer
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_request finance.approval_requests%ROWTYPE; v_doc finance.business_documents%ROWTYPE;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id, 'approvals.read');
  SELECT r.* INTO v_request FROM finance.approval_requests r
    WHERE r.organization_id = p_organization_id AND r.id = p_approval_request_id;
  IF NOT FOUND OR NOT finance_private.can_read_document(p_organization_id, v_request.document_id) THEN
    RAISE EXCEPTION 'approval request unavailable' USING ERRCODE = 'P0002';
  END IF;
  SELECT d.* INTO v_doc FROM finance.business_documents d
    WHERE d.organization_id = p_organization_id AND d.id = v_request.document_id;
  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'submitted document version required' USING ERRCODE = '22023';
  END IF;
  IF v_request.document_version <> p_expected_version OR v_doc.version <> p_expected_version
    OR v_request.document_digest IS DISTINCT FROM v_doc.material_digest
    OR v_request.state NOT IN ('pending','approved') OR v_doc.state NOT IN ('pending_approval','approved') THEN
    RAISE EXCEPTION 'approval no longer matches the current source' USING ERRCODE = '40001';
  END IF;
  RETURN finance_private.cash_document_preview(p_organization_id, v_doc.id);
END; $$;
REVOKE ALL ON FUNCTION public.preview_approval_cash_posting(uuid,uuid,integer) FROM PUBLIC, ams_runtime;
GRANT EXECUTE ON FUNCTION public.preview_approval_cash_posting(uuid,uuid,integer) TO ams_runtime;

-- Preserve the existing atomic command; only cash-line construction delegates to the shared plan.
CREATE OR REPLACE FUNCTION public.post_financial_document(p_organization_id uuid,p_document_id uuid,p_expected_version integer,
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
  v_open_item_id uuid; v_alloc_id uuid; v_target finance.open_items%ROWTYPE; v_plan record; v_period finance.accounting_periods%ROWTYPE;
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
  ELSIF v_type IN ('receipt','vendor_payment','customer_refund','vendor_refund','customer_advance','vendor_advance','transfer') THEN
    -- Preview and posting use this one ordered cash-accounting plan. All writing,
    -- account locks, open-item creation and settlement checks remain in this command.
    FOR v_line IN SELECT p.* FROM finance_private.cash_document_posting_plan(p_organization_id,p_document_id) p ORDER BY p.line_no LOOP
      v_line_no:=v_line_no+1;
      PERFORM finance_private.insert_posting_line(p_organization_id,v_journal_id,v_line_no,
        v_line.account_id,v_line.party_id,v_line.cost_center_id,v_line.debit,v_line.credit,v_line.description,v_line.cash_flow_class,
        CASE WHEN v_line.creates_open_item THEN v_number ELSE NULL END,v_line.open_item_due_date);
      IF v_line.creates_open_item AND v_type='receipt' THEN v_ar:=v_line.account_id; END IF;
      IF v_line.creates_open_item AND v_type='vendor_payment' THEN v_ap:=v_line.account_id; END IF;
    END LOOP;
    IF v_type IN ('receipt','vendor_payment') THEN
      SELECT mm.* INTO v_movement FROM finance.money_movements mm WHERE mm.organization_id=p_organization_id AND mm.document_id=p_document_id;
      FOR v_line IN SELECT oi.id,oi.side,p.amount FROM finance.document_allocation_plans p JOIN finance.open_items oi
        ON oi.organization_id=p.organization_id AND oi.id=p.target_open_item_id WHERE p.organization_id=p_organization_id AND p.document_id=p_document_id ORDER BY oi.id LOOP
        SELECT * INTO v_target FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.id=v_line.id FOR UPDATE;
        IF NOT FOUND OR v_target.party_id IS DISTINCT FROM v_doc.party_id OR v_target.account_id IS DISTINCT FROM (CASE WHEN v_type='receipt' THEN v_ar ELSE v_ap END) OR
           v_target.side IS DISTINCT FROM (CASE WHEN v_type='receipt' THEN 'debit' ELSE 'credit' END) OR v_line.amount<=0 OR v_line.amount>v_movement.amount THEN
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
END; $$;
REVOKE ALL ON FUNCTION public.post_financial_document(uuid,uuid,integer,text,text,text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.post_financial_document(uuid,uuid,integer,text,text,text) TO ams_runtime;

NOTIFY pgrst,'reload schema';
