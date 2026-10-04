-- US-022: derive every open item from a posted control-account journal line.

ALTER TABLE finance.open_items ADD CONSTRAINT open_items_reference_length_check CHECK(length(reference) BETWEEN 1 AND 160);
ALTER TABLE finance.open_items ADD CONSTRAINT open_items_due_date_check CHECK(due_date IS NULL OR due_date>=issue_date);

CREATE FUNCTION finance_private.create_open_item_for_control_line(
  p_organization_id uuid,p_journal_line_id uuid,p_reference text DEFAULT NULL,p_due_date date DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_line finance.journal_lines%ROWTYPE; v_entry finance.journal_entries%ROWTYPE; v_doc finance.business_documents%ROWTYPE;
  v_account finance.accounts%ROWTYPE; v_contact finance.contacts%ROWTYPE; v_side text; v_amount finance.amount;
  v_reference text; v_due date; v_id uuid;
BEGIN
  SELECT * INTO v_line FROM finance.journal_lines l WHERE l.organization_id=p_organization_id AND l.id=p_journal_line_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'journal line unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_entry FROM finance.journal_entries j WHERE j.organization_id=p_organization_id AND j.id=v_line.journal_entry_id;
  IF NOT FOUND OR v_entry.state<>'building' THEN RAISE EXCEPTION 'open items must be created while the journal is building' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_account FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=v_line.account_id;
  IF NOT FOUND OR v_account.control_kind IS NULL OR NOT v_account.is_active OR NOT v_account.is_postable THEN
    RAISE EXCEPTION 'journal line is not an active postable control account' USING ERRCODE='23514';
  END IF;
  IF v_line.party_id IS NULL THEN RAISE EXCEPTION 'control-account journal lines require a party' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_contact FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=v_line.party_id AND c.is_active;
  IF NOT FOUND OR (v_account.control_kind IN ('ar','customer_advance') AND NOT v_contact.is_customer) OR
     (v_account.control_kind IN ('ap','vendor_advance') AND NOT v_contact.is_vendor) THEN
    RAISE EXCEPTION 'party does not match the control-account type' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=v_entry.source_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'source document unavailable' USING ERRCODE='23514'; END IF;
  v_side:=CASE WHEN v_line.debit>0 THEN 'debit' ELSE 'credit' END;
  v_amount:=CASE WHEN v_line.debit>0 THEN v_line.debit ELSE v_line.credit END;
  v_reference:=COALESCE(NULLIF(btrim(p_reference),''),NULLIF(v_doc.document_number,''),v_doc.id::text);
  v_due:=COALESCE(p_due_date,v_doc.due_date);
  IF length(v_reference)>160 OR (v_due IS NOT NULL AND (NOT isfinite(v_due) OR v_due<v_entry.accounting_date)) THEN
    RAISE EXCEPTION 'open-item reference or due date is invalid' USING ERRCODE='22023';
  END IF;
  INSERT INTO finance.open_items(organization_id,journal_line_id,account_id,party_id,control_kind,side,original_amount,reference,issue_date,due_date)
    VALUES(p_organization_id,v_line.id,v_line.account_id,v_line.party_id,v_account.control_kind,v_side,v_amount,v_reference,v_entry.accounting_date,v_due)
    RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION finance_private.create_open_item_for_control_line(uuid,uuid,text,date) FROM PUBLIC,ams_runtime;

CREATE FUNCTION finance_private.validate_control_open_item_match()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_line finance.journal_lines%ROWTYPE; v_entry finance.journal_entries%ROWTYPE; v_control text;
  v_count integer; v_expected_side text; v_expected_amount finance.amount;
BEGIN
  SELECT * INTO v_line FROM finance.journal_lines l WHERE l.organization_id=COALESCE(NEW.organization_id,OLD.organization_id)
    AND l.id=COALESCE(NEW.id,OLD.id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_entry FROM finance.journal_entries j WHERE j.organization_id=v_line.organization_id AND j.id=v_line.journal_entry_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'journal line has no same-company journal' USING ERRCODE='23503'; END IF;
  IF v_entry.state<>'posted' THEN RAISE EXCEPTION 'building journal entries cannot commit' USING ERRCODE='23514'; END IF;
  SELECT a.control_kind INTO v_control FROM finance.accounts a WHERE a.organization_id=v_line.organization_id AND a.id=v_line.account_id;
  IF v_control IS NULL THEN
    IF EXISTS(SELECT 1 FROM finance.open_items oi WHERE oi.organization_id=v_line.organization_id AND oi.journal_line_id=v_line.id) THEN
      RAISE EXCEPTION 'non-control journal line cannot have an open item' USING ERRCODE='23514';
    END IF;
    RETURN NULL;
  END IF;
  v_expected_side:=CASE WHEN v_line.debit>0 THEN 'debit' ELSE 'credit' END;
  v_expected_amount:=CASE WHEN v_line.debit>0 THEN v_line.debit ELSE v_line.credit END;
  SELECT count(*) INTO v_count FROM finance.open_items oi WHERE oi.organization_id=v_line.organization_id AND oi.journal_line_id=v_line.id
    AND oi.account_id=v_line.account_id AND oi.party_id=v_line.party_id AND oi.control_kind=v_control AND oi.side=v_expected_side
    AND oi.original_amount=v_expected_amount AND oi.issue_date=v_entry.accounting_date;
  IF v_line.party_id IS NULL OR v_count<>1 THEN RAISE EXCEPTION 'posted control line requires exactly one matching open item' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION finance_private.validate_control_open_item_match() FROM PUBLIC,ams_runtime;
CREATE CONSTRAINT TRIGGER journal_line_control_item_check
  AFTER INSERT OR UPDATE OR DELETE ON finance.journal_lines DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION finance_private.validate_control_open_item_match();

CREATE FUNCTION finance_private.guard_posted_journal_line_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_state text; v_org uuid; v_entry uuid;
BEGIN
  v_org:=COALESCE(NEW.organization_id,OLD.organization_id);v_entry:=COALESCE(NEW.journal_entry_id,OLD.journal_entry_id);
  SELECT j.state INTO v_state FROM finance.journal_entries j WHERE j.organization_id=v_org AND j.id=v_entry;
  IF v_state='posted' THEN RAISE EXCEPTION 'posted journal lines are immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND (NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id) THEN
    RAISE EXCEPTION 'journal line cannot move between companies or journal entries' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION finance_private.guard_posted_journal_line_mutation() FROM PUBLIC,ams_runtime;
CREATE TRIGGER journal_lines_posted_immutable BEFORE UPDATE OR DELETE ON finance.journal_lines
  FOR EACH ROW EXECUTE FUNCTION finance_private.guard_posted_journal_line_mutation();

CREATE FUNCTION finance_private.guard_open_item_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'posted open items are immutable' USING ERRCODE='23514'; END; $$;
REVOKE ALL ON FUNCTION finance_private.guard_open_item_mutation() FROM PUBLIC,ams_runtime;
CREATE TRIGGER open_items_immutable BEFORE UPDATE OR DELETE ON finance.open_items
  FOR EACH ROW EXECUTE FUNCTION finance_private.guard_open_item_mutation();
CREATE TRIGGER open_items_no_truncate BEFORE TRUNCATE ON finance.open_items
  FOR EACH STATEMENT EXECUTE FUNCTION finance_private.guard_open_item_mutation();

CREATE FUNCTION finance_private.validate_open_item_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_line finance.journal_lines%ROWTYPE; v_entry finance.journal_entries%ROWTYPE; v_account finance.accounts%ROWTYPE;
BEGIN
  SELECT * INTO v_line FROM finance.journal_lines l WHERE l.organization_id=NEW.organization_id AND l.id=NEW.journal_line_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'open item must reference an existing journal line' USING ERRCODE='23503'; END IF;
  SELECT * INTO v_entry FROM finance.journal_entries j WHERE j.organization_id=v_line.organization_id AND j.id=v_line.journal_entry_id;
  SELECT * INTO v_account FROM finance.accounts a WHERE a.organization_id=v_line.organization_id AND a.id=v_line.account_id;
  IF v_entry.state<>'building' OR v_account.control_kind IS NULL OR v_line.party_id IS NULL OR
     NEW.account_id<>v_line.account_id OR NEW.party_id<>v_line.party_id OR NEW.control_kind<>v_account.control_kind OR
     NEW.side IS DISTINCT FROM (CASE WHEN v_line.debit>0 THEN 'debit' ELSE 'credit' END) OR
     NEW.original_amount IS DISTINCT FROM (CASE WHEN v_line.debit>0 THEN v_line.debit ELSE v_line.credit END) OR NEW.issue_date<>v_entry.accounting_date THEN
    RAISE EXCEPTION 'open item does not agree with its source control line' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION finance_private.validate_open_item_insert() FROM PUBLIC,ams_runtime;
CREATE TRIGGER open_items_source_guard BEFORE INSERT ON finance.open_items
  FOR EACH ROW EXECUTE FUNCTION finance_private.validate_open_item_insert();

CREATE FUNCTION finance_private.open_item_balance_at(p_organization_id uuid,p_open_item_id uuid,p_as_of date,p_cutoff timestamptz)
RETURNS finance.amount LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT CASE WHEN p_as_of IS NULL OR p_cutoff IS NULL THEN NULL::finance.amount
    WHEN oi.issue_date>p_as_of OR oi.created_at>p_cutoff THEN 0::finance.amount
    ELSE (oi.original_amount-COALESCE((SELECT sum(a.amount) FROM finance.settlement_allocations a
      WHERE a.organization_id=p_organization_id AND a.effective_date<=p_as_of AND a.created_at<=p_cutoff
        AND (a.debit_open_item_id=oi.id OR a.credit_open_item_id=oi.id)
        AND NOT EXISTS(SELECT 1 FROM finance.allocation_reversals r WHERE r.organization_id=a.organization_id AND r.allocation_id=a.id
          AND r.effective_date<=p_as_of AND r.created_at<=p_cutoff)),0))::finance.amount END
  FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.id=p_open_item_id
$$;
REVOKE ALL ON FUNCTION finance_private.open_item_balance_at(uuid,uuid,date,timestamptz) FROM PUBLIC,ams_runtime;

CREATE FUNCTION public.list_open_items(
  p_organization_id uuid,p_as_of date,p_cutoff timestamptz DEFAULT now(),p_party_id uuid DEFAULT NULL,
  p_control_kind text DEFAULT NULL,p_limit integer DEFAULT 100
) RETURNS TABLE(open_item_id uuid,journal_line_id uuid,source_document_id uuid,document_number text,account_id uuid,
  party_id uuid,party_name text,control_kind text,side text,original_amount finance.amount,available_amount finance.amount,
  reference text,issue_date date,due_date date)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'dues.read');
  IF p_as_of IS NULL OR NOT isfinite(p_as_of) OR p_cutoff IS NULL OR NOT isfinite(p_cutoff) OR
     (p_control_kind IS NOT NULL AND p_control_kind NOT IN ('ar','ap','customer_advance','vendor_advance')) OR p_limit NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid open-item filter' USING ERRCODE='22023';
  END IF;
  RETURN QUERY SELECT oi.id,oi.journal_line_id,je.source_document_id,d.document_number,oi.account_id,oi.party_id,c.display_name,
    oi.control_kind,oi.side,oi.original_amount,finance_private.open_item_balance_at(p_organization_id,oi.id,p_as_of,p_cutoff),
    oi.reference,oi.issue_date,oi.due_date
  FROM finance.open_items oi JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
  JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
  JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id AND d.state='posted'
  JOIN finance.contacts c ON c.organization_id=oi.organization_id AND c.id=oi.party_id
  WHERE oi.organization_id=p_organization_id AND oi.issue_date<=p_as_of AND oi.created_at<=p_cutoff
    AND (p_party_id IS NULL OR oi.party_id=p_party_id) AND (p_control_kind IS NULL OR oi.control_kind=p_control_kind)
  ORDER BY oi.issue_date,oi.id LIMIT p_limit;
END; $$;
REVOKE ALL ON FUNCTION public.list_open_items(uuid,date,timestamptz,uuid,text,integer) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.list_open_items(uuid,date,timestamptz,uuid,text,integer) TO ams_runtime;

