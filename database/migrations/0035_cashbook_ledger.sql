-- US-045: serialize physical-cash postings and read the authoritative cashbook.
CREATE FUNCTION finance_private.lock_physical_cash_posting()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM finance.cash_accounts ca WHERE ca.organization_id=NEW.organization_id AND ca.account_id=NEW.account_id
    AND ca.kind='cash' AND NOT ca.allow_negative_balance) THEN
    -- One company-scoped lock avoids opposite-direction transfer deadlocks while
    -- still allowing unrelated companies to post concurrently.
    PERFORM pg_advisory_xact_lock(hashtext(NEW.organization_id::text),711045);
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION finance_private.lock_physical_cash_posting() FROM PUBLIC,ams_runtime;
CREATE TRIGGER journal_lines_lock_physical_cash_posting
BEFORE INSERT ON finance.journal_lines FOR EACH ROW EXECUTE FUNCTION finance_private.lock_physical_cash_posting();

CREATE FUNCTION finance_private.enforce_physical_cash_floor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_account finance.cash_accounts%ROWTYPE;v_balance finance.amount;
BEGIN
  IF NEW.state<>'posted' OR OLD.state='posted' THEN RETURN NEW; END IF;
  FOR v_account IN SELECT ca.* FROM finance.cash_accounts ca
    JOIN finance.journal_lines jl ON jl.organization_id=ca.organization_id AND jl.account_id=ca.account_id
    WHERE ca.organization_id=NEW.organization_id AND jl.journal_entry_id=NEW.id AND ca.kind='cash' AND NOT ca.allow_negative_balance
    ORDER BY ca.id
  LOOP
    SELECT COALESCE(sum(jl.debit-jl.credit),0)::finance.amount INTO v_balance
    FROM finance.journal_lines jl JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
    WHERE jl.organization_id=v_account.organization_id AND jl.account_id=v_account.account_id;
    IF v_balance<0 THEN RAISE EXCEPTION 'physical cash balance would become negative' USING ERRCODE='23514'; END IF;
  END LOOP;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION finance_private.enforce_physical_cash_floor() FROM PUBLIC,ams_runtime;
CREATE TRIGGER journal_entries_physical_cash_floor
AFTER UPDATE OF state ON finance.journal_entries FOR EACH ROW EXECUTE FUNCTION finance_private.enforce_physical_cash_floor();

CREATE FUNCTION public.read_cash_account_ledger(p_organization_id uuid,p_cash_account_id uuid,p_from date,p_to date,p_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_account finance.cash_accounts%ROWTYPE;v_gl finance.accounts%ROWTYPE;v_open finance.amount;v_close finance.amount;v_items jsonb;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'banking.read');
  IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_from>p_to OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid cashbook range' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_account FROM finance.cash_accounts ca WHERE ca.organization_id=p_organization_id AND ca.id=p_cash_account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'cash account unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_gl FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=v_account.account_id;
  WITH lines AS (
    SELECT je.accounting_date,je.id AS journal_id,jl.id AS line_id,jl.line_no,jl.debit,jl.credit,(jl.debit-jl.credit)::finance.amount AS movement,
      jl.description,d.id AS source_document_id,d.document_type::text AS source_type,d.document_number,d.external_reference
    FROM finance.journal_lines jl JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
    LEFT JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id
    WHERE jl.organization_id=p_organization_id AND jl.account_id=v_account.account_id
  ) SELECT COALESCE(sum(movement) FILTER(WHERE accounting_date<p_from),0)::finance.amount,
      COALESCE(sum(movement) FILTER(WHERE accounting_date<=p_to),0)::finance.amount INTO v_open,v_close FROM lines;
  WITH lines AS (
    SELECT je.accounting_date,je.id AS journal_id,jl.id AS line_id,jl.line_no,jl.debit,jl.credit,(jl.debit-jl.credit)::finance.amount AS movement,
      jl.description,d.id AS source_document_id,d.document_type::text AS source_type,d.document_number,d.external_reference
    FROM finance.journal_lines jl JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
    LEFT JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id
    WHERE jl.organization_id=p_organization_id AND jl.account_id=v_account.account_id AND je.accounting_date BETWEEN p_from AND p_to
  ), running AS (
    SELECT *,v_open+sum(movement) OVER(ORDER BY accounting_date,journal_id,line_no ROWS UNBOUNDED PRECEDING) AS balance
    FROM lines ORDER BY accounting_date DESC,journal_id DESC,line_no DESC LIMIT p_limit
  ) SELECT COALESCE(jsonb_agg(jsonb_build_object('accounting_date',accounting_date,'journal_id',journal_id,'line_id',line_id,'line_no',line_no,
      'debit',debit::text,'credit',credit::text,'running_balance',balance::text,'description',description,'source_document_id',source_document_id,
      'source_type',source_type,'document_number',document_number,'external_reference',external_reference)
      ORDER BY accounting_date,journal_id,line_no),'[]'::jsonb) INTO v_items FROM running;
  RETURN jsonb_build_object('organization_id',p_organization_id,'cash_account_id',v_account.id,'name',v_account.name,'kind',v_account.kind,
    'is_active',v_account.is_active,'account_id',v_gl.id,'account_code',v_gl.code,'account_name',v_gl.name,'from_date',p_from,'to_date',p_to,
    'opening_balance',v_open::text,'closing_balance',v_close::text,'transactions',v_items);
END; $$;
REVOKE ALL ON FUNCTION public.read_cash_account_ledger(uuid,uuid,date,date,integer) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_cash_account_ledger(uuid,uuid,date,date,integer) TO ams_runtime;
NOTIFY pgrst,'reload schema';
