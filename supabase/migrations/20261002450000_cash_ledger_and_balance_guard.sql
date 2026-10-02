BEGIN;

DROP FUNCTION public.read_cash_accounts(uuid);
CREATE FUNCTION public.read_cash_accounts(p_organization_id uuid)
RETURNS TABLE(id uuid,name text,kind text,institution text,masked_account_number text,is_cash_equivalent boolean,allow_negative_balance boolean,is_active boolean,
  account_id uuid,account_code text,account_name text,book_balance text,last_reconciled_on date,row_version integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'banking.read');
  RETURN QUERY SELECT ca.id,ca.name,ca.kind,ca.institution,ca.masked_account_number,ca.is_cash_equivalent,ca.allow_negative_balance,ca.is_active,
    a.id,a.code,a.name,COALESCE(sum(jl.debit-jl.credit),0)::finance.amount::text,
    (SELECT max(r.ends_on) FROM finance.reconciliations r WHERE r.organization_id=ca.organization_id AND r.cash_account_id=ca.id AND r.state='finalized'),ca.row_version
  FROM finance.cash_accounts ca JOIN finance.accounts a ON a.organization_id=ca.organization_id AND a.id=ca.account_id
  LEFT JOIN finance.journal_entries je ON je.organization_id=ca.organization_id AND je.state='posted'
  LEFT JOIN finance.journal_lines jl ON jl.organization_id=je.organization_id AND jl.journal_entry_id=je.id AND jl.account_id=ca.account_id
  WHERE ca.organization_id=p_organization_id GROUP BY ca.id,a.id ORDER BY ca.is_active DESC,ca.name,ca.id;
END $$;
REVOKE ALL ON FUNCTION public.read_cash_accounts(uuid) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_cash_accounts(uuid) TO authenticated;

CREATE FUNCTION public.set_cash_account_overdraft(p_organization_id uuid,p_request_id text,p_account_id uuid,p_expected_version integer,p_allow_negative boolean)
RETURNS TABLE(account_id uuid,row_version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid;v_row finance.cash_accounts%ROWTYPE;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);v_actor:=finance_private.require_capability(p_organization_id,'banking.write');
  SELECT * INTO v_row FROM finance.cash_accounts ca WHERE ca.organization_id=p_organization_id AND ca.id=p_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cash account not found' USING ERRCODE='P0002'; END IF;
  IF v_row.row_version<>p_expected_version THEN RAISE EXCEPTION 'cash account changed' USING ERRCODE='40001'; END IF;
  IF p_allow_negative IS NULL OR (p_allow_negative AND v_row.kind<>'bank') THEN RAISE EXCEPTION 'only bank accounts can have a configured overdraft' USING ERRCODE='23514'; END IF;
  IF p_allow_negative IS DISTINCT FROM v_row.allow_negative_balance THEN
    UPDATE finance.cash_accounts ca SET allow_negative_balance=p_allow_negative,row_version=ca.row_version+1
      WHERE ca.organization_id=p_organization_id AND ca.id=p_account_id RETURNING * INTO v_row;
  END IF;
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'cash_account.overdraft','cash_account',v_row.id,p_request_id,
    jsonb_build_object('allow_negative_balance',v_row.allow_negative_balance,'row_version',v_row.row_version));
  RETURN QUERY SELECT v_row.id,v_row.row_version;
END $$;
REVOKE ALL ON FUNCTION public.set_cash_account_overdraft(uuid,text,uuid,integer,boolean) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.set_cash_account_overdraft(uuid,text,uuid,integer,boolean) TO authenticated;

CREATE FUNCTION finance_private.guard_cash_account_balance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_entry finance.journal_entries%ROWTYPE;v_cash finance.cash_accounts%ROWTYPE;v_posted numeric;v_pending numeric;v_projected numeric;
BEGIN
  SELECT * INTO v_entry FROM finance.journal_entries je WHERE je.organization_id=NEW.organization_id AND je.id=NEW.journal_entry_id;
  IF NOT FOUND OR v_entry.state<>'building' THEN RETURN NEW; END IF;
  SELECT * INTO v_cash FROM finance.cash_accounts ca WHERE ca.organization_id=NEW.organization_id AND ca.account_id=NEW.account_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT COALESCE(sum(pl.debit-pl.credit),0) INTO v_posted FROM finance.journal_lines pl
    JOIN finance.journal_entries pe ON pe.organization_id=pl.organization_id AND pe.id=pl.journal_entry_id AND pe.state='posted'
    WHERE pl.organization_id=NEW.organization_id AND pl.account_id=v_cash.account_id;
  SELECT COALESCE(sum(pending.debit-pending.credit),0) INTO v_pending FROM finance.journal_lines pending
    WHERE pending.organization_id=NEW.organization_id AND pending.journal_entry_id=NEW.journal_entry_id AND pending.account_id=v_cash.account_id;
  v_projected:=v_posted+v_pending+NEW.debit-NEW.credit;
  IF v_projected<0 AND (v_cash.kind<>'bank' OR NOT v_cash.allow_negative_balance) THEN
    RAISE EXCEPTION 'cash account balance would fall below zero' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_cash_account_balance() FROM PUBLIC,anon,authenticated,ams_job_worker;
