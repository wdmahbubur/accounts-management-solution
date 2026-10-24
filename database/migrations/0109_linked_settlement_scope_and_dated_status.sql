-- Strengthen the dedicated command's read boundary and dated lifecycle flags.
DO $$
DECLARE f text; anchor text;
BEGIN
  f:=replace(pg_get_functiondef('finance_private.validate_linked_settlement(uuid,uuid)'::regprocedure),E'\r\n',E'\n');
  anchor:='  IF v_type IS NULL OR a.party_id IS DISTINCT FROM d.party_id';
  IF position(anchor IN f)=0 THEN RAISE EXCEPTION 'linked source scope anchor missing'; END IF;
  f:=replace(f,anchor,$new$  IF NOT EXISTS(SELECT 1 FROM finance.journal_lines l JOIN finance.journal_entries j
    ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id
    WHERE l.organization_id=p_organization_id AND l.id=a.journal_line_id AND finance_private.can_read_document(p_organization_id,j.source_document_id)) THEN
    RAISE EXCEPTION 'linked source unavailable' USING ERRCODE='P0002'; END IF;
  IF v_type IS NULL OR a.party_id IS DISTINCT FROM d.party_id$new$);
  anchor:='    PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,t.id,s.amount,d.accounting_date);';
  IF position(anchor IN f)=0 THEN RAISE EXCEPTION 'linked target scope anchor missing'; END IF;
  f:=replace(f,anchor,$new$    IF NOT EXISTS(SELECT 1 FROM finance.journal_lines l JOIN finance.journal_entries j
      ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id
      WHERE l.organization_id=p_organization_id AND l.id=t.journal_line_id AND finance_private.can_read_document(p_organization_id,j.source_document_id)) THEN
      RAISE EXCEPTION 'linked target unavailable' USING ERRCODE='P0002'; END IF;
    PERFORM finance_private.assert_open_item_allocation_capacity(p_organization_id,t.id,s.amount,d.accounting_date);$new$);
  EXECUTE f;
  f:=pg_get_functiondef('public.read_linked_settlement_options(uuid,date)'::regprocedure);
  f:=replace(f,'r.reversal_of_document_id=d.id)','r.reversal_of_document_id=d.id AND r.accounting_date<=p_effective_date)');
  f:=replace(f,'r.allocation_id=a.id)) ORDER BY','r.allocation_id=a.id AND r.effective_date<=p_effective_date)) ORDER BY');
  EXECUTE f;
END $$;
