-- US-063: version approval policy changes and keep administration owner-scoped.

INSERT INTO finance.permissions(code,description)
  VALUES('approvals.manage','Configure company approval policies') ON CONFLICT(code) DO UPDATE SET description=EXCLUDED.description;

CREATE OR REPLACE FUNCTION finance_private.template_permission_codes(p_template_key text)
RETURNS TABLE(permission_code text) LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT unnest(CASE p_template_key
    WHEN 'owner' THEN ARRAY['company.read','company.update','users.read','users.manage','sales.read','sales.write','sales.post',
      'purchases.read','purchases.write','purchases.post','contacts.read','contacts.write','catalog.read','catalog.write',
      'documents.read','banking.read','banking.write','dues.read','dues.allocate','accounting.read','journal.write','journal.post',
      'ledger.read','tax.read','tax.manage','approvals.read','approvals.decide','approvals.manage','periods.lock','periods.reopen',
      'reports.read','reports.export','imports.read','imports.run','exports.read','attachments.read','attachments.write','audit.read',
      'subscription.read','subscription.manage']::text[]
    WHEN 'admin' THEN ARRAY['company.read','company.update','users.read','users.manage']::text[]
    WHEN 'finance_manager' THEN ARRAY['sales.read','sales.write','sales.post','purchases.read','purchases.write','purchases.post',
      'contacts.read','contacts.write','catalog.read','catalog.write','documents.read','banking.read','banking.write','dues.read',
      'dues.allocate','accounting.read','journal.write','journal.post','ledger.read','tax.read','tax.manage','approvals.read',
      'approvals.decide','periods.lock','periods.reopen','reports.read','reports.export','imports.read','imports.run','exports.read',
      'attachments.read','attachments.write','audit.read']::text[]
    WHEN 'accountant' THEN ARRAY['sales.read','sales.write','sales.post','purchases.read','purchases.write','purchases.post',
      'contacts.read','contacts.write','catalog.read','catalog.write','documents.read','banking.read','banking.write','dues.read',
      'dues.allocate','accounting.read','journal.write','journal.post','ledger.read','tax.read','tax.manage','approvals.read',
      'reports.read','reports.export','imports.read','imports.run','exports.read','attachments.read','attachments.write','audit.read']::text[]
    WHEN 'billing' THEN ARRAY['sales.read','sales.write','sales.post','contacts.write','catalog.read','dues.allocate']::text[]
    WHEN 'auditor' THEN ARRAY['company.read','sales.read','purchases.read','contacts.read','catalog.read','documents.read','banking.read',
      'dues.read','accounting.read','ledger.read','tax.read','approvals.read','reports.read','reports.export','imports.read','exports.read',
      'attachments.read','audit.read']::text[]
    ELSE ARRAY[]::text[] END)
$$;
REVOKE ALL ON FUNCTION finance_private.template_permission_codes(text) FROM PUBLIC,ams_runtime;
INSERT INTO finance.role_permissions(organization_id,role_id,permission_id)
SELECT r.organization_id,r.id,p.id FROM finance.roles r JOIN finance.permissions p ON p.code='approvals.manage'
WHERE r.is_system AND r.template_key='owner' ON CONFLICT(organization_id,role_id,permission_id) DO NOTHING;

ALTER TABLE finance.approval_policies ADD COLUMN policy_group_id uuid;
UPDATE finance.approval_policies SET policy_group_id=id WHERE policy_group_id IS NULL;
ALTER TABLE finance.approval_policies ALTER COLUMN policy_group_id SET NOT NULL;
ALTER TABLE finance.approval_policies ADD COLUMN version_no integer NOT NULL DEFAULT 1 CHECK(version_no>0);
ALTER TABLE finance.approval_policies ADD COLUMN row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0);
ALTER TABLE finance.approval_policies DROP CONSTRAINT IF EXISTS approval_policies_organization_id_name_key;
ALTER TABLE finance.approval_policies ADD CONSTRAINT approval_policy_version_unique UNIQUE(organization_id,policy_group_id,version_no);
CREATE UNIQUE INDEX approval_policy_active_name_unique ON finance.approval_policies(organization_id,name) WHERE is_active;
CREATE UNIQUE INDEX approval_policy_active_threshold_unique ON finance.approval_policies(organization_id,document_type,threshold_amount) WHERE is_active;
CREATE INDEX approval_policy_group_history_idx ON finance.approval_policies(organization_id,policy_group_id,version_no DESC);

