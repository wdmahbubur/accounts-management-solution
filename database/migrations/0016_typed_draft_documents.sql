-- US-017: typed draft documents, exact snapshots, version conflicts and idempotent saves.

ALTER TABLE finance.business_documents ADD COLUMN material_digest text NOT NULL DEFAULT '';
ALTER TABLE finance.business_documents ADD COLUMN rounding_reason text;
ALTER TABLE finance.business_documents ADD COLUMN rounding_account_id uuid;
ALTER TABLE finance.business_documents ADD CONSTRAINT business_documents_rounding_account_fk
  FOREIGN KEY (organization_id,rounding_account_id) REFERENCES finance.accounts(organization_id,id) ON DELETE RESTRICT;
ALTER TABLE finance.business_documents ADD CONSTRAINT business_documents_rounding_evidence_check
  CHECK ((rounding_adjustment=0 AND rounding_reason IS NULL AND rounding_account_id IS NULL) OR
         (rounding_adjustment<>0 AND rounding_reason IS NOT NULL AND length(btrim(rounding_reason)) BETWEEN 1 AND 500 AND rounding_account_id IS NOT NULL));

CREATE FUNCTION finance_private.guard_source_document()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.state<>'draft' THEN RAISE EXCEPTION 'posted and approved documents cannot be deleted' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.state IN ('posted','void') THEN RAISE EXCEPTION 'posted and void documents are immutable' USING ERRCODE='40001'; END IF;
  IF NEW.version=OLD.version AND
    (NEW.organization_id,NEW.id,NEW.document_type,NEW.state,NEW.document_number,NEW.fiscal_year_id,NEW.party_id,NEW.issue_date,
     NEW.accounting_date,NEW.due_date,NEW.external_reference,NEW.description,NEW.currency,NEW.rounding_adjustment,NEW.rounding_reason,NEW.rounding_account_id,NEW.party_snapshot,
     NEW.material_digest,NEW.created_by_member_id,NEW.posted_by_member_id,NEW.posted_at,NEW.reversal_of_document_id,NEW.correction_reason,
     NEW.import_source_key,NEW.updated_at,NEW.created_at)
    IS NOT DISTINCT FROM
    (OLD.organization_id,OLD.id,OLD.document_type,OLD.state,OLD.document_number,OLD.fiscal_year_id,OLD.party_id,OLD.issue_date,
     OLD.accounting_date,OLD.due_date,OLD.external_reference,OLD.description,OLD.currency,OLD.rounding_adjustment,OLD.rounding_reason,OLD.rounding_account_id,OLD.party_snapshot,
     OLD.material_digest,OLD.created_by_member_id,OLD.posted_by_member_id,OLD.posted_at,OLD.reversal_of_document_id,OLD.correction_reason,
     OLD.import_source_key,OLD.updated_at,OLD.created_at) THEN
    RETURN NEW;
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.id IS DISTINCT FROM OLD.id OR
     NEW.document_type IS DISTINCT FROM OLD.document_type OR NEW.created_by_member_id IS DISTINCT FROM OLD.created_by_member_id OR
     NEW.document_number IS DISTINCT FROM OLD.document_number OR NEW.posted_at IS NOT NULL OR NEW.posted_by_member_id IS NOT NULL THEN
    RAISE EXCEPTION 'source identity and issued fields cannot be changed by draft save' USING ERRCODE='23514';
  END IF;
  IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'document version must advance by one' USING ERRCODE='40001'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_source_document() FROM PUBLIC,ams_runtime;
CREATE TRIGGER business_documents_source_guard BEFORE UPDATE OR DELETE ON finance.business_documents
  FOR EACH ROW EXECUTE FUNCTION finance_private.guard_source_document();

CREATE FUNCTION finance_private.guard_draft_child()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_org uuid; v_document uuid; v_state finance.document_state;
BEGIN
  v_org:=COALESCE(NEW.organization_id,OLD.organization_id); v_document:=COALESCE(NEW.document_id,OLD.document_id);
  SELECT d.state INTO v_state FROM finance.business_documents d WHERE d.organization_id=v_org AND d.id=v_document FOR UPDATE;
  IF NOT FOUND OR v_state<>'draft' THEN RAISE EXCEPTION 'only draft document children can be changed' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND (NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.document_id IS DISTINCT FROM OLD.document_id) THEN
    RAISE EXCEPTION 'document child cannot move between sources or companies' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_draft_child() FROM PUBLIC,ams_runtime;
CREATE TRIGGER trade_documents_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON finance.trade_documents FOR EACH ROW EXECUTE FUNCTION finance_private.guard_draft_child();
CREATE TRIGGER document_lines_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON finance.document_lines FOR EACH ROW EXECUTE FUNCTION finance_private.guard_draft_child();
CREATE TRIGGER money_movements_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON finance.money_movements FOR EACH ROW EXECUTE FUNCTION finance_private.guard_draft_child();
CREATE TRIGGER transfers_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON finance.transfers FOR EACH ROW EXECUTE FUNCTION finance_private.guard_draft_child();
CREATE TRIGGER manual_journal_rows_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON finance.manual_journal_rows FOR EACH ROW EXECUTE FUNCTION finance_private.guard_draft_child();
CREATE TRIGGER document_allocation_plans_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON finance.document_allocation_plans FOR EACH ROW EXECUTE FUNCTION finance_private.guard_draft_child();

