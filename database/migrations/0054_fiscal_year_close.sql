-- US-061: preview, post, reopen and reclose without rewriting prior ledger facts.
CREATE FUNCTION finance_private.year_close_preview(p_organization_id uuid,p_fiscal_year_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_year finance.fiscal_years%ROWTYPE;v_data jsonb;
BEGIN
  SELECT * INTO v_year FROM finance.fiscal_years f WHERE f.organization_id=p_organization_id AND f.id=p_fiscal_year_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'fiscal year not found' USING ERRCODE='P0002'; END IF;
  WITH periods AS (
    SELECT p.id,p.status,finance_private.period_close_checklist(p_organization_id,p.id) AS checklist
    FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.fiscal_year_id=p_fiscal_year_id
  ), nominal AS (
    SELECT a.id,a.code,a.name,a.account_type,COALESCE(sum(jl.debit-jl.credit),0)::numeric AS balance
    FROM finance.accounts a LEFT JOIN finance.journal_lines jl ON jl.organization_id=a.organization_id AND jl.account_id=a.id
    LEFT JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted' AND je.accounting_date<=v_year.ends_on
    LEFT JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id AND d.state='posted'
    WHERE a.organization_id=p_organization_id AND a.account_type IN ('income','expense') AND (d.id IS NOT NULL OR jl.id IS NULL)
    GROUP BY a.id,a.code,a.name,a.account_type HAVING COALESCE(sum(jl.debit-jl.credit),0)<>0
  ), mapping AS (
    SELECT a.id,a.code,a.name,a.account_type,a.account_type='equity' AND a.is_active AND a.is_postable AS available
    FROM finance.account_mappings m JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id
    WHERE m.organization_id=p_organization_id AND m.mapping_key='retained_earnings'
  ), prior AS (
    SELECT count(*)::integer AS n FROM finance.fiscal_years f WHERE f.organization_id=p_organization_id AND f.ends_on<v_year.starts_on AND f.status='open'
  ), live AS (
    SELECT count(*)::integer AS n FROM finance.year_close_runs r WHERE r.organization_id=p_organization_id AND r.fiscal_year_id=p_fiscal_year_id AND r.reopen_document_id IS NULL
  ), totals AS (
    SELECT count(*)::integer AS nominal_count,COALESCE(-sum(balance),0)::numeric AS profit,
      COALESCE(sum(CASE WHEN balance<0 THEN -balance ELSE 0 END),0)::numeric+GREATEST(COALESCE(sum(balance),0),0) AS debit_total
    FROM nominal
  ), check_data AS (
    SELECT count(*)::integer AS period_count,count(*) FILTER(WHERE status='locked')::integer AS locked_count,
      count(*) FILTER(WHERE NOT COALESCE((checklist->>'passed')::boolean,false))::integer AS failing_checks
    FROM periods
  ), detail AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('account_id',id,'code',code,'name',name,'account_type',account_type,'signed_balance',(CASE WHEN account_type='income' THEN -balance ELSE balance END)::text,
      'close_debit',CASE WHEN balance<0 THEN (-balance)::text ELSE '0.00' END,'close_credit',CASE WHEN balance>0 THEN balance::text ELSE '0.00' END) ORDER BY code),'[]'::jsonb) AS lines FROM nominal
  ), rules AS (
    SELECT COALESCE((SELECT available FROM mapping LIMIT 1),false) AS mapping_ok,
      COALESCE((SELECT id FROM mapping LIMIT 1),NULL::uuid) AS retained_id,
      COALESCE((SELECT name FROM mapping LIMIT 1),NULL::text) AS retained_name,
      (SELECT n FROM prior) AS prior_open_years,(SELECT n FROM live) AS active_close_runs,
      (SELECT period_count FROM check_data) AS period_count,(SELECT locked_count FROM check_data) AS locked_count,
      (SELECT failing_checks FROM check_data) AS failing_checks,(SELECT nominal_count FROM totals) AS nominal_count,
      (SELECT profit FROM totals) AS profit,(SELECT debit_total FROM totals) AS debit_total,(SELECT lines FROM detail) AS lines
  )
  SELECT jsonb_build_object('fiscal_year_id',p_fiscal_year_id,'label',v_year.label,'starts_on',v_year.starts_on,'ends_on',v_year.ends_on,'year_status',v_year.status,
    'period_count',r.period_count,'locked_period_count',r.locked_count,'period_check_failures',r.failing_checks,'retained_earnings_account_id',r.retained_id,
    'retained_earnings_account_name',r.retained_name,'retained_earnings_mapping_ok',r.mapping_ok,'prior_open_year_count',r.prior_open_years,
    'active_close_runs',r.active_close_runs,'nominal_account_count',r.nominal_count,'profit',r.profit::text,'lines',r.lines,
    'retained_earnings_debit',CASE WHEN r.profit<0 THEN (-r.profit)::text ELSE '0.00' END,
    'retained_earnings_credit',CASE WHEN r.profit>0 THEN r.profit::text ELSE '0.00' END,'debit_total',r.debit_total::text,
    'can_close',(v_year.status='open' AND r.period_count>0 AND r.period_count=r.locked_count AND r.failing_checks=0 AND r.mapping_ok AND r.prior_open_years=0 AND r.active_close_runs=0 AND r.nominal_count>0),
    'generated_at',transaction_timestamp()) INTO v_data FROM rules r;
  RETURN v_data;
