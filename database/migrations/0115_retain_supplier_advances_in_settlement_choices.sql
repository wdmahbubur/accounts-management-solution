-- Preserve ordinary supplier advances alongside imported opening items.
DO $$
DECLARE f text; anchor text:=$old$d.document_type IN ('vendor_credit','vendor_payment','opening_balance')$old$;
BEGIN
  f:=pg_get_functiondef('public.read_linked_settlement_options(uuid,date)'::regprocedure);
  IF (length(f)-length(replace(f,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'supplier choice compatibility anchor missing'; END IF;
  EXECUTE replace(f,anchor,$new$d.document_type IN ('vendor_advance','vendor_credit','vendor_payment','opening_balance')$new$);
END $$;