CREATE FUNCTION finance_private.require_decimal_string(p_value jsonb,p_scale integer,p_signed boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_text text; v_pattern text; v_digits integer;
BEGIN
  IF jsonb_typeof(p_value)<>'string' THEN RAISE EXCEPTION 'financial values must be decimal strings' USING ERRCODE='22023'; END IF;
  v_text:=p_value#>>'{}';v_digits:=CASE WHEN p_scale=2 THEN 18 ELSE 14 END;
  IF p_scale NOT IN (2,6) THEN RAISE EXCEPTION 'unsupported decimal scale' USING ERRCODE='22023'; END IF;
  v_pattern:='^'||CASE WHEN p_signed THEN '-?' ELSE '' END||'(0|[1-9][0-9]{0,'||(v_digits-1)::text||'})\.[0-9]{'||p_scale::text||'}$';
  IF v_text !~ v_pattern OR v_text IN ('-0.00','-0.000000') THEN RAISE EXCEPTION 'financial value is not a canonical decimal string' USING ERRCODE='22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION finance_private.require_decimal_string(jsonb,integer,boolean) FROM PUBLIC,ams_runtime;

-- Include explicit rounding in server-derived header totals after US-015 line recalculation.
CREATE OR REPLACE FUNCTION finance_private.recompute_draft_document_totals()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_org uuid; v_document uuid;
BEGIN
  v_org:=COALESCE(NEW.organization_id,OLD.organization_id); v_document:=COALESCE(NEW.document_id,OLD.document_id);
  UPDATE finance.business_documents d SET net_amount=x.net_amount,tax_amount=x.tax_amount,total_amount=x.total_amount+d.rounding_adjustment,
    updated_at=d.updated_at
  FROM (SELECT COALESCE(sum(l.net_amount),0)::finance.amount AS net_amount,
        COALESCE(sum(l.tax_amount),0)::finance.amount AS tax_amount,
        COALESCE(sum(l.gross_amount),0)::finance.amount AS total_amount
        FROM finance.document_lines l WHERE l.organization_id=v_org AND l.document_id=v_document) x
  WHERE d.organization_id=v_org AND d.id=v_document AND d.state='draft';
  RETURN NULL;
END $$;

CREATE FUNCTION public.save_financial_document(
  p_organization_id uuid,p_document_id uuid,p_expected_version integer,p_request_id text,
  p_idempotency_key text,p_request_hash text,p_payload jsonb
) RETURNS TABLE(document_id uuid,document_version integer,state text,net_amount finance.amount,tax_amount finance.amount,
  total_amount finance.amount,material_digest text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_type finance.document_type; v_permission text; v_document finance.business_documents%ROWTYPE;
  v_id uuid:=COALESCE(p_document_id,gen_random_uuid()); v_created boolean:=p_document_id IS NULL;
  v_line jsonb; v_row jsonb; v_ord bigint; v_line_id uuid; v_keep_ids uuid[]:='{}'; v_original uuid; v_party uuid;
  v_issue date; v_accounting date; v_due date; v_books_start date; v_year_id uuid; v_currency text; v_rounding finance.amount;
  v_rounding_reason text; v_rounding_account uuid; v_rounding_row finance.accounts%ROWTYPE; v_receipt jsonb; v_existing_hash text; v_existing_actor uuid; v_result jsonb;
  v_line_count integer:=0; v_journal_count integer:=0; v_debits finance.amount; v_credits finance.amount; v_movement_amount finance.amount;
  v_plan_total finance.amount:=0; v_plan_amount finance.amount; v_target finance.open_items%ROWTYPE; v_plan_control text; v_plan_side text; v_plan jsonb;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{22,172}$' OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'valid idempotency key and request hash required' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR jsonb_typeof(p_payload->'lines') IS DISTINCT FROM 'array' OR
     jsonb_typeof(COALESCE(p_payload->'allocation_plan','[]'::jsonb)) IS DISTINCT FROM 'array' OR octet_length(p_payload::text)>1000000 THEN
    RAISE EXCEPTION 'document payload and typed arrays required' USING ERRCODE='22023';
  END IF;
  BEGIN v_type:=(p_payload->>'document_type')::finance.document_type;
    v_issue:=(p_payload->>'issue_date')::date; v_accounting:=(p_payload->>'accounting_date')::date;
    v_due:=NULLIF(p_payload->>'due_date','')::date; v_party:=NULLIF(p_payload->>'party_id','')::uuid;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'invalid document type or date' USING ERRCODE='22023'; END;
  IF v_type IS NULL OR v_issue IS NULL OR v_accounting IS NULL OR NOT isfinite(v_issue) OR NOT isfinite(v_accounting) THEN
    RAISE EXCEPTION 'document type, issue date, and accounting date are required' USING ERRCODE='22023';
  END IF;
  v_permission:=CASE WHEN v_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance') THEN 'sales.write'
    WHEN v_type IN ('bill','vendor_credit','paid_expense','vendor_payment','vendor_refund','vendor_advance') THEN 'purchases.write'
    WHEN v_type='transfer' THEN 'banking.write' ELSE 'journal.write' END;
  v_actor:=finance_private.require_capability(p_organization_id,v_permission);
  SELECT o.status,o.books_start_date INTO v_permission,v_books_start FROM finance.organizations o WHERE o.id=p_organization_id FOR SHARE;
  IF NOT FOUND OR v_permission<>'active' THEN RAISE EXCEPTION 'company is unavailable for editing' USING ERRCODE='42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text||':documents.save:'||p_idempotency_key,0));
  SELECT i.request_hash,i.actor_member_id,i.response_body INTO v_existing_hash,v_existing_actor,v_receipt FROM finance.idempotency_requests i
    WHERE i.organization_id=p_organization_id AND i.operation='documents.save' AND i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing_hash<>p_request_hash OR v_existing_actor<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505'; END IF;
    RETURN QUERY SELECT (v_receipt->>'document_id')::uuid,(v_receipt->>'document_version')::integer,
      v_receipt->>'state',(v_receipt->>'net_amount')::finance.amount,(v_receipt->>'tax_amount')::finance.amount,
      (v_receipt->>'total_amount')::finance.amount,v_receipt->>'material_digest'; RETURN;
  END IF;
  IF v_type NOT IN ('invoice','customer_credit','bill','vendor_credit','paid_expense','receipt','vendor_payment','customer_refund','vendor_refund',
     'customer_advance','vendor_advance','transfer','manual_journal','controlled_adjustment','opening_balance') THEN
    RAISE EXCEPTION 'this source type is created by its dedicated workflow' USING ERRCODE='23514';
  END IF;
  v_currency:=COALESCE(p_payload->>'currency','BDT'); IF v_currency<>'BDT' THEN RAISE EXCEPTION 'V1 supports BDT only' USING ERRCODE='23514'; END IF;
  IF length(COALESCE(p_payload->>'description',''))>2000 OR length(COALESCE(p_payload->>'external_reference',''))>160 THEN
    RAISE EXCEPTION 'document text exceeds its allowed length' USING ERRCODE='22023';
  END IF;
  v_rounding:=COALESCE(NULLIF(p_payload->>'rounding_adjustment','')::finance.amount,0);
  IF p_payload ? 'rounding_adjustment' THEN PERFORM finance_private.require_decimal_string(p_payload->'rounding_adjustment',2,true); END IF;
  v_rounding_reason:=NULLIF(btrim(p_payload->>'rounding_reason'),'');v_rounding_account:=NULLIF(p_payload->>'rounding_account_id','')::uuid;
  IF abs(v_rounding)>.05 OR (v_rounding=0 AND (v_rounding_reason IS NOT NULL OR v_rounding_account IS NOT NULL)) OR
     (v_rounding<>0 AND (v_rounding_reason IS NULL OR length(v_rounding_reason)>500 OR v_rounding_account IS NULL)) THEN
    RAISE EXCEPTION 'rounding requires an amount up to 0.05, reason, and approved account' USING ERRCODE='23514';
  END IF;
  IF v_rounding_account IS NOT NULL THEN
    SELECT * INTO v_rounding_row FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=v_rounding_account;
    IF NOT FOUND OR NOT finance_private.validate_mapping_target('rounding_difference',v_rounding_row) THEN
      RAISE EXCEPTION 'invalid rounding-difference account' USING ERRCODE='23514';
    END IF;
  END IF;
  IF v_type='opening_balance' THEN
    IF v_accounting<>v_books_start-1 THEN RAISE EXCEPTION 'opening balances use the day before books start' USING ERRCODE='23514'; END IF;
    SELECT p.fiscal_year_id INTO v_year_id FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.kind='opening'
      AND p.starts_on=v_accounting AND p.ends_on=v_accounting AND p.status='open';
    IF NOT FOUND THEN RAISE EXCEPTION 'opening period unavailable' USING ERRCODE='23514'; END IF;
  ELSE
    IF v_accounting<v_books_start THEN RAISE EXCEPTION 'accounting date precedes books start' USING ERRCODE='23514'; END IF;
    SELECT p.fiscal_year_id INTO v_year_id FROM finance.accounting_periods p JOIN finance.fiscal_years fy
      ON fy.organization_id=p.organization_id AND fy.id=p.fiscal_year_id
      WHERE p.organization_id=p_organization_id AND p.kind='regular' AND p.starts_on<=v_accounting AND p.ends_on>=v_accounting
        AND p.status='open' AND fy.status='open';
  END IF;
  IF v_type<>'opening_balance' AND v_year_id IS NULL THEN RAISE EXCEPTION 'accounting date has no open fiscal period' USING ERRCODE='23514'; END IF;
  IF v_due IS NOT NULL AND (NOT isfinite(v_due) OR v_due<v_issue) THEN RAISE EXCEPTION 'due date precedes issue date' USING ERRCODE='23514'; END IF;
  IF v_party IS NOT NULL THEN
    IF v_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance') AND NOT EXISTS
       (SELECT 1 FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=v_party AND c.is_customer AND c.is_active) THEN
      RAISE EXCEPTION 'active customer unavailable' USING ERRCODE='23514';
    END IF;
    IF v_type IN ('bill','vendor_credit','vendor_payment','vendor_refund','vendor_advance') AND NOT EXISTS
       (SELECT 1 FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=v_party AND c.is_vendor AND c.is_active) THEN
      RAISE EXCEPTION 'active supplier unavailable' USING ERRCODE='23514';
    END IF;
  ELSIF v_type IN ('invoice','customer_credit','bill','vendor_credit','receipt','vendor_payment','customer_refund','vendor_refund','customer_advance','vendor_advance') THEN
    RAISE EXCEPTION 'party is required for this source type' USING ERRCODE='23514';
  END IF;
  IF v_type IN ('customer_credit','vendor_credit') THEN
    v_original:=NULLIF(p_payload->'trade'->>'original_document_id','')::uuid;
    IF v_original IS NULL OR NOT EXISTS (SELECT 1 FROM finance.business_documents o WHERE o.organization_id=p_organization_id AND o.id=v_original
      AND o.state='posted' AND ((v_type='customer_credit' AND o.document_type='invoice') OR (v_type='vendor_credit' AND o.document_type='bill')) AND o.party_id=v_party) THEN
      RAISE EXCEPTION 'credit must reference its same-party posted original document' USING ERRCODE='23514';
    END IF;
  END IF;
  IF v_created THEN
    INSERT INTO finance.business_documents(id,organization_id,document_type,fiscal_year_id,party_id,issue_date,accounting_date,due_date,external_reference,
      description,currency,rounding_adjustment,rounding_reason,rounding_account_id,version,created_by_member_id,party_snapshot,material_digest)
    VALUES(v_id,p_organization_id,v_type,v_year_id,v_party,v_issue,v_accounting,v_due,NULLIF(p_payload->>'external_reference',''),
      COALESCE(p_payload->>'description',''),v_currency,v_rounding,v_rounding_reason,v_rounding_account,1,v_actor,
      CASE WHEN v_party IS NULL THEN '{}'::jsonb ELSE (SELECT jsonb_build_object('display_name',c.display_name,'legal_name',c.legal_name,'email',c.email,
        'phone',c.phone,'billing_address',c.billing_address,'tax_identifiers',c.tax_identifiers) FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=v_party) END,
      p_request_hash);
    v_document.version:=1;
  ELSE
    SELECT * INTO v_document FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
    IF v_document.state IN ('posted','void') THEN RAISE EXCEPTION 'posted or void sources cannot be edited' USING ERRCODE='40001'; END IF;
    IF p_expected_version IS NULL OR v_document.version<>p_expected_version THEN RAISE EXCEPTION 'document version is stale' USING ERRCODE='40001'; END IF;
    IF v_document.document_type<>v_type THEN RAISE EXCEPTION 'document type cannot change' USING ERRCODE='23514'; END IF;
    UPDATE finance.approval_requests SET state='superseded' WHERE organization_id=p_organization_id AND document_id=v_id AND state IN ('pending','approved');
    UPDATE finance.business_documents d SET fiscal_year_id=v_year_id,party_id=v_party,issue_date=v_issue,accounting_date=v_accounting,due_date=v_due,
      external_reference=NULLIF(p_payload->>'external_reference',''),description=COALESCE(p_payload->>'description',''),currency=v_currency,
      rounding_adjustment=v_rounding,rounding_reason=v_rounding_reason,rounding_account_id=v_rounding_account,state='draft',version=d.version+1,
      updated_at=clock_timestamp(),material_digest=p_request_hash,
      party_snapshot=CASE WHEN v_party IS NULL THEN '{}'::jsonb ELSE (SELECT jsonb_build_object('display_name',c.display_name,'legal_name',c.legal_name,
        'email',c.email,'phone',c.phone,'billing_address',c.billing_address,'tax_identifiers',c.tax_identifiers) FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=v_party) END
      WHERE d.organization_id=p_organization_id AND d.id=v_id;
    DELETE FROM finance.trade_documents WHERE organization_id=p_organization_id AND document_id=v_id;
    DELETE FROM finance.money_movements WHERE organization_id=p_organization_id AND document_id=v_id;
    DELETE FROM finance.transfers WHERE organization_id=p_organization_id AND document_id=v_id;
    DELETE FROM finance.manual_journal_rows WHERE organization_id=p_organization_id AND document_id=v_id;
    DELETE FROM finance.document_allocation_plans WHERE organization_id=p_organization_id AND document_id=v_id;
    v_document.version:=v_document.version+1;
  END IF;
  IF v_type IN ('invoice','customer_credit','bill','vendor_credit','paid_expense') THEN
    UPDATE finance.document_lines SET line_no=line_no+1000 WHERE organization_id=p_organization_id AND document_id=v_id;
  ELSIF jsonb_array_length(p_payload->'lines')>0 THEN
    RAISE EXCEPTION 'this document type does not accept trade lines' USING ERRCODE='23514';
  END IF;
  IF v_type IN ('invoice','customer_credit','bill','vendor_credit','paid_expense') THEN
    INSERT INTO finance.trade_documents(organization_id,document_id,original_document_id,recognition_mode,performance_confirmed,
      supplier_invoice_date,supplier_invoice_key,terms,notes)
    VALUES(p_organization_id,v_id,v_original,COALESCE(p_payload->'trade'->>'recognition_mode','earned_or_incurred'),
      COALESCE((p_payload->'trade'->>'performance_confirmed')::boolean,false),NULLIF(p_payload->'trade'->>'supplier_invoice_date','')::date,
      NULLIF(p_payload->'trade'->>'supplier_invoice_key',''),p_payload->'trade'->>'terms',p_payload->'trade'->>'notes');
  END IF;
  FOR v_line,v_ord IN SELECT value,ordinality FROM jsonb_array_elements(p_payload->'lines') WITH ORDINALITY AS x(value,ordinality) LOOP
    v_line_count:=v_line_count+1; IF v_line_count>500 THEN RAISE EXCEPTION 'too many document lines' USING ERRCODE='22023'; END IF;
    IF v_line->>'description' IS NULL OR length(btrim(v_line->>'description')) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'line description required' USING ERRCODE='22023'; END IF;
    PERFORM finance_private.require_decimal_string(v_line->'quantity',6,false);
    PERFORM finance_private.require_decimal_string(v_line->'unit_price',6,false);
    PERFORM finance_private.require_decimal_string(COALESCE(v_line->'discount_amount','"0.00"'::jsonb),2,false);
    v_line_id:=NULLIF(v_line->>'id','')::uuid;
    IF v_line_id IS NOT NULL THEN
      UPDATE finance.document_lines SET line_no=v_ord,item_id=NULLIF(v_line->>'item_id','')::uuid,
        original_line_id=NULLIF(v_line->>'original_line_id','')::uuid,description=btrim(COALESCE(v_line->>'description','')),
        quantity=(v_line->>'quantity')::finance.quantity,unit_price=(v_line->>'unit_price')::finance.unit_price,
        discount_amount=COALESCE(NULLIF(v_line->>'discount_amount','')::finance.amount,0),account_id=(v_line->>'account_id')::uuid,
        cost_center_id=NULLIF(v_line->>'cost_center_id','')::uuid,tax_code_id=NULLIF(v_line->>'tax_code_id','')::uuid,
        tax_mode=COALESCE(v_line->>'tax_mode','exclusive'),cash_flow_class=NULLIF(v_line->>'cash_flow_class','')::finance.cash_flow_class
        WHERE organization_id=p_organization_id AND document_id=v_id AND id=v_line_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'line does not belong to this draft' USING ERRCODE='23514'; END IF;
    ELSE
      INSERT INTO finance.document_lines(organization_id,document_id,line_no,item_id,original_line_id,description,quantity,unit_price,discount_amount,
        account_id,cost_center_id,tax_code_id,tax_mode,net_amount,tax_amount,gross_amount,cash_flow_class)
      VALUES(p_organization_id,v_id,v_ord,NULLIF(v_line->>'item_id','')::uuid,NULLIF(v_line->>'original_line_id','')::uuid,
        btrim(COALESCE(v_line->>'description','')),(v_line->>'quantity')::finance.quantity,(v_line->>'unit_price')::finance.unit_price,
        COALESCE(NULLIF(v_line->>'discount_amount','')::finance.amount,0),(v_line->>'account_id')::uuid,
        NULLIF(v_line->>'cost_center_id','')::uuid,NULLIF(v_line->>'tax_code_id','')::uuid,COALESCE(v_line->>'tax_mode','exclusive'),
        0,0,0,NULLIF(v_line->>'cash_flow_class','')::finance.cash_flow_class) RETURNING id INTO v_line_id;
    END IF;
    v_keep_ids:=array_append(v_keep_ids,v_line_id);
  END LOOP;
  IF v_type IN ('invoice','customer_credit','bill','vendor_credit','paid_expense') AND v_line_count=0 THEN RAISE EXCEPTION 'trade source requires at least one line' USING ERRCODE='23514'; END IF;
  IF v_type IN ('customer_credit','vendor_credit') AND EXISTS(SELECT 1 FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.document_id=v_id
    AND (l.original_line_id IS NULL OR NOT EXISTS(SELECT 1 FROM finance.document_lines source_line WHERE source_line.organization_id=p_organization_id
      AND source_line.id=l.original_line_id AND source_line.document_id=v_original))) THEN
    RAISE EXCEPTION 'every credit line must reference a line on the selected original' USING ERRCODE='23514';
  END IF;
  IF v_type IN ('invoice','customer_credit','bill','vendor_credit','paid_expense') AND p_document_id IS NOT NULL THEN
    DELETE FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.document_id=v_id AND NOT (l.id=ANY(v_keep_ids));
  END IF;
  IF p_payload ? 'movement' AND jsonb_typeof(p_payload->'movement')='object' THEN
    IF v_type NOT IN ('receipt','vendor_payment','customer_refund','vendor_refund','customer_advance','vendor_advance','paid_expense') THEN
      RAISE EXCEPTION 'cash movement is not valid for this source type' USING ERRCODE='23514';
    END IF;
    v_row:=p_payload->'movement';
    IF length(COALESCE(v_row->>'reference',''))>160 THEN RAISE EXCEPTION 'movement reference is too long' USING ERRCODE='22023'; END IF;
    PERFORM finance_private.require_decimal_string(v_row->'amount',2,false);
    IF (v_type IN ('receipt','customer_advance','vendor_refund') AND COALESCE(v_row->>'direction','in')<>'in') OR
       (v_type IN ('vendor_payment','customer_refund','vendor_advance','paid_expense') AND COALESCE(v_row->>'direction','out')<>'out') THEN
      RAISE EXCEPTION 'cash direction does not match source type' USING ERRCODE='23514';
    END IF;
    INSERT INTO finance.money_movements(organization_id,document_id,cash_account_id,direction,amount,method,reference,cash_flow_class)
    VALUES(p_organization_id,v_id,(v_row->>'cash_account_id')::uuid,COALESCE(v_row->>'direction','out'),(v_row->>'amount')::finance.amount,
      COALESCE(v_row->>'method','other'),NULLIF(v_row->>'reference',''),COALESCE(v_row->>'cash_flow_class','unclassified')::finance.cash_flow_class);
  END IF;
  IF v_type IN ('receipt','vendor_payment','customer_refund','vendor_refund','customer_advance','vendor_advance','paid_expense') AND
     NOT EXISTS(SELECT 1 FROM finance.money_movements m WHERE m.organization_id=p_organization_id AND m.document_id=v_id) THEN
    RAISE EXCEPTION 'this source type requires a cash movement' USING ERRCODE='23514';
  END IF;
  IF jsonb_array_length(COALESCE(p_payload->'allocation_plan','[]'::jsonb))>0 THEN
    IF v_type NOT IN ('receipt','vendor_payment') OR v_party IS NULL OR
       jsonb_array_length(p_payload->'allocation_plan')>100 THEN
      RAISE EXCEPTION 'allocation plans are only supported for receipt and supplier payment drafts' USING ERRCODE='23514';
    END IF;
    PERFORM finance_private.require_capability(p_organization_id,'dues.read');
    v_plan_control:=CASE WHEN v_type='receipt' THEN 'ar' ELSE 'ap' END;
    v_plan_side:=CASE WHEN v_type='receipt' THEN 'debit' ELSE 'credit' END;
    FOR v_plan IN SELECT value FROM jsonb_array_elements(p_payload->'allocation_plan') LOOP
      IF jsonb_typeof(v_plan) IS DISTINCT FROM 'object' OR jsonb_object_length(v_plan)<>2 OR
         NOT (v_plan ? 'target_open_item_id' AND v_plan ? 'amount') THEN
        RAISE EXCEPTION 'invalid allocation plan row' USING ERRCODE='22023';
      END IF;
      PERFORM finance_private.require_decimal_string(v_plan->'amount',2,false);
      v_plan_amount:=(v_plan->>'amount')::finance.amount;
      IF v_plan_amount<=0 THEN RAISE EXCEPTION 'allocation amount must be positive' USING ERRCODE='23514'; END IF;
      SELECT * INTO v_target FROM finance.open_items oi WHERE oi.organization_id=p_organization_id
        AND oi.id=(v_plan->>'target_open_item_id')::uuid AND oi.party_id=v_party
        AND oi.control_kind=v_plan_control AND oi.side=v_plan_side AND oi.issue_date<=v_accounting FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'allocation target is incompatible or unavailable' USING ERRCODE='23514'; END IF;
      IF v_plan_amount>v_target.original_amount-COALESCE((
        SELECT sum(a.amount) FROM finance.settlement_allocations a LEFT JOIN finance.allocation_reversals r
          ON r.organization_id=a.organization_id AND r.allocation_id=a.id AND r.effective_date<=v_accounting
        WHERE a.organization_id=p_organization_id AND a.effective_date<=v_accounting AND r.id IS NULL
          AND (a.debit_open_item_id=v_target.id OR a.credit_open_item_id=v_target.id)),0) THEN
        RAISE EXCEPTION 'allocation exceeds historical open-item capacity' USING ERRCODE='23514';
      END IF;
      INSERT INTO finance.document_allocation_plans(organization_id,document_id,target_open_item_id,amount)
        VALUES(p_organization_id,v_id,v_target.id,v_plan_amount);
      v_plan_total:=v_plan_total+v_plan_amount;
    END LOOP;
    SELECT m.amount INTO v_movement_amount FROM finance.money_movements m
      WHERE m.organization_id=p_organization_id AND m.document_id=v_id;
    IF v_movement_amount IS NULL OR v_plan_total>v_movement_amount THEN
      RAISE EXCEPTION 'planned settlements exceed the draft payment amount' USING ERRCODE='23514';
    END IF;
  END IF;
  IF p_payload ? 'transfer' AND jsonb_typeof(p_payload->'transfer')='object' THEN
    v_row:=p_payload->'transfer';
    PERFORM finance_private.require_decimal_string(v_row->'amount',2,false);
    PERFORM finance_private.require_decimal_string(COALESCE(v_row->'fee_amount','"0.00"'::jsonb),2,false);
    INSERT INTO finance.transfers(organization_id,document_id,from_cash_account_id,to_cash_account_id,amount,fee_amount,fee_account_id)
    VALUES(p_organization_id,v_id,(v_row->>'from_cash_account_id')::uuid,(v_row->>'to_cash_account_id')::uuid,(v_row->>'amount')::finance.amount,
      COALESCE(NULLIF(v_row->>'fee_amount','')::finance.amount,0),(NULLIF(v_row->>'fee_account_id',''))::uuid);
  END IF;
  IF v_type='transfer' AND NOT EXISTS(SELECT 1 FROM finance.transfers t WHERE t.organization_id=p_organization_id AND t.document_id=v_id) THEN
    RAISE EXCEPTION 'transfer details required' USING ERRCODE='23514';
  END IF;
  IF v_type<>'transfer' AND p_payload ? 'transfer' AND jsonb_typeof(p_payload->'transfer')='object' THEN RAISE EXCEPTION 'transfer details are not valid for this source type' USING ERRCODE='23514'; END IF;
  IF jsonb_typeof(p_payload->'journal_rows') IS DISTINCT FROM 'array' AND v_type IN ('manual_journal','controlled_adjustment','opening_balance') THEN
    RAISE EXCEPTION 'journal row array required' USING ERRCODE='22023';
  END IF;
  IF v_type NOT IN ('manual_journal','controlled_adjustment','opening_balance') AND jsonb_typeof(p_payload->'journal_rows')='array'
     AND jsonb_array_length(p_payload->'journal_rows')>0 THEN RAISE EXCEPTION 'journal rows are only valid for journal sources' USING ERRCODE='23514'; END IF;
  IF jsonb_typeof(p_payload->'journal_rows')='array' THEN
    FOR v_line,v_ord IN SELECT value,ordinality FROM jsonb_array_elements(p_payload->'journal_rows') WITH ORDINALITY AS x(value,ordinality) LOOP
      v_journal_count:=v_journal_count+1; IF v_journal_count>1000 THEN RAISE EXCEPTION 'too many source rows' USING ERRCODE='22023'; END IF;
      PERFORM finance_private.require_decimal_string(COALESCE(v_line->'debit','"0.00"'::jsonb),2,false);
      PERFORM finance_private.require_decimal_string(COALESCE(v_line->'credit','"0.00"'::jsonb),2,false);
      INSERT INTO finance.manual_journal_rows(organization_id,document_id,line_no,account_id,party_id,cost_center_id,debit,credit,description,
        cash_flow_class,open_item_reference,open_item_due_date)
      VALUES(p_organization_id,v_id,v_ord,(v_line->>'account_id')::uuid,(NULLIF(v_line->>'party_id',''))::uuid,
        (NULLIF(v_line->>'cost_center_id',''))::uuid,COALESCE(NULLIF(v_line->>'debit','')::finance.amount,0),
        COALESCE(NULLIF(v_line->>'credit','')::finance.amount,0),btrim(COALESCE(v_line->>'description','')),
        (NULLIF(v_line->>'cash_flow_class',''))::finance.cash_flow_class,NULLIF(v_line->>'open_item_reference',''),
        NULLIF(v_line->>'open_item_due_date','')::date);
      IF length(btrim(COALESCE(v_line->>'description','')))=0 OR length(v_line->>'description')>500 THEN
        RAISE EXCEPTION 'journal row description required' USING ERRCODE='22023';
      END IF;
    END LOOP;
  END IF;
  SELECT COALESCE(sum(r.debit),0)::finance.amount,COALESCE(sum(r.credit),0)::finance.amount INTO v_debits,v_credits
    FROM finance.manual_journal_rows r WHERE r.organization_id=p_organization_id AND r.document_id=v_id;
  IF NOT EXISTS(SELECT 1 FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.document_id=v_id) THEN
    SELECT COALESCE(sum(m.amount),0)::finance.amount INTO v_movement_amount FROM finance.money_movements m WHERE m.organization_id=p_organization_id AND m.document_id=v_id;
    IF v_movement_amount=0 THEN SELECT COALESCE(sum(t.amount+t.fee_amount),0)::finance.amount INTO v_movement_amount FROM finance.transfers t WHERE t.organization_id=p_organization_id AND t.document_id=v_id; END IF;
    IF v_movement_amount=0 THEN v_movement_amount:=GREATEST(v_debits,v_credits); END IF;
    UPDATE finance.business_documents d SET net_amount=v_movement_amount,tax_amount=0,total_amount=v_movement_amount+d.rounding_adjustment
      WHERE d.organization_id=p_organization_id AND d.id=v_id;
  END IF;
  SELECT jsonb_build_object('document_id',d.id,'document_version',d.version,'state',d.state,'net_amount',d.net_amount::text,
    'tax_amount',d.tax_amount::text,'total_amount',d.total_amount::text,'material_digest',d.material_digest) INTO v_result
    FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=v_id;
  INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body,resource_document_id)
    VALUES(p_organization_id,'documents.save',p_idempotency_key,p_request_hash,v_actor,200,v_result,v_id);
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,CASE WHEN v_created THEN 'document.draft.create' ELSE 'document.draft.update' END,
    'business_document',v_id,p_request_id,jsonb_build_object('document_type',v_type,'version',v_document.version,'digest',p_request_hash));
  RETURN QUERY SELECT v_id,(v_result->>'document_version')::integer,v_result->>'state',(v_result->>'net_amount')::finance.amount,
    (v_result->>'tax_amount')::finance.amount,(v_result->>'total_amount')::finance.amount,v_result->>'material_digest';
