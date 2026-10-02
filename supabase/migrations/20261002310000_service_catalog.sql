-- US-029: company-scoped service/non-stock catalogue and cost-center tags.
BEGIN;

ALTER TABLE finance.items ADD COLUMN row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0);
ALTER TABLE finance.cost_centers ADD COLUMN row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0);
ALTER TABLE finance.document_lines ADD COLUMN item_snapshot jsonb;

CREATE FUNCTION finance_private.guard_document_line_item_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_item finance.items%ROWTYPE; v_document finance.business_documents%ROWTYPE;
BEGIN
 SELECT * INTO v_document FROM finance.business_documents d WHERE d.organization_id=NEW.organization_id AND d.id=NEW.document_id FOR UPDATE;
 IF NOT FOUND OR v_document.state<>'draft' THEN RAISE EXCEPTION 'catalogue selections can only change on a draft source' USING ERRCODE='23514'; END IF;
 IF NEW.item_id IS NULL THEN NEW.item_snapshot:=NULL;
 ELSIF TG_OP='UPDATE' AND NEW.item_id=OLD.item_id THEN NEW.item_snapshot:=OLD.item_snapshot;
 ELSE
  SELECT * INTO v_item FROM finance.items i WHERE i.organization_id=NEW.organization_id AND i.id=NEW.item_id AND i.is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'active catalogue item unavailable in this company' USING ERRCODE='23514'; END IF;
  NEW.item_snapshot:=jsonb_build_object('name',v_item.name,'sku',v_item.sku,'unit',v_item.unit);
 END IF;
 IF NEW.cost_center_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.cost_center_id IS DISTINCT FROM OLD.cost_center_id) AND NOT EXISTS(
  SELECT 1 FROM finance.cost_centers c WHERE c.organization_id=NEW.organization_id AND c.id=NEW.cost_center_id AND c.is_active FOR SHARE) THEN
  RAISE EXCEPTION 'active same-company cost center unavailable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_document_line_item_snapshot() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER document_lines_item_snapshot_guard BEFORE INSERT OR UPDATE ON finance.document_lines
 FOR EACH ROW EXECUTE FUNCTION finance_private.guard_document_line_item_snapshot();

CREATE FUNCTION finance_private.guard_manual_journal_cost_center()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_document finance.business_documents%ROWTYPE;
BEGIN
 SELECT * INTO v_document FROM finance.business_documents d WHERE d.organization_id=NEW.organization_id AND d.id=NEW.document_id FOR UPDATE;
 IF NOT FOUND OR v_document.state<>'draft' THEN RAISE EXCEPTION 'journal cost-center tags can only change on a draft' USING ERRCODE='23514'; END IF;
 IF NEW.cost_center_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.cost_center_id IS DISTINCT FROM OLD.cost_center_id) AND NOT EXISTS(
  SELECT 1 FROM finance.cost_centers c WHERE c.organization_id=NEW.organization_id AND c.id=NEW.cost_center_id AND c.is_active FOR SHARE) THEN
  RAISE EXCEPTION 'active same-company cost center unavailable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_manual_journal_cost_center() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER manual_journal_cost_center_guard BEFORE INSERT OR UPDATE ON finance.manual_journal_rows
 FOR EACH ROW EXECUTE FUNCTION finance_private.guard_manual_journal_cost_center();

