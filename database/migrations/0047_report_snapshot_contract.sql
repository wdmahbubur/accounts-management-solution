-- US-054: execute each supported report and capture its company, filters and
-- database read cutoff within the same PostgreSQL statement snapshot.
CREATE FUNCTION public.read_report_snapshot(p_organization_id uuid,p_report_type text,p_filters jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_org finance.organizations%ROWTYPE; v_permission text; v_data jsonb; v_opening text; v_from date; v_to date; v_as_of date;
  v_account uuid; v_center uuid; v_cursor_date date; v_cursor_journal uuid; v_cursor_line integer; v_limit integer; v_search text; v_source text;
  v_cash uuid; v_now timestamptz:=transaction_timestamp();
BEGIN
  IF p_filters IS NULL OR jsonb_typeof(p_filters) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'report filters must be an object' USING ERRCODE='22023'; END IF;
  v_permission:=CASE WHEN p_report_type='trial_balance' THEN 'reports.read' WHEN p_report_type IN ('general_ledger','journal_register') THEN 'ledger.read' WHEN p_report_type='cashbook' THEN 'banking.read' ELSE NULL END;
  IF v_permission IS NULL THEN RAISE EXCEPTION 'unsupported report type' USING ERRCODE='22023'; END IF;
  PERFORM finance_private.require_capability(p_organization_id,v_permission);
  SELECT * INTO v_org FROM finance.organizations o WHERE o.id=p_organization_id;
  IF p_report_type='trial_balance' THEN
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_filters) k WHERE k NOT IN ('as_of','from')) OR
       COALESCE(p_filters->>'as_of','') !~ '^\d{4}-\d{2}-\d{2}$' OR
       (p_filters ? 'from' AND COALESCE(p_filters->>'from','') !~ '^\d{4}-\d{2}-\d{2}$') THEN RAISE EXCEPTION 'invalid trial-balance filters' USING ERRCODE='22023'; END IF;
    v_as_of:=(p_filters->>'as_of')::date;v_from:=NULLIF(p_filters->>'from','')::date;
    SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.account_code),'[]'::jsonb) INTO v_data FROM public.read_trial_balance(p_organization_id,v_as_of,v_from) r;
  ELSIF p_report_type='general_ledger' THEN
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_filters) k WHERE k NOT IN ('account','from','to','source','cost_center','after_date','after_journal','after_line','limit')) OR
       COALESCE(p_filters->>'from','') !~ '^\d{4}-\d{2}-\d{2}$' OR COALESCE(p_filters->>'to','') !~ '^\d{4}-\d{2}-\d{2}$' OR
       COALESCE(p_filters->>'account','') !~* '^[0-9a-f-]{36}$' THEN RAISE EXCEPTION 'invalid general-ledger filters' USING ERRCODE='22023'; END IF;
    v_account:=(p_filters->>'account')::uuid;v_from:=(p_filters->>'from')::date;v_to:=(p_filters->>'to')::date;
    v_center:=NULLIF(p_filters->>'cost_center','')::uuid;v_source:=NULLIF(p_filters->>'source','');
    v_cursor_date:=NULLIF(p_filters->>'after_date','')::date;v_cursor_journal:=NULLIF(p_filters->>'after_journal','')::uuid;v_cursor_line:=NULLIF(p_filters->>'after_line','')::integer;
    v_limit:=COALESCE(NULLIF(p_filters->>'limit','')::integer,500);
    IF ((v_cursor_date IS NULL)::integer+(v_cursor_journal IS NULL)::integer+(v_cursor_line IS NULL)::integer) NOT IN (0,3) THEN RAISE EXCEPTION 'incomplete ledger cursor' USING ERRCODE='22023'; END IF;
    v_opening:=public.read_general_ledger_opening(p_organization_id,v_account,v_from,v_source,v_center);
    SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.accounting_date,r.journal_id,r.line_no),'[]'::jsonb) INTO v_data
      FROM public.read_general_ledger(p_organization_id,v_account,v_from,v_to,v_source,v_center,v_cursor_date,v_cursor_journal,v_cursor_line,v_limit+1) r;
    v_data:=jsonb_build_object('rows',v_data,'opening_balance',v_opening,'limit',v_limit);
  ELSIF p_report_type='journal_register' THEN
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_filters) k WHERE k NOT IN ('search','from','to','limit')) OR
       (p_filters ? 'from' AND COALESCE(p_filters->>'from','') !~ '^\d{4}-\d{2}-\d{2}$') OR
       (p_filters ? 'to' AND COALESCE(p_filters->>'to','') !~ '^\d{4}-\d{2}-\d{2}$') THEN RAISE EXCEPTION 'invalid journal-register filters' USING ERRCODE='22023'; END IF;
    v_from:=NULLIF(p_filters->>'from','')::date;v_to:=NULLIF(p_filters->>'to','')::date;v_search:=NULLIF(p_filters->>'search','');v_limit:=COALESCE(NULLIF(p_filters->>'limit','')::integer,100);
    SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.accounting_date DESC,r.id DESC),'[]'::jsonb) INTO v_data FROM public.read_journal_register(p_organization_id,v_search,v_from,v_to,LEAST(v_limit+1,101)) r;
  ELSE
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_filters) k WHERE k NOT IN ('cash_account_id','from','to','limit')) OR
       COALESCE(p_filters->>'cash_account_id','') !~* '^[0-9a-f-]{36}$' OR COALESCE(p_filters->>'from','') !~ '^\d{4}-\d{2}-\d{2}$' OR
       COALESCE(p_filters->>'to','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'invalid cashbook filters' USING ERRCODE='22023'; END IF;
    v_cash:=(p_filters->>'cash_account_id')::uuid;v_from:=(p_filters->>'from')::date;v_to:=(p_filters->>'to')::date;v_limit:=COALESCE(NULLIF(p_filters->>'limit','')::integer,500);
    v_data:=public.read_cash_account_ledger(p_organization_id,v_cash,v_from,v_to,v_limit);
  END IF;
  RETURN jsonb_build_object('snapshot_id',gen_random_uuid(),'report_type',p_report_type,
    'company',jsonb_build_object('id',v_org.id,'name',v_org.name,'timezone',v_org.timezone),
    'filters',p_filters,'generated_at',v_now,'ledger_cutoff_at',v_now,'template_version','v1.0',
    'status','posted','provisional',false,'data',COALESCE(v_data,'[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.read_report_snapshot(uuid,text,jsonb) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_report_snapshot(uuid,text,jsonb) TO ams_runtime;
