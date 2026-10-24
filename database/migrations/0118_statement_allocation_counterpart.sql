-- The allocation source is normally the receipt/payment. Its related document
-- must be the opposite source item, not the same receipt a second time.
DO $migration$
DECLARE body text;old_join text;new_join text;
BEGIN
 SELECT pg_get_functiondef('public.read_party_statement_snapshot(uuid,text,uuid,date,date)'::regprocedure) INTO body;
 old_join:=$old$JOIN finance.business_documents other_doc ON other_doc.organization_id=citem.organization_id
      AND other_doc.id=(SELECT je.source_document_id FROM finance.journal_lines jl JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id WHERE jl.organization_id=citem.organization_id AND jl.id=citem.journal_line_id)$old$;
 new_join:=$new$JOIN finance.business_documents debit_doc ON debit_doc.organization_id=ditem.organization_id
      AND debit_doc.id=(SELECT je.source_document_id FROM finance.journal_lines jl JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id WHERE jl.organization_id=ditem.organization_id AND jl.id=ditem.journal_line_id)
    JOIN finance.business_documents credit_doc ON credit_doc.organization_id=citem.organization_id
      AND credit_doc.id=(SELECT je.source_document_id FROM finance.journal_lines jl JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id WHERE jl.organization_id=citem.organization_id AND jl.id=citem.journal_line_id)
    JOIN finance.business_documents other_doc ON other_doc.organization_id=a.organization_id
      AND other_doc.id=CASE WHEN a.source_document_id=debit_doc.id THEN credit_doc.id ELSE debit_doc.id END$new$;
 IF (length(body)-length(replace(body,old_join,'')))/length(old_join)<>2
   OR position('COALESCE(a.source_document_id,other_doc.id)' IN body)=0
   OR position('COALESCE(source.document_number,other_doc.document_number)' IN body)=0 THEN
   RAISE EXCEPTION 'statement allocation anchors changed';
 END IF;
 body:=replace(body,old_join,new_join);
 body:=replace(body,'COALESCE(a.source_document_id,other_doc.id)','COALESCE(a.source_document_id,credit_doc.id)');
 body:=replace(body,'COALESCE(source.document_number,other_doc.document_number)','COALESCE(source.document_number,credit_doc.document_number)');
 EXECUTE body;
END $migration$;
NOTIFY pgrst,'reload schema';
