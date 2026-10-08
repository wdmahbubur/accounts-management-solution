-- Company setup is a recorded, atomic transition. Existing accounting approval
-- and posting commands remain the authority for imported opening balances.
CREATE TABLE finance_private.company_setup_completions (
  organization_id uuid PRIMARY KEY REFERENCES finance.organizations(id) ON DELETE RESTRICT,
  opening_mode text NOT NULL CHECK (opening_mode IN ('zero_opening','import_opening')),
  books_start_date date NOT NULL,
  opening_document_id uuid,
  opening_document_version integer,
  opening_document_digest text,
  completed_by_member_id uuid NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  readiness_snapshot jsonb NOT NULL,
  FOREIGN KEY (organization_id,opening_document_id) REFERENCES finance.business_documents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,completed_by_member_id) REFERENCES finance.organization_members(organization_id,id) ON DELETE RESTRICT,
  CHECK ((opening_mode='zero_opening' AND opening_document_id IS NULL AND opening_document_version IS NULL AND opening_document_digest IS NULL)
    OR (opening_mode='import_opening' AND opening_document_id IS NOT NULL AND opening_document_version IS NOT NULL AND opening_document_version>0
      AND opening_document_digest IS NOT NULL AND opening_document_digest ~ '^[0-9a-f]{64}$'))
);
REVOKE ALL ON finance_private.company_setup_completions FROM PUBLIC,ams_runtime;

CREATE FUNCTION finance_private.guard_setup_completion()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  RAISE EXCEPTION 'company setup completion evidence is immutable' USING ERRCODE='23514';
END; $$;
REVOKE ALL ON FUNCTION finance_private.guard_setup_completion() FROM PUBLIC,ams_runtime;
CREATE TRIGGER company_setup_completion_immutable BEFORE UPDATE OR DELETE ON finance_private.company_setup_completions
FOR EACH ROW EXECUTE FUNCTION finance_private.guard_setup_completion();

CREATE FUNCTION finance_private.guard_completed_company_opening()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_completion finance_private.company_setup_completions%ROWTYPE;
BEGIN
  IF NEW.document_type<>'opening_balance' THEN RETURN NEW; END IF;
  SELECT * INTO v_completion FROM finance_private.company_setup_completions c WHERE c.organization_id=NEW.organization_id;
  IF FOUND AND (v_completion.opening_mode='zero_opening' OR v_completion.opening_document_id<>NEW.id) THEN
    RAISE EXCEPTION 'company opening is already completed; use a linked correction instead of another opening batch' USING ERRCODE='23514';
  END IF;
  -- Supported creation/posting commands lock the organization first; posting also
  -- holds the unique cutover-period lock, serializing different-document races.
  IF NEW.state='posted' AND EXISTS(SELECT 1 FROM finance.business_documents d
      WHERE d.organization_id=NEW.organization_id AND d.document_type='opening_balance' AND d.state='posted' AND d.id<>NEW.id) THEN
    RAISE EXCEPTION 'only one opening batch can post for a company' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION finance_private.guard_completed_company_opening() FROM PUBLIC,ams_runtime;
CREATE TRIGGER completed_company_opening_guard BEFORE INSERT OR UPDATE OF document_type,state ON finance.business_documents
FOR EACH ROW EXECUTE FUNCTION finance_private.guard_completed_company_opening();

