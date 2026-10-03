-- US-066: capability-scoped, stable audit search with recursively redacted changes.
CREATE FUNCTION finance_private.redact_audit_value(p_value jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_out jsonb; v_item record;
BEGIN
  IF jsonb_typeof(p_value)='object' THEN
    v_out:='{}'::jsonb;
    FOR v_item IN SELECT key,value FROM jsonb_each(p_value) LOOP
      IF v_item.key ~* '(password|secret|token|credential|authorization|cookie|attachment|file[_-]?content|other[_-]?organization|private[_-]?key|access[_-]?key)' THEN CONTINUE; END IF;
      v_out:=v_out||jsonb_build_object(v_item.key,finance_private.redact_audit_value(v_item.value));
    END LOOP;
    RETURN v_out;
  ELSIF jsonb_typeof(p_value)='array' THEN
    SELECT COALESCE(jsonb_agg(finance_private.redact_audit_value(value)),'[]'::jsonb) INTO v_out FROM jsonb_array_elements(p_value);
    RETURN v_out;
  END IF;
  RETURN p_value;
END $$;
REVOKE ALL ON FUNCTION finance_private.redact_audit_value(jsonb) FROM PUBLIC,ams_runtime;

CREATE FUNCTION public.search_audit_events(
  p_organization_id uuid,p_actor_member_id uuid DEFAULT NULL,p_from timestamptz DEFAULT NULL,p_to timestamptz DEFAULT NULL,
  p_entity_type text DEFAULT NULL,p_entity_id uuid DEFAULT NULL,p_action text DEFAULT NULL,
  p_before_created_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit integer DEFAULT 50
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_rows jsonb; v_has_more boolean;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'audit.read');
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR (p_before_created_at IS NULL)<>(p_before_id IS NULL)
    OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from>p_to)
    OR (p_entity_type IS NOT NULL AND length(p_entity_type)>80)
    OR (p_action IS NOT NULL AND length(p_action)>120) THEN
    RAISE EXCEPTION 'invalid audit search filters' USING ERRCODE='22023';
  END IF;
  -- Never return details for a module the caller cannot read, even when they have audit.read.
  WITH filtered AS (
    SELECT ae.* FROM finance.audit_events ae
    WHERE ae.organization_id=p_organization_id
      AND (p_actor_member_id IS NULL OR ae.actor_member_id=p_actor_member_id)
      AND (p_from IS NULL OR ae.created_at>=p_from)
      AND (p_to IS NULL OR ae.created_at<=p_to)
      AND (p_entity_type IS NULL OR ae.entity_type=p_entity_type)
      AND (p_entity_id IS NULL OR ae.entity_id=p_entity_id OR ae.document_id=p_entity_id)
      AND (p_action IS NULL OR strpos(lower(ae.action),lower(p_action))>0)
      AND (p_before_created_at IS NULL OR (ae.created_at,ae.id)<(p_before_created_at,p_before_id))
      AND CASE
        WHEN ae.entity_type='business_document' THEN finance_private.can_read_document(p_organization_id,COALESCE(ae.document_id,ae.entity_id))
        WHEN ae.entity_type IN ('settlement_allocation','allocation_reversal') THEN finance_private.has_permission(p_organization_id,'dues.read') OR finance_private.has_permission(p_organization_id,'dues.allocate')
        WHEN ae.entity_type IN ('contact','contact_import') THEN finance_private.has_permission(p_organization_id,'contacts.read')
        WHEN ae.entity_type IN ('catalog_item','cost_center') THEN finance_private.has_permission(p_organization_id,'catalog.read')
        WHEN ae.entity_type IN ('account','account_mapping','tax_code','accounting_period','fiscal_year') THEN finance_private.has_permission(p_organization_id,'accounting.read') OR finance_private.has_permission(p_organization_id,'ledger.read')
        WHEN ae.entity_type IN ('cash_account','bank_reconciliation','reconciliation_match','statement_import') THEN finance_private.has_permission(p_organization_id,'banking.read')
        WHEN ae.entity_type IN ('role','member','invitation','approval_policy') THEN finance_private.has_permission(p_organization_id,'users.read') OR finance_private.has_permission(p_organization_id,'approvals.read')
        ELSE finance_private.has_permission(p_organization_id,'company.read')
      END
  ), page AS (
    SELECT * FROM filtered ORDER BY created_at DESC,id DESC LIMIT p_limit+1
  ), marked AS (
    SELECT page.*,row_number() OVER(ORDER BY created_at DESC,id DESC) AS rn FROM page
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',id,'created_at',created_at,'actor_member_id',actor_member_id,'actor_kind',actor_kind,
    'action',action,'entity_type',entity_type,'entity_id',entity_id,'document_id',document_id,
    'request_id',request_id,'reason',CASE WHEN reason ~* '(password|secret|token|credential|authorization|cookie)[[:space:]]*[:=]' THEN '[redacted]' ELSE reason END,
    'change',finance_private.redact_audit_value(redacted_change)
  ) ORDER BY created_at DESC,id DESC) FILTER(WHERE rn<=p_limit),'[]'::jsonb),COALESCE(bool_or(rn>p_limit),false)
  INTO v_rows,v_has_more FROM marked;
  RETURN jsonb_build_object('events',v_rows,'has_more',v_has_more,'limit',p_limit,
    'next_created_at',CASE WHEN v_has_more THEN v_rows->-1->>'created_at' END,
    'next_id',CASE WHEN v_has_more THEN v_rows->-1->>'id' END);
END $$;
REVOKE ALL ON FUNCTION public.search_audit_events(uuid,uuid,timestamptz,timestamptz,text,uuid,text,timestamptz,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_audit_events(uuid,uuid,timestamptz,timestamptz,text,uuid,text,timestamptz,uuid,integer) TO ams_runtime;
NOTIFY pgrst,'reload schema';
