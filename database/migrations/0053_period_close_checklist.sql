-- US-060: calculate close exceptions in the database and gate locking on a fresh snapshot.
CREATE FUNCTION finance_private.period_close_checklist(p_organization_id uuid,p_period_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_period finance.accounting_periods%ROWTYPE;v_data jsonb;
BEGIN
  SELECT * INTO v_period FROM finance.accounting_periods p
    WHERE p.organization_id=p_organization_id AND p.id=p_period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'period not found' USING ERRCODE='P0002'; END IF;
  WITH pending AS (
    SELECT count(DISTINCT d.id)::integer AS n FROM finance.business_documents d
    LEFT JOIN finance.approval_requests ar ON ar.organization_id=d.organization_id AND ar.document_id=d.id AND ar.state='pending'
    WHERE d.organization_id=p_organization_id AND d.accounting_date BETWEEN v_period.starts_on AND v_period.ends_on
      AND (d.state='pending_approval' OR ar.id IS NOT NULL)
  ), drafts AS (
    SELECT count(*)::integer AS n FROM finance.business_documents d WHERE d.organization_id=p_organization_id
      AND d.accounting_date BETWEEN v_period.starts_on AND v_period.ends_on AND d.state='draft'
  ), bank AS (
    SELECT count(*)::integer AS n FROM finance.reconciliations r WHERE r.organization_id=p_organization_id
      AND r.state='draft' AND daterange(r.starts_on,r.ends_on,'[]') && daterange(v_period.starts_on,v_period.ends_on,'[]')
  ), control AS (
    SELECT count(*)::integer AS n FROM finance.account_mappings m
    JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id AND a.control_kind IS NOT NULL
    CROSS JOIN LATERAL (
      SELECT COALESCE(sum(jl.debit-jl.credit),0)::numeric AS ledger
      FROM finance.journal_lines jl JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
        AND je.state='posted' AND je.accounting_date<=v_period.ends_on
      WHERE jl.organization_id=p_organization_id AND jl.account_id=m.account_id
    ) gl
    CROSS JOIN LATERAL (
      SELECT COALESCE(sum(CASE WHEN oi.side='debit' THEN 1 ELSE -1 END * finance_private.open_item_balance_at(p_organization_id,oi.id,v_period.ends_on,transaction_timestamp())),0)::numeric AS residual
      FROM finance.open_items oi WHERE oi.organization_id=p_organization_id AND oi.control_kind=m.mapping_key
        AND oi.account_id=m.account_id AND oi.issue_date<=v_period.ends_on
    ) items
    WHERE m.organization_id=p_organization_id AND m.mapping_key IN ('ar','ap','customer_advance','vendor_advance')
      AND gl.ledger<>items.residual
  ), suspense AS (
    SELECT count(*)::integer AS n FROM finance.account_mappings m
    JOIN finance.journal_lines jl ON jl.organization_id=m.organization_id AND jl.account_id=m.account_id
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
      AND je.state='posted' AND je.accounting_date<=v_period.ends_on
    WHERE m.organization_id=p_organization_id AND m.mapping_key LIKE '%suspense%'
    GROUP BY m.id HAVING sum(jl.debit-jl.credit)<>0
  ), cash AS (
    SELECT count(*)::integer AS n FROM finance.cash_accounts ca
    JOIN finance.journal_lines jl ON jl.organization_id=ca.organization_id AND jl.account_id=ca.account_id
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
      AND je.state='posted' AND je.accounting_date BETWEEN v_period.starts_on AND v_period.ends_on AND NOT je.is_opening
    WHERE ca.organization_id=p_organization_id AND ca.is_cash_equivalent
      AND (jl.cash_flow_class IS NULL OR jl.cash_flow_class='unclassified' OR jl.cash_flow_class='opening'
        OR (jl.cash_flow_class='internal' AND NOT EXISTS(SELECT 1 FROM finance.transfers t JOIN finance.business_documents d
          ON d.organization_id=t.organization_id AND d.id=t.document_id AND d.id=je.source_document_id AND d.document_type='transfer'
          JOIN finance.cash_accounts f ON f.organization_id=t.organization_id AND f.id=t.from_cash_account_id AND f.is_cash_equivalent
          JOIN finance.cash_accounts z ON z.organization_id=t.organization_id AND z.id=t.to_cash_account_id AND z.is_cash_equivalent
          WHERE t.organization_id=p_organization_id)))
  ), tb AS (
    SELECT COALESCE(sum(jl.debit-jl.credit),0)::numeric AS difference FROM finance.journal_lines jl
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
    WHERE jl.organization_id=p_organization_id AND je.accounting_date<=v_period.ends_on
  ), tax AS (
    SELECT COALESCE(sum(jl.debit-jl.credit),0)::numeric AS net FROM finance.account_mappings m
    JOIN finance.journal_lines jl ON jl.organization_id=m.organization_id AND jl.account_id=m.account_id
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
      AND je.state='posted' AND je.accounting_date<=v_period.ends_on
    WHERE m.organization_id=p_organization_id AND m.mapping_key IN ('input_tax','output_tax')
  ), checks AS (
    SELECT 'pending_approvals'::text code,(SELECT n FROM pending) AS issue_count,'Pending approvals remain in this period.'::text detail,true AS blocking
    UNION ALL SELECT 'draft_documents',(SELECT n FROM drafts),'Unposted drafts remain in this period.',true
    UNION ALL SELECT 'bank_reconciliations',(SELECT n FROM bank),'Bank reconciliation sessions intersecting this period are still open.',true
    UNION ALL SELECT 'control_tieouts',(SELECT n FROM control),'AR/AP/advance open items do not tie to their control-account balances.',true
    UNION ALL SELECT 'suspense',(SELECT count(*) FROM suspense),'A mapped suspense account has a non-zero period-end balance.',true
    UNION ALL SELECT 'cash_classification',(SELECT n FROM cash),'Cash-equivalent activity needs a valid cash-flow classification.',true
    UNION ALL SELECT 'trial_balance',CASE WHEN (SELECT difference FROM tb)=0 THEN 0 ELSE 1 END,'Posted trial balance is not balanced.',true
    UNION ALL SELECT 'tax_control_review',CASE WHEN (SELECT net FROM tax)=0 THEN 0 ELSE 1 END,
      'Mapped input/output tax controls net to BDT '||(SELECT net::text FROM tax)||'; review the approved filing scope.',false
  )
  SELECT jsonb_build_object('period_id',p_period_id,'starts_on',v_period.starts_on,'ends_on',v_period.ends_on,
    'passed',COALESCE(bool_and(issue_count=0 OR NOT blocking),true),'blocking_count',count(*) FILTER(WHERE issue_count>0 AND blocking),
    'checks',COALESCE(jsonb_agg(jsonb_build_object('code',code,'count',issue_count,'detail',detail,'blocking',blocking) ORDER BY code),'[]'::jsonb),
    'checked_at',transaction_timestamp()) INTO v_data FROM checks;
  RETURN v_data;
END $$;
REVOKE ALL ON FUNCTION finance_private.period_close_checklist(uuid,uuid) FROM PUBLIC,ams_runtime;

CREATE FUNCTION public.read_period_close_checklist(p_organization_id uuid,p_period_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'accounting.read');
  RETURN finance_private.period_close_checklist(p_organization_id,p_period_id);
END $$;
REVOKE ALL ON FUNCTION public.read_period_close_checklist(uuid,uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_period_close_checklist(uuid,uuid) TO ams_runtime;

CREATE FUNCTION public.list_period_close_events(p_organization_id uuid,p_period_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'audit.read');
  IF NOT EXISTS(SELECT 1 FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.id=p_period_id) THEN
    RAISE EXCEPTION 'period not found' USING ERRCODE='P0002'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('action',e.action,'reason',e.reason,'created_at',e.created_at,
    'snapshot',e.checklist_snapshot) ORDER BY e.created_at DESC,e.id DESC)
    FROM finance.period_events e WHERE e.organization_id=p_organization_id AND e.period_id=p_period_id),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.list_period_close_events(uuid,uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.list_period_close_events(uuid,uuid) TO ams_runtime;

CREATE OR REPLACE FUNCTION public.lock_accounting_period(
  p_organization_id uuid,p_period_id uuid,p_expected_version integer,p_request_id text,p_reason text
) RETURNS TABLE(period_id uuid,row_version integer,locked_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid;v_year_id uuid;v_year_status text;v_period finance.accounting_periods%ROWTYPE;
  v_snapshot jsonb;v_locked_at timestamptz;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_reason IS NULL OR length(btrim(p_reason))<10 OR length(btrim(p_reason))>1000 THEN
    RAISE EXCEPTION 'lock reason must be 10-1000 characters' USING ERRCODE='22023'; END IF;
  v_actor:=finance_private.require_period_action(p_organization_id,'periods.lock');
  SELECT p.fiscal_year_id INTO v_year_id FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.id=p_period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'period not found' USING ERRCODE='P0002'; END IF;
  IF v_year_id IS NOT NULL THEN
    SELECT fy.status INTO v_year_status FROM finance.fiscal_years fy WHERE fy.organization_id=p_organization_id AND fy.id=v_year_id FOR UPDATE;
    IF NOT FOUND OR v_year_status<>'open' THEN RAISE EXCEPTION 'fiscal year is closed' USING ERRCODE='23514'; END IF;
  END IF;
  SELECT * INTO v_period FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id AND p.id=p_period_id FOR UPDATE;
  IF v_period.status<>'open' OR p_expected_version IS NULL OR p_expected_version<1 OR v_period.row_version<>p_expected_version THEN
    RAISE EXCEPTION 'period is locked or version is stale' USING ERRCODE='40001'; END IF;
  v_snapshot:=finance_private.period_close_checklist(p_organization_id,p_period_id);
  IF NOT (v_snapshot->>'passed')::boolean THEN
    RAISE EXCEPTION 'period close checks have unresolved blocking exceptions' USING ERRCODE='23514',DETAIL=v_snapshot::text;
  END IF;
  v_locked_at:=clock_timestamp();
  UPDATE finance.accounting_periods p SET status='locked',locked_at=v_locked_at,locked_by_member_id=v_actor,row_version=p.row_version+1
    WHERE p.organization_id=p_organization_id AND p.id=p_period_id;
  INSERT INTO finance.period_events(organization_id,period_id,action,actor_member_id,reason,checklist_snapshot)
    VALUES(p_organization_id,p_period_id,'lock',v_actor,btrim(p_reason),v_snapshot);
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'period.lock','accounting_period',p_period_id,p_request_id,
    jsonb_build_object('from_version',v_period.row_version,'to_version',v_period.row_version+1,'snapshot',v_snapshot));
  RETURN QUERY SELECT p_period_id,v_period.row_version+1,v_locked_at;
END $$;
REVOKE ALL ON FUNCTION public.lock_accounting_period(uuid,uuid,integer,text,text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.lock_accounting_period(uuid,uuid,integer,text,text) TO ams_runtime;
NOTIFY pgrst,'reload schema';
