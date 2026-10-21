-- Opening batches can contain many original documents. Show the selected
-- immutable item references to reviewers, rather than only the batch number.
DO $$
DECLARE f text; anchor text:='''amount'',s.amount::text,''document_version'',s.document_version,';
BEGIN
  f:=pg_get_functiondef('public.read_financial_document(uuid,uuid)'::regprocedure);
  IF (length(f)-length(replace(f,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'linked reference read anchor missing'; END IF;
  EXECUTE replace(f,anchor,$new$'source_reference',soi.reference,'target_reference',toi.reference,
      'amount',s.amount::text,'document_version',s.document_version,$new$);
END $$;
