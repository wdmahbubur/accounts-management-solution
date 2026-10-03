-- Expose only account labels needed for write workflows to writers without broad banking.read.
CREATE FUNCTION public.list_operational_cash_accounts(p_organization_id uuid)
RETURNS TABLE(id uuid,name text,kind text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'banking.write');
  RETURN QUERY SELECT c.id,c.name,c.kind FROM finance.cash_accounts c
   WHERE c.organization_id=p_organization_id AND c.is_active ORDER BY c.name,c.id;
END; $$;
REVOKE ALL ON FUNCTION public.list_operational_cash_accounts(uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.list_operational_cash_accounts(uuid) TO ams_runtime;

CREATE OR REPLACE FUNCTION public.read_reconciliation_workspace(p_organization_id uuid,p_reconciliation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_recon finance.reconciliations%ROWTYPE;v_account finance.cash_accounts%ROWTYPE;v_bank jsonb;v_book jsonb;v_matches jsonb;
BEGIN
  IF NOT finance_private.has_permission(p_organization_id,'banking.read') AND NOT finance_private.has_permission(p_organization_id,'banking.write') THEN
    RAISE EXCEPTION 'Banking access required.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_recon FROM finance.reconciliations WHERE organization_id=p_organization_id AND id=p_reconciliation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reconciliation not found.' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_account FROM finance.cash_accounts WHERE organization_id=p_organization_id AND id=v_recon.cash_account_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'transaction_date',s.transaction_date,'value_date',s.value_date,'row_no',s.row_no,'description',s.description,'reference',s.source_transaction_id,'amount',s.amount::text,'review_required',s.review_required,'matched',COALESCE(m.amount,0)::text,'remaining',(abs(s.amount)-COALESCE(m.amount,0))::text) ORDER BY s.transaction_date,s.row_no),'[]'::jsonb) INTO v_bank
    FROM finance.statement_lines s LEFT JOIN LATERAL(SELECT sum(x.amount)::finance.amount amount FROM finance.reconciliation_matches x LEFT JOIN finance.reconciliation_match_reversals z ON z.organization_id=x.organization_id AND z.match_id=x.id WHERE x.organization_id=s.organization_id AND x.statement_line_id=s.id AND z.id IS NULL) m ON true
   WHERE s.organization_id=p_organization_id AND s.cash_account_id=v_recon.cash_account_id AND s.transaction_date BETWEEN v_recon.starts_on AND v_recon.ends_on;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',jl.id,'accounting_date',je.accounting_date,'line_no',jl.line_no,'description',jl.description,'document_number',d.document_number,'reference',d.external_reference,'debit',jl.debit::text,'credit',jl.credit::text,'signed_amount',(jl.debit-jl.credit)::text,'matched',COALESCE(m.amount,0)::text,'remaining',(abs(jl.debit-jl.credit)-COALESCE(m.amount,0))::text) ORDER BY je.accounting_date,je.id,jl.line_no),'[]'::jsonb) INTO v_book
    FROM finance.journal_lines jl JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
    LEFT JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id
    LEFT JOIN LATERAL(SELECT sum(x.amount)::finance.amount amount FROM finance.reconciliation_matches x LEFT JOIN finance.reconciliation_match_reversals z ON z.organization_id=x.organization_id AND z.match_id=x.id WHERE x.organization_id=jl.organization_id AND x.journal_line_id=jl.id AND z.id IS NULL) m ON true
   WHERE jl.organization_id=p_organization_id AND jl.account_id=v_account.account_id AND je.accounting_date BETWEEN v_recon.starts_on AND v_recon.ends_on;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',x.id,'statement_line_id',x.statement_line_id,'journal_line_id',x.journal_line_id,'amount',x.amount::text,'created_at',x.created_at,'reversed',z.id IS NOT NULL) ORDER BY x.created_at),'[]'::jsonb)
    INTO v_matches FROM finance.reconciliation_matches x JOIN finance.reconciliations r ON r.organization_id=x.organization_id AND r.id=x.reconciliation_id LEFT JOIN finance.reconciliation_match_reversals z ON z.organization_id=x.organization_id AND z.match_id=x.id
   WHERE x.organization_id=p_organization_id AND x.reconciliation_id=p_reconciliation_id;
  RETURN jsonb_build_object('reconciliation',to_jsonb(v_recon),'cash_account',jsonb_build_object('id',v_account.id,'name',v_account.name,'kind',v_account.kind),'statement_lines',v_bank,'book_lines',v_book,'matches',v_matches);
END; $$;
REVOKE ALL ON FUNCTION public.read_reconciliation_workspace(uuid,uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_reconciliation_workspace(uuid,uuid) TO ams_runtime;
NOTIFY pgrst,'reload schema';
