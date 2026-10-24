-- A posted-journal register must include source journals, not just manual JVs.
DO $migration$
DECLARE body text;manual_filter text;
BEGIN
 SELECT pg_get_functiondef('public.read_journal_register(uuid,text,date,date,integer)'::regprocedure) INTO body;
 manual_filter:=$old$    AND (d.document_type='manual_journal' OR (d.document_type='reversal' AND EXISTS(SELECT 1 FROM finance.business_documents original
      WHERE original.organization_id=d.organization_id AND original.id=d.reversal_of_document_id AND original.document_type='manual_journal')))
$old$;
 IF position(manual_filter IN body)=0 THEN RAISE EXCEPTION 'manual-only journal filter anchor changed'; END IF;
 EXECUTE replace(body,manual_filter,'');
END $migration$;
NOTIFY pgrst,'reload schema';
