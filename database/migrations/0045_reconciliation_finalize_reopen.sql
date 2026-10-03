-- US-051: reconcile exact statement/book balances and retain immutable finalize history.
CREATE TABLE finance.reconciliation_reopen_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  reconciliation_id uuid NOT NULL,
  actor_member_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 1000),
  prior_evidence_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,reconciliation_id) REFERENCES finance.reconciliations(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,actor_member_id) REFERENCES finance.organization_members(organization_id,id) ON DELETE RESTRICT
);
ALTER TABLE finance.reconciliation_reopen_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.reconciliation_reopen_events FROM PUBLIC,ams_runtime;
GRANT SELECT ON finance.reconciliation_reopen_events TO ams_runtime;
CREATE POLICY reconciliation_reopen_events_read ON finance.reconciliation_reopen_events FOR SELECT TO ams_runtime USING (finance_private.has_permission(organization_id,'banking.read'));

CREATE FUNCTION finance_private.guard_cash_evidence_after_finalize()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_date date;v_cash_id uuid;
BEGIN
  IF TG_TABLE_NAME='statement_lines' THEN
    v_cash_id:=NEW.cash_account_id;
    PERFORM 1 FROM finance.cash_accounts WHERE organization_id=NEW.organization_id AND id=v_cash_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM finance.reconciliations r WHERE r.organization_id=NEW.organization_id AND r.cash_account_id=v_cash_id AND r.state='finalized' AND NEW.transaction_date BETWEEN r.starts_on AND r.ends_on) THEN
      RAISE EXCEPTION 'reopen the finalized reconciliation before importing statement evidence for this date' USING ERRCODE='55000';
    END IF;
  ELSIF TG_TABLE_NAME='journal_lines' THEN
    SELECT je.accounting_date INTO v_date FROM finance.journal_entries je WHERE je.organization_id=NEW.organization_id AND je.id=NEW.journal_entry_id;
    IF EXISTS(SELECT 1 FROM finance.cash_accounts c JOIN finance.reconciliations r ON r.organization_id=c.organization_id AND r.cash_account_id=c.id
      WHERE c.organization_id=NEW.organization_id AND c.account_id=NEW.account_id AND r.state='finalized' AND v_date<=r.ends_on) THEN
      RAISE EXCEPTION 'reopen the finalized reconciliation before posting cash activity dated on or before its closing date' USING ERRCODE='55000';
    END IF;
    IF EXISTS(SELECT 1 FROM finance.cash_accounts c WHERE c.organization_id=NEW.organization_id AND c.account_id=NEW.account_id) THEN
      PERFORM pg_advisory_xact_lock(hashtext(NEW.organization_id::text),711046);
      PERFORM 1 FROM finance.cash_accounts c WHERE c.organization_id=NEW.organization_id AND c.account_id=NEW.account_id FOR UPDATE;
      IF EXISTS(SELECT 1 FROM finance.cash_accounts c JOIN finance.reconciliations r ON r.organization_id=c.organization_id AND r.cash_account_id=c.id
        WHERE c.organization_id=NEW.organization_id AND c.account_id=NEW.account_id AND r.state='finalized' AND v_date<=r.ends_on) THEN
        RAISE EXCEPTION 'reopen the finalized reconciliation before posting cash activity dated on or before its closing date' USING ERRCODE='55000';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION finance_private.guard_cash_evidence_after_finalize() FROM PUBLIC,ams_runtime;
CREATE TRIGGER statement_lines_guard_finalized_evidence BEFORE INSERT ON finance.statement_lines FOR EACH ROW EXECUTE FUNCTION finance_private.guard_cash_evidence_after_finalize();
CREATE TRIGGER journal_lines_guard_finalized_evidence BEFORE INSERT ON finance.journal_lines FOR EACH ROW EXECUTE FUNCTION finance_private.guard_cash_evidence_after_finalize();