CREATE FUNCTION finance_private.company_setup_readiness(p_organization_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_org finance.organizations%ROWTYPE; v_missing text[]; v_checks jsonb; v_calendar boolean; v_opening boolean;
BEGIN
  SELECT * INTO v_org FROM finance.organizations o WHERE o.id=p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'company unavailable' USING ERRCODE='P0002'; END IF;
  SELECT array_agg(required.key ORDER BY required.key) INTO v_missing
    FROM unnest(ARRAY['cash','bank','ar','vendor_advance','input_tax','ap','output_tax','customer_advance','retained_earnings','opening_suspense','rounding_difference']) required(key)
    LEFT JOIN finance.account_mappings m ON m.organization_id=p_organization_id AND m.mapping_key=required.key
    LEFT JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id
    WHERE a.id IS NULL OR NOT finance_private.validate_mapping_target(required.key,a);
  SELECT EXISTS(SELECT 1 FROM finance.fiscal_years f
    JOIN finance.accounting_periods p ON p.organization_id=f.organization_id AND p.fiscal_year_id=f.id AND p.kind='regular'
    WHERE f.organization_id=p_organization_id AND f.status='open' AND v_org.books_start_date BETWEEN f.starts_on AND f.ends_on
    GROUP BY f.id,f.ends_on
    HAVING min(p.starts_on)=v_org.books_start_date AND max(p.ends_on)=f.ends_on
      AND sum(p.ends_on-p.starts_on+1)=f.ends_on-v_org.books_start_date+1 AND bool_and(p.status='open')) INTO v_calendar;
  SELECT EXISTS(SELECT 1 FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.kind='opening'
    AND p.starts_on=v_org.books_start_date-1 AND p.ends_on=p.starts_on AND p.status='open') INTO v_opening;
  v_checks:=jsonb_build_array(
    jsonb_build_object('code','company_profile','required',true,'ready',v_org.base_currency='BDT' AND btrim(v_org.name)<>'' AND btrim(v_org.legal_name)<>''
      AND isfinite(v_org.books_start_date) AND EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names t WHERE t.name=v_org.timezone),
      'message','Company identity, BDT currency, timezone and books-start date are valid.'),
    jsonb_build_object('code','account_mappings','required',true,'ready',v_missing IS NULL,
      'message',CASE WHEN v_missing IS NULL THEN 'All required accounts and system mappings are ready.' ELSE 'Repair these account mappings: '||array_to_string(v_missing,', ')||'.' END),
    jsonb_build_object('code','fiscal_calendar','required',true,'ready',v_calendar,'message','The first fiscal year and its operating periods must be open and cover books start through year end.'),
    jsonb_build_object('code','opening_period','required',true,'ready',v_opening,'message','The opening period must be open on the day before books start.'),
    jsonb_build_object('code','cash_account','required',false,'ready',EXISTS(SELECT 1 FROM finance.cash_accounts ca JOIN finance.accounts a ON a.organization_id=ca.organization_id AND a.id=ca.account_id
      WHERE ca.organization_id=p_organization_id AND ca.is_active AND a.is_active AND a.is_postable AND a.account_type='asset' AND a.control_kind IS NULL),
      'message','Set up a cash or bank account before recording receipts or payments.'),
    jsonb_build_object('code','invoice_policy','required',false,'ready',EXISTS(SELECT 1 FROM finance.approval_policies p WHERE p.organization_id=p_organization_id AND p.document_type='invoice' AND p.is_active),
      'message','Configure an invoice approval policy before submitting invoices.'),
    jsonb_build_object('code','receipt_policy','required',false,'ready',EXISTS(SELECT 1 FROM finance.approval_policies p WHERE p.organization_id=p_organization_id AND p.document_type='receipt' AND p.is_active),
      'message','Configure a receipt approval policy before submitting receipts.'),
    jsonb_build_object('code','purchase_policies','required',false,'ready',NOT EXISTS(SELECT 1 FROM unnest(ARRAY['bill','paid_expense','vendor_payment']) kind(value)
      WHERE NOT EXISTS(SELECT 1 FROM finance.approval_policies p WHERE p.organization_id=p_organization_id AND p.document_type::text=kind.value AND p.is_active)),
      'message','Configure bill, expense and supplier-payment policies before submitting purchases.')
  );
  RETURN jsonb_build_object('organization_id',v_org.id,'name',v_org.name,'status',v_org.status,'books_start_date',v_org.books_start_date,
    'cutover_date',v_org.books_start_date-1,'checks',v_checks,
    'zero_opening_available',NOT EXISTS(SELECT 1 FROM finance.journal_entries j WHERE j.organization_id=p_organization_id)
      AND NOT EXISTS(SELECT 1 FROM finance.open_items i WHERE i.organization_id=p_organization_id)
      AND NOT EXISTS(SELECT 1 FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.document_type='opening_balance' AND d.state<>'void'),
    'opening_documents',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'version',d.version,'state',d.state,'description',d.description,
      'accounting_date',d.accounting_date,'total_amount',d.total_amount::text,'has_cutover_summary',s.document_id IS NOT NULL) ORDER BY d.created_at,d.id)
      FROM finance.business_documents d LEFT JOIN finance_private.opening_cutover_summaries s ON s.organization_id=d.organization_id AND s.document_id=d.id
      WHERE d.organization_id=p_organization_id AND d.document_type='opening_balance' AND d.state<>'void'),'[]'::jsonb),
    'completion',(SELECT jsonb_build_object('opening_mode',c.opening_mode,'opening_document_id',c.opening_document_id,'completed_at',c.completed_at)
      FROM finance_private.company_setup_completions c WHERE c.organization_id=p_organization_id));
