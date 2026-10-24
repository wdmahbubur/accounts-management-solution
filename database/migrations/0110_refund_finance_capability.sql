-- Refunds require finance cash authority in addition to sales/purchase scope.
-- The billing template can collect invoices but cannot return company funds.
DO $$
DECLARE signature regprocedure; f text; anchor text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.save_linked_settlement_draft(uuid,uuid,integer,text,text,text,jsonb)'::regprocedure,
    'finance_private.post_linked_settlement(uuid,uuid,uuid,text,uuid,text)'::regprocedure
  ] LOOP
    f:=replace(pg_get_functiondef(signature),E'\r\n',E'\n');
    anchor:='  PERFORM finance_private.require_capability(p_organization_id,''dues.allocate'');';
    IF position(anchor IN f)=0 THEN RAISE EXCEPTION 'linked settlement capability anchor missing'; END IF;
    -- Reclassification already requires journal.write/post in the common path.
    IF signature='public.save_linked_settlement_draft(uuid,uuid,integer,text,text,text,jsonb)'::regprocedure THEN
      f:=replace(f,anchor,anchor||E'\n  IF v_type IN (''customer_refund'',''vendor_refund'') THEN PERFORM finance_private.require_capability(p_organization_id,''banking.write''); END IF;');
    ELSE
      -- The shared post validation occurs before any writes commit.
      f:=replace(f,'  PERFORM finance_private.validate_linked_settlement(p_organization_id,p_document_id);',
        $new$  IF EXISTS(SELECT 1 FROM finance.business_documents x WHERE x.organization_id=p_organization_id AND x.id=p_document_id AND x.document_type IN ('customer_refund','vendor_refund')) THEN
    PERFORM finance_private.require_capability(p_organization_id,'banking.write'); END IF;
  PERFORM finance_private.validate_linked_settlement(p_organization_id,p_document_id);$new$);
    END IF;
    EXECUTE f;
  END LOOP;
END $$;