CREATE FUNCTION public.finalize_reconciliation(p_organization_id uuid,p_reconciliation_id uuid,p_request_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid;v_recon finance.reconciliations%ROWTYPE;v_cash finance.cash_accounts%ROWTYPE;
  v_statement_sum finance.amount;v_statement_calculated finance.amount;v_book_open finance.amount;v_book_movement finance.amount;v_book_close finance.amount;
  v_unmatched_book finance.amount;v_adjusted_statement finance.amount;v_difference finance.amount;v_snapshot jsonb;v_now timestamptz:=clock_timestamp();
BEGIN
  v_actor:=finance_private.require_period_action(p_organization_id,'periods.lock');
  PERFORM finance_private.validate_request_id(p_request_id);
  PERFORM pg_advisory_xact_lock(hashtext(p_organization_id::text),711046);
  SELECT * INTO v_recon FROM finance.reconciliations WHERE organization_id=p_organization_id AND id=p_reconciliation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reconciliation not found' USING ERRCODE='P0002'; END IF;
  IF v_recon.state<>'draft' THEN RAISE EXCEPTION 'reconciliation is already finalized' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_cash FROM finance.cash_accounts WHERE organization_id=p_organization_id AND id=v_recon.cash_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cash account unavailable' USING ERRCODE='P0002'; END IF;
  IF EXISTS(SELECT 1 FROM finance.reconciliations r WHERE r.organization_id=p_organization_id AND r.cash_account_id=v_cash.id AND r.id<>v_recon.id AND r.state='finalized' AND daterange(r.starts_on,r.ends_on,'[]') && daterange(v_recon.starts_on,v_recon.ends_on,'[]')) THEN
    RAISE EXCEPTION 'another finalized reconciliation overlaps this date range' USING ERRCODE='23P01';
  END IF;
  SELECT COALESCE(sum(s.amount),0)::finance.amount INTO v_statement_sum FROM finance.statement_lines s
   WHERE s.organization_id=p_organization_id AND s.cash_account_id=v_cash.id AND s.transaction_date BETWEEN v_recon.starts_on AND v_recon.ends_on;
  v_statement_calculated:=v_recon.statement_opening+v_statement_sum;
  SELECT COALESCE(sum(jl.debit-jl.credit) FILTER(WHERE je.accounting_date<v_recon.starts_on),0)::finance.amount,
         COALESCE(sum(jl.debit-jl.credit) FILTER(WHERE je.accounting_date BETWEEN v_recon.starts_on AND v_recon.ends_on),0)::finance.amount
    INTO v_book_open,v_book_movement FROM finance.journal_lines jl JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
   WHERE jl.organization_id=p_organization_id AND jl.account_id=v_cash.account_id;
  v_book_close:=v_book_open+v_book_movement;
  SELECT COALESCE(sum(sign(jl.debit-jl.credit)*(abs(jl.debit-jl.credit)-COALESCE(m.matched,0))),0)::finance.amount INTO v_unmatched_book
    FROM finance.journal_lines jl JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
    LEFT JOIN LATERAL(SELECT sum(x.amount)::finance.amount matched FROM finance.reconciliation_matches x LEFT JOIN finance.reconciliation_match_reversals z ON z.organization_id=x.organization_id AND z.match_id=x.id
      WHERE x.organization_id=jl.organization_id AND x.journal_line_id=jl.id AND z.id IS NULL) m ON true
   WHERE jl.organization_id=p_organization_id AND jl.account_id=v_cash.account_id AND je.accounting_date BETWEEN v_recon.starts_on AND v_recon.ends_on;
  v_adjusted_statement:=v_recon.statement_closing+v_unmatched_book;
  v_difference:=v_adjusted_statement-v_book_close;
  IF v_statement_calculated<>v_recon.statement_closing THEN RAISE EXCEPTION 'statement opening plus imported statement movements does not equal statement closing' USING ERRCODE='23514'; END IF;
  IF v_difference<>0 THEN RAISE EXCEPTION 'adjusted statement closing does not equal the posted book closing; resolve bank-only items before finalizing' USING ERRCODE='23514'; END IF;

  SELECT jsonb_build_object('version',1,'finalized_at',v_now,'cash_account_id',v_cash.id,'starts_on',v_recon.starts_on,'ends_on',v_recon.ends_on,
    'statement_opening',v_recon.statement_opening::text,'statement_movements',v_statement_sum::text,'statement_calculated_closing',v_statement_calculated::text,'statement_closing',v_recon.statement_closing::text,
    'book_opening',v_book_open::text,'book_movements',v_book_movement::text,'book_closing',v_book_close::text,'unmatched_book_adjustment',v_unmatched_book::text,
    'adjusted_statement_closing',v_adjusted_statement::text,'unexplained_difference',v_difference::text,
    'unmatched_statement_lines',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'date',s.transaction_date,'description',s.description,'amount',s.amount::text,'remaining',(abs(s.amount)-COALESCE(m.matched,0))::text) ORDER BY s.transaction_date,s.row_no)
      FROM finance.statement_lines s LEFT JOIN LATERAL(SELECT sum(x.amount)::finance.amount matched FROM finance.reconciliation_matches x LEFT JOIN finance.reconciliation_match_reversals z ON z.organization_id=x.organization_id AND z.match_id=x.id WHERE x.organization_id=s.organization_id AND x.statement_line_id=s.id AND z.id IS NULL) m ON true
      WHERE s.organization_id=p_organization_id AND s.cash_account_id=v_cash.id AND s.transaction_date BETWEEN v_recon.starts_on AND v_recon.ends_on AND abs(s.amount)>COALESCE(m.matched,0)),'[]'::jsonb),
    'outstanding_book_lines',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',jl.id,'date',je.accounting_date,'description',jl.description,'signed_amount',(jl.debit-jl.credit)::text,'remaining',(abs(jl.debit-jl.credit)-COALESCE(m.matched,0))::text) ORDER BY je.accounting_date,je.id,jl.line_no)
      FROM finance.journal_lines jl JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted' LEFT JOIN LATERAL(SELECT sum(x.amount)::finance.amount matched FROM finance.reconciliation_matches x LEFT JOIN finance.reconciliation_match_reversals z ON z.organization_id=x.organization_id AND z.match_id=x.id WHERE x.organization_id=jl.organization_id AND x.journal_line_id=jl.id AND z.id IS NULL) m ON true
      WHERE jl.organization_id=p_organization_id AND jl.account_id=v_cash.account_id AND je.accounting_date BETWEEN v_recon.starts_on AND v_recon.ends_on AND abs(jl.debit-jl.credit)>COALESCE(m.matched,0)),'[]'::jsonb))
   INTO v_snapshot;
  UPDATE finance.reconciliations SET state='finalized',finalized_by_member_id=v_actor,finalized_at=v_now,evidence_snapshot=v_snapshot
   WHERE organization_id=p_organization_id AND id=v_recon.id;
  INSERT INTO finance.audit_events(organization_id,actor_member_id,actor_kind,action,entity_type,entity_id,request_id,redacted_change)
   VALUES(p_organization_id,v_actor,'user','reconciliation.finalized','reconciliation',v_recon.id,p_request_id,jsonb_build_object('statement_closing',v_recon.statement_closing::text,'book_closing',v_book_close::text,'adjusted_statement_closing',v_adjusted_statement::text));
  RETURN jsonb_build_object('id',v_recon.id,'state','finalized','evidence',v_snapshot);
