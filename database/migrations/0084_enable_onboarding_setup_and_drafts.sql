-- Onboarding is a real company state, not a read-only state. Owners must be
-- able to finish accounting setup and prepare unposted drafts before the
-- company is activated. Posting remains guarded by lock_accounting_date().

CREATE OR REPLACE FUNCTION finance_private.require_chart_write(p_organization_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member_id uuid; v_status text;
BEGIN
  v_member_id:=finance_private.require_capability(p_organization_id,'accounting.read');
  PERFORM finance_private.require_capability(p_organization_id,'journal.write');
  PERFORM finance_private.require_recent_auth();
  SELECT o.status INTO v_status FROM finance.organizations o WHERE o.id=p_organization_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'organization not found' USING ERRCODE='P0002'; END IF;
  IF v_status NOT IN ('active','onboarding') THEN RAISE EXCEPTION 'organization is not writable' USING ERRCODE='42501'; END IF;
  RETURN v_member_id;
END $$;

CREATE OR REPLACE FUNCTION finance_private.require_catalog_write(p_organization_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_status text;
BEGIN
 v_actor:=finance_private.require_capability(p_organization_id,'catalog.write');
 PERFORM finance_private.require_recent_auth();
 SELECT o.status INTO v_status FROM finance.organizations o WHERE o.id=p_organization_id FOR UPDATE;
 IF v_status IS DISTINCT FROM 'active' AND v_status IS DISTINCT FROM 'onboarding' THEN
   RAISE EXCEPTION 'company is not writable' USING ERRCODE='42501';
 END IF;
 RETURN v_actor;
END; $$;

-- Change only the organization-state predicate, and fail if a future schema
-- definition no longer matches the reviewed function body.
DO $$
DECLARE
  v_definition text;
  v_updated text;
  v_signature regprocedure;
  v_old text;
  v_new text;
BEGIN
  FOR v_signature, v_old, v_new IN
    SELECT 'public.create_tax_code_version(uuid,text,text,text,text,finance.rate,text,uuid,uuid,text,date,date,integer)'::regprocedure,
      'IF NOT FOUND OR v_status<>''active'' THEN RAISE EXCEPTION ''company unavailable'' USING ERRCODE=''42501''; END IF;',
      'IF NOT FOUND OR v_status NOT IN (''active'',''onboarding'') THEN RAISE EXCEPTION ''company unavailable'' USING ERRCODE=''42501''; END IF;'
    UNION ALL
    SELECT 'public.archive_tax_code_version(uuid,uuid,integer,text,text)'::regprocedure,
      'IF NOT FOUND OR v_status<>''active'' THEN RAISE EXCEPTION ''company unavailable'' USING ERRCODE=''42501''; END IF;',
      'IF NOT FOUND OR v_status NOT IN (''active'',''onboarding'') THEN RAISE EXCEPTION ''company unavailable'' USING ERRCODE=''42501''; END IF;'
    UNION ALL
    SELECT 'public.save_financial_document(uuid,uuid,integer,text,text,text,jsonb)'::regprocedure,
      'IF NOT FOUND OR v_permission<>''active'' THEN RAISE EXCEPTION ''company is unavailable for editing'' USING ERRCODE=''42501''; END IF;',
      'IF NOT FOUND OR v_permission NOT IN (''active'',''onboarding'') THEN RAISE EXCEPTION ''company is unavailable for editing'' USING ERRCODE=''42501''; END IF;'
  LOOP
    v_definition := pg_catalog.pg_get_functiondef(v_signature);
    IF position(v_old IN v_definition)=0 OR
       length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) THEN
      RAISE EXCEPTION 'expected single onboarding status guard in %',v_signature;
    END IF;
    v_updated := replace(v_definition,v_old,v_new);
    EXECUTE v_updated;
  END LOOP;
END $$;

COMMENT ON FUNCTION finance_private.require_chart_write(uuid)
IS 'Allows authorized chart setup while onboarding; ledger posting remains separately gated.';
COMMENT ON FUNCTION finance_private.require_catalog_write(uuid)
IS 'Allows authorized catalog setup while onboarding; ledger posting remains separately gated.';