CREATE FUNCTION finance_private.guard_approval_policy_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'approval policy versions are historical and cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (NEW.id,NEW.organization_id,NEW.policy_group_id,NEW.version_no,NEW.row_version,NEW.name,NEW.document_type,NEW.threshold_amount,
      NEW.approver_role_id,NEW.required_approvals,NEW.allow_self_approval,NEW.created_at)
     IS DISTINCT FROM
     (OLD.id,OLD.organization_id,OLD.policy_group_id,OLD.version_no,OLD.row_version,OLD.name,OLD.document_type,OLD.threshold_amount,
      OLD.approver_role_id,OLD.required_approvals,OLD.allow_self_approval,OLD.created_at) THEN
    RAISE EXCEPTION 'approval policy versions are immutable; create a new version' USING ERRCODE='23514';
  END IF;
  IF OLD.is_active=false OR NEW.is_active=true THEN RAISE EXCEPTION 'approval policy versions can only be archived once' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION finance_private.guard_approval_policy_version() FROM PUBLIC,ams_runtime;
CREATE TRIGGER approval_policy_versions_immutable BEFORE UPDATE OR DELETE ON finance.approval_policies
  FOR EACH ROW EXECUTE FUNCTION finance_private.guard_approval_policy_version();
CREATE FUNCTION finance_private.reject_approval_policy_truncate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'approval policy versions are historical and cannot be truncated' USING ERRCODE='23514'; END; $$;
REVOKE ALL ON FUNCTION finance_private.reject_approval_policy_truncate() FROM PUBLIC,ams_runtime;
CREATE TRIGGER approval_policies_no_truncate BEFORE TRUNCATE ON finance.approval_policies
  FOR EACH STATEMENT EXECUTE FUNCTION finance_private.reject_approval_policy_truncate();

CREATE FUNCTION public.list_approval_policy_roles(p_organization_id uuid)
RETURNS TABLE(role_id uuid,role_name text,is_system boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'approvals.manage');
  IF NOT finance_private.is_active_owner(p_organization_id,finance_private.require_capability(p_organization_id,'approvals.manage')) THEN
    RAISE EXCEPTION 'only an active owner can configure approval policies' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT DISTINCT r.id,r.name,r.is_system FROM finance.roles r
    JOIN finance.role_permissions rp ON rp.organization_id=r.organization_id AND rp.role_id=r.id
    JOIN finance.permissions pe ON pe.id=rp.permission_id AND pe.code='approvals.decide'
    WHERE r.organization_id=p_organization_id ORDER BY r.is_system DESC,r.name;
