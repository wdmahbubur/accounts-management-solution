-- US-050: append-only evidence links between bank observations and posted book cash lines.
DO $$
DECLARE v_constraint record;
BEGIN
  FOR v_constraint IN SELECT conname FROM pg_catalog.pg_constraint
   WHERE conrelid='finance.reconciliation_matches'::regclass AND contype='u'
     AND pg_catalog.pg_get_constraintdef(oid)='UNIQUE (organization_id, reconciliation_id, statement_line_id, journal_line_id)'
  LOOP EXECUTE format('ALTER TABLE finance.reconciliation_matches DROP CONSTRAINT %I',v_constraint.conname); END LOOP;
END; $$;

CREATE TABLE finance.reconciliation_match_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  match_id uuid NOT NULL,
  created_by_member_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,match_id),
  FOREIGN KEY (organization_id,match_id) REFERENCES finance.reconciliation_matches(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,created_by_member_id) REFERENCES finance.organization_members(organization_id,id) ON DELETE RESTRICT
);
ALTER TABLE finance.reconciliation_match_reversals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.reconciliation_match_reversals FROM PUBLIC,ams_runtime;
GRANT SELECT ON finance.reconciliation_match_reversals TO ams_runtime;
CREATE POLICY reconciliation_match_reversals_read ON finance.reconciliation_match_reversals FOR SELECT TO ams_runtime USING (finance_private.has_permission(organization_id,'banking.read'));

CREATE FUNCTION public.create_reconciliation(p_organization_id uuid,p_cash_account_id uuid,p_starts_on date,p_ends_on date,p_statement_opening text,p_statement_closing text,p_request_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_member_id uuid;v_id uuid;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'banking.write');
  SELECT id INTO v_member_id FROM finance.organization_members WHERE organization_id=p_organization_id AND user_id=identity.current_actor_id() AND status='active';
  IF v_member_id IS NULL OR p_starts_on IS NULL OR p_ends_on IS NULL OR NOT isfinite(p_starts_on) OR NOT isfinite(p_ends_on) OR p_ends_on<p_starts_on
     OR p_ends_on-p_starts_on>370 OR p_request_id IS NULL OR length(p_request_id)>100 THEN RAISE EXCEPTION 'Invalid reconciliation session.' USING ERRCODE='22023'; END IF;
  IF p_statement_opening IS NULL OR p_statement_closing IS NULL OR p_statement_opening !~ '^-?\d{1,12}\.\d{2}$' OR p_statement_closing !~ '^-?\d{1,12}\.\d{2}$' THEN RAISE EXCEPTION 'Invalid statement balances.' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM finance.cash_accounts WHERE organization_id=p_organization_id AND id=p_cash_account_id AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cash account unavailable.' USING ERRCODE='P0002'; END IF;
  SELECT id INTO v_id FROM finance.reconciliations WHERE organization_id=p_organization_id AND cash_account_id=p_cash_account_id AND starts_on=p_starts_on AND ends_on=p_ends_on AND state='draft' FOR UPDATE;
  IF FOUND THEN RETURN v_id; END IF;
  IF EXISTS(SELECT 1 FROM finance.reconciliations r WHERE r.organization_id=p_organization_id AND r.cash_account_id=p_cash_account_id AND r.state='finalized' AND daterange(r.starts_on,r.ends_on,'[]') && daterange(p_starts_on,p_ends_on,'[]')) THEN
    RAISE EXCEPTION 'A finalized reconciliation already covers part of that statement.' USING ERRCODE='23P01';
  END IF;
  INSERT INTO finance.reconciliations(organization_id,cash_account_id,starts_on,ends_on,statement_opening,statement_closing)
   VALUES(p_organization_id,p_cash_account_id,p_starts_on,p_ends_on,p_statement_opening::finance.amount,p_statement_closing::finance.amount) RETURNING id INTO v_id;
  INSERT INTO finance.audit_events(organization_id,actor_member_id,actor_kind,action,entity_type,entity_id,request_id,redacted_change)
   VALUES(p_organization_id,v_member_id,'user','reconciliation.created','reconciliation',v_id,p_request_id,jsonb_build_object('cash_account_id',p_cash_account_id,'starts_on',p_starts_on,'ends_on',p_ends_on));
  RETURN v_id;
