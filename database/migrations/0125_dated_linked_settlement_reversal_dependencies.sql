-- #175: a future refund/application reversal must not release an earlier source.
-- Preserve immutable linked history and the existing period/item lock protocol.
DO $patch$
DECLARE signature regprocedure:='public.reverse_posted_document(uuid,uuid,date,text,text,text,text)'::regprocedure;
  definition text; old text; replacement text;
BEGIN
  old:=$needle$AND r.reversal_of_document_id=linked.id)) THEN$needle$;
  replacement:=$replacement$AND r.reversal_of_document_id=linked.id AND r.state='posted'
       AND r.accounting_date<=p_reversal_date)) THEN$replacement$;
  definition:=pg_catalog.pg_get_functiondef(signature);
  IF length(definition)-length(replace(definition,old,''))<>length(old) THEN
    RAISE EXCEPTION 'expected one linked-settlement reversal dependency anchor in %',signature;
  END IF;
  EXECUTE replace(definition,old,replacement);
END;
$patch$;
NOTIFY pgrst,'reload schema';
