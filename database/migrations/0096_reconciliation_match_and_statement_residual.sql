-- Repair the composite-row assignment proved by the real restricted RPC.
-- Finalization must resolve every bank-only movement (accounting rules02:219),
-- even when opposite unmatched movements net to zero. Outstanding book lines
-- remain valid adjustments under the existing close calculation.
-- Patch exactly one known anchor in each function, preserving its privileges,
-- organization/period/authentication gates, locks and immutable close evidence.
DO $patch$
DECLARE v_signature regprocedure;v_definition text;v_old text;v_new text;
BEGIN
  v_signature:='public.add_reconciliation_match(uuid,uuid,uuid,uuid,text,text)'::regprocedure;
  v_old:=$needle$SELECT jl INTO v_book FROM finance.journal_lines jl$needle$;
  v_new:=$replacement$SELECT jl.* INTO v_book FROM finance.journal_lines jl$replacement$;
  v_definition:=pg_catalog.pg_get_functiondef(v_signature);
  IF position(v_old IN v_definition)=0 OR length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) THEN
    RAISE EXCEPTION 'expected one reconciliation book-row selection in %',v_signature;
  END IF;
  EXECUTE replace(v_definition,v_old,v_new);

  v_signature:='public.finalize_reconciliation(uuid,uuid,text)'::regprocedure;
  v_old:=$needle$  v_statement_calculated:=v_recon.statement_opening+v_statement_sum;$needle$;
  v_new:=$replacement$  IF EXISTS(
    SELECT 1 FROM finance.statement_lines s
    LEFT JOIN LATERAL(
      SELECT sum(x.amount)::finance.amount AS matched
      FROM finance.reconciliation_matches x
      LEFT JOIN finance.reconciliation_match_reversals z
        ON z.organization_id=x.organization_id AND z.match_id=x.id
      WHERE x.organization_id=s.organization_id AND x.statement_line_id=s.id AND z.id IS NULL
    ) m ON true
    WHERE s.organization_id=p_organization_id AND s.cash_account_id=v_cash.id
      AND s.transaction_date BETWEEN v_recon.starts_on AND v_recon.ends_on
      AND abs(s.amount)<>COALESCE(m.matched,0)
  ) THEN
    RAISE EXCEPTION 'resolve every unmatched statement movement before finalizing' USING ERRCODE='23514';
  END IF;
  v_statement_calculated:=v_recon.statement_opening+v_statement_sum;$replacement$;
  v_definition:=pg_catalog.pg_get_functiondef(v_signature);
  IF position(v_old IN v_definition)=0 OR length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) THEN
    RAISE EXCEPTION 'expected one reconciliation statement calculation in %',v_signature;
  END IF;
  EXECUTE replace(v_definition,v_old,v_new);

  -- Finalization reads active capacities across sessions. Match mutations must
  -- take its existing organization lock before any session/line locks, and
  -- protect a finalized range even when another draft owns the actual links.
  FOR v_signature,v_old,v_new IN SELECT * FROM (VALUES
    ('public.add_reconciliation_match(uuid,uuid,uuid,uuid,text,text)'::regprocedure,
     $needle$  SELECT * INTO v_recon FROM finance.reconciliations WHERE organization_id=p_organization_id AND id=p_reconciliation_id FOR UPDATE;$needle$,
     $replacement$  PERFORM pg_advisory_xact_lock(hashtext(p_organization_id::text),711046);
  SELECT * INTO v_recon FROM finance.reconciliations WHERE organization_id=p_organization_id AND id=p_reconciliation_id FOR UPDATE;$replacement$),
    ('public.add_reconciliation_match(uuid,uuid,uuid,uuid,text,text)'::regprocedure,
     $needle$  SELECT COALESCE(sum(m.amount),0)::finance.amount INTO v_bank_used$needle$,
     $replacement$  IF EXISTS(SELECT 1 FROM finance.reconciliations r
    WHERE r.organization_id=p_organization_id AND r.cash_account_id=v_account.id AND r.state='finalized'
      AND (v_bank.transaction_date BETWEEN r.starts_on AND r.ends_on OR v_date BETWEEN r.starts_on AND r.ends_on)
  ) THEN
    RAISE EXCEPTION 'reopen the finalized reconciliation before changing its statement or book matches' USING ERRCODE='55000';
  END IF;
  SELECT COALESCE(sum(m.amount),0)::finance.amount INTO v_bank_used$replacement$),
    ('public.reverse_reconciliation_match(uuid,uuid,uuid,text,text)'::regprocedure,
     $needle$  SELECT r.* INTO v_recon FROM finance.reconciliations r JOIN finance.reconciliation_matches m$needle$,
     $replacement$  PERFORM pg_advisory_xact_lock(hashtext(p_organization_id::text),711046);
  SELECT r.* INTO v_recon FROM finance.reconciliations r JOIN finance.reconciliation_matches m$replacement$),
    ('public.reverse_reconciliation_match(uuid,uuid,uuid,text,text)'::regprocedure,
     $needle$  INSERT INTO finance.reconciliation_match_reversals(organization_id,match_id,created_by_member_id,reason)$needle$,
     $replacement$  IF EXISTS(
    SELECT 1 FROM finance.reconciliation_matches m
    JOIN finance.statement_lines s ON s.organization_id=m.organization_id AND s.id=m.statement_line_id
    JOIN finance.journal_lines jl ON jl.organization_id=m.organization_id AND jl.id=m.journal_line_id
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
    JOIN finance.reconciliations r ON r.organization_id=m.organization_id AND r.cash_account_id=v_recon.cash_account_id
      AND r.state='finalized'
      AND (s.transaction_date BETWEEN r.starts_on AND r.ends_on OR je.accounting_date BETWEEN r.starts_on AND r.ends_on)
    WHERE m.organization_id=p_organization_id AND m.reconciliation_id=v_recon.id AND m.id=p_match_id
  ) THEN
    RAISE EXCEPTION 'reopen the finalized reconciliation before changing its statement or book matches' USING ERRCODE='55000';
  END IF;
  INSERT INTO finance.reconciliation_match_reversals(organization_id,match_id,created_by_member_id,reason)$replacement$)
  ) AS patches(signature,needle,replacement)
  LOOP
    v_definition:=pg_catalog.pg_get_functiondef(v_signature);
    IF position(v_old IN v_definition)=0 OR length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) THEN
      RAISE EXCEPTION 'expected one reconciliation match protection anchor in %',v_signature;
    END IF;
    EXECUTE replace(v_definition,v_old,v_new);
  END LOOP;
END;
$patch$;