CREATE FUNCTION finance_private.require_catalog_write(p_organization_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_status text;
BEGIN
 v_actor:=finance_private.require_capability(p_organization_id,'catalog.write');
 PERFORM finance_private.require_recent_auth();
 SELECT o.status INTO v_status FROM finance.organizations o WHERE o.id=p_organization_id FOR UPDATE;
 IF v_status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'company is not writable' USING ERRCODE='42501'; END IF;
 RETURN v_actor;
END $$;
REVOKE ALL ON FUNCTION finance_private.require_catalog_write(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.list_service_catalog(p_organization_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM finance_private.require_capability(p_organization_id,'catalog.read');
 RETURN jsonb_build_object(
  'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'sku',i.sku,'name',i.name,'unit',i.unit,
    'default_unit_price',i.default_unit_price::text,'sales_account_id',i.sales_account_id,'purchase_account_id',i.purchase_account_id,
    'tax_code_id',i.tax_code_id,'is_active',i.is_active,'row_version',i.row_version) ORDER BY i.name,i.id)
    FROM finance.items i WHERE i.organization_id=p_organization_id),'[]'::jsonb),
  'cost_centers',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'code',c.code,'name',c.name,'is_active',c.is_active,'row_version',c.row_version)
    ORDER BY c.code,c.id) FROM finance.cost_centers c WHERE c.organization_id=p_organization_id),'[]'::jsonb),
  'accounts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'code',a.code,'name',a.name,'account_type',a.account_type::text)
    ORDER BY a.code,a.id) FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.is_active AND a.is_postable
      AND a.control_kind IS NULL AND a.account_type IN ('income','expense','asset')),'[]'::jsonb),
  'tax_codes',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'code',t.code,'label',t.label,'rate_percent',t.rate_percent::text,'effective_from',t.effective_from,'effective_to',t.effective_to)
    ORDER BY t.code,t.effective_from DESC) FROM finance.tax_codes t WHERE t.organization_id=p_organization_id AND t.is_active),'[]'::jsonb)
 );