END; $$;

CREATE FUNCTION public.reopen_reconciliation(p_organization_id uuid,p_reconciliation_id uuid,p_reason text,p_request_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid;v_recon finance.reconciliations%ROWTYPE;v_event_id uuid;
BEGIN
  v_actor:=finance_private.require_period_action(p_organization_id,'periods.reopen');
  PERFORM finance_private.require_recent_auth();
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 10 AND 1000 THEN RAISE EXCEPTION 'reopen reason must be 10-1000 characters' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_recon FROM finance.reconciliations WHERE organization_id=p_organization_id AND id=p_reconciliation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reconciliation not found' USING ERRCODE='P0002'; END IF;
  IF v_recon.state<>'finalized' OR v_recon.finalized_at IS NULL THEN RAISE EXCEPTION 'only a finalized reconciliation can be reopened' USING ERRCODE='23514'; END IF;
  INSERT INTO finance.reconciliation_reopen_events(organization_id,reconciliation_id,actor_member_id,reason,prior_evidence_snapshot)
   VALUES(p_organization_id,v_recon.id,v_actor,btrim(p_reason),v_recon.evidence_snapshot) RETURNING id INTO v_event_id;
  UPDATE finance.reconciliations SET state='draft',finalized_by_member_id=NULL,finalized_at=NULL
   WHERE organization_id=p_organization_id AND id=v_recon.id;
  INSERT INTO finance.audit_events(organization_id,actor_member_id,actor_kind,action,entity_type,entity_id,request_id,reason,redacted_change)
   VALUES(p_organization_id,v_actor,'user','reconciliation.reopened','reconciliation',v_recon.id,p_request_id,btrim(p_reason),jsonb_build_object('reopen_event_id',v_event_id,'prior_finalized_at',v_recon.finalized_at));
  RETURN v_event_id;
END; $$;

REVOKE ALL ON FUNCTION public.finalize_reconciliation(uuid,uuid,text) FROM PUBLIC,ams_runtime;
REVOKE ALL ON FUNCTION public.reopen_reconciliation(uuid,uuid,text,text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.finalize_reconciliation(uuid,uuid,text) TO ams_runtime;
GRANT EXECUTE ON FUNCTION public.reopen_reconciliation(uuid,uuid,text,text) TO ams_runtime;
NOTIFY pgrst,'reload schema';