CREATE TRIGGER cash_account_balance_guard BEFORE INSERT ON finance.journal_lines
  FOR EACH ROW EXECUTE FUNCTION finance_private.guard_cash_account_balance();

CREATE FUNCTION public.read_cash_account_ledger(p_organization_id uuid,p_cash_account_id uuid,p_from date,p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_cash finance.cash_accounts%ROWTYPE;v_opening finance.amount;v_closing finance.amount;v_rows jsonb;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'banking.read');
  IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_to<p_from OR p_to-p_from>3660 THEN
    RAISE EXCEPTION 'ledger date range is invalid' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_cash FROM finance.cash_accounts ca WHERE ca.organization_id=p_organization_id AND ca.id=p_cash_account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'cash account not found' USING ERRCODE='P0002'; END IF;
  SELECT COALESCE(sum(l.debit-l.credit),0)::finance.amount INTO v_opening FROM finance.journal_lines l JOIN finance.journal_entries je
    ON je.organization_id=l.organization_id AND je.id=l.journal_entry_id AND je.state='posted'
    WHERE l.organization_id=p_organization_id AND l.account_id=v_cash.account_id AND je.accounting_date<p_from;
  WITH source_rows AS (
    SELECT je.accounting_date,je.id AS journal_id,l.id AS line_id,l.line_no,l.debit,l.credit,d.id AS document_id,d.document_number,d.document_type::text AS document_type,
      d.description,d.external_reference,CASE WHEN COALESCE((SELECT sum(rm.amount) FROM finance.reconciliation_matches rm WHERE rm.organization_id=l.organization_id AND rm.journal_line_id=l.id),0)=0 THEN 'unmatched'
        WHEN COALESCE((SELECT sum(rm.amount) FROM finance.reconciliation_matches rm WHERE rm.organization_id=l.organization_id AND rm.journal_line_id=l.id),0)>=l.debit+l.credit THEN 'matched' ELSE 'partially_matched' END AS match_status
    FROM finance.journal_lines l JOIN finance.journal_entries je ON je.organization_id=l.organization_id AND je.id=l.journal_entry_id AND je.state='posted'
    JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id
    WHERE l.organization_id=p_organization_id AND l.account_id=v_cash.account_id AND je.accounting_date BETWEEN p_from AND p_to
  ), running AS (
    SELECT s.*, (v_opening+sum(s.debit-s.credit) OVER(ORDER BY s.accounting_date,s.journal_id,s.line_no,s.line_id ROWS UNBOUNDED PRECEDING))::finance.amount AS running_balance
    FROM source_rows s
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('accounting_date',accounting_date,'journal_id',journal_id,'line_id',line_id,'document_id',document_id,
    'document_number',document_number,'document_type',document_type,'description',description,'reference',external_reference,'debit',debit::text,'credit',credit::text,
    'running_balance',running_balance::text,'match_status',match_status) ORDER BY accounting_date,journal_id,line_no,line_id),'[]'::jsonb),
    COALESCE((SELECT running_balance FROM running ORDER BY accounting_date DESC,journal_id DESC,line_no DESC,line_id DESC LIMIT 1),v_opening)
    INTO v_rows,v_closing FROM running;
  RETURN jsonb_build_object('cash_account_id',v_cash.id,'account_name',v_cash.name,'kind',v_cash.kind,'allow_negative_balance',v_cash.allow_negative_balance,
    'from_date',p_from,'to_date',p_to,'opening_balance',v_opening::text,'closing_balance',v_closing::text,'entries',v_rows);
END $$;
REVOKE ALL ON FUNCTION public.read_cash_account_ledger(uuid,uuid,date,date) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_cash_account_ledger(uuid,uuid,date,date) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
