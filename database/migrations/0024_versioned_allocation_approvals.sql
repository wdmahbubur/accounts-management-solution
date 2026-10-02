-- US-025: bind approval decisions to a specific source version and policy snapshot.

-- Approval state transitions do not change the material version. Material edits still must increment it.
CREATE OR REPLACE FUNCTION finance_private.guard_source_document()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.state<>'draft' THEN RAISE EXCEPTION 'posted and approved documents cannot be deleted' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.state IN ('posted','void') THEN RAISE EXCEPTION 'posted and void documents are immutable' USING ERRCODE='23514'; END IF;
  IF NEW.version=OLD.version AND NEW.state IS DISTINCT FROM OLD.state AND
     (to_jsonb(NEW)-'state')=(to_jsonb(OLD)-'state') AND
     ((OLD.state='draft' AND NEW.state='pending_approval') OR
      (OLD.state='pending_approval' AND NEW.state IN ('approved','draft'))) THEN
    RETURN NEW;
  END IF;
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
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.id IS DISTINCT FROM OLD.id OR
     NEW.document_type IS DISTINCT FROM OLD.document_type OR NEW.created_by_member_id IS DISTINCT FROM OLD.created_by_member_id OR
     (NEW.document_number IS DISTINCT FROM OLD.document_number AND NOT (OLD.document_number IS NULL AND NEW.document_number IS NOT NULL AND NEW.state='posted')) OR
     (NEW.state<>'posted' AND (NEW.posted_at IS NOT NULL OR NEW.posted_by_member_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'source identity or issued fields cannot be changed by draft save' USING ERRCODE='23514';
  END IF;
  IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'document version must advance by one' USING ERRCODE='40001'; END IF;
  RETURN NEW;
END; $$;

CREATE FUNCTION finance_private.reject_approval_decision_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'approval decisions are append-only' USING ERRCODE='23514'; END; $$;
REVOKE ALL ON FUNCTION finance_private.reject_approval_decision_mutation() FROM PUBLIC,ams_runtime;
CREATE TRIGGER approval_decisions_append_only BEFORE UPDATE OR DELETE ON finance.approval_decisions
  FOR EACH ROW EXECUTE FUNCTION finance_private.reject_approval_decision_mutation();
CREATE TRIGGER approval_decisions_no_truncate BEFORE TRUNCATE ON finance.approval_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION finance_private.reject_approval_decision_mutation();

CREATE FUNCTION public.submit_financial_document(
  p_organization_id uuid,p_document_id uuid,p_expected_version integer,p_operation text,p_request_id text,
  p_idempotency_key text,p_request_hash text
) RETURNS TABLE(approval_request_id uuid,document_id uuid,document_version integer,state text,approval_required boolean,policy_snapshot jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_type finance.document_type; v_doc finance.business_documents%ROWTYPE; v_policy finance.approval_policies%ROWTYPE;
  v_operation text; v_hash text; v_existing_actor uuid; v_receipt jsonb; v_snapshot jsonb; v_max_threshold finance.amount;
  v_policy_count integer; v_required boolean; v_request_id uuid; v_rank_count integer;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_expected_version IS NULL OR p_expected_version<1 OR p_operation IS DISTINCT FROM 'documents.submit:'||p_document_id::text OR
     p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 200 OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid approval submission request' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_operation||':'||p_idempotency_key,0));
  IF NOT finance_private.can_read_document(p_organization_id,p_document_id) THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
  SELECT d.document_type INTO v_type FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id;
  IF NOT FOUND OR v_type NOT IN ('receipt','vendor_payment') THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
  v_actor:=finance_private.require_capability(p_organization_id,CASE WHEN v_type='receipt' THEN 'sales.write' ELSE 'purchases.write' END);
  PERFORM finance_private.require_capability(p_organization_id,'dues.read');
  SELECT i.request_hash,i.actor_member_id,i.response_body INTO v_hash,v_existing_actor,v_receipt FROM finance.idempotency_requests i
    WHERE i.organization_id=p_organization_id AND i.operation=p_operation AND i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_hash<>p_request_hash OR v_existing_actor<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505'; END IF;
    RETURN QUERY SELECT (v_receipt->>'approval_request_id')::uuid,(v_receipt->>'document_id')::uuid,
      (v_receipt->>'document_version')::integer,v_receipt->>'state',(v_receipt->>'approval_required')::boolean,v_receipt->'policy_snapshot'; RETURN;
  END IF;
  SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
  IF v_doc.document_type NOT IN ('receipt','vendor_payment') OR v_doc.party_id IS NULL OR v_doc.state<>'draft' THEN
    RAISE EXCEPTION 'only editable receipt and supplier payment plans can be submitted' USING ERRCODE='23514';
  END IF;
  IF v_doc.version<>p_expected_version THEN RAISE EXCEPTION 'source version is stale' USING ERRCODE='40001'; END IF;
  IF v_doc.document_type<>v_type THEN RAISE EXCEPTION 'source type changed' USING ERRCODE='40001'; END IF;
  IF NOT EXISTS(SELECT 1 FROM finance.document_allocation_plans p WHERE p.organization_id=p_organization_id AND p.document_id=p_document_id) THEN
    RAISE EXCEPTION 'an allocation plan is required before submission' USING ERRCODE='23514';
  END IF;
  SELECT count(*) INTO v_policy_count FROM finance.approval_policies p WHERE p.organization_id=p_organization_id
    AND p.document_type=v_doc.document_type AND p.is_active;
  IF v_policy_count=0 THEN RAISE EXCEPTION 'approval policy is not configured' USING ERRCODE='P0001'; END IF;
  SELECT max(p.threshold_amount) INTO v_max_threshold FROM finance.approval_policies p WHERE p.organization_id=p_organization_id
    AND p.document_type=v_doc.document_type AND p.is_active AND p.threshold_amount<=v_doc.total_amount;
  v_required:=v_max_threshold IS NOT NULL;
  IF v_required THEN
    SELECT count(*) INTO v_rank_count FROM finance.approval_policies p WHERE p.organization_id=p_organization_id
      AND p.document_type=v_doc.document_type AND p.is_active AND p.threshold_amount=v_max_threshold;
    IF v_rank_count<>1 THEN RAISE EXCEPTION 'approval policy threshold is ambiguous' USING ERRCODE='22023'; END IF;
    SELECT * INTO v_policy FROM finance.approval_policies p WHERE p.organization_id=p_organization_id
      AND p.document_type=v_doc.document_type AND p.is_active AND p.threshold_amount=v_max_threshold FOR SHARE;
    IF NOT EXISTS(SELECT 1 FROM finance.role_permissions rp JOIN finance.permissions pe ON pe.id=rp.permission_id
      WHERE rp.organization_id=p_organization_id AND rp.role_id=v_policy.approver_role_id AND pe.code='approvals.decide') THEN
      RAISE EXCEPTION 'approval role cannot decide approvals' USING ERRCODE='23514';
    END IF;
    v_snapshot:=jsonb_build_object('approval_required',true,'policy_id',v_policy.id,'policy_name',v_policy.name,
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

CREATE FUNCTION public.decide_financial_approval(
  p_organization_id uuid,p_approval_request_id uuid,p_operation text,p_request_id text,p_idempotency_key text,
  p_request_hash text,p_decision text,p_reason text
) RETURNS TABLE(approval_request_id uuid,state text,decision_id uuid,approved_approvals integer,required_approvals integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_request finance.approval_requests%ROWTYPE; v_doc finance.business_documents%ROWTYPE;
  v_policy finance.approval_policies%ROWTYPE; v_role_id uuid; v_hash text; v_existing_actor uuid; v_receipt jsonb;
  v_decision_id uuid; v_approved integer; v_required integer; v_self_allowed boolean; v_active_members integer;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_approval_request_id IS NULL OR p_operation IS DISTINCT FROM 'approvals.decide:'||p_approval_request_id::text OR
     p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 200 OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' OR
     p_decision IS NULL OR p_decision NOT IN ('approve','reject') OR (p_decision='reject' AND length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 10 AND 1000) OR
     (p_reason IS NOT NULL AND length(p_reason)>1000) THEN RAISE EXCEPTION 'invalid approval decision' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_operation||':'||p_idempotency_key,0));
  v_actor:=finance_private.require_capability(p_organization_id,'approvals.decide');
  SELECT i.request_hash,i.actor_member_id,i.response_body INTO v_hash,v_existing_actor,v_receipt FROM finance.idempotency_requests i
    WHERE i.organization_id=p_organization_id AND i.operation=p_operation AND i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_hash<>p_request_hash OR v_existing_actor<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505'; END IF;
    RETURN QUERY SELECT (v_receipt->>'approval_request_id')::uuid,v_receipt->>'state',(v_receipt->>'decision_id')::uuid,
      (v_receipt->>'approved_approvals')::integer,(v_receipt->>'required_approvals')::integer; RETURN;
  END IF;
  SELECT * INTO v_request FROM finance.approval_requests r WHERE r.organization_id=p_organization_id AND r.id=p_approval_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'approval request unavailable' USING ERRCODE='P0002'; END IF;
  IF v_request.state<>'pending' OR v_request.policy_snapshot->>'approval_required'<>'true' THEN
    RAISE EXCEPTION 'approval request is no longer pending' USING ERRCODE='40001';
  END IF;
  SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=v_request.document_id FOR UPDATE;
  SELECT * INTO v_request FROM finance.approval_requests r WHERE r.organization_id=p_organization_id AND r.id=p_approval_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.state<>'pending' THEN RAISE EXCEPTION 'approval request is no longer pending' USING ERRCODE='40001'; END IF;
  IF NOT FOUND OR v_doc.version<>v_request.document_version OR v_doc.material_digest<>v_request.document_digest OR v_doc.state<>'pending_approval' THEN
    RAISE EXCEPTION 'approval source version or digest is stale' USING ERRCODE='40001';
  END IF;
  v_role_id:=(v_request.policy_snapshot->>'approver_role_id')::uuid;
  PERFORM 1 FROM finance.member_roles mr JOIN finance.organization_members m
      ON m.organization_id=mr.organization_id AND m.id=mr.member_id JOIN finance.role_permissions rp
      ON rp.organization_id=mr.organization_id AND rp.role_id=mr.role_id JOIN finance.permissions pe ON pe.id=rp.permission_id
      WHERE mr.organization_id=p_organization_id AND mr.member_id=v_actor AND mr.role_id=v_role_id AND m.status='active' AND pe.code='approvals.decide'
      FOR KEY SHARE OF mr,m,rp;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'member is not an eligible approver' USING ERRCODE='42501';
  END IF;
  v_self_allowed:=(v_request.policy_snapshot->>'allow_self_approval')::boolean;
  IF v_actor=v_request.requested_by_member_id THEN
    SELECT count(*) INTO v_active_members FROM finance.organization_members m WHERE m.organization_id=p_organization_id AND m.status='active';
    IF NOT v_self_allowed OR v_active_members<>1 OR NOT finance_private.is_active_owner(p_organization_id,v_actor) THEN
      RAISE EXCEPTION 'maker cannot approve this request' USING ERRCODE='42501';
    END IF;
  END IF;
  SELECT * INTO v_policy FROM finance.approval_policies p WHERE p.organization_id=p_organization_id
    AND p.id=(v_request.policy_snapshot->>'policy_id')::uuid AND p.document_type=v_doc.document_type FOR SHARE;
  IF NOT FOUND OR NOT v_policy.is_active OR v_policy.name<>v_request.policy_snapshot->>'policy_name' OR
     v_policy.threshold_amount::text<>v_request.policy_snapshot->>'threshold_amount' OR v_policy.approver_role_id<>v_role_id OR
     v_policy.required_approvals<>(v_request.policy_snapshot->>'required_approvals')::integer OR
     v_policy.allow_self_approval<>v_self_allowed THEN RAISE EXCEPTION 'approval policy changed after submission' USING ERRCODE='40001'; END IF;
  IF EXISTS(SELECT 1 FROM finance.approval_decisions d WHERE d.organization_id=p_organization_id
    AND d.request_id=p_approval_request_id AND d.decided_by_member_id=v_actor) THEN RAISE EXCEPTION 'member already decided this request' USING ERRCODE='40001'; END IF;
  INSERT INTO finance.approval_decisions(organization_id,request_id,decided_by_member_id,decision,reason)
    VALUES(p_organization_id,p_approval_request_id,v_actor,p_decision,NULLIF(btrim(p_reason),'')) RETURNING id INTO v_decision_id;
  v_required:=v_policy.required_approvals;
  IF p_decision='reject' THEN
    UPDATE finance.approval_requests r SET state='rejected' WHERE r.organization_id=p_organization_id AND r.id=p_approval_request_id;
    UPDATE finance.business_documents d SET state='draft' WHERE d.organization_id=p_organization_id AND d.id=v_doc.id;
    v_approved:=0;
  ELSE
    SELECT count(*) INTO v_approved FROM finance.approval_decisions d WHERE d.organization_id=p_organization_id
      AND d.request_id=p_approval_request_id AND d.decision='approve';
    IF v_approved>=v_required THEN
      UPDATE finance.approval_requests r SET state='approved' WHERE r.organization_id=p_organization_id AND r.id=p_approval_request_id;
      UPDATE finance.business_documents d SET state='approved' WHERE d.organization_id=p_organization_id AND d.id=v_doc.id;
    END IF;
  END IF;
  SELECT jsonb_build_object('approval_request_id',p_approval_request_id,'state',CASE WHEN p_decision='reject' THEN 'rejected' WHEN v_approved>=v_required THEN 'approved' ELSE 'pending' END,
    'decision_id',v_decision_id,'approved_approvals',v_approved,'required_approvals',v_required) INTO v_receipt;
  INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body)
    VALUES(p_organization_id,p_operation,p_idempotency_key,p_request_hash,v_actor,200,v_receipt);
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'approval.decision',CASE WHEN p_decision='approve' THEN 'approval_approved' ELSE 'approval_rejected' END,
    v_decision_id,p_request_id,jsonb_build_object('approval_request_id',p_approval_request_id,'decision',p_decision,'reason',NULLIF(btrim(p_reason),''),
      'state',v_receipt->>'state','maker_self_approval',v_actor=v_request.requested_by_member_id,'policy_snapshot',v_request.policy_snapshot));
  RETURN QUERY SELECT p_approval_request_id,v_receipt->>'state',v_decision_id,v_approved,v_required;
END; $$;
REVOKE ALL ON FUNCTION public.decide_financial_approval(uuid,uuid,text,text,text,text,text,text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.decide_financial_approval(uuid,uuid,text,text,text,text,text,text) TO ams_runtime;

NOTIFY pgrst,'reload schema';