END $$;
REVOKE ALL ON FUNCTION public.list_service_catalog(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_service_catalog(uuid) TO authenticated;

CREATE FUNCTION public.save_service_item(p_organization_id uuid,p_item_id uuid,p_expected_version integer,p_request_id text,
 p_idempotency_key text,p_request_hash text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_item finance.items%ROWTYPE; v_id uuid:=COALESCE(p_item_id,gen_random_uuid());
 v_existing jsonb; v_hash text; v_existing_actor uuid; v_result jsonb; v_created boolean:=p_item_id IS NULL; v_price finance.unit_price;
BEGIN
 PERFORM finance_private.validate_request_id(p_request_id);v_actor:=finance_private.require_catalog_write(p_organization_id);
 IF (v_created AND p_expected_version IS NOT NULL) OR (NOT v_created AND COALESCE(p_expected_version,0)<1) OR
  p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{22,172}$' OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' OR
  jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR
  (p_payload-ARRAY['sku','name','unit','default_unit_price','sales_account_id','purchase_account_id','tax_code_id','is_active'])<>'{}'::jsonb OR
  jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'unit') IS DISTINCT FROM 'string' OR
  jsonb_typeof(p_payload->'default_unit_price') IS DISTINCT FROM 'string' OR
  (p_payload ? 'sku' AND jsonb_typeof(p_payload->'sku') NOT IN ('string','null')) OR
  (p_payload ? 'sales_account_id' AND jsonb_typeof(p_payload->'sales_account_id') NOT IN ('string','null')) OR
  (p_payload ? 'purchase_account_id' AND jsonb_typeof(p_payload->'purchase_account_id') NOT IN ('string','null')) OR
  (p_payload ? 'tax_code_id' AND jsonb_typeof(p_payload->'tax_code_id') NOT IN ('string','null')) OR
  (p_payload ? 'is_active' AND jsonb_typeof(p_payload->'is_active') IS DISTINCT FROM 'boolean') OR
  length(btrim(COALESCE(p_payload->>'name',''))) NOT BETWEEN 1 AND 160 OR
  length(COALESCE(p_payload->>'sku',''))>80 OR length(btrim(COALESCE(p_payload->>'unit',''))) NOT BETWEEN 1 AND 40 OR
  COALESCE(p_payload->>'is_active','true') NOT IN ('true','false') THEN
  RAISE EXCEPTION 'invalid catalogue item fields' USING ERRCODE='22023'; END IF;
 PERFORM finance_private.require_decimal_string(p_payload->'default_unit_price',6,false);
 v_price:=(p_payload->>'default_unit_price')::finance.unit_price;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':catalog.item:'||p_idempotency_key,0));
 SELECT i.request_hash,i.actor_member_id,i.response_body INTO v_hash,v_existing_actor,v_existing FROM finance.idempotency_requests i
  WHERE i.organization_id=p_organization_id AND i.operation='catalog.item.save' AND i.idempotency_key=p_idempotency_key FOR UPDATE;
 IF FOUND THEN IF v_hash<>p_request_hash OR v_existing_actor<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505'; END IF; RETURN v_existing; END IF;
 IF NULLIF(p_payload->>'sales_account_id','') IS NULL AND NULLIF(p_payload->>'purchase_account_id','') IS NULL THEN
  RAISE EXCEPTION 'configure a revenue or purchase account default' USING ERRCODE='23514'; END IF;
 IF p_payload->>'sales_account_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM finance.accounts a WHERE a.organization_id=p_organization_id
  AND a.id=(p_payload->>'sales_account_id')::uuid AND a.is_active AND a.is_postable AND a.control_kind IS NULL AND a.account_type='income') THEN
  RAISE EXCEPTION 'sales account must be an active postable income account in this company' USING ERRCODE='23514'; END IF;
 IF p_payload->>'purchase_account_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM finance.accounts a WHERE a.organization_id=p_organization_id
  AND a.id=(p_payload->>'purchase_account_id')::uuid AND a.is_active AND a.is_postable AND a.control_kind IS NULL AND a.account_type IN ('expense','asset')) THEN
  RAISE EXCEPTION 'purchase account must be an active postable expense or asset account in this company' USING ERRCODE='23514'; END IF;
 IF p_payload->>'tax_code_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM finance.tax_codes t WHERE t.organization_id=p_organization_id
  AND t.id=(p_payload->>'tax_code_id')::uuid AND t.is_active) THEN RAISE EXCEPTION 'active same-company tax code unavailable' USING ERRCODE='23514'; END IF;
 IF v_created THEN
  INSERT INTO finance.items(id,organization_id,sku,name,unit,default_unit_price,sales_account_id,purchase_account_id,tax_code_id,is_active)
  VALUES(v_id,p_organization_id,NULLIF(btrim(p_payload->>'sku'),''),btrim(p_payload->>'name'),btrim(p_payload->>'unit'),v_price,
   NULLIF(p_payload->>'sales_account_id','')::uuid,NULLIF(p_payload->>'purchase_account_id','')::uuid,NULLIF(p_payload->>'tax_code_id','')::uuid,
   COALESCE((p_payload->>'is_active')::boolean,true)) RETURNING * INTO v_item;
 ELSE
  SELECT * INTO v_item FROM finance.items i WHERE i.organization_id=p_organization_id AND i.id=v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'catalogue item unavailable' USING ERRCODE='P0002'; END IF;
  IF v_item.row_version<>p_expected_version THEN RAISE EXCEPTION 'catalogue item version is stale' USING ERRCODE='40001'; END IF;
  UPDATE finance.items SET sku=NULLIF(btrim(p_payload->>'sku'),''),name=btrim(p_payload->>'name'),unit=btrim(p_payload->>'unit'),
   default_unit_price=v_price,sales_account_id=NULLIF(p_payload->>'sales_account_id','')::uuid,purchase_account_id=NULLIF(p_payload->>'purchase_account_id','')::uuid,
   tax_code_id=NULLIF(p_payload->>'tax_code_id','')::uuid,is_active=COALESCE((p_payload->>'is_active')::boolean,true),row_version=row_version+1
   WHERE organization_id=p_organization_id AND id=v_id RETURNING * INTO v_item;
 END IF;
 v_result:=jsonb_build_object('id',v_item.id,'sku',v_item.sku,'name',v_item.name,'unit',v_item.unit,'default_unit_price',v_item.default_unit_price::text,
  'sales_account_id',v_item.sales_account_id,'purchase_account_id',v_item.purchase_account_id,'tax_code_id',v_item.tax_code_id,'is_active',v_item.is_active,'row_version',v_item.row_version);
 INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body)
 VALUES(p_organization_id,'catalog.item.save',p_idempotency_key,p_request_hash,v_actor,200,v_result);
 PERFORM finance_private.write_role_audit(p_organization_id,v_actor,CASE WHEN v_created THEN 'catalog.item.create' ELSE 'catalog.item.update' END,
  'catalog_item',v_id,p_request_id,jsonb_build_object('version',v_item.row_version,'sku',v_item.sku,'name',v_item.name,'unit',v_item.unit,'is_active',v_item.is_active));
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.save_service_item(uuid,uuid,integer,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_service_item(uuid,uuid,integer,text,text,text,jsonb) TO authenticated;

CREATE FUNCTION public.save_cost_center(p_organization_id uuid,p_center_id uuid,p_expected_version integer,p_request_id text,
 p_idempotency_key text,p_request_hash text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_center finance.cost_centers%ROWTYPE; v_id uuid:=COALESCE(p_center_id,gen_random_uuid());
 v_existing jsonb; v_hash text; v_existing_actor uuid; v_result jsonb; v_created boolean:=p_center_id IS NULL;
BEGIN
 PERFORM finance_private.validate_request_id(p_request_id);v_actor:=finance_private.require_catalog_write(p_organization_id);
 IF (v_created AND p_expected_version IS NOT NULL) OR (NOT v_created AND COALESCE(p_expected_version,0)<1) OR
  p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{22,172}$' OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' OR
  jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR
  (p_payload-ARRAY['code','name','is_active'])<>'{}'::jsonb OR
  jsonb_typeof(p_payload->'code') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string' OR
  (p_payload ? 'is_active' AND jsonb_typeof(p_payload->'is_active') IS DISTINCT FROM 'boolean') OR
  COALESCE(p_payload->>'code','') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$' OR
  length(btrim(COALESCE(p_payload->>'name',''))) NOT BETWEEN 1 AND 120 OR
  COALESCE(p_payload->>'is_active','true') NOT IN ('true','false') THEN
  RAISE EXCEPTION 'invalid cost-center fields' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':catalog.cost-center:'||p_idempotency_key,0));
 SELECT i.request_hash,i.actor_member_id,i.response_body INTO v_hash,v_existing_actor,v_existing FROM finance.idempotency_requests i
  WHERE i.organization_id=p_organization_id AND i.operation='catalog.cost-center.save' AND i.idempotency_key=p_idempotency_key FOR UPDATE;
 IF FOUND THEN IF v_hash<>p_request_hash OR v_existing_actor<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505'; END IF; RETURN v_existing; END IF;
 IF v_created THEN
  INSERT INTO finance.cost_centers(id,organization_id,code,name,is_active)
   VALUES(v_id,p_organization_id,upper(btrim(p_payload->>'code')),btrim(p_payload->>'name'),COALESCE((p_payload->>'is_active')::boolean,true)) RETURNING * INTO v_center;
 ELSE
  SELECT * INTO v_center FROM finance.cost_centers c WHERE c.organization_id=p_organization_id AND c.id=v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cost center unavailable' USING ERRCODE='P0002'; END IF;
  IF v_center.row_version<>p_expected_version THEN RAISE EXCEPTION 'cost center version is stale' USING ERRCODE='40001'; END IF;
  IF (v_center.code,v_center.name) IS DISTINCT FROM (upper(btrim(p_payload->>'code')),btrim(p_payload->>'name')) AND
   (EXISTS(SELECT 1 FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.cost_center_id=v_id) OR
    EXISTS(SELECT 1 FROM finance.manual_journal_rows j WHERE j.organization_id=p_organization_id AND j.cost_center_id=v_id) OR
    EXISTS(SELECT 1 FROM finance.journal_lines j WHERE j.organization_id=p_organization_id AND j.cost_center_id=v_id)) THEN
   RAISE EXCEPTION 'used cost-center labels are preserved; create another center instead' USING ERRCODE='23514'; END IF;
  UPDATE finance.cost_centers SET code=upper(btrim(p_payload->>'code')),name=btrim(p_payload->>'name'),
   is_active=COALESCE((p_payload->>'is_active')::boolean,true),row_version=row_version+1
   WHERE organization_id=p_organization_id AND id=v_id RETURNING * INTO v_center;
 END IF;
 v_result:=jsonb_build_object('id',v_center.id,'code',v_center.code,'name',v_center.name,'is_active',v_center.is_active,'row_version',v_center.row_version);
 INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body)
 VALUES(p_organization_id,'catalog.cost-center.save',p_idempotency_key,p_request_hash,v_actor,200,v_result);
 PERFORM finance_private.write_role_audit(p_organization_id,v_actor,CASE WHEN v_created THEN 'cost_center.create' ELSE 'cost_center.update' END,
  'cost_center',v_id,p_request_id,jsonb_build_object('version',v_center.row_version,'code',v_center.code,'name',v_center.name,'is_active',v_center.is_active));
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.save_cost_center(uuid,uuid,integer,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_cost_center(uuid,uuid,integer,text,text,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_document_draft_options(p_organization_id uuid,p_document_type text,p_accounting_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_type finance.document_type; v_permission text;
BEGIN
 BEGIN v_type:=p_document_type::finance.document_type; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'unsupported source type' USING ERRCODE='22023'; END;
 v_permission:=CASE WHEN v_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance') THEN 'sales.write'
  WHEN v_type IN ('bill','vendor_credit','paid_expense','vendor_payment','vendor_refund','vendor_advance') THEN 'purchases.write'
  WHEN v_type='transfer' THEN 'banking.write' ELSE 'journal.write' END;
 PERFORM finance_private.require_capability(p_organization_id,v_permission);
 IF p_accounting_date IS NULL OR NOT isfinite(p_accounting_date) THEN RAISE EXCEPTION 'accounting date required' USING ERRCODE='22023'; END IF;
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
    AND (t.effective_to IS NULL OR t.effective_to>=p_accounting_date) AND finance_private.has_permission(p_organization_id,'tax.read')), '[]'::jsonb),
  'items',CASE WHEN finance_private.has_permission(p_organization_id,'catalog.read') THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'sku',i.sku,'name',i.name,'unit',i.unit,'default_unit_price',i.default_unit_price::text,
    'sales_account_id',i.sales_account_id,'purchase_account_id',i.purchase_account_id,'tax_code_id',i.tax_code_id) ORDER BY i.name,i.id)
    FROM finance.items i WHERE i.organization_id=p_organization_id AND i.is_active),'[]'::jsonb) ELSE '[]'::jsonb END,
  'cost_centers',CASE WHEN finance_private.has_permission(p_organization_id,'catalog.read') THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'code',c.code,'name',c.name)
    ORDER BY c.code,c.id) FROM finance.cost_centers c WHERE c.organization_id=p_organization_id AND c.is_active),'[]'::jsonb) ELSE '[]'::jsonb END);
END $$;
REVOKE ALL ON FUNCTION public.list_document_draft_options(uuid,text,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_document_draft_options(uuid,text,date) TO authenticated;

CREATE FUNCTION public.read_line_item_snapshots(p_organization_id uuid,p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT finance_private.can_read_document(p_organization_id,p_document_id) THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('line_id',l.id,'item_id',l.item_id,'snapshot',l.item_snapshot,
   'cost_center_snapshot',CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id',c.id,'code',c.code,'name',c.name) END))
  FROM finance.document_lines l LEFT JOIN finance.cost_centers c ON c.organization_id=l.organization_id AND c.id=l.cost_center_id
  WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.read_line_item_snapshots(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_line_item_snapshots(uuid,uuid) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