END; $$;

CREATE FUNCTION public.read_reconciliation_workspace(p_organization_id uuid,p_reconciliation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_recon finance.reconciliations%ROWTYPE;v_account finance.cash_accounts%ROWTYPE;v_bank jsonb;v_book jsonb;v_matches jsonb;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'banking.read');
  SELECT * INTO v_recon FROM finance.reconciliations WHERE organization_id=p_organization_id AND id=p_reconciliation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reconciliation not found.' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_account FROM finance.cash_accounts WHERE organization_id=p_organization_id AND id=v_recon.cash_account_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'transaction_date',s.transaction_date,'value_date',s.value_date,'row_no',s.row_no,'description',s.description,'reference',s.source_transaction_id,'amount',s.amount::text,'review_required',s.review_required,
      'matched',COALESCE(m.amount,0)::text,'remaining',(abs(s.amount)-COALESCE(m.amount,0))::text)
      ORDER BY s.transaction_date,s.row_no),'[]'::jsonb) INTO v_bank
    FROM finance.statement_lines s LEFT JOIN LATERAL(SELECT sum(x.amount)::finance.amount amount FROM finance.reconciliation_matches x LEFT JOIN finance.reconciliation_match_reversals z ON z.organization_id=x.organization_id AND z.match_id=x.id WHERE x.organization_id=s.organization_id AND x.statement_line_id=s.id AND z.id IS NULL) m ON true
   WHERE s.organization_id=p_organization_id AND s.cash_account_id=v_recon.cash_account_id AND s.transaction_date BETWEEN v_recon.starts_on AND v_recon.ends_on;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',jl.id,'accounting_date',je.accounting_date,'line_no',jl.line_no,'description',jl.description,'document_number',d.document_number,'reference',d.external_reference,'debit',jl.debit::text,'credit',jl.credit::text,'signed_amount',(jl.debit-jl.credit)::text,
      'matched',COALESCE(m.amount,0)::text,'remaining',(abs(jl.debit-jl.credit)-COALESCE(m.amount,0))::text)
      ORDER BY je.accounting_date,je.id,jl.line_no),'[]'::jsonb) INTO v_book
    FROM finance.journal_lines jl JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
    LEFT JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id
    LEFT JOIN LATERAL(SELECT sum(x.amount)::finance.amount amount FROM finance.reconciliation_matches x LEFT JOIN finance.reconciliation_match_reversals z ON z.organization_id=x.organization_id AND z.match_id=x.id WHERE x.organization_id=jl.organization_id AND x.journal_line_id=jl.id AND z.id IS NULL) m ON true
   WHERE jl.organization_id=p_organization_id AND jl.account_id=v_account.account_id AND je.accounting_date BETWEEN v_recon.starts_on AND v_recon.ends_on;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',x.id,'statement_line_id',x.statement_line_id,'journal_line_id',x.journal_line_id,'amount',x.amount::text,'created_at',x.created_at,'reversed',z.id IS NOT NULL) ORDER BY x.created_at),'[]'::jsonb)
    INTO v_matches FROM finance.reconciliation_matches x JOIN finance.reconciliations r ON r.organization_id=x.organization_id AND r.id=x.reconciliation_id LEFT JOIN finance.reconciliation_match_reversals z ON z.organization_id=x.organization_id AND z.match_id=x.id
   WHERE x.organization_id=p_organization_id AND x.reconciliation_id=p_reconciliation_id;
  RETURN jsonb_build_object('reconciliation',to_jsonb(v_recon),'cash_account',jsonb_build_object('id',v_account.id,'name',v_account.name,'kind',v_account.kind),'statement_lines',v_bank,'book_lines',v_book,'matches',v_matches);
