-- Preserve the same complete issued contact snapshot as other financial drafts.
-- This affects future saves only; previously posted snapshots are immutable.
DO $$
DECLARE f text; anchor text:='jsonb_build_object(''display_name'',c.display_name,''legal_name'',c.legal_name)';
BEGIN
  f:=pg_get_functiondef('public.save_linked_settlement_draft(uuid,uuid,integer,text,text,text,jsonb)'::regprocedure);
  IF (length(f)-length(replace(f,anchor,'')))/length(anchor)<>2 THEN RAISE EXCEPTION 'expected both linked party snapshot anchors'; END IF;
  EXECUTE replace(f,anchor,$new$jsonb_build_object('display_name',c.display_name,'legal_name',c.legal_name,
    'email',c.email,'phone',c.phone,'billing_address',c.billing_address,'tax_identifiers',c.tax_identifiers)$new$);
END $$;
