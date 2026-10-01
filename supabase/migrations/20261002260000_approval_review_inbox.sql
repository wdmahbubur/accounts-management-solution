-- US-064/065: expose only source-readable approval requests and evidence.
BEGIN;

-- Extend submission to every supported financial source type. Allocation plans
-- are mandatory only for cash settlement documents; other source types still
-- bind their complete material digest and policy snapshot.
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
END $$;
REVOKE ALL ON FUNCTION public.submit_financial_document(uuid,uuid,integer,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_financial_document(uuid,uuid,integer,text,text,text,text) TO authenticated;

CREATE FUNCTION public.list_approval_inbox(p_organization_id uuid,p_state text DEFAULT 'pending')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_state text; v_result jsonb;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'approvals.read');
  IF p_state IS NULL OR p_state NOT IN ('pending','approved','rejected','all') THEN
    RAISE EXCEPTION 'invalid approval inbox filter' USING ERRCODE='22023';
  END IF;
  v_state:=p_state;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',r.id,'state',r.state,'created_at',r.created_at,'document_id',d.id,'document_type',d.document_type::text,
    'document_number',d.document_number,'description',d.description,'accounting_date',d.accounting_date,
    'total_amount',d.total_amount::text,'document_version',r.document_version,'current_version',d.version,
    'stale',d.version<>r.document_version OR d.material_digest<>r.document_digest OR d.state NOT IN ('pending_approval','approved'),
    'maker',m.display_name_snapshot,'policy_snapshot',r.policy_snapshot||jsonb_build_object('approver_role_name',
      (SELECT ro.name FROM finance.roles ro WHERE ro.organization_id=r.organization_id AND ro.id=(r.policy_snapshot->>'approver_role_id')::uuid)),
    'approved_count',(SELECT count(*) FROM finance.approval_decisions ad WHERE ad.organization_id=r.organization_id AND ad.request_id=r.id AND ad.decision='approve'),
    'decision_count',(SELECT count(*) FROM finance.approval_decisions ad WHERE ad.organization_id=r.organization_id AND ad.request_id=r.id)),
    ORDER BY r.created_at DESC,r.id DESC),'[]'::jsonb)
    INTO v_result
  FROM finance.approval_requests r
  JOIN finance.business_documents d ON d.organization_id=r.organization_id AND d.id=r.document_id
  JOIN finance.organization_members m ON m.organization_id=r.organization_id AND m.id=r.requested_by_member_id
  WHERE r.organization_id=p_organization_id AND r.state IN ('pending','approved','rejected')
    AND (v_state='all' OR r.state=v_state) AND finance_private.can_read_document(r.organization_id,d.id);
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.list_approval_inbox(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_approval_inbox(uuid,text) TO authenticated;

CREATE FUNCTION public.read_approval_review(p_organization_id uuid,p_approval_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_request finance.approval_requests%ROWTYPE; v_result jsonb;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'approvals.read');
  IF p_approval_request_id IS NULL THEN RAISE EXCEPTION 'approval request unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_request FROM finance.approval_requests r WHERE r.organization_id=p_organization_id AND r.id=p_approval_request_id;
  IF NOT FOUND OR NOT finance_private.can_read_document(p_organization_id,v_request.document_id) THEN
    RAISE EXCEPTION 'approval request unavailable' USING ERRCODE='P0002';
  END IF;
  SELECT jsonb_build_object(
    'id',r.id,'state',r.state,'created_at',r.created_at,'document_id',d.id,'document_type',d.document_type::text,
    'document_number',d.document_number,'description',d.description,'accounting_date',d.accounting_date,
    'total_amount',d.total_amount::text,'document_version',r.document_version,'current_version',d.version,
    'stale',d.version<>r.document_version OR d.material_digest<>r.document_digest OR d.state NOT IN ('pending_approval','approved'),
    'maker',m.display_name_snapshot,'policy_snapshot',r.policy_snapshot||jsonb_build_object('approver_role_name',
      (SELECT ro.name FROM finance.roles ro WHERE ro.organization_id=r.organization_id AND ro.id=(r.policy_snapshot->>'approver_role_id')::uuid)),
    'document',public.read_financial_document(p_organization_id,d.id),
    'attachments',CASE WHEN finance_private.has_permission(p_organization_id,'attachments.read') THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',a.id,'filename',a.original_filename,'content_type',a.content_type,'byte_size',a.byte_size,
        'scan_status',a.scan_status,'created_at',a.created_at) ORDER BY a.created_at,a.id)
      FROM finance.attachment_links al JOIN finance.attachments a ON a.organization_id=al.organization_id AND a.id=al.attachment_id
      WHERE al.organization_id=p_organization_id AND al.document_id=d.id AND finance_private.can_read_attachment(al.organization_id,a.id)
    ),'[]'::jsonb) ELSE '[]'::jsonb END,
    'decisions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',ad.id,'decision',ad.decision,'reason',ad.reason,
      'decided_at',ad.created_at,'decided_by',dm.display_name_snapshot) ORDER BY ad.created_at,ad.id)
      FROM finance.approval_decisions ad JOIN finance.organization_members dm ON dm.organization_id=ad.organization_id AND dm.id=ad.decided_by_member_id
      WHERE ad.organization_id=r.organization_id AND ad.request_id=r.id),'[]'::jsonb)) INTO v_result
  FROM finance.approval_requests r
  JOIN finance.business_documents d ON d.organization_id=r.organization_id AND d.id=r.document_id
  JOIN finance.organization_members m ON m.organization_id=r.organization_id AND m.id=r.requested_by_member_id
  WHERE r.organization_id=p_organization_id AND r.id=p_approval_request_id;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.read_approval_review(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_approval_review(uuid,uuid) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