END; $$;

CREATE FUNCTION public.add_reconciliation_match(p_organization_id uuid,p_reconciliation_id uuid,p_statement_line_id uuid,p_journal_line_id uuid,p_amount text,p_request_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_recon finance.reconciliations%ROWTYPE;v_bank finance.statement_lines%ROWTYPE;v_account finance.cash_accounts%ROWTYPE;v_book finance.journal_lines%ROWTYPE;v_date date;v_state text;v_actor uuid;v_member uuid;v_bank_used finance.amount;v_book_used finance.amount;v_id uuid;v_amount finance.amount;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'banking.write');
  SELECT id INTO v_member FROM finance.organization_members WHERE organization_id=p_organization_id AND user_id=identity.current_actor_id() AND status='active';
  IF v_member IS NULL OR p_amount IS NULL OR p_amount !~ '^\d{1,12}\.\d{2}$' OR p_amount::finance.amount<=0 OR p_request_id IS NULL OR length(p_request_id)>100 THEN RAISE EXCEPTION 'Invalid reconciliation match.' USING ERRCODE='22023'; END IF;
  v_amount:=p_amount::finance.amount;
  SELECT * INTO v_recon FROM finance.reconciliations WHERE organization_id=p_organization_id AND id=p_reconciliation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reconciliation not found.' USING ERRCODE='P0002'; END IF;
  IF v_recon.state<>'draft' THEN RAISE EXCEPTION 'Only draft reconciliations can be changed.' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_bank FROM finance.statement_lines WHERE organization_id=p_organization_id AND id=p_statement_line_id FOR UPDATE;
  IF NOT FOUND OR v_bank.cash_account_id<>v_recon.cash_account_id OR v_bank.transaction_date NOT BETWEEN v_recon.starts_on AND v_recon.ends_on THEN RAISE EXCEPTION 'Statement line is outside this reconciliation.' USING ERRCODE='23514'; END IF;
  SELECT jl INTO v_book FROM finance.journal_lines jl WHERE jl.organization_id=p_organization_id AND jl.id=p_journal_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Book line is outside this reconciliation.' USING ERRCODE='23514'; END IF;
  SELECT je.accounting_date,je.state INTO v_date,v_state FROM finance.journal_entries je WHERE je.organization_id=p_organization_id AND je.id=v_book.journal_entry_id;
  IF NOT FOUND OR v_state<>'posted' OR v_date NOT BETWEEN v_recon.starts_on AND v_recon.ends_on THEN RAISE EXCEPTION 'Book line is outside this reconciliation.' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_account FROM finance.cash_accounts WHERE organization_id=p_organization_id AND id=v_recon.cash_account_id;
  IF v_book.account_id<>v_account.account_id OR sign(v_bank.amount)<>sign(v_book.debit-v_book.credit) THEN RAISE EXCEPTION 'Statement and book lines must use the same cash account and direction.' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(sum(m.amount),0)::finance.amount INTO v_bank_used FROM finance.reconciliation_matches m LEFT JOIN finance.reconciliation_match_reversals z ON z.organization_id=m.organization_id AND z.match_id=m.id WHERE m.organization_id=p_organization_id AND m.statement_line_id=v_bank.id AND z.id IS NULL;
  SELECT COALESCE(sum(m.amount),0)::finance.amount INTO v_book_used FROM finance.reconciliation_matches m LEFT JOIN finance.reconciliation_match_reversals z ON z.organization_id=m.organization_id AND z.match_id=m.id WHERE m.organization_id=p_organization_id AND m.journal_line_id=v_book.id AND z.id IS NULL;
  IF v_amount>abs(v_bank.amount)-v_bank_used OR v_amount>abs(v_book.debit-v_book.credit)-v_book_used THEN RAISE EXCEPTION 'Match exceeds remaining line capacity.' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM finance.reconciliation_matches m LEFT JOIN finance.reconciliation_match_reversals z ON z.organization_id=m.organization_id AND z.match_id=m.id WHERE m.organization_id=p_organization_id AND m.reconciliation_id=p_reconciliation_id AND m.statement_line_id=v_bank.id AND m.journal_line_id=v_book.id AND z.id IS NULL) THEN
    RAISE EXCEPTION 'These lines already have an active match. Reverse it before changing the amount.' USING ERRCODE='23505';
  END IF;
  INSERT INTO finance.reconciliation_matches(organization_id,reconciliation_id,statement_line_id,journal_line_id,amount,created_by_member_id)
   VALUES(p_organization_id,p_reconciliation_id,v_bank.id,v_book.id,v_amount,v_member) RETURNING id INTO v_id;
  INSERT INTO finance.audit_events(organization_id,actor_member_id,actor_kind,action,entity_type,entity_id,request_id,redacted_change)
   VALUES(p_organization_id,v_member,'user','reconciliation.match_added','reconciliation_match',v_id,p_request_id,jsonb_build_object('reconciliation_id',p_reconciliation_id,'statement_line_id',v_bank.id,'journal_line_id',v_book.id,'amount',v_amount::text));
  RETURN v_id;
