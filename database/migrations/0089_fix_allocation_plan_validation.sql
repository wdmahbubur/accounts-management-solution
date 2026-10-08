-- Allocation rows contain exactly two named fields. PostgreSQL provides JSONB
-- key deletion, but no jsonb_object_length() function. Keep both required-key
-- checks and reject any remaining keys using supported operators.
DO $$
DECLARE
  v_signature regprocedure;
  v_definition text;
  v_old text := 'jsonb_object_length(v_plan)<>2';
  v_new text := $replacement$(v_plan - 'target_open_item_id' - 'amount') <> '{}'::jsonb$replacement$;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.save_financial_document(uuid,uuid,integer,text,text,text,jsonb)'::regprocedure,
    'public.save_document_allocation_plan(uuid,uuid,integer,text,text,text,jsonb)'::regprocedure
  ] LOOP
    v_definition := pg_catalog.pg_get_functiondef(v_signature);
    IF position(v_old IN v_definition)=0 OR
       length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) THEN
      RAISE EXCEPTION 'expected a single allocation key-count guard in %',v_signature;
    END IF;
    EXECUTE replace(v_definition,v_old,v_new);
  END LOOP;
END $$;

-- The dedicated allocation editor also returns TABLE(document_id, state, ...).
-- Qualify SQL columns so its output variables cannot shadow the source columns.
DO $$
DECLARE
  v_signature regprocedure := 'public.save_document_allocation_plan(uuid,uuid,integer,text,text,text,jsonb)'::regprocedure;
  v_definition text := pg_catalog.pg_get_functiondef(v_signature);
  v_old text;
  v_new text;
BEGIN
  FOR v_old,v_new IN
    SELECT * FROM (VALUES
      ('UPDATE finance.approval_requests SET state=''superseded'' WHERE organization_id=p_organization_id AND document_id=p_document_id AND state IN (''pending'',''approved'');',
       'UPDATE finance.approval_requests AS ar SET state=''superseded'' WHERE ar.organization_id=p_organization_id AND ar.document_id=p_document_id AND ar.state IN (''pending'',''approved'');'),
      ('DELETE FROM finance.document_allocation_plans WHERE organization_id=p_organization_id AND document_id=p_document_id;',
       'DELETE FROM finance.document_allocation_plans AS ap WHERE ap.organization_id=p_organization_id AND ap.document_id=p_document_id;')
    ) AS replacements(old_text,new_text)
  LOOP
    IF position(v_old IN v_definition)=0 OR
       length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) THEN
      RAISE EXCEPTION 'expected a single ambiguous allocation-save clause: %',v_old;
    END IF;
    v_definition := replace(v_definition,v_old,v_new);
  END LOOP;
  EXECUTE v_definition;
END $$;

COMMENT ON FUNCTION public.save_document_allocation_plan(uuid,uuid,integer,text,text,text,jsonb)
IS 'Saves a versioned allocation plan with exact JSON fields, qualified source columns, and unchanged authorization and settlement guards.';
