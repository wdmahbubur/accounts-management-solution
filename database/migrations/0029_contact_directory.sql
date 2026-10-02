-- US-027: customer/vendor directory, scoped profiles and immutable source snapshots.
ALTER TABLE finance.contacts ADD COLUMN row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0);
ALTER TABLE finance.idempotency_requests ADD COLUMN resource_contact_id uuid;
ALTER TABLE finance.idempotency_requests ADD CONSTRAINT idempotency_requests_resource_contact_fk
 FOREIGN KEY(organization_id,resource_contact_id) REFERENCES finance.contacts(organization_id,id) ON DELETE RESTRICT;
CREATE INDEX idempotency_requests_resource_contact_idx ON finance.idempotency_requests(organization_id,resource_contact_id);

CREATE FUNCTION finance_private.guard_contact_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (OLD.is_customer AND NOT NEW.is_customer AND EXISTS(SELECT 1 FROM finance.business_documents d WHERE d.organization_id=OLD.organization_id AND d.party_id=OLD.id AND d.document_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance'))) OR
    (OLD.is_vendor AND NOT NEW.is_vendor AND EXISTS(SELECT 1 FROM finance.business_documents d WHERE d.organization_id=OLD.organization_id AND d.party_id=OLD.id AND d.document_type IN ('bill','vendor_credit','vendor_payment','vendor_refund','vendor_advance','paid_expense'))) THEN
  RAISE EXCEPTION 'financial-history roles cannot be removed from a contact' USING ERRCODE='23514';
 END IF;
 NEW.row_version:=OLD.row_version+1; RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION finance_private.guard_contact_mutation() FROM PUBLIC,ams_runtime;
CREATE TRIGGER contacts_version_guard BEFORE UPDATE ON finance.contacts FOR EACH ROW EXECUTE FUNCTION finance_private.guard_contact_mutation();

CREATE FUNCTION public.save_contact(p_organization_id uuid,p_contact_id uuid,p_expected_version integer,p_request_id text,p_idempotency_key text,p_request_hash text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_id uuid:=COALESCE(p_contact_id,gen_random_uuid()); v_existing jsonb; v_hash text; v_existing_actor uuid; v_contact finance.contacts%ROWTYPE; v_result jsonb; v_created boolean:=p_contact_id IS NULL;
BEGIN
 PERFORM finance_private.validate_request_id(p_request_id);v_actor:=finance_private.require_capability(p_organization_id,'contacts.write');
 IF (p_contact_id IS NULL AND p_expected_version IS NOT NULL) OR (p_contact_id IS NOT NULL AND (p_expected_version IS NULL OR p_expected_version<1)) THEN
  RAISE EXCEPTION 'contact version is required' USING ERRCODE='22023'; END IF;
 IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{22,172}$' OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' OR
  jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>25000 OR length(btrim(COALESCE(p_payload->>'display_name',''))) NOT BETWEEN 1 AND 200 OR
  (p_payload-ARRAY['display_name','legal_name','is_customer','is_vendor','email','phone','billing_address','tax_identifiers','payment_terms_days','credit_limit','external_key','is_active'])<>'{}'::jsonb OR
  length(COALESCE(p_payload->>'legal_name',''))>200 OR length(COALESCE(p_payload->>'email',''))>254 OR length(COALESCE(p_payload->>'phone',''))>40 OR length(COALESCE(p_payload->>'external_key',''))>160 OR
  jsonb_typeof(COALESCE(p_payload->'billing_address','{}'::jsonb))<>'object' OR jsonb_typeof(COALESCE(p_payload->'tax_identifiers','{}'::jsonb))<>'object' OR
  COALESCE((p_payload->>'payment_terms_days')::integer,-1) NOT BETWEEN 0 AND 3650 OR
  COALESCE(p_payload->>'is_customer','false') NOT IN ('true','false') OR COALESCE(p_payload->>'is_vendor','false') NOT IN ('true','false') OR
  (NOT COALESCE((p_payload->>'is_customer')::boolean,false) AND NOT COALESCE((p_payload->>'is_vendor')::boolean,false)) THEN
  RAISE EXCEPTION 'invalid contact payload' USING ERRCODE='22023'; END IF;
 IF p_payload ? 'credit_limit' AND p_payload->'credit_limit'<>'null'::jsonb THEN PERFORM finance_private.require_decimal_string(p_payload->'credit_limit',2,false); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':contacts.save:'||p_idempotency_key,0));
 SELECT i.request_hash,i.actor_member_id,i.response_body INTO v_hash,v_existing_actor,v_existing FROM finance.idempotency_requests i WHERE i.organization_id=p_organization_id AND i.operation='contacts.save' AND i.idempotency_key=p_idempotency_key FOR UPDATE;
 IF FOUND THEN IF v_hash<>p_request_hash OR v_existing_actor<>v_actor THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23505'; END IF; RETURN v_existing; END IF;
 IF v_created THEN
  INSERT INTO finance.contacts(id,organization_id,display_name,legal_name,is_customer,is_vendor,email,phone,billing_address,tax_identifiers,payment_terms_days,credit_limit,external_key,is_active)
  VALUES(v_id,p_organization_id,btrim(p_payload->>'display_name'),NULLIF(btrim(p_payload->>'legal_name'),''),COALESCE((p_payload->>'is_customer')::boolean,false),
   COALESCE((p_payload->>'is_vendor')::boolean,false),NULLIF(btrim(p_payload->>'email'),''),NULLIF(btrim(p_payload->>'phone'),''),COALESCE(p_payload->'billing_address','{}'::jsonb),
   COALESCE(p_payload->'tax_identifiers','{}'::jsonb),COALESCE((p_payload->>'payment_terms_days')::integer,0),NULLIF(p_payload->>'credit_limit','')::finance.amount,NULLIF(btrim(p_payload->>'external_key'),''),COALESCE((p_payload->>'is_active')::boolean,true));
  SELECT * INTO v_contact FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=v_id;
 ELSE
  SELECT * INTO v_contact FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contact unavailable' USING ERRCODE='P0002'; END IF;
  IF v_contact.row_version<>p_expected_version THEN RAISE EXCEPTION 'contact version is stale' USING ERRCODE='40001'; END IF;
  UPDATE finance.contacts SET display_name=btrim(p_payload->>'display_name'),legal_name=NULLIF(btrim(p_payload->>'legal_name'),''),
   is_customer=COALESCE((p_payload->>'is_customer')::boolean,false),is_vendor=COALESCE((p_payload->>'is_vendor')::boolean,false),email=NULLIF(btrim(p_payload->>'email'),''),
   phone=NULLIF(btrim(p_payload->>'phone'),''),billing_address=COALESCE(p_payload->'billing_address','{}'::jsonb),tax_identifiers=COALESCE(p_payload->'tax_identifiers','{}'::jsonb),
   payment_terms_days=COALESCE((p_payload->>'payment_terms_days')::integer,0),credit_limit=NULLIF(p_payload->>'credit_limit','')::finance.amount,
   external_key=NULLIF(btrim(p_payload->>'external_key'),''),is_active=COALESCE((p_payload->>'is_active')::boolean,true)
   WHERE organization_id=p_organization_id AND id=v_id RETURNING * INTO v_contact;
 END IF;
 v_result:=jsonb_build_object('id',v_contact.id,'organization_id',v_contact.organization_id,'display_name',v_contact.display_name,'legal_name',v_contact.legal_name,'is_customer',v_contact.is_customer,
  'is_vendor',v_contact.is_vendor,'email',v_contact.email,'phone',v_contact.phone,'billing_address',v_contact.billing_address,'tax_identifiers',v_contact.tax_identifiers,
  'payment_terms_days',v_contact.payment_terms_days,'credit_limit',v_contact.credit_limit::text,'external_key',v_contact.external_key,'is_active',v_contact.is_active,'row_version',v_contact.row_version);
 INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body,resource_contact_id)
  VALUES(p_organization_id,'contacts.save',p_idempotency_key,p_request_hash,v_actor,200,v_result,v_id);
 PERFORM finance_private.write_role_audit(p_organization_id,v_actor,CASE WHEN v_created THEN 'contact.create' ELSE 'contact.update' END,'contact',v_id,p_request_id,
  jsonb_build_object('row_version',v_contact.row_version,'display_name',v_contact.display_name,'is_customer',v_contact.is_customer,'is_vendor',v_contact.is_vendor,'is_active',v_contact.is_active));
 RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.save_contact(uuid,uuid,integer,text,text,text,jsonb) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.save_contact(uuid,uuid,integer,text,text,text,jsonb) TO ams_runtime;