END; $$;
REVOKE ALL ON FUNCTION public.list_approval_policy_roles(uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.list_approval_policy_roles(uuid) TO ams_runtime;

CREATE FUNCTION public.list_approval_policies(p_organization_id uuid)
RETURNS TABLE(id uuid,policy_group_id uuid,version_no integer,row_version integer,name text,document_type text,
  threshold_amount text,approver_role_id uuid,approver_role_name text,required_approvals integer,allow_self_approval boolean,
  is_active boolean,created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT finance_private.is_active_owner(p_organization_id,finance_private.require_capability(p_organization_id,'approvals.manage')) THEN
    RAISE EXCEPTION 'only an active owner can configure approval policies' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT p.id,p.policy_group_id,p.version_no,p.row_version,p.name,p.document_type::text,p.threshold_amount::text,
    p.approver_role_id,r.name,p.required_approvals,p.allow_self_approval,p.is_active,p.created_at
  FROM finance.approval_policies p JOIN finance.roles r ON r.organization_id=p.organization_id AND r.id=p.approver_role_id
  WHERE p.organization_id=p_organization_id ORDER BY p.name,p.version_no DESC;
END; $$;
REVOKE ALL ON FUNCTION public.list_approval_policies(uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.list_approval_policies(uuid) TO ams_runtime;

CREATE FUNCTION public.save_approval_policy(
  p_organization_id uuid,p_request_id text,p_idempotency_key text,p_request_hash text,p_policy_id uuid,
  p_expected_version integer,p_name text,p_document_type text,p_threshold_amount text,p_approver_role_id uuid,
  p_required_approvals integer,p_allow_self_approval boolean,p_is_active boolean,p_reason text
) RETURNS TABLE(policy_id uuid,policy_group_id uuid,version_no integer,row_version integer,name text,document_type text,
  threshold_amount text,approver_role_id uuid,approver_role_name text,required_approvals integer,allow_self_approval boolean,is_active boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_doc_type finance.document_type; v_threshold finance.amount; v_previous finance.approval_policies%ROWTYPE;
  v_group_id uuid; v_next_version integer; v_next_row_version integer; v_policy_id uuid; v_hash text; v_old_actor uuid; v_receipt jsonb;
  v_active_count integer; v_role_name text; v_invalidation record; v_invalidated_count integer:=0; v_new_version integer;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 200 OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' OR
     p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 120 OR p_document_type IS NULL OR p_approver_role_id IS NULL OR
     p_expected_version IS NULL OR p_expected_version<0 OR (p_policy_id IS NULL AND p_expected_version<>0) OR
     (p_policy_id IS NOT NULL AND p_expected_version<1) OR p_required_approvals IS NULL OR p_required_approvals NOT BETWEEN 1 AND 5 OR
     p_allow_self_approval IS NULL OR p_is_active IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'invalid approval policy request' USING ERRCODE='22023';
  END IF;
  v_doc_type:=p_document_type::finance.document_type;
  PERFORM finance_private.require_decimal_string(to_jsonb(p_threshold_amount),2,false);
  v_threshold:=p_threshold_amount::finance.amount;
  IF v_threshold<0 THEN RAISE EXCEPTION 'approval threshold cannot be negative' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':approval-policy:'||p_idempotency_key,0));
  v_actor:=finance_private.require_capability(p_organization_id,'approvals.manage');
  IF NOT finance_private.is_active_owner(p_organization_id,v_actor) THEN RAISE EXCEPTION 'only an active owner can configure approval policies' USING ERRCODE='42501'; END IF;
  SELECT i.request_hash,i.actor_member_id,i.response_body INTO v_hash,v_old_actor,v_receipt FROM finance.idempotency_requests i
    WHERE i.organization_id=p_organization_id AND i.operation='approvals.policy.save' AND i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_hash<>p_request_hash OR v_old_actor<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505'; END IF;
    RETURN QUERY SELECT (v_receipt->>'policy_id')::uuid,(v_receipt->>'policy_group_id')::uuid,(v_receipt->>'version_no')::integer,
      (v_receipt->>'row_version')::integer,v_receipt->>'name',v_receipt->>'document_type',v_receipt->>'threshold_amount',
      (v_receipt->>'approver_role_id')::uuid,v_receipt->>'approver_role_name',(v_receipt->>'required_approvals')::integer,
      (v_receipt->>'allow_self_approval')::boolean,(v_receipt->>'is_active')::boolean; RETURN;
  END IF;
  SELECT r.name INTO v_role_name FROM finance.roles r WHERE r.organization_id=p_organization_id AND r.id=p_approver_role_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'approver role is unavailable' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM finance.role_permissions rp JOIN finance.permissions pe ON pe.id=rp.permission_id
    WHERE rp.organization_id=p_organization_id AND rp.role_id=p_approver_role_id AND pe.code='approvals.decide' FOR KEY SHARE OF rp;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approver role must have the approval decision capability' USING ERRCODE='23514';
  END IF;
  IF p_allow_self_approval THEN
    SELECT count(*) INTO v_active_count FROM finance.organization_members m WHERE m.organization_id=p_organization_id AND m.status='active';
    IF v_active_count<>1 OR NOT finance_private.is_active_owner(p_organization_id,v_actor) THEN
      RAISE EXCEPTION 'self approval can only be explicitly configured for a sole active owner' USING ERRCODE='23514';
    END IF;
  END IF;
  IF p_policy_id IS NULL THEN
    v_group_id:=gen_random_uuid();v_next_version:=1;v_next_row_version:=1;
  ELSE
    SELECT * INTO v_previous FROM finance.approval_policies p WHERE p.organization_id=p_organization_id AND p.id=p_policy_id;
    IF NOT FOUND OR v_previous.row_version<>p_expected_version OR v_previous.document_type<>v_doc_type OR EXISTS(SELECT 1 FROM finance.approval_policies newer
      WHERE newer.organization_id=p_organization_id AND newer.policy_group_id=v_previous.policy_group_id AND newer.version_no>v_previous.version_no) THEN
      RAISE EXCEPTION 'approval policy version is stale or document type cannot change' USING ERRCODE='40001';
    END IF;
    v_group_id:=v_previous.policy_group_id;v_next_version:=v_previous.version_no+1;v_next_row_version:=v_previous.row_version+1;
  END IF;
  -- Lock affected documents before policy rows, matching approval decision's document-then-policy order.
  PERFORM d.id FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.document_type=v_doc_type
    AND EXISTS(SELECT 1 FROM finance.approval_requests ar WHERE ar.organization_id=d.organization_id AND ar.document_id=d.id AND ar.state IN ('pending','approved'))
    ORDER BY d.id FOR UPDATE OF d;
  IF p_policy_id IS NOT NULL THEN
    SELECT * INTO v_previous FROM finance.approval_policies p WHERE p.organization_id=p_organization_id AND p.id=p_policy_id FOR UPDATE;
    IF NOT FOUND OR v_previous.row_version<>p_expected_version OR v_previous.document_type<>v_doc_type OR EXISTS(SELECT 1 FROM finance.approval_policies newer
      WHERE newer.organization_id=p_organization_id AND newer.policy_group_id=v_previous.policy_group_id AND newer.version_no>v_previous.version_no) THEN
      RAISE EXCEPTION 'approval policy version is stale or document type cannot change' USING ERRCODE='40001';
    END IF;
  END IF;
  -- Any threshold/role/requirement change can alter policy resolution, so invalidate every active request of this document type.
  FOR v_invalidation IN SELECT ar.id AS request_id,d.id AS document_id,d.version AS old_version,d.material_digest,d.state AS document_state
    FROM finance.approval_requests ar JOIN finance.business_documents d ON d.organization_id=ar.organization_id AND d.id=ar.document_id
    WHERE ar.organization_id=p_organization_id AND d.document_type=v_doc_type AND ar.state IN ('pending','approved')
    ORDER BY d.id,ar.id FOR UPDATE OF ar
  LOOP
    UPDATE finance.approval_requests ar SET state='superseded' WHERE ar.organization_id=p_organization_id AND ar.id=v_invalidation.request_id;
    IF v_invalidation.document_state IN ('pending_approval','approved') THEN
      UPDATE finance.business_documents d SET state='draft',version=d.version+1,updated_at=clock_timestamp()
        WHERE d.organization_id=p_organization_id AND d.id=v_invalidation.document_id RETURNING version INTO v_new_version;
    ELSE v_new_version:=v_invalidation.old_version; END IF;
    PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'approval.policy.invalidate','business_document',v_invalidation.document_id,p_request_id,
      jsonb_build_object('reason',btrim(p_reason),'from_version',v_invalidation.old_version,'to_version',v_new_version,
        'approval_request_id',v_invalidation.request_id,'prior_digest',v_invalidation.material_digest,'state',v_invalidation.document_state));
    v_invalidated_count:=v_invalidated_count+1;
  END LOOP;
  IF p_policy_id IS NOT NULL AND v_previous.is_active THEN
    UPDATE finance.approval_policies p SET is_active=false WHERE p.organization_id=p_organization_id AND p.id=v_previous.id;
  END IF;
  INSERT INTO finance.approval_policies(organization_id,policy_group_id,version_no,row_version,name,document_type,threshold_amount,
      approver_role_id,required_approvals,allow_self_approval,is_active)
    VALUES(p_organization_id,v_group_id,v_next_version,v_next_row_version,btrim(p_name),v_doc_type,v_threshold,p_approver_role_id,
      p_required_approvals,p_allow_self_approval,p_is_active) RETURNING id INTO v_policy_id;
  SELECT jsonb_build_object('policy_id',v_policy_id,'policy_group_id',v_group_id,'version_no',v_next_version,'row_version',v_next_row_version,
      'name',btrim(p_name),'document_type',v_doc_type::text,'threshold_amount',v_threshold::text,'approver_role_id',p_approver_role_id,
      'approver_role_name',v_role_name,'required_approvals',p_required_approvals,'allow_self_approval',p_allow_self_approval,'is_active',p_is_active) INTO v_receipt;
  INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body)
    VALUES(p_organization_id,'approvals.policy.save',p_idempotency_key,p_request_hash,v_actor,200,v_receipt);
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,CASE WHEN p_policy_id IS NULL THEN 'approval.policy.create' ELSE 'approval.policy.version' END,
    'approval_policy',v_policy_id,p_request_id,jsonb_build_object('reason',btrim(p_reason),'invalidated_requests',v_invalidated_count,'before',CASE WHEN p_policy_id IS NULL THEN NULL ELSE
      jsonb_build_object('policy_id',v_previous.id,'version_no',v_previous.version_no,'name',v_previous.name,'document_type',v_previous.document_type::text,
        'threshold_amount',v_previous.threshold_amount::text,'approver_role_id',v_previous.approver_role_id,'required_approvals',v_previous.required_approvals,
        'allow_self_approval',v_previous.allow_self_approval,'is_active',v_previous.is_active) END,'after',v_receipt));
  RETURN QUERY SELECT v_policy_id,v_group_id,v_next_version,v_next_row_version,btrim(p_name),v_doc_type::text,v_threshold::text,
    p_approver_role_id,v_role_name,p_required_approvals,p_allow_self_approval,p_is_active;
END; $$;
REVOKE ALL ON FUNCTION public.save_approval_policy(uuid,text,text,text,uuid,integer,text,text,text,uuid,integer,boolean,boolean,text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.save_approval_policy(uuid,text,text,text,uuid,integer,text,text,text,uuid,integer,boolean,boolean,text) TO ams_runtime;

NOTIFY pgrst,'reload schema';