END $$;
REVOKE ALL ON FUNCTION public.save_financial_document(uuid,uuid,integer,text,text,text,jsonb) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.save_financial_document(uuid,uuid,integer,text,text,text,jsonb) TO ams_runtime;

CREATE FUNCTION public.save_document_allocation_plan(
  p_organization_id uuid,p_document_id uuid,p_expected_version integer,p_request_id text,
  p_idempotency_key text,p_request_hash text,p_allocation_plan jsonb
) RETURNS TABLE(document_id uuid,document_version integer,state text,net_amount finance.amount,tax_amount finance.amount,
  total_amount finance.amount,material_digest text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_type finance.document_type; v_state finance.document_state; v_party uuid; v_date date; v_period_id uuid;
  v_year_id uuid; v_status text; v_plan jsonb; v_target finance.open_items%ROWTYPE; v_side text; v_control text;
  v_amount finance.amount; v_total finance.amount:=0; v_payment finance.amount; v_hash text; v_existing_actor uuid;
  v_existing_document uuid; v_receipt jsonb; v_result jsonb; v_doc finance.business_documents%ROWTYPE;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_expected_version IS NULL OR p_expected_version<1 OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{22,172}$'
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' OR jsonb_typeof(p_allocation_plan) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_allocation_plan)>100 THEN RAISE EXCEPTION 'invalid allocation-plan request' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text||':documents.allocation-plan:'||p_idempotency_key,0));
  SELECT o.status INTO v_status FROM finance.organizations o WHERE o.id=p_organization_id FOR SHARE;
  IF NOT FOUND OR v_status<>'active' THEN RAISE EXCEPTION 'company is not writable' USING ERRCODE='42501'; END IF;
  SELECT d.document_type,d.state,d.party_id,d.accounting_date,d.fiscal_year_id INTO v_type,v_state,v_party,v_date,v_year_id
    FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
  IF v_type NOT IN ('receipt','vendor_payment') OR v_party IS NULL THEN
    RAISE EXCEPTION 'allocation plans require an editable receipt or supplier payment' USING ERRCODE='23514';
  END IF;
  v_actor:=finance_private.require_capability(p_organization_id,CASE WHEN v_type='receipt' THEN 'sales.write' ELSE 'purchases.write' END);
  PERFORM finance_private.require_capability(p_organization_id,'dues.read');
  SELECT i.request_hash,i.actor_member_id,i.response_body,i.resource_document_id INTO v_hash,v_existing_actor,v_receipt,v_existing_document FROM finance.idempotency_requests i
    WHERE i.organization_id=p_organization_id AND i.operation='documents.allocation-plan' AND i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_hash<>p_request_hash OR v_existing_actor<>v_actor OR v_existing_document<>p_document_id THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505'; END IF;
    RETURN QUERY SELECT (v_receipt->>'document_id')::uuid,(v_receipt->>'document_version')::integer,v_receipt->>'state',
      (v_receipt->>'net_amount')::finance.amount,(v_receipt->>'tax_amount')::finance.amount,
      (v_receipt->>'total_amount')::finance.amount,v_receipt->>'material_digest'; RETURN;
  END IF;
  IF v_state IN ('posted','void') THEN RAISE EXCEPTION 'posted and void documents are immutable' USING ERRCODE='23514'; END IF;
  SELECT fy.status INTO v_status FROM finance.fiscal_years fy WHERE fy.organization_id=p_organization_id AND fy.id=v_year_id FOR UPDATE;
  IF NOT FOUND OR v_status<>'open' THEN RAISE EXCEPTION 'fiscal year is locked' USING ERRCODE='23514'; END IF;
  SELECT p.id INTO v_period_id FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.fiscal_year_id=v_year_id
    AND p.kind='regular' AND p.starts_on<=v_date AND p.ends_on>=v_date FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.id=v_period_id AND p.status='open') THEN
    RAISE EXCEPTION 'accounting period is locked or unavailable' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id FOR UPDATE;
  IF v_doc.version<>p_expected_version THEN RAISE EXCEPTION 'document version is stale' USING ERRCODE='40001'; END IF;
  IF v_doc.state IN ('posted','void') OR v_doc.accounting_date<>v_date OR v_doc.document_type<>v_type THEN
    RAISE EXCEPTION 'document changed while saving allocation plan' USING ERRCODE='40001';
  END IF;
  v_control:=CASE WHEN v_type='receipt' THEN 'ar' ELSE 'ap' END;
  v_side:=CASE WHEN v_type='receipt' THEN 'debit' ELSE 'credit' END;
  SELECT m.amount INTO v_payment FROM finance.money_movements m WHERE m.organization_id=p_organization_id
    AND m.document_id=p_document_id AND m.direction=CASE WHEN v_type='receipt' THEN 'in' ELSE 'out' END;
  IF NOT FOUND THEN RAISE EXCEPTION 'cash movement is required before settlement planning' USING ERRCODE='23514'; END IF;
  UPDATE finance.approval_requests SET state='superseded' WHERE organization_id=p_organization_id AND document_id=p_document_id AND state IN ('pending','approved');
  UPDATE finance.business_documents d SET state='draft',version=d.version+1,material_digest=p_request_hash,updated_at=clock_timestamp()
    WHERE d.organization_id=p_organization_id AND d.id=p_document_id RETURNING * INTO v_doc;
  DELETE FROM finance.document_allocation_plans WHERE organization_id=p_organization_id AND document_id=p_document_id;
  FOR v_plan IN SELECT value FROM jsonb_array_elements(p_allocation_plan) LOOP
    IF jsonb_typeof(v_plan) IS DISTINCT FROM 'object' OR jsonb_object_length(v_plan)<>2 OR
       NOT (v_plan ? 'target_open_item_id' AND v_plan ? 'amount') THEN RAISE EXCEPTION 'invalid allocation-plan row' USING ERRCODE='22023'; END IF;
    PERFORM finance_private.require_decimal_string(v_plan->'amount',2,false);
    v_amount:=(v_plan->>'amount')::finance.amount;
    IF v_amount<=0 THEN RAISE EXCEPTION 'allocation amount must be positive' USING ERRCODE='23514'; END IF;
    SELECT * INTO v_target FROM finance.open_items oi WHERE oi.organization_id=p_organization_id
      AND oi.id=(v_plan->>'target_open_item_id')::uuid AND oi.party_id=v_party AND oi.control_kind=v_control
      AND oi.side=v_side AND oi.issue_date<=v_date;
    IF NOT FOUND THEN RAISE EXCEPTION 'allocation target is incompatible or unavailable' USING ERRCODE='23514'; END IF;
    IF v_amount>v_target.original_amount-COALESCE((
      SELECT sum(a.amount) FROM finance.settlement_allocations a LEFT JOIN finance.allocation_reversals r
        ON r.organization_id=a.organization_id AND r.allocation_id=a.id AND r.effective_date<=v_date
      WHERE a.organization_id=p_organization_id AND a.effective_date<=v_date AND r.id IS NULL
        AND (a.debit_open_item_id=v_target.id OR a.credit_open_item_id=v_target.id)),0) THEN
      RAISE EXCEPTION 'allocation exceeds historical open-item capacity' USING ERRCODE='23514';
    END IF;
    INSERT INTO finance.document_allocation_plans(organization_id,document_id,target_open_item_id,amount)
      VALUES(p_organization_id,p_document_id,v_target.id,v_amount);
    v_total:=v_total+v_amount;
  END LOOP;
  IF v_total>v_payment THEN RAISE EXCEPTION 'planned settlement exceeds payment amount' USING ERRCODE='23514'; END IF;
  SELECT jsonb_build_object('document_id',v_doc.id,'document_version',v_doc.version,'state',v_doc.state,'net_amount',v_doc.net_amount::text,
    'tax_amount',v_doc.tax_amount::text,'total_amount',v_doc.total_amount::text,'material_digest',v_doc.material_digest) INTO v_result;
  INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body,resource_document_id)
    VALUES(p_organization_id,'documents.allocation-plan',p_idempotency_key,p_request_hash,v_actor,200,v_result,p_document_id);
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'document.allocation-plan.update','business_document',p_document_id,p_request_id,
    jsonb_build_object('version',v_doc.version,'target_count',jsonb_array_length(p_allocation_plan),'amount',v_total::text,'digest',p_request_hash));
  RETURN QUERY SELECT p_document_id,v_doc.version,v_doc.state::text,v_doc.net_amount,v_doc.tax_amount,v_doc.total_amount,v_doc.material_digest;