END; $$;
REVOKE ALL ON FUNCTION finance_private.company_setup_readiness(uuid) FROM PUBLIC,ams_runtime;

CREATE FUNCTION public.read_company_setup(p_organization_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid;
BEGIN
  v_actor:=finance_private.require_capability(p_organization_id,'company.update');
  IF NOT finance_private.is_active_owner(p_organization_id,v_actor) THEN RAISE EXCEPTION 'company setup requires an active owner' USING ERRCODE='42501'; END IF;
  RETURN finance_private.company_setup_readiness(p_organization_id);
END; $$;
REVOKE ALL ON FUNCTION public.read_company_setup(uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_company_setup(uuid) TO ams_runtime;

CREATE FUNCTION public.complete_company_setup(
  p_organization_id uuid,p_request_id text,p_idempotency_key text,p_request_hash text,
  p_opening_mode text,p_zero_opening_confirmed boolean,p_opening_document_id uuid,p_expected_document_version integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_org finance.organizations%ROWTYPE; v_existing finance.idempotency_requests%ROWTYPE;
  v_readiness jsonb; v_receipt jsonb; v_doc finance.business_documents%ROWTYPE; v_opening_number text; v_nested_key text; v_completed_at timestamptz;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 200 OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
    OR p_opening_mode IS NULL OR p_opening_mode NOT IN ('zero_opening','import_opening') OR p_zero_opening_confirmed IS NULL THEN
    RAISE EXCEPTION 'invalid company setup request' USING ERRCODE='22023'; END IF;
  IF (p_opening_mode='zero_opening' AND (NOT p_zero_opening_confirmed OR p_opening_document_id IS NOT NULL OR p_expected_document_version IS NOT NULL))
    OR (p_opening_mode='import_opening' AND (p_zero_opening_confirmed OR p_opening_document_id IS NULL OR p_expected_document_version IS NULL OR p_expected_document_version<1)) THEN
    RAISE EXCEPTION 'choose an explicit zero opening or a versioned opening document' USING ERRCODE='22023'; END IF;
  PERFORM finance_private.lock_role_admin(p_organization_id);
  v_actor:=finance_private.require_capability(p_organization_id,'company.update');
  IF NOT finance_private.is_active_owner(p_organization_id,v_actor) THEN RAISE EXCEPTION 'company setup requires an active owner' USING ERRCODE='42501'; END IF;
  IF p_opening_mode='import_opening' THEN
    PERFORM finance_private.require_capability(p_organization_id,'journal.post');
    v_nested_key:='setup-opening:'||encode(sha256(convert_to(p_idempotency_key,'UTF8')),'hex');
    -- Match the existing posting command's advisory-before-organization order.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':documents.post:'||p_opening_document_id::text||':'||v_nested_key,0));
  END IF;
  SELECT * INTO v_org FROM finance.organizations o WHERE o.id=p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'company unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_existing FROM finance.idempotency_requests i WHERE i.organization_id=p_organization_id
    AND i.operation='company.setup.complete' AND i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash<>p_request_hash OR v_existing.actor_member_id<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505'; END IF;
    RETURN v_existing.response_body;
  END IF;
  IF v_org.status<>'onboarding' THEN RAISE EXCEPTION 'company setup is already completed or the company is read only' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM finance_private.company_setup_completions c WHERE c.organization_id=p_organization_id) THEN
    RAISE EXCEPTION 'company setup is already completed' USING ERRCODE='23505'; END IF;
  -- These locks also keep readiness stable against supported configuration writers.
  PERFORM a.id FROM finance.account_mappings m JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id
    WHERE m.organization_id=p_organization_id ORDER BY a.id FOR SHARE OF a,m;
  PERFORM f.id FROM finance.fiscal_years f WHERE f.organization_id=p_organization_id ORDER BY f.id FOR UPDATE;
  PERFORM p.id FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id ORDER BY p.id FOR UPDATE;
  v_readiness:=finance_private.company_setup_readiness(p_organization_id);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_readiness->'checks') c WHERE (c->>'required')::boolean AND NOT (c->>'ready')::boolean) THEN
    RAISE EXCEPTION 'company setup has incomplete account mappings or fiscal calendar; review setup checks' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM finance.journal_entries j WHERE j.organization_id=p_organization_id)
    OR EXISTS(SELECT 1 FROM finance.open_items i WHERE i.organization_id=p_organization_id) THEN
    RAISE EXCEPTION 'company already has accounting history; setup cannot replace existing books' USING ERRCODE='23514'; END IF;
  IF p_opening_mode='zero_opening' THEN
    IF NOT (v_readiness->>'zero_opening_available')::boolean THEN RAISE EXCEPTION 'an opening draft already exists; complete that cutover instead of declaring zero opening' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_opening_document_id;
    IF NOT FOUND OR v_doc.document_type<>'opening_balance' THEN RAISE EXCEPTION 'opening document unavailable' USING ERRCODE='P0002'; END IF;
    IF v_doc.version<>p_expected_document_version THEN RAISE EXCEPTION 'opening document version is stale' USING ERRCODE='40001'; END IF;
    IF v_doc.state<>'approved' THEN RAISE EXCEPTION 'approve the opening document before completing setup' USING ERRCODE='P0001'; END IF;
    IF v_doc.accounting_date<>v_org.books_start_date-1 OR NOT EXISTS(SELECT 1 FROM finance_private.opening_cutover_summaries s
      WHERE s.organization_id=p_organization_id AND s.document_id=p_opening_document_id AND s.cutover_date=v_doc.accounting_date) THEN
      RAISE EXCEPTION 'opening cutover evidence is missing or has the wrong date' USING ERRCODE='23514'; END IF;
  END IF;
  v_completed_at:=clock_timestamp();
  INSERT INTO finance_private.company_setup_completions(organization_id,opening_mode,books_start_date,opening_document_id,opening_document_version,
    opening_document_digest,completed_by_member_id,completed_at,readiness_snapshot)
    VALUES(p_organization_id,p_opening_mode,v_org.books_start_date,p_opening_document_id,p_expected_document_version,v_doc.material_digest,v_actor,v_completed_at,v_readiness);
  UPDATE finance.organizations SET status='active',updated_at=v_completed_at WHERE id=p_organization_id;
  IF p_opening_mode='import_opening' THEN
    SELECT posted.document_number INTO v_opening_number FROM public.post_financial_document(p_organization_id,p_opening_document_id,p_expected_document_version,p_request_id,v_nested_key,p_request_hash) posted;
  END IF;
  v_receipt:=jsonb_build_object('organization_id',p_organization_id,'status','active','opening_mode',p_opening_mode,'completed_at',v_completed_at,
    'opening_document_id',p_opening_document_id,'opening_document_number',v_opening_number);
  INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body,resource_document_id)
    VALUES(p_organization_id,'company.setup.complete',p_idempotency_key,p_request_hash,v_actor,200,v_receipt,p_opening_document_id);
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'company.setup.complete','organization',p_organization_id,p_request_id,
    jsonb_build_object('before_status','onboarding','after_status','active','opening_mode',p_opening_mode,'opening_document_id',p_opening_document_id,
      'opening_document_version',p_expected_document_version,'books_start_date',v_org.books_start_date,'checks',v_readiness->'checks'));
  RETURN v_receipt;