CREATE FUNCTION public.read_contact_directory(p_organization_id uuid,p_scope text,p_search text,p_status text,p_after uuid,p_limit integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_rows jsonb:='[]'::jsonb; v_row record; v_count integer:=0; v_next uuid; v_today date;
BEGIN
 IF p_scope NOT IN ('customer','vendor') OR p_status NOT IN ('active','inactive','overdue','all') OR p_limit NOT BETWEEN 1 AND 100 OR length(COALESCE(p_search,''))>100 THEN RAISE EXCEPTION 'invalid directory filters' USING ERRCODE='22023'; END IF;
 PERFORM finance_private.require_capability(p_organization_id,CASE p_scope WHEN 'customer' THEN 'sales.read' ELSE 'purchases.read' END);
 SELECT (clock_timestamp() AT TIME ZONE o.timezone)::date INTO v_today FROM finance.organizations o WHERE o.id=p_organization_id;
 IF v_today IS NULL THEN RAISE EXCEPTION 'organization unavailable' USING ERRCODE='P0002'; END IF;
 FOR v_row IN SELECT c.id,c.display_name,c.legal_name,c.email,c.phone,c.is_active,c.row_version,
   COALESCE((SELECT sum(finance_private.open_item_balance_at(oi.organization_id,oi.id,v_today,clock_timestamp())) FROM finance.open_items oi WHERE oi.organization_id=c.organization_id AND oi.party_id=c.id AND oi.control_kind=CASE p_scope WHEN 'customer' THEN 'ar' ELSE 'ap' END AND oi.side=CASE p_scope WHEN 'customer' THEN 'debit' ELSE 'credit' END),0)::text AS outstanding,
   COALESCE((SELECT sum(finance_private.open_item_balance_at(oi.organization_id,oi.id,v_today,clock_timestamp())) FROM finance.open_items oi WHERE oi.organization_id=c.organization_id AND oi.party_id=c.id AND oi.control_kind=CASE p_scope WHEN 'customer' THEN 'ar' ELSE 'ap' END AND oi.side=CASE p_scope WHEN 'customer' THEN 'credit' ELSE 'debit' END),0)::text AS available_credit,
   COALESCE((SELECT sum(finance_private.open_item_balance_at(oi.organization_id,oi.id,v_today,clock_timestamp())) FROM finance.open_items oi WHERE oi.organization_id=c.organization_id AND oi.party_id=c.id AND oi.control_kind=CASE p_scope WHEN 'customer' THEN 'customer_advance' ELSE 'vendor_advance' END),0)::text AS advances,
   COALESCE((SELECT sum(finance_private.open_item_balance_at(oi.organization_id,oi.id,v_today,clock_timestamp())) FROM finance.open_items oi WHERE oi.organization_id=c.organization_id AND oi.party_id=c.id AND oi.control_kind=CASE p_scope WHEN 'customer' THEN 'ar' ELSE 'ap' END AND oi.side=CASE p_scope WHEN 'customer' THEN 'debit' ELSE 'credit' END AND oi.due_date<v_today),0)::text AS overdue
  FROM finance.contacts c WHERE c.organization_id=p_organization_id AND CASE p_scope WHEN 'customer' THEN c.is_customer ELSE c.is_vendor END
   AND (p_search IS NULL OR c.display_name ILIKE '%'||p_search||'%' OR COALESCE(c.legal_name,'') ILIKE '%'||p_search||'%' OR COALESCE(c.email,'') ILIKE '%'||p_search||'%' OR COALESCE(c.phone,'') ILIKE '%'||p_search||'%')
   AND (p_after IS NULL OR c.id>p_after) AND (p_status='all' OR (p_status='active' AND c.is_active) OR (p_status='inactive' AND NOT c.is_active) OR (p_status='overdue' AND c.is_active AND EXISTS(SELECT 1 FROM finance.open_items oi WHERE oi.organization_id=c.organization_id AND oi.party_id=c.id AND oi.control_kind=CASE p_scope WHEN 'customer' THEN 'ar' ELSE 'ap' END AND oi.side=CASE p_scope WHEN 'customer' THEN 'debit' ELSE 'credit' END AND oi.due_date<v_today AND finance_private.open_item_balance_at(oi.organization_id,oi.id,v_today,clock_timestamp())>0)))
  ORDER BY c.id LIMIT p_limit+1 LOOP
  v_count:=v_count+1; IF v_count>p_limit THEN v_next:= (v_rows->(p_limit-1)->>'id')::uuid; EXIT; END IF;
  v_rows:=v_rows||jsonb_build_array(jsonb_build_object('id',v_row.id,'display_name',v_row.display_name,'legal_name',v_row.legal_name,'email',v_row.email,'phone',v_row.phone,
   'is_active',v_row.is_active,'row_version',v_row.row_version,'outstanding',v_row.outstanding,'available_credit',v_row.available_credit,'advances',v_row.advances,'overdue',v_row.overdue));
 END LOOP;
 RETURN jsonb_build_object('items',v_rows,'next_cursor',v_next);
END; $$;
REVOKE ALL ON FUNCTION public.read_contact_directory(uuid,text,text,text,uuid,integer) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_contact_directory(uuid,text,text,text,uuid,integer) TO ams_runtime;

CREATE FUNCTION public.read_contact_profile(p_organization_id uuid,p_contact_id uuid,p_scope text,p_cutoff timestamptz,p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_contact finance.contacts%ROWTYPE; v_result jsonb; v_control text; v_side text; v_credit_side text; v_advance text; v_types text[]; v_as_of date;
BEGIN
 IF p_contact_id IS NULL OR p_scope NOT IN ('customer','vendor') OR p_cutoff IS NULL OR NOT isfinite(p_cutoff) OR p_limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid profile request' USING ERRCODE='22023'; END IF;
 PERFORM finance_private.require_capability(p_organization_id,CASE p_scope WHEN 'customer' THEN 'sales.read' ELSE 'purchases.read' END);
 SELECT (p_cutoff AT TIME ZONE o.timezone)::date INTO v_as_of FROM finance.organizations o WHERE o.id=p_organization_id;
 IF v_as_of IS NULL THEN RAISE EXCEPTION 'organization unavailable' USING ERRCODE='P0002'; END IF;
 SELECT * INTO v_contact FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=p_contact_id AND CASE p_scope WHEN 'customer' THEN c.is_customer ELSE c.is_vendor END;
 IF NOT FOUND THEN RAISE EXCEPTION 'contact unavailable' USING ERRCODE='P0002'; END IF;
 v_control:=CASE p_scope WHEN 'customer' THEN 'ar' ELSE 'ap' END;v_side:=CASE p_scope WHEN 'customer' THEN 'debit' ELSE 'credit' END;
 v_credit_side:=CASE p_scope WHEN 'customer' THEN 'credit' ELSE 'debit' END;v_advance:=CASE p_scope WHEN 'customer' THEN 'customer_advance' ELSE 'vendor_advance' END;
 v_types:=CASE p_scope WHEN 'customer' THEN ARRAY['invoice','receipt','customer_credit','customer_refund','customer_advance'] ELSE ARRAY['bill','vendor_credit','vendor_payment','vendor_refund','vendor_advance','paid_expense'] END;
 SELECT jsonb_build_object('contact',jsonb_build_object('id',v_contact.id,'display_name',v_contact.display_name,'legal_name',v_contact.legal_name,'is_customer',v_contact.is_customer,'is_vendor',v_contact.is_vendor,'email',v_contact.email,'phone',v_contact.phone,'external_key',v_contact.external_key,
   'billing_address',v_contact.billing_address,'tax_identifiers',v_contact.tax_identifiers,'payment_terms_days',v_contact.payment_terms_days,'credit_limit',v_contact.credit_limit::text,'is_active',v_contact.is_active,'row_version',v_contact.row_version),
  'as_of',v_as_of,
  'balances',jsonb_build_object('receivable_or_payable',COALESCE((SELECT sum(finance_private.open_item_balance_at(oi.organization_id,oi.id,v_as_of,p_cutoff)) FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.party_id=p_contact_id AND oi.control_kind=v_control AND oi.side=v_side),0)::text,
   'available_credits',COALESCE((SELECT sum(finance_private.open_item_balance_at(oi.organization_id,oi.id,v_as_of,p_cutoff)) FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.party_id=p_contact_id AND oi.control_kind=v_control AND oi.side=v_credit_side),0)::text,
   'advances',COALESCE((SELECT sum(finance_private.open_item_balance_at(oi.organization_id,oi.id,v_as_of,p_cutoff)) FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.party_id=p_contact_id AND oi.control_kind=v_advance),0)::text),
  'documents',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'type',d.document_type,'number',d.document_number,'state',d.state,'date',d.accounting_date,'amount',d.total_amount::text,'description',d.description,
    'supplier_invoice_reference',td.supplier_invoice_key,'duplicate_supplier_reference',CASE WHEN d.document_type='bill' AND NULLIF(btrim(td.supplier_invoice_key),'') IS NOT NULL THEN EXISTS(
      SELECT 1 FROM finance.business_documents other JOIN finance.trade_documents other_td ON other_td.organization_id=other.organization_id AND other_td.document_id=other.id
       WHERE other.organization_id=d.organization_id AND other.party_id=d.party_id AND other.id<>d.id AND other.document_type='bill'
        AND lower(btrim(other_td.supplier_invoice_key))=lower(btrim(td.supplier_invoice_key))) ELSE false END) ORDER BY d.accounting_date DESC,d.id DESC)
   FROM (SELECT d.* FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.party_id=p_contact_id AND d.document_type::text=ANY(v_types) ORDER BY d.accounting_date DESC,d.id DESC LIMIT p_limit) d
    LEFT JOIN finance.trade_documents td ON td.organization_id=d.organization_id AND td.document_id=d.id),'[]'::jsonb),
  'statement',COALESCE((SELECT jsonb_agg(jsonb_build_object('open_item_id',oi.id,'date',oi.issue_date,'due_date',oi.due_date,'reference',oi.reference,'control_kind',oi.control_kind,'side',oi.side,
   'original_amount',oi.original_amount::text,'balance',finance_private.open_item_balance_at(oi.organization_id,oi.id,v_as_of,p_cutoff)::text,'document_number',d.document_number) ORDER BY oi.issue_date,oi.id)
   FROM finance.open_items oi JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
   JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id WHERE oi.organization_id=p_organization_id AND oi.party_id=p_contact_id AND (oi.control_kind=v_control OR oi.control_kind=v_advance) AND oi.issue_date<=v_as_of AND je.state='posted'),'[]'::jsonb),
  'activity',COALESCE((SELECT jsonb_agg(jsonb_build_object('action',e.action,'created_at',e.created_at,'reason',e.reason,'change',e.redacted_change) ORDER BY e.created_at DESC,e.id DESC)
   FROM (SELECT e.* FROM finance.audit_events e WHERE e.organization_id=p_organization_id AND e.entity_type='contact' AND e.entity_id=p_contact_id ORDER BY e.created_at DESC,e.id DESC LIMIT 100) e),'[]'::jsonb)) INTO v_result;
 RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.read_contact_profile(uuid,uuid,text,timestamptz,integer) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_contact_profile(uuid,uuid,text,timestamptz,integer) TO ams_runtime;

NOTIFY pgrst,'reload schema';