END $$;
REVOKE ALL ON FUNCTION finance_private.year_close_preview(uuid,uuid) FROM PUBLIC,ams_runtime;

CREATE FUNCTION public.read_year_close_preview(p_organization_id uuid,p_fiscal_year_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM finance_private.require_capability(p_organization_id,'accounting.read');RETURN finance_private.year_close_preview(p_organization_id,p_fiscal_year_id);END $$;
REVOKE ALL ON FUNCTION public.read_year_close_preview(uuid,uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_year_close_preview(uuid,uuid) TO ams_runtime;

CREATE FUNCTION public.list_year_close_workspace(p_organization_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'accounting.read');
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.id,'label',f.label,'starts_on',f.starts_on,'ends_on',f.ends_on,'status',f.status,
    'active_close',active.run,'history',history.runs) ORDER BY f.starts_on DESC)
    FROM finance.fiscal_years f
    LEFT JOIN LATERAL(SELECT jsonb_build_object('run_id',r.id,'document_id',r.close_document_id,'created_at',r.created_at,'snapshot',r.report_snapshot) AS run
      FROM finance.year_close_runs r WHERE r.organization_id=f.organization_id AND r.fiscal_year_id=f.id AND r.reopen_document_id IS NULL ORDER BY r.created_at DESC LIMIT 1) active ON true
    LEFT JOIN LATERAL(SELECT COALESCE(jsonb_agg(jsonb_build_object('run_id',r.id,'close_document_id',r.close_document_id,'reopen_document_id',r.reopen_document_id,'created_at',r.created_at,'snapshot',r.report_snapshot) ORDER BY r.created_at DESC),'[]'::jsonb) AS runs
      FROM finance.year_close_runs r WHERE r.organization_id=f.organization_id AND r.fiscal_year_id=f.id) history ON true
    WHERE f.organization_id=p_organization_id),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.list_year_close_workspace(uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.list_year_close_workspace(uuid) TO ams_runtime;

CREATE FUNCTION finance_private.guard_year_close_run_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' OR (NEW.organization_id,NEW.id,NEW.fiscal_year_id,NEW.close_document_id,NEW.created_by_member_id,NEW.report_snapshot,NEW.created_at)
    IS DISTINCT FROM (OLD.organization_id,OLD.id,OLD.fiscal_year_id,OLD.close_document_id,OLD.created_by_member_id,OLD.report_snapshot,OLD.created_at)
    OR OLD.reopen_document_id IS NOT NULL OR NEW.reopen_document_id IS NULL THEN
    RAISE EXCEPTION 'year-close history is append-only; only one reopen link is allowed' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_year_close_run_mutation() FROM PUBLIC,ams_runtime;
CREATE TRIGGER year_close_runs_append_only BEFORE UPDATE OR DELETE ON finance.year_close_runs FOR EACH ROW EXECUTE FUNCTION finance_private.guard_year_close_run_mutation();

CREATE FUNCTION public.close_fiscal_year(p_organization_id uuid,p_fiscal_year_id uuid,p_request_id text,p_idempotency_key text,p_request_hash text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid;v_year finance.fiscal_years%ROWTYPE;v_preview jsonb;v_existing finance.idempotency_requests%ROWTYPE;
  v_doc uuid:=gen_random_uuid();v_entry uuid:=gen_random_uuid();v_number text;v_retained uuid;v_period uuid;v_total finance.amount;
  v_balance record;v_line_no integer:=0;v_receipt jsonb;v_run uuid:=gen_random_uuid();v_now timestamptz:=clock_timestamp();
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 200 OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid idempotency data' USING ERRCODE='22023'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 10 AND 1000 THEN RAISE EXCEPTION 'close reason must be 10-1000 characters' USING ERRCODE='22023'; END IF;
  v_actor:=finance_private.require_period_action(p_organization_id,'periods.lock');
  SELECT * INTO v_year FROM finance.fiscal_years f WHERE f.organization_id=p_organization_id AND f.id=p_fiscal_year_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fiscal year not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_existing FROM finance.idempotency_requests i WHERE i.organization_id=p_organization_id AND i.operation='fiscal-year.close:'||p_fiscal_year_id::text AND i.idempotency_key=p_idempotency_key;
  IF FOUND THEN IF v_existing.actor_member_id<>v_actor OR v_existing.request_hash<>p_request_hash THEN RAISE EXCEPTION 'idempotency key reused for a different request' USING ERRCODE='23505'; END IF;RETURN v_existing.response_body;END IF;
  PERFORM p.id FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.fiscal_year_id=p_fiscal_year_id ORDER BY p.starts_on,p.id FOR UPDATE;
  v_preview:=finance_private.year_close_preview(p_organization_id,p_fiscal_year_id);
  IF NOT (v_preview->>'can_close')::boolean THEN RAISE EXCEPTION 'year close prerequisites are not satisfied' USING ERRCODE='23514',DETAIL=v_preview::text; END IF;
  SELECT p.id INTO v_period FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.fiscal_year_id=p_fiscal_year_id AND p.ends_on=v_year.ends_on ORDER BY p.starts_on DESC LIMIT 1;
  SELECT m.account_id INTO v_retained FROM finance.account_mappings m JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id
    WHERE m.organization_id=p_organization_id AND m.mapping_key='retained_earnings' AND a.account_type='equity' AND a.is_active AND a.is_postable;
  IF v_retained IS NULL THEN RAISE EXCEPTION 'active retained-earnings mapping is required' USING ERRCODE='23514'; END IF;
  v_total:=(v_preview->>'debit_total')::finance.amount;
  INSERT INTO finance.business_documents(organization_id,id,document_type,state,fiscal_year_id,issue_date,accounting_date,description,net_amount,total_amount,created_by_member_id)
    VALUES(p_organization_id,v_doc,'year_close','approved',p_fiscal_year_id,v_year.ends_on,v_year.ends_on,'Fiscal year close · '||v_year.label,v_total,v_total,v_actor);
  INSERT INTO finance.journal_entries(organization_id,id,source_document_id,period_id,accounting_date,state,is_year_close,posted_by_member_id)
    VALUES(p_organization_id,v_entry,v_doc,v_period,v_year.ends_on,'building',true,v_actor);
  FOR v_balance IN SELECT a.id,a.code,a.name,COALESCE(sum(jl.debit-jl.credit),0)::finance.amount AS balance
    FROM finance.accounts a JOIN finance.journal_lines jl ON jl.organization_id=a.organization_id AND jl.account_id=a.id
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted' AND je.accounting_date<=v_year.ends_on
    JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id AND d.state='posted'
    WHERE a.organization_id=p_organization_id AND a.account_type IN ('income','expense') GROUP BY a.id,a.code,a.name HAVING sum(jl.debit-jl.credit)<>0 ORDER BY a.code,a.id LOOP
    v_line_no:=v_line_no+1;
    INSERT INTO finance.journal_lines(organization_id,journal_entry_id,line_no,account_id,debit,credit,description)
      VALUES(p_organization_id,v_entry,v_line_no,v_balance.id,GREATEST(-v_balance.balance,0),GREATEST(v_balance.balance,0),'Year close · '||v_balance.code||' · '||v_balance.name);
  END LOOP;
  IF v_total<=0 THEN RAISE EXCEPTION 'there are no nominal balances to close' USING ERRCODE='23514'; END IF;
  IF (v_preview->>'profit')::numeric>0 THEN
    v_line_no:=v_line_no+1;INSERT INTO finance.journal_lines(organization_id,journal_entry_id,line_no,account_id,debit,credit,description)
      VALUES(p_organization_id,v_entry,v_line_no,v_retained,0,(v_preview->>'profit')::finance.amount,'Transfer annual profit to retained earnings');
  ELSIF (v_preview->>'profit')::numeric<0 THEN
    v_line_no:=v_line_no+1;INSERT INTO finance.journal_lines(organization_id,journal_entry_id,line_no,account_id,debit,credit,description)
      VALUES(p_organization_id,v_entry,v_line_no,v_retained,(-(v_preview->>'profit')::numeric)::finance.amount,0,'Transfer annual loss to retained earnings');
  END IF;
  v_number:=finance_private.allocate_document_number(p_organization_id,v_doc);
  UPDATE finance.journal_entries SET state='posted',posted_at=v_now WHERE organization_id=p_organization_id AND id=v_entry;
  UPDATE finance.business_documents SET state='posted',document_number=v_number,posted_by_member_id=v_actor,posted_at=v_now,updated_at=v_now
    WHERE organization_id=p_organization_id AND id=v_doc;
  INSERT INTO finance.year_close_runs(organization_id,id,fiscal_year_id,close_document_id,created_by_member_id,report_snapshot,created_at)
    VALUES(p_organization_id,v_run,p_fiscal_year_id,v_doc,v_actor,jsonb_build_object('version',1,'preview',v_preview,'close_reason',btrim(p_reason),'closed_at',v_now,'journal_entry_id',v_entry),v_now);
  UPDATE finance.fiscal_years SET status='closed' WHERE organization_id=p_organization_id AND id=p_fiscal_year_id;
  v_receipt:=jsonb_build_object('run_id',v_run,'document_id',v_doc,'document_number',v_number,'journal_entry_id',v_entry,'profit',v_preview->>'profit','status','closed');
  INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body,resource_document_id)
    VALUES(p_organization_id,'fiscal-year.close:'||p_fiscal_year_id::text,p_idempotency_key,p_request_hash,v_actor,200,v_receipt,v_doc);
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'fiscal_year.close','fiscal_year',p_fiscal_year_id,p_request_id,v_receipt||jsonb_build_object('reason',btrim(p_reason),'snapshot',v_preview));
  RETURN v_receipt;