END; $$;

CREATE FUNCTION public.reverse_reconciliation_match(p_organization_id uuid,p_reconciliation_id uuid,p_match_id uuid,p_reason text,p_request_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_member uuid;v_recon finance.reconciliations%ROWTYPE;v_id uuid;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'banking.write');
  SELECT id INTO v_member FROM finance.organization_members WHERE organization_id=p_organization_id AND user_id=identity.current_actor_id() AND status='active';
  IF v_member IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 OR p_request_id IS NULL OR length(p_request_id)>100 THEN RAISE EXCEPTION 'A reason is required to reverse a match.' USING ERRCODE='22023'; END IF;
  SELECT r.* INTO v_recon FROM finance.reconciliations r JOIN finance.reconciliation_matches m ON m.organization_id=r.organization_id AND m.reconciliation_id=r.id WHERE r.organization_id=p_organization_id AND r.id=p_reconciliation_id AND m.id=p_match_id FOR UPDATE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reconciliation match not found.' USING ERRCODE='P0002'; END IF;
  IF v_recon.state<>'draft' THEN RAISE EXCEPTION 'Only draft reconciliation matches can be reversed.' USING ERRCODE='55000'; END IF;
  INSERT INTO finance.reconciliation_match_reversals(organization_id,match_id,created_by_member_id,reason) VALUES(p_organization_id,p_match_id,v_member,p_reason) RETURNING id INTO v_id;
  INSERT INTO finance.audit_events(organization_id,actor_member_id,actor_kind,action,entity_type,entity_id,request_id,reason,redacted_change)
   VALUES(p_organization_id,v_member,'user','reconciliation.match_reversed','reconciliation_match',p_match_id,p_request_id,p_reason,jsonb_build_object('reversal_id',v_id,'reconciliation_id',p_reconciliation_id));
  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.create_reconciliation(uuid,uuid,date,date,text,text,text) FROM PUBLIC,ams_runtime;
REVOKE ALL ON FUNCTION public.read_reconciliation_workspace(uuid,uuid) FROM PUBLIC,ams_runtime;
REVOKE ALL ON FUNCTION public.add_reconciliation_match(uuid,uuid,uuid,uuid,text,text) FROM PUBLIC,ams_runtime;
REVOKE ALL ON FUNCTION public.reverse_reconciliation_match(uuid,uuid,uuid,text,text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.create_reconciliation(uuid,uuid,date,date,text,text,text) TO ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_reconciliation_workspace(uuid,uuid) TO ams_runtime;
GRANT EXECUTE ON FUNCTION public.add_reconciliation_match(uuid,uuid,uuid,uuid,text,text) TO ams_runtime;
GRANT EXECUTE ON FUNCTION public.reverse_reconciliation_match(uuid,uuid,uuid,text,text) TO ams_runtime;
NOTIFY pgrst,'reload schema';
