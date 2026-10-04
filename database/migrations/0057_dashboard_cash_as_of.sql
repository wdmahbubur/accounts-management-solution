-- US-062: role-filtered dashboard composed from the same report snapshot services.
CREATE OR REPLACE FUNCTION public.read_finance_dashboard(p_organization_id uuid,p_from date DEFAULT NULL,p_to date DEFAULT NULL,p_as_of date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_org finance.organizations%ROWTYPE;v_now timestamptz:=transaction_timestamp();v_today date;v_from date;v_to date;v_as_of date;
  v_reports boolean;v_ar_access boolean;v_ap_access boolean;v_audit boolean;v_pl jsonb;v_bs jsonb;v_cash jsonb;v_ar jsonb;v_ap jsonb;
  v_result jsonb;v_exceptions jsonb:='[]'::jsonb;v_trend jsonb:='[]'::jsonb;v_month date;v_month_end date;v_month_start date;v_month_report jsonb;
  v_revenue numeric:=0;v_expenses numeric:=0;v_profit numeric:=0;v_overdue_ar numeric:=0;v_overdue_ap numeric:=0;v_due_soon numeric:=0;
BEGIN
  v_reports:=finance_private.has_permission(p_organization_id,'reports.read');
  v_ar_access:=finance_private.has_permission(p_organization_id,'dues.read') OR finance_private.has_permission(p_organization_id,'sales.read');
  v_ap_access:=finance_private.has_permission(p_organization_id,'dues.read') OR finance_private.has_permission(p_organization_id,'purchases.read');
  v_audit:=finance_private.has_permission(p_organization_id,'audit.read');
  IF NOT (v_reports OR v_ar_access OR v_ap_access) THEN RAISE EXCEPTION 'dashboard permission required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_org FROM finance.organizations o WHERE o.id=p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'company unavailable' USING ERRCODE='P0002'; END IF;
  v_today:=(v_now AT TIME ZONE v_org.timezone)::date;v_as_of:=COALESCE(p_as_of,v_today);v_to:=COALESCE(p_to,v_as_of);
  SELECT COALESCE(p_from,(SELECT f.starts_on FROM finance.fiscal_years f WHERE f.organization_id=p_organization_id AND v_today BETWEEN f.starts_on AND f.ends_on ORDER BY f.starts_on DESC LIMIT 1),date_trunc('year',v_today::timestamp)::date) INTO v_from;
  IF NOT isfinite(v_from) OR NOT isfinite(v_to) OR NOT isfinite(v_as_of) OR v_from>v_to OR (v_to-v_from)>800 THEN
    RAISE EXCEPTION 'invalid dashboard date range' USING ERRCODE='22023'; END IF;
  IF v_reports THEN
    v_pl:=public.read_profit_loss_snapshot(p_organization_id,v_from,v_to,NULL,NULL,NULL);
    v_bs:=public.read_balance_sheet_snapshot(p_organization_id,v_as_of,NULL);
    v_cash:=public.read_cash_flow_snapshot(p_organization_id,LEAST(v_from,v_as_of),v_as_of);
    v_revenue:=COALESCE((v_pl->'data'->'totals'->>'revenue')::numeric,0);
    v_expenses:=COALESCE((v_pl->'data'->'totals'->>'direct_costs')::numeric,0)+COALESCE((v_pl->'data'->'totals'->>'operating_costs')::numeric,0)+COALESCE((v_pl->'data'->'totals'->>'other_expenses')::numeric,0);
    v_profit:=COALESCE((v_pl->'data'->'totals'->>'net_profit')::numeric,0);
    IF COALESCE((v_pl->'provisional')::boolean,false) THEN v_exceptions:=v_exceptions||jsonb_build_array(jsonb_build_object('code','profit_loss_provisional','message','The Profit and Loss includes incomplete or summarized source detail.')); END IF;
    IF COALESCE((v_bs->'data'->'current'->>'difference')::numeric,0)<>0 THEN v_exceptions:=v_exceptions||jsonb_build_array(jsonb_build_object('code','balance_sheet_difference','message','Balance Sheet does not balance to posted ledger totals.')); END IF;
    IF COALESCE((v_cash->'data'->>'unclassified_count')::integer,0)>0 OR COALESCE((v_cash->>'provisional')::boolean,false) THEN
      v_exceptions:=v_exceptions||jsonb_build_array(jsonb_build_object('code','cash_flow_provisional','count',COALESCE((v_cash->'data'->>'unclassified_count')::integer,0),'message','Cash-flow report has unclassified activity or incomplete cash-equivalent setup.')); END IF;
    v_month:=date_trunc('month',GREATEST(v_from,v_org.books_start_date)::timestamp)::date;
    WHILE v_month<=v_to LOOP
      v_month_start:=GREATEST(v_month,v_from,v_org.books_start_date);
      v_month_end:=LEAST(v_to,(date_trunc('month',v_month::timestamp)+interval '1 month - 1 day')::date);
      v_month_report:=public.read_profit_loss_snapshot(p_organization_id,v_month_start,v_month_end,NULL,NULL,NULL);
      v_trend:=v_trend||jsonb_build_array(jsonb_build_object('month',v_month,'from',v_month_start,'to',v_month_end,
        'revenue',(v_month_report->'data'->'totals'->>'revenue'),'profit',(v_month_report->'data'->'totals'->>'net_profit')));
      v_month:=(v_month+interval '1 month')::date;
    END LOOP;
  END IF;
  IF v_ar_access THEN
    v_ar:=public.read_aging_snapshot(p_organization_id,'ar',v_as_of);
    v_overdue_ar:=COALESCE((v_ar->'data'->'buckets'->>'days_1_30')::numeric,0)+COALESCE((v_ar->'data'->'buckets'->>'days_31_60')::numeric,0)+COALESCE((v_ar->'data'->'buckets'->>'days_61_90')::numeric,0)+COALESCE((v_ar->'data'->'buckets'->>'days_91_plus')::numeric,0);
    IF COALESCE((v_ar->'data'->>'trade_control_difference')::numeric,0)<>0 OR COALESCE((v_ar->'data'->'advances'->>'difference')::numeric,0)<>0 THEN
      v_exceptions:=v_exceptions||jsonb_build_array(jsonb_build_object('code','receivable_control_difference','message','Receivables do not tie to their control accounts.')); END IF;
  END IF;
  IF v_ap_access THEN
    v_ap:=public.read_aging_snapshot(p_organization_id,'ap',v_as_of);
    v_overdue_ap:=COALESCE((v_ap->'data'->'buckets'->>'days_1_30')::numeric,0)+COALESCE((v_ap->'data'->'buckets'->>'days_31_60')::numeric,0)+COALESCE((v_ap->'data'->'buckets'->>'days_61_90')::numeric,0)+COALESCE((v_ap->'data'->'buckets'->>'days_91_plus')::numeric,0);
    SELECT COALESCE(sum((x.item->>'residual')::numeric),0) INTO v_due_soon
      FROM jsonb_array_elements(COALESCE(v_ap->'data'->'items','[]'::jsonb)) AS x(item)
      WHERE x.item->>'control_kind'='ap' AND x.item->>'bucket'='not_due'
        AND NULLIF(x.item->>'due_date','')::date>v_as_of AND NULLIF(x.item->>'due_date','')::date<=v_as_of+30;
    IF COALESCE((v_ap->'data'->>'trade_control_difference')::numeric,0)<>0 OR COALESCE((v_ap->'data'->'advances'->>'difference')::numeric,0)<>0 THEN
      v_exceptions:=v_exceptions||jsonb_build_array(jsonb_build_object('code','payable_control_difference','message','Payables do not tie to their control accounts.')); END IF;
  END IF;
  v_result:=jsonb_build_object('company',jsonb_build_object('id',v_org.id,'name',v_org.name,'timezone',v_org.timezone),
    'filters',jsonb_build_object('from',v_from,'to',v_to,'as_of',v_as_of),'generated_at',v_now,'ledger_cutoff_at',v_now,
    'permissions',jsonb_build_object('reports',v_reports,'receivables',v_ar_access,'payables',v_ap_access,'audit',v_audit),
    'exceptions',v_exceptions,'empty',true);
  IF v_reports THEN
    v_result:=v_result||jsonb_build_object('performance',jsonb_build_object('revenue',v_revenue::text,'expenses',v_expenses::text,'net_profit',v_profit::text,
      'provisional',COALESCE((v_pl->>'provisional')::boolean,false),'warnings',COALESCE(v_pl->'data'->'warnings','[]'::jsonb)),
      'liquidity',jsonb_build_object('closing_cash_equivalents',v_cash->'data'->>'closing_cash','provisional',COALESCE((v_cash->>'provisional')::boolean,false),
        'unclassified_count',COALESCE((v_cash->'data'->>'unclassified_count')::integer,0)),
      'balance_sheet',jsonb_build_object('assets',v_bs->'data'->'current'->>'assets','difference',v_bs->'data'->'current'->>'difference'),
      'trend',v_trend,'cutover_detail_start',GREATEST(v_from,v_org.books_start_date));
  END IF;
  IF v_ar_access THEN v_result:=v_result||jsonb_build_object('receivables',jsonb_build_object('net_trade',v_ar->'data'->>'net_trade_control_items',
    'overdue',v_overdue_ar::text,'credits',v_ar->'data'->>'unapplied_trade_credits','as_of',v_as_of,'provisional',COALESCE((v_ar->>'provisional')::boolean,false)));END IF;
  IF v_ap_access THEN v_result:=v_result||jsonb_build_object('payables',jsonb_build_object('net_trade',v_ap->'data'->>'net_trade_control_items',
    'overdue',v_overdue_ap::text,'due_in_30_days',v_due_soon::text,'credits',v_ap->'data'->>'unapplied_trade_credits','as_of',v_as_of,'provisional',COALESCE((v_ap->>'provisional')::boolean,false)));END IF;
  IF v_audit THEN v_result:=v_result||jsonb_build_object('recent_events',COALESCE((SELECT jsonb_agg(jsonb_build_object('action',e.action,'entity_type',e.entity_type,'created_at',e.created_at) ORDER BY e.created_at DESC)
    FROM (SELECT ae.action,ae.entity_type,ae.created_at FROM finance.audit_events ae WHERE ae.organization_id=p_organization_id ORDER BY ae.created_at DESC,ae.id DESC LIMIT 8) e),'[]'::jsonb));END IF;
  v_result:=jsonb_set(v_result,'{empty}',to_jsonb(
    (NOT v_reports OR jsonb_array_length(COALESCE(v_pl->'data'->'accounts','[]'::jsonb))=0)
      AND (NOT v_ar_access OR jsonb_array_length(COALESCE(v_ar->'data'->'items','[]'::jsonb))=0)
      AND (NOT v_ap_access OR jsonb_array_length(COALESCE(v_ap->'data'->'items','[]'::jsonb))=0)
      AND (NOT v_reports OR jsonb_array_length(COALESCE(v_cash->'data'->'activity','[]'::jsonb))=0)),false);
  RETURN jsonb_build_object('snapshot_id',gen_random_uuid(),'report_type','dashboard','company',v_result->'company','filters',v_result->'filters',
    'generated_at',v_now,'ledger_cutoff_at',v_now,'template_version','v1.0','status',CASE WHEN jsonb_array_length(v_exceptions)>0 THEN 'provisional' ELSE 'posted' END,
    'provisional',jsonb_array_length(v_exceptions)>0,'data',v_result);
END $$;
REVOKE ALL ON FUNCTION public.read_finance_dashboard(uuid,date,date,date) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_finance_dashboard(uuid,date,date,date) TO ams_runtime;
NOTIFY pgrst,'reload schema';