END $$;

CREATE FUNCTION public.reopen_fiscal_year(p_organization_id uuid,p_fiscal_year_id uuid,p_request_id text,p_idempotency_key text,p_request_hash text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid;v_year finance.fiscal_years%ROWTYPE;v_run finance.year_close_runs%ROWTYPE;v_source finance.business_documents%ROWTYPE;v_existing finance.idempotency_requests%ROWTYPE;
  v_entry_id uuid:=gen_random_uuid();v_doc_id uuid:=gen_random_uuid();v_number text;v_period uuid;v_line record;v_line_no integer:=0;v_total finance.amount;v_now timestamptz:=clock_timestamp();v_receipt jsonb;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 200 OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid idempotency data' USING ERRCODE='22023'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 10 AND 1000 THEN RAISE EXCEPTION 'reopen reason must be 10-1000 characters' USING ERRCODE='22023'; END IF;
  v_actor:=finance_private.require_period_action(p_organization_id,'periods.reopen');
  SELECT * INTO v_year FROM finance.fiscal_years f WHERE f.organization_id=p_organization_id AND f.id=p_fiscal_year_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fiscal year not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_existing FROM finance.idempotency_requests i WHERE i.organization_id=p_organization_id AND i.operation='fiscal-year.reopen:'||p_fiscal_year_id::text AND i.idempotency_key=p_idempotency_key;
  IF FOUND THEN IF v_existing.actor_member_id<>v_actor OR v_existing.request_hash<>p_request_hash THEN RAISE EXCEPTION 'idempotency key reused for a different request' USING ERRCODE='23505'; END IF;RETURN v_existing.response_body;END IF;
  SELECT * INTO v_run FROM finance.year_close_runs r WHERE r.organization_id=p_organization_id AND r.fiscal_year_id=p_fiscal_year_id AND r.reopen_document_id IS NULL FOR UPDATE;
  IF NOT FOUND OR v_year.status<>'closed' THEN RAISE EXCEPTION 'there is no active year close to reopen' USING ERRCODE='23514'; END IF;
  PERFORM p.id FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.fiscal_year_id=p_fiscal_year_id ORDER BY p.starts_on,p.id FOR UPDATE;
  SELECT * INTO v_source FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=v_run.close_document_id AND d.state='posted';
  IF NOT FOUND THEN RAISE EXCEPTION 'posted year-close source is unavailable' USING ERRCODE='23514'; END IF;
  UPDATE finance.fiscal_years SET status='open' WHERE organization_id=p_organization_id AND id=p_fiscal_year_id;
  FOR v_period IN SELECT p.id FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.fiscal_year_id=p_fiscal_year_id AND p.status='locked' ORDER BY p.starts_on,p.id LOOP
    UPDATE finance.accounting_periods SET status='open',locked_at=NULL,locked_by_member_id=NULL,row_version=row_version+1 WHERE organization_id=p_organization_id AND id=v_period;
    INSERT INTO finance.period_events(organization_id,period_id,action,actor_member_id,reason,checklist_snapshot)
      VALUES(p_organization_id,v_period,'reopen',v_actor,btrim(p_reason),jsonb_build_object('fiscal_year_id',p_fiscal_year_id,'year_close_run_id',v_run.id,'close_snapshot',v_run.report_snapshot));
  END LOOP;
  SELECT p.id INTO v_period FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.fiscal_year_id=p_fiscal_year_id AND p.ends_on=v_year.ends_on ORDER BY p.starts_on DESC LIMIT 1;
  INSERT INTO finance.business_documents(organization_id,id,document_type,state,fiscal_year_id,issue_date,accounting_date,description,total_amount,created_by_member_id,reversal_of_document_id,correction_reason)
    VALUES(p_organization_id,v_doc_id,'reversal','approved',p_fiscal_year_id,v_year.ends_on,v_year.ends_on,'Reopen fiscal year · '||v_year.label,v_source.total_amount,v_actor,v_source.id,btrim(p_reason));
  v_number:=finance_private.allocate_document_number(p_organization_id,v_doc_id);
  SELECT j.id INTO v_entry_id FROM finance.journal_entries j WHERE j.organization_id=p_organization_id AND j.source_document_id=v_source.id AND j.state='posted' AND j.is_year_close;
  IF NOT FOUND THEN RAISE EXCEPTION 'year-close journal is unavailable' USING ERRCODE='23514'; END IF;
  v_entry_id:=gen_random_uuid();
  INSERT INTO finance.journal_entries(organization_id,id,source_document_id,period_id,accounting_date,state,is_year_close,posted_by_member_id)
    VALUES(p_organization_id,v_entry_id,v_doc_id,v_period,v_year.ends_on,'building',true,v_actor);
  FOR v_line IN SELECT jl.* FROM finance.journal_lines jl JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
    WHERE je.organization_id=p_organization_id AND je.source_document_id=v_source.id AND je.is_year_close ORDER BY jl.line_no LOOP
    v_line_no:=v_line_no+1;INSERT INTO finance.journal_lines(organization_id,journal_entry_id,line_no,account_id,party_id,cost_center_id,debit,credit,description,cash_flow_class)
      VALUES(p_organization_id,v_entry_id,v_line_no,v_line.account_id,v_line.party_id,v_line.cost_center_id,v_line.credit,v_line.debit,'Reopen · '||v_line.description,v_line.cash_flow_class);
  END LOOP;
  SELECT COALESCE(sum(jl.debit),0)::finance.amount INTO v_total FROM finance.journal_lines jl WHERE jl.organization_id=p_organization_id AND jl.journal_entry_id=v_entry_id;
  IF v_total<=0 THEN RAISE EXCEPTION 'year-close reversal must contain balanced lines' USING ERRCODE='23514'; END IF;
  UPDATE finance.journal_entries SET state='posted',posted_at=v_now WHERE organization_id=p_organization_id AND id=v_entry_id;
  UPDATE finance.business_documents SET state='posted',document_number=v_number,posted_by_member_id=v_actor,posted_at=v_now,updated_at=v_now WHERE organization_id=p_organization_id AND id=v_doc_id;
  UPDATE finance.year_close_runs SET reopen_document_id=v_doc_id WHERE organization_id=p_organization_id AND id=v_run.id;
  v_receipt:=jsonb_build_object('run_id',v_run.id,'reopen_document_id',v_doc_id,'document_number',v_number,'journal_entry_id',v_entry_id,'status','reopened');
  INSERT INTO finance.idempotency_requests(organization_id,operation,idempotency_key,request_hash,actor_member_id,response_status,response_body,resource_document_id)
    VALUES(p_organization_id,'fiscal-year.reopen:'||p_fiscal_year_id::text,p_idempotency_key,p_request_hash,v_actor,200,v_receipt,v_doc_id);
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'fiscal_year.reopen','fiscal_year',p_fiscal_year_id,p_request_id,v_receipt||jsonb_build_object('reason',btrim(p_reason),'prior_snapshot',v_run.report_snapshot));
  RETURN v_receipt;
END $$;
REVOKE ALL ON FUNCTION public.close_fiscal_year(uuid,uuid,text,text,text,text) FROM PUBLIC,ams_runtime;
REVOKE ALL ON FUNCTION public.reopen_fiscal_year(uuid,uuid,text,text,text,text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.close_fiscal_year(uuid,uuid,text,text,text,text) TO ams_runtime;
GRANT EXECUTE ON FUNCTION public.reopen_fiscal_year(uuid,uuid,text,text,text,text) TO ams_runtime;
NOTIFY pgrst,'reload schema';
