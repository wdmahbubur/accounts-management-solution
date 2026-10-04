-- save_financial_document returns TABLE(document_id, state, net_amount, ...).
-- Several SQL statements also reference columns named document_id without a
-- table alias. PL/pgSQL therefore sees an output-variable/column ambiguity.
-- Resolve ambiguous SQL names to their table columns; intentional PL/pgSQL
-- locals in this function are v_-prefixed.
DO $$
DECLARE
  v_signature regprocedure := 'public.save_financial_document(uuid,uuid,integer,text,text,text,jsonb)'::regprocedure;
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(v_signature);
  FOR v_old,v_new IN
    SELECT * FROM (VALUES
      ('UPDATE finance.approval_requests SET state=''superseded'' WHERE organization_id=p_organization_id AND document_id=v_id AND state IN (''pending'',''approved'');',
       'UPDATE finance.approval_requests AS ar SET state=''superseded'' WHERE ar.organization_id=p_organization_id AND ar.document_id=v_id AND ar.state IN (''pending'',''approved'');'),
      ('DELETE FROM finance.trade_documents WHERE organization_id=p_organization_id AND document_id=v_id;',
       'DELETE FROM finance.trade_documents AS td WHERE td.organization_id=p_organization_id AND td.document_id=v_id;'),
      ('DELETE FROM finance.money_movements WHERE organization_id=p_organization_id AND document_id=v_id;',
       'DELETE FROM finance.money_movements AS mm WHERE mm.organization_id=p_organization_id AND mm.document_id=v_id;'),
      ('DELETE FROM finance.transfers WHERE organization_id=p_organization_id AND document_id=v_id;',
       'DELETE FROM finance.transfers AS tr WHERE tr.organization_id=p_organization_id AND tr.document_id=v_id;'),
      ('DELETE FROM finance.manual_journal_rows WHERE organization_id=p_organization_id AND document_id=v_id;',
       'DELETE FROM finance.manual_journal_rows AS jr WHERE jr.organization_id=p_organization_id AND jr.document_id=v_id;'),
      ('DELETE FROM finance.document_allocation_plans WHERE organization_id=p_organization_id AND document_id=v_id;',
       'DELETE FROM finance.document_allocation_plans AS ap WHERE ap.organization_id=p_organization_id AND ap.document_id=v_id;'),
      ('UPDATE finance.document_lines SET line_no=line_no+1000 WHERE organization_id=p_organization_id AND document_id=v_id;',
       'UPDATE finance.document_lines AS dl SET line_no=dl.line_no+1000 WHERE dl.organization_id=p_organization_id AND dl.document_id=v_id;'),
      ('WHERE organization_id=p_organization_id AND document_id=v_id AND id=v_line_id;',
       'WHERE organization_id=p_organization_id AND finance.document_lines.document_id=v_id AND id=v_line_id;')
    ) AS replacements(old_text,new_text)
  LOOP
    IF position(v_old IN v_definition)=0 OR
       length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) THEN
      RAISE EXCEPTION 'expected a single ambiguous draft-save clause: %',v_old;
    END IF;
    v_definition := replace(v_definition,v_old,v_new);
  END LOOP;
  EXECUTE v_definition;
END $$;

COMMENT ON FUNCTION public.save_financial_document(uuid,uuid,integer,text,text,text,jsonb)
IS 'Saves a typed financial source as a draft with SQL column references resolved ahead of same-named output fields.';
