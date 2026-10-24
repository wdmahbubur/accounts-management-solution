-- US-037 / #175: retained history is not an active bank/credit dependency.
-- Forward-only routine repair. No financial facts, receipts or grants change.
-- Keep the existing posting order: year/period -> source -> bank evidence lock.
DO $patch$
DECLARE v_signature regprocedure; v_definition text; v_old text; v_new text;
BEGIN
  FOR v_signature,v_old,v_new IN SELECT * FROM (VALUES
    ('public.reverse_posted_document(uuid,uuid,date,text,text,text,text)'::regprocedure,
     $needle$ IF EXISTS(SELECT 1 FROM finance.reconciliation_matches m JOIN finance.reconciliations r$needle$,
     $replacement$ -- Serialize dependency reads and the opposite cash entry with match/unmatch/finalize.
 PERFORM pg_advisory_xact_lock(hashtext(p_organization_id::text),711046);
 IF EXISTS(SELECT 1 FROM finance.reconciliation_matches m JOIN finance.reconciliations r$replacement$),
    ('public.reverse_posted_document(uuid,uuid,date,text,text,text,text)'::regprocedure,
     $needle$AND r.state='finalized') THEN$needle$,
     $replacement$AND r.state='finalized' AND NOT EXISTS(
     SELECT 1 FROM finance.reconciliation_match_reversals z WHERE z.organization_id=m.organization_id AND z.match_id=m.id)) THEN$replacement$),
    ('public.reverse_posted_document(uuid,uuid,date,text,text,text,text)'::regprocedure,
     $needle$AND r.state='draft') THEN$needle$,
     $replacement$AND r.state='draft' AND NOT EXISTS(
     SELECT 1 FROM finance.reconciliation_match_reversals z WHERE z.organization_id=m.organization_id AND z.match_id=m.id)) THEN$replacement$),
    ('public.reverse_posted_document(uuid,uuid,date,text,text,text,text)'::regprocedure,
     $needle$AND child.state='posted') THEN$needle$,
     $replacement$AND child.state='posted' AND NOT EXISTS(
     SELECT 1 FROM finance.business_documents reversed WHERE reversed.organization_id=child.organization_id
       AND reversed.reversal_of_document_id=child.id AND reversed.state='posted'
       AND reversed.accounting_date<=p_reversal_date)) THEN$replacement$),
    ('public.add_reconciliation_match(uuid,uuid,uuid,uuid,text,text)'::regprocedure,
     $needle$  SELECT * INTO v_account FROM finance.cash_accounts WHERE organization_id=p_organization_id AND id=v_recon.cash_account_id;$needle$,
     $replacement$  -- A racing source reversal and a new match cannot both succeed.
  -- These routines hold the same bank-evidence advisory lock until commit.
  IF EXISTS(SELECT 1 FROM finance.journal_entries source
    JOIN finance.business_documents reversed ON reversed.organization_id=source.organization_id
      AND reversed.reversal_of_document_id=source.source_document_id AND reversed.state='posted'
    WHERE source.organization_id=p_organization_id AND source.id=v_book.journal_entry_id) THEN
    RAISE EXCEPTION 'a reversed cash source cannot receive new bank matches' USING ERRCODE='55000';
  END IF;
  SELECT * INTO v_account FROM finance.cash_accounts WHERE organization_id=p_organization_id AND id=v_recon.cash_account_id;$replacement$)
  ) AS changes(signature,needle,replacement)
  LOOP
    v_definition:=pg_catalog.pg_get_functiondef(v_signature);
    IF length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) THEN
      RAISE EXCEPTION 'expected one source-reversal dependency anchor in %',v_signature;
    END IF;
    EXECUTE replace(v_definition,v_old,v_new);
  END LOOP;
END;
$patch$;
NOTIFY pgrst,'reload schema';