END; $$;
REVOKE ALL ON FUNCTION public.complete_company_setup(uuid,text,text,text,text,boolean,uuid,integer) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.complete_company_setup(uuid,text,text,text,text,boolean,uuid,integer) TO ams_runtime;

-- Save the opening document and its cutover evidence together. A lost response
-- can be retried even after the document later moves into approval.
CREATE FUNCTION public.save_opening_cutover_draft(
  p_organization_id uuid,p_document_id uuid,p_expected_version integer,p_request_id text,p_idempotency_key text,p_request_hash text,
  p_payload jsonb,p_prior_trial_balance jsonb,p_ytd_summary jsonb,p_evidence_reference text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_existing finance.idempotency_requests%ROWTYPE; v_saved record; v_receipt jsonb; v_key text;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 200 OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
    OR p_payload->>'document_type' IS DISTINCT FROM 'opening_balance' THEN RAISE EXCEPTION 'invalid opening draft request' USING ERRCODE='22023'; END IF;
  PERFORM finance_private.lock_role_admin(p_organization_id);
  v_actor:=finance_private.require_capability(p_organization_id,'journal.write');
  PERFORM finance_private.require_capability(p_organization_id,'documents.read');
  PERFORM finance_private.require_capability(p_organization_id,'accounting.read');
  PERFORM 1 FROM finance.organizations o WHERE o.id=p_organization_id FOR UPDATE;
  SELECT * INTO v_existing FROM finance.idempotency_requests i WHERE i.organization_id=p_organization_id
    AND i.operation='opening-cutover.save' AND i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash<>p_request_hash OR v_existing.actor_member_id<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505'; END IF;
    RETURN v_existing.response_body;
  END IF;
  IF p_document_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM finance.business_documents d
    WHERE d.organization_id=p_organization_id AND d.id=p_document_id AND d.document_type='opening_balance') THEN
    RAISE EXCEPTION 'opening document unavailable' USING ERRCODE='P0002'; END IF;
  v_key:='opening_draft_'||encode(sha256(convert_to(p_idempotency_key,'UTF8')),'hex');
  SELECT * INTO v_saved FROM public.save_financial_document(p_organization_id,p_document_id,p_expected_version,p_request_id,v_key,p_request_hash,p_payload);
  PERFORM public.save_opening_cutover_summary(p_organization_id,v_saved.document_id,(p_payload->>'accounting_date')::date,
    p_prior_trial_balance,p_ytd_summary,p_evidence_reference);
  v_receipt:=jsonb_build_object('document_id',v_saved.document_id,'document_version',v_saved.document_version,'state',v_saved.state);
  INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body,resource_document_id)
    VALUES(p_organization_id,'opening-cutover.save',p_idempotency_key,p_request_hash,v_actor,200,v_receipt,v_saved.document_id);
  RETURN v_receipt;
END; $$;
REVOKE ALL ON FUNCTION public.save_opening_cutover_draft(uuid,uuid,integer,text,text,text,jsonb,jsonb,jsonb,text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.save_opening_cutover_draft(uuid,uuid,integer,text,text,text,jsonb,jsonb,jsonb,text) TO ams_runtime;
