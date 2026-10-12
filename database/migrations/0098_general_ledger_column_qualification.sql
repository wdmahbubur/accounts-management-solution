-- RETURNS TABLE exposes movement/date/journal/line output variables to PL/pgSQL.
-- Qualify the two CTE references so PostgreSQL resolves their table columns.
-- Preserve the signature, privileges, security settings, exact arithmetic,
-- filters and running-balance calculation before keyset pagination.
DO $patch$
DECLARE
  v_signature regprocedure := 'public.read_general_ledger(uuid,uuid,date,date,text,uuid,date,uuid,integer,integer)'::regprocedure;
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(v_signature);
  FOR v_old,v_new IN
    SELECT * FROM (VALUES
      ('sum(movement) OVER(ORDER BY accounting_date,journal_id,line_no ROWS UNBOUNDED PRECEDING)',
       'sum(base.movement) OVER(ORDER BY base.accounting_date,base.journal_id,base.line_no ROWS UNBOUNDED PRECEDING)'),
      ('ORDER BY accounting_date,journal_id,line_no LIMIT p_limit)',
       'ORDER BY r.accounting_date,r.journal_id,r.line_no LIMIT p_limit)')
    ) AS replacements(old_text,new_text)
  LOOP
    IF position(v_old IN v_definition)=0 OR
       length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) THEN
      RAISE EXCEPTION 'expected one general-ledger clause in %: %',v_signature,v_old;
    END IF;
    v_definition := replace(v_definition,v_old,v_new);
  END LOOP;
  EXECUTE v_definition;
END;
$patch$;
