-- US-058: party-scoped statements with dated source movements and settlement evidence.
CREATE FUNCTION public.list_statement_parties(p_organization_id uuid,p_scope text,p_search text DEFAULT NULL,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_permission text;v_items jsonb;v_all jsonb;v_next uuid;
BEGIN
  IF p_scope NOT IN ('customer','vendor') OR length(COALESCE(p_search,''))>100 OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid party selector filters' USING ERRCODE='22023'; END IF;
  v_permission:=CASE p_scope WHEN 'customer' THEN 'sales.read' ELSE 'purchases.read' END;
  IF NOT finance_private.has_permission(p_organization_id,'dues.read') AND NOT finance_private.has_permission(p_organization_id,v_permission) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',x.id,'display_name',x.display_name,'legal_name',x.legal_name,'is_active',x.is_active) ORDER BY x.id),'[]'::jsonb),
    (array_agg(x.id ORDER BY x.id))[p_limit+1]
  INTO v_all,v_next FROM (SELECT c.id,c.display_name,c.legal_name,c.is_active FROM finance.contacts c
    WHERE c.organization_id=p_organization_id AND CASE p_scope WHEN 'customer' THEN c.is_customer ELSE c.is_vendor END
      AND (p_search IS NULL OR c.display_name ILIKE '%'||p_search||'%' OR COALESCE(c.legal_name,'') ILIKE '%'||p_search||'%')
      AND (p_after IS NULL OR c.id>p_after) ORDER BY c.id LIMIT p_limit+1) x;
  SELECT COALESCE(jsonb_agg(value ORDER BY ordinality),'[]'::jsonb) INTO v_items FROM jsonb_array_elements(COALESCE(v_all,'[]'::jsonb)) WITH ORDINALITY AS entry(value,ordinality) WHERE ordinality<=p_limit;
  RETURN jsonb_build_object('items',v_items,'next_cursor',v_next);
END; $$;
REVOKE ALL ON FUNCTION public.list_statement_parties(uuid,text,text,uuid,integer) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.list_statement_parties(uuid,text,text,uuid,integer) TO ams_runtime;

CREATE FUNCTION public.read_party_statement_snapshot(p_organization_id uuid,p_scope text,p_party_id uuid,p_from date,p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_contact finance.contacts%ROWTYPE;v_now timestamptz:=transaction_timestamp();v_trade text;v_advance text;v_control uuid;v_advance_account uuid;v_side text;v_data jsonb;v_org finance.organizations%ROWTYPE;
BEGIN
  IF p_scope NOT IN ('customer','vendor') OR p_party_id IS NULL OR p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_from>p_to THEN
    RAISE EXCEPTION 'invalid party statement filters' USING ERRCODE='22023'; END IF;
  IF NOT finance_private.has_permission(p_organization_id,'dues.read') AND NOT finance_private.has_permission(p_organization_id,CASE p_scope WHEN 'customer' THEN 'sales.read' ELSE 'purchases.read' END) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_org FROM finance.organizations o WHERE o.id=p_organization_id;
  SELECT * INTO v_contact FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=p_party_id
    AND CASE p_scope WHEN 'customer' THEN c.is_customer ELSE c.is_vendor END;
  IF NOT FOUND THEN RAISE EXCEPTION 'party unavailable' USING ERRCODE='P0002'; END IF;
  v_trade:=CASE p_scope WHEN 'customer' THEN 'ar' ELSE 'ap' END;
  v_advance:=CASE p_scope WHEN 'customer' THEN 'customer_advance' ELSE 'vendor_advance' END;
  v_side:=CASE p_scope WHEN 'customer' THEN 'debit' ELSE 'credit' END;
  SELECT m.account_id INTO v_control FROM finance.account_mappings m WHERE m.organization_id=p_organization_id AND m.mapping_key=v_trade;
  SELECT m.account_id INTO v_advance_account FROM finance.account_mappings m WHERE m.organization_id=p_organization_id AND m.mapping_key=v_advance;
  IF v_control IS NULL OR v_advance_account IS NULL THEN RAISE EXCEPTION 'party control mapping unavailable' USING ERRCODE='P0002'; END IF;
  WITH item_base AS (
    SELECT oi.id,oi.journal_line_id,je.source_document_id,d.document_number,d.document_type::text AS document_type,oi.control_kind,oi.side,oi.reference,
      oi.issue_date,oi.due_date,oi.original_amount::numeric AS original_amount,
      CASE WHEN (oi.control_kind=v_trade AND oi.side=v_side) OR (oi.control_kind=v_advance AND oi.side=CASE p_scope WHEN 'customer' THEN 'credit' ELSE 'debit' END)
        THEN oi.original_amount::numeric ELSE -oi.original_amount::numeric END AS balance_effect
    FROM finance.open_items oi JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted' AND je.posted_at<=v_now
    JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id AND d.state='posted'
    WHERE oi.organization_id=p_organization_id AND oi.party_id=p_party_id AND oi.control_kind IN (v_trade,v_advance) AND oi.created_at<=v_now
  ), openings AS (
    SELECT kind,COALESCE(sum(finance_private.open_item_balance_at(p_organization_id,i.id,p_from-1,v_now)*
      CASE WHEN i.balance_effect>0 THEN 1 ELSE -1 END),0)::numeric AS amount
    FROM (VALUES(v_trade),(v_advance)) kinds(kind) LEFT JOIN item_base i ON i.control_kind=kinds.kind GROUP BY kind
  ), closings AS (
    SELECT kind,COALESCE(sum(finance_private.open_item_balance_at(p_organization_id,i.id,p_to,v_now)*
      CASE WHEN i.balance_effect>0 THEN 1 ELSE -1 END),0)::numeric AS amount
    FROM (VALUES(v_trade),(v_advance)) kinds(kind) LEFT JOIN item_base i ON i.control_kind=kinds.kind GROUP BY kind
  ), source_events AS (
    SELECT i.id AS event_id,i.issue_date AS event_date,'source'::text AS event_type,i.control_kind,
      i.document_type,i.source_document_id,i.document_number,i.reference,NULL::uuid AS related_document_id,NULL::text AS related_document,NULL::text AS detail,
      i.balance_effect AS balance_effect
    FROM item_base i WHERE i.issue_date BETWEEN p_from AND p_to
  ), allocation_events AS (
    SELECT a.id AS event_id,a.effective_date AS event_date,'allocation'::text AS event_type,ditem.control_kind,
      'allocation'::text AS document_type,COALESCE(a.source_document_id,other_doc.id) AS source_document_id,COALESCE(source.document_number,other_doc.document_number) AS document_number,
      COALESCE(source.document_number,ditem.reference) AS reference,other_doc.id AS related_document_id,other_doc.document_number AS related_document,
      'Applied BDT '||a.amount::text AS detail,0::numeric AS balance_effect
    FROM finance.settlement_allocations a
    JOIN finance.open_items ditem ON ditem.organization_id=a.organization_id AND ditem.id=a.debit_open_item_id AND ditem.organization_id=p_organization_id AND ditem.party_id=p_party_id
    JOIN finance.open_items citem ON citem.organization_id=a.organization_id AND citem.id=a.credit_open_item_id
    JOIN finance.business_documents other_doc ON other_doc.organization_id=citem.organization_id
      AND other_doc.id=(SELECT je.source_document_id FROM finance.journal_lines jl JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id WHERE jl.organization_id=citem.organization_id AND jl.id=citem.journal_line_id)
    LEFT JOIN finance.business_documents source ON source.organization_id=a.organization_id AND source.id=a.source_document_id
    WHERE a.organization_id=p_organization_id AND ditem.control_kind IN (v_trade,v_advance) AND citem.party_id=p_party_id AND a.created_at<=v_now AND a.effective_date BETWEEN p_from AND p_to
    UNION ALL
    SELECT r.id,r.effective_date,'allocation_reversal',ditem.control_kind,'allocation_reversal'::text,
      COALESCE(a.source_document_id,other_doc.id),COALESCE(source.document_number,other_doc.document_number),ditem.reference,other_doc.id,other_doc.document_number,r.reason,0::numeric
    FROM finance.allocation_reversals r JOIN finance.settlement_allocations a ON a.organization_id=r.organization_id AND a.id=r.allocation_id
    JOIN finance.open_items ditem ON ditem.organization_id=a.organization_id AND ditem.id=a.debit_open_item_id AND ditem.organization_id=p_organization_id AND ditem.party_id=p_party_id
    JOIN finance.open_items citem ON citem.organization_id=a.organization_id AND citem.id=a.credit_open_item_id
    JOIN finance.business_documents other_doc ON other_doc.organization_id=citem.organization_id
      AND other_doc.id=(SELECT je.source_document_id FROM finance.journal_lines jl JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id WHERE jl.organization_id=citem.organization_id AND jl.id=citem.journal_line_id)
    LEFT JOIN finance.business_documents source ON source.organization_id=a.organization_id AND source.id=a.source_document_id
    WHERE r.organization_id=p_organization_id AND ditem.control_kind IN (v_trade,v_advance) AND citem.party_id=p_party_id AND r.created_at<=v_now AND r.effective_date BETWEEN p_from AND p_to
  ), events AS (
    SELECT * FROM source_events UNION ALL SELECT * FROM allocation_events
  ), running AS (
    SELECT e.*,(o.amount+sum(e.balance_effect) OVER(PARTITION BY e.control_kind ORDER BY e.event_date,e.event_type,e.event_id ROWS UNBOUNDED PRECEDING))::numeric AS running_balance
    FROM events e JOIN openings o ON o.kind=e.control_kind
  ), event_json AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('event_id',event_id,'date',event_date,'event_type',event_type,'control_kind',control_kind,
      'document_type',document_type,'document_number',document_number,'reference',reference,'related_document',related_document,'detail',detail,
      'source_document_id',source_document_id,'related_document_id',related_document_id,
      'balance_effect',balance_effect::text,'running_balance',running_balance::text) ORDER BY event_date,event_type,event_id),'[]'::jsonb) AS rows FROM running
  ), ledger AS (
    SELECT mapping.kind,COALESCE(sum(CASE WHEN je.id IS NOT NULL AND d.id IS NOT NULL THEN jl.debit-jl.credit ELSE 0 END),0)::numeric AS debit_balance
    FROM (VALUES(v_trade,v_control),(v_advance,v_advance_account)) mapping(kind,account_id)
    LEFT JOIN finance.journal_lines jl ON jl.organization_id=p_organization_id AND jl.account_id=mapping.account_id AND jl.party_id=p_party_id
    LEFT JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted' AND je.accounting_date<=p_to AND je.posted_at<=v_now
    LEFT JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id AND d.state='posted'
    GROUP BY mapping.kind
  )
  SELECT jsonb_build_object('scope',p_scope,'party',jsonb_build_object('id',v_contact.id,'name',v_contact.display_name,'email',v_contact.email),
    'from',p_from,'to',p_to,'opening',jsonb_build_object('trade',(SELECT amount FROM openings WHERE kind=v_trade)::text,'advances',(SELECT amount FROM openings WHERE kind=v_advance)::text),
    'movements',jsonb_build_object('trade',COALESCE((SELECT sum(balance_effect) FROM events WHERE control_kind=v_trade),0)::text,'advances',COALESCE((SELECT sum(balance_effect) FROM events WHERE control_kind=v_advance),0)::text),
    'closing',jsonb_build_object('trade',(SELECT amount FROM closings WHERE kind=v_trade)::text,'advances',(SELECT amount FROM closings WHERE kind=v_advance)::text),
    'control_bridge',jsonb_build_object('trade_ledger',CASE p_scope WHEN 'customer' THEN (SELECT debit_balance FROM ledger WHERE kind=v_trade)::text ELSE (-(SELECT debit_balance FROM ledger WHERE kind=v_trade))::text END,
      'trade_difference',CASE p_scope WHEN 'customer' THEN ((SELECT debit_balance FROM ledger WHERE kind=v_trade)-(SELECT amount FROM closings WHERE kind=v_trade))::text ELSE (-(SELECT debit_balance FROM ledger WHERE kind=v_trade)-(SELECT amount FROM closings WHERE kind=v_trade))::text END,
      'advance_ledger',CASE p_scope WHEN 'customer' THEN (-(SELECT debit_balance FROM ledger WHERE kind=v_advance))::text ELSE (SELECT debit_balance FROM ledger WHERE kind=v_advance)::text END,
      'advance_difference',CASE p_scope WHEN 'customer' THEN (-(SELECT debit_balance FROM ledger WHERE kind=v_advance)-(SELECT amount FROM closings WHERE kind=v_advance))::text ELSE ((SELECT debit_balance FROM ledger WHERE kind=v_advance)-(SELECT amount FROM closings WHERE kind=v_advance))::text END),
    'events',(SELECT rows FROM event_json),'cutoff_at',v_now,'timezone',v_org.timezone)
  INTO v_data;
  RETURN jsonb_build_object('snapshot_id',gen_random_uuid(),'report_type',CASE p_scope WHEN 'customer' THEN 'customer_statement' ELSE 'vendor_statement' END,
    'company',jsonb_build_object('id',v_org.id,'name',v_org.name,'timezone',v_org.timezone),'filters',jsonb_build_object('scope',p_scope,'party_id',p_party_id,'from',p_from,'to',p_to),
    'generated_at',v_now,'ledger_cutoff_at',v_now,'template_version','v1.0','status','posted','provisional',false,'data',v_data);
END; $$;
REVOKE ALL ON FUNCTION public.read_party_statement_snapshot(uuid,text,uuid,date,date) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_party_statement_snapshot(uuid,text,uuid,date,date) TO ams_runtime;
NOTIFY pgrst,'reload schema';