END $$;
REVOKE ALL ON FUNCTION public.save_document_allocation_plan(uuid,uuid,integer,text,text,text,jsonb) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.save_document_allocation_plan(uuid,uuid,integer,text,text,text,jsonb) TO ams_runtime;

CREATE FUNCTION public.read_financial_document(p_organization_id uuid,p_document_id uuid)
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
    'allocation_plan',COALESCE((SELECT jsonb_agg(jsonb_build_object('target_open_item_id',p.target_open_item_id,'amount',p.amount::text) ORDER BY p.target_open_item_id)
      FROM finance.document_allocation_plans p WHERE p.organization_id=d.organization_id AND p.document_id=d.id),'[]'::jsonb))
    INTO v_result FROM finance.business_documents d LEFT JOIN finance.trade_documents td ON td.organization_id=d.organization_id AND td.document_id=d.id
      LEFT JOIN finance.money_movements mm ON mm.organization_id=d.organization_id AND mm.document_id=d.id
      LEFT JOIN finance.transfers tr ON tr.organization_id=d.organization_id AND tr.document_id=d.id
    WHERE d.organization_id=p_organization_id AND d.id=p_document_id;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.read_financial_document(uuid,uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_financial_document(uuid,uuid) TO ams_runtime;

CREATE FUNCTION public.list_document_draft_options(p_organization_id uuid,p_document_type text,p_accounting_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_type finance.document_type; v_permission text;
BEGIN
  BEGIN v_type:=p_document_type::finance.document_type; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'unsupported source type' USING ERRCODE='22023'; END;
  v_permission:=CASE WHEN v_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance') THEN 'sales.write'
    WHEN v_type IN ('bill','vendor_credit','paid_expense','vendor_payment','vendor_refund','vendor_advance') THEN 'purchases.write'
    WHEN v_type='transfer' THEN 'banking.write' ELSE 'journal.write' END;
  PERFORM finance_private.require_capability(p_organization_id,v_permission);
  IF p_accounting_date IS NULL THEN RAISE EXCEPTION 'accounting date required' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object(
    'accounts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'code',a.code,'name',a.name,'account_type',a.account_type,'normal_side',a.normal_side) ORDER BY a.code)
      FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.is_active AND a.is_postable AND a.control_kind IS NULL
        AND ((v_type IN ('invoice','customer_credit') AND a.account_type='income') OR
             (v_type IN ('bill','vendor_credit','paid_expense') AND a.account_type IN ('expense','asset')) OR
             (v_type='transfer' AND a.account_type='expense') OR
             (v_type IN ('manual_journal','controlled_adjustment','opening_balance') AND finance_private.has_permission(p_organization_id,'accounting.read')))), '[]'::jsonb),
    'parties',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'display_name',c.display_name) ORDER BY c.display_name)
      FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.is_active AND
        ((v_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance') AND c.is_customer) OR
         (v_type IN ('bill','vendor_credit','vendor_payment','vendor_refund','vendor_advance') AND c.is_vendor) OR
         (v_type='paid_expense' AND c.is_vendor))), '[]'::jsonb),
    'cash_accounts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',ca.id,'name',ca.name,'kind',ca.kind) ORDER BY ca.name)
      FROM finance.cash_accounts ca WHERE ca.organization_id=p_organization_id AND ca.is_active AND
        (finance_private.has_permission(p_organization_id,'banking.read') OR finance_private.has_permission(p_organization_id,'banking.write'))), '[]'::jsonb),
    'rounding_accounts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'code',a.code,'name',a.name) ORDER BY a.code)
      FROM finance.accounts a JOIN finance.account_mappings m ON m.organization_id=a.organization_id AND m.account_id=a.id
      WHERE a.organization_id=p_organization_id AND m.mapping_key='rounding_difference' AND a.is_active AND a.is_postable), '[]'::jsonb),
    'tax_codes',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'code',t.code,'label',t.label,'rate_percent',t.rate_percent::text) ORDER BY t.code)
      FROM finance.tax_codes t WHERE t.organization_id=p_organization_id AND t.is_active AND t.effective_from<=p_accounting_date
        AND (t.effective_to IS NULL OR t.effective_to>=p_accounting_date) AND finance_private.has_permission(p_organization_id,'tax.read')), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.list_document_draft_options(uuid,text,date) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.list_document_draft_options(uuid,text,date) TO ams_runtime;

