-- US-016: resolve accounting dates and serialize financial writes with period close.
BEGIN;

ALTER TABLE finance.accounting_periods ADD COLUMN row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0);

CREATE FUNCTION finance_private.lock_accounting_date(
  p_organization_id uuid,p_accounting_date date,p_allow_opening boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_books_start date; v_org_status text; v_period finance.accounting_periods%ROWTYPE;
  v_year_status text;
BEGIN
  IF p_accounting_date IS NULL THEN RAISE EXCEPTION 'accounting date required' USING ERRCODE='22023'; END IF;
  SELECT o.books_start_date,o.status INTO v_books_start,v_org_status FROM finance.organizations o
    WHERE o.id=p_organization_id FOR SHARE;
  IF NOT FOUND OR v_org_status='archived' THEN RAISE EXCEPTION 'organization unavailable' USING ERRCODE='P0002'; END IF;
  IF v_org_status<>'active' THEN RAISE EXCEPTION 'organization is not writable' USING ERRCODE='42501'; END IF;
  IF p_allow_opening AND p_accounting_date=v_books_start-1 THEN
    SELECT * INTO v_period FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id
      AND p.kind='opening' AND p.starts_on=p_accounting_date FOR UPDATE;
    IF NOT FOUND OR v_period.status<>'open' THEN RAISE EXCEPTION 'opening period is unavailable' USING ERRCODE='23514'; END IF;
    RETURN v_period.id;
  END IF;
  IF p_accounting_date<v_books_start THEN RAISE EXCEPTION 'accounting date precedes books start' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_period FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id
    AND p.kind='regular' AND p.starts_on<=p_accounting_date AND p.ends_on>=p_accounting_date;
  IF NOT FOUND THEN RAISE EXCEPTION 'accounting date has no fiscal period' USING ERRCODE='23514'; END IF;
  SELECT fy.status INTO v_year_status FROM finance.fiscal_years fy
    WHERE fy.organization_id=p_organization_id AND fy.id=v_period.fiscal_year_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fiscal year unavailable' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_period FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id
    AND p.id=v_period.id FOR UPDATE;
  IF v_year_status<>'open' OR v_period.status<>'open' OR p_accounting_date<v_books_start
     OR p_accounting_date NOT BETWEEN v_period.starts_on AND v_period.ends_on THEN
    RAISE EXCEPTION 'accounting period is locked or unavailable' USING ERRCODE='23514';
  END IF;
  RETURN v_period.id;
END $$;
REVOKE ALL ON FUNCTION finance_private.lock_accounting_date(uuid,date,boolean) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION finance_private.require_period_action(p_organization_id uuid,p_permission text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member uuid; v_status text;
BEGIN
  v_member:=finance_private.require_capability(p_organization_id,p_permission);
  PERFORM finance_private.require_recent_auth();
  SELECT o.status INTO v_status FROM finance.organizations o WHERE o.id=p_organization_id FOR SHARE;
  IF NOT FOUND OR v_status<>'active' THEN RAISE EXCEPTION 'organization is not writable' USING ERRCODE='42501'; END IF;
  RETURN v_member;
END $$;
REVOKE ALL ON FUNCTION finance_private.require_period_action(uuid,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.lock_accounting_period(
  p_organization_id uuid,p_period_id uuid,p_expected_version integer,p_request_id text,p_reason text
) RETURNS TABLE(period_id uuid,row_version integer,locked_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid; v_year_id uuid; v_year_status text; v_period finance.accounting_periods%ROWTYPE;
  v_snapshot jsonb; v_locked_at timestamptz:=clock_timestamp();
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_reason IS NULL OR length(btrim(p_reason))<10 OR length(btrim(p_reason))>1000
    THEN RAISE EXCEPTION 'lock reason must be 10-1000 characters' USING ERRCODE='22023'; END IF;
  v_actor:=finance_private.require_period_action(p_organization_id,'periods.lock');
  SELECT p.fiscal_year_id INTO v_year_id FROM finance.accounting_periods p
    WHERE p.organization_id=p_organization_id AND p.id=p_period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'period not found' USING ERRCODE='P0002'; END IF;
  IF v_year_id IS NOT NULL THEN
    SELECT fy.status INTO v_year_status FROM finance.fiscal_years fy
      WHERE fy.organization_id=p_organization_id AND fy.id=v_year_id FOR UPDATE;
    IF NOT FOUND OR v_year_status<>'open' THEN RAISE EXCEPTION 'fiscal year is closed' USING ERRCODE='23514'; END IF;
  END IF;
  SELECT * INTO v_period FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id
    AND p.id=p_period_id FOR UPDATE;
  IF v_period.status<>'open' OR p_expected_version IS NULL OR p_expected_version<1
    OR v_period.row_version<>p_expected_version THEN
    RAISE EXCEPTION 'period is locked or version is stale' USING ERRCODE='40001';
  END IF;
  SELECT jsonb_build_object('draft_documents',count(*) FILTER(WHERE d.state='draft'),
      'posted_documents',count(*) FILTER(WHERE d.state='posted')) INTO v_snapshot
    FROM finance.business_documents d WHERE d.organization_id=p_organization_id
      AND d.accounting_date BETWEEN v_period.starts_on AND v_period.ends_on;
  UPDATE finance.accounting_periods p SET status='locked',locked_at=v_locked_at,
    locked_by_member_id=v_actor,row_version=p.row_version+1
    WHERE p.organization_id=p_organization_id AND p.id=p_period_id;
  INSERT INTO finance.period_events(organization_id,period_id,action,actor_member_id,reason,checklist_snapshot)
    VALUES(p_organization_id,p_period_id,'lock',v_actor,btrim(p_reason),COALESCE(v_snapshot,'{}'::jsonb));
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'period.lock','accounting_period',p_period_id,p_request_id,
    jsonb_build_object('from_version',v_period.row_version,'to_version',v_period.row_version+1,'snapshot',v_snapshot));
  RETURN QUERY SELECT p_period_id,v_period.row_version+1,v_locked_at;
END $$;
REVOKE ALL ON FUNCTION public.lock_accounting_period(uuid,uuid,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lock_accounting_period(uuid,uuid,integer,text,text) TO authenticated;

CREATE FUNCTION public.reopen_accounting_period(
  p_organization_id uuid,p_period_id uuid,p_expected_version integer,p_request_id text,p_reason text
) RETURNS TABLE(period_id uuid,row_version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid; v_year_id uuid; v_year_status text; v_period finance.accounting_periods%ROWTYPE;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_reason IS NULL OR length(btrim(p_reason))<10 OR length(btrim(p_reason))>1000
    THEN RAISE EXCEPTION 'reopen reason must be 10-1000 characters' USING ERRCODE='22023'; END IF;
  v_actor:=finance_private.require_period_action(p_organization_id,'periods.reopen');
  SELECT p.fiscal_year_id INTO v_year_id FROM finance.accounting_periods p
    WHERE p.organization_id=p_organization_id AND p.id=p_period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'period not found' USING ERRCODE='P0002'; END IF;
  IF v_year_id IS NOT NULL THEN
    SELECT fy.status INTO v_year_status FROM finance.fiscal_years fy
      WHERE fy.organization_id=p_organization_id AND fy.id=v_year_id FOR UPDATE;
    IF NOT FOUND OR v_year_status<>'open' THEN RAISE EXCEPTION 'closed fiscal year must be reopened through year close' USING ERRCODE='23514'; END IF;
  END IF;
  SELECT * INTO v_period FROM finance.accounting_periods p WHERE p.organization_id=p_organization_id
    AND p.id=p_period_id FOR UPDATE;
  IF v_period.status<>'locked' OR p_expected_version IS NULL OR p_expected_version<1
    OR v_period.row_version<>p_expected_version THEN
    RAISE EXCEPTION 'period is open or version is stale' USING ERRCODE='40001';
  END IF;
  UPDATE finance.accounting_periods p SET status='open',locked_at=NULL,locked_by_member_id=NULL,
    row_version=p.row_version+1 WHERE p.organization_id=p_organization_id AND p.id=p_period_id;
  INSERT INTO finance.period_events(organization_id,period_id,action,actor_member_id,reason,checklist_snapshot)
    VALUES(p_organization_id,p_period_id,'reopen',v_actor,btrim(p_reason),jsonb_build_object('from_version',v_period.row_version));
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'period.reopen','accounting_period',p_period_id,p_request_id,
    jsonb_build_object('from_version',v_period.row_version,'to_version',v_period.row_version+1));
  RETURN QUERY SELECT p_period_id,v_period.row_version+1;
END $$;
REVOKE ALL ON FUNCTION public.reopen_accounting_period(uuid,uuid,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_accounting_period(uuid,uuid,integer,text,text) TO authenticated;

CREATE FUNCTION public.list_accounting_periods(p_organization_id uuid)
RETURNS TABLE(id uuid,fiscal_year_id uuid,year_label text,label text,kind text,starts_on date,ends_on date,status text,
  locked_at timestamptz,locked_by_member_id uuid,row_version integer,last_action text,last_reason text,last_event_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NOT finance_private.has_permission(p_organization_id,'accounting.read') THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT p.id,p.fiscal_year_id,fy.label,p.label,p.kind,p.starts_on,p.ends_on,p.status,p.locked_at,
    p.locked_by_member_id,p.row_version,e.action,e.reason,e.created_at
  FROM finance.accounting_periods p LEFT JOIN finance.fiscal_years fy
    ON fy.organization_id=p.organization_id AND fy.id=p.fiscal_year_id
  LEFT JOIN LATERAL (SELECT pe.action,pe.reason,pe.created_at FROM finance.period_events pe
    WHERE pe.organization_id=p.organization_id AND pe.period_id=p.id ORDER BY pe.created_at DESC,pe.id DESC LIMIT 1) e ON true
  WHERE p.organization_id=p_organization_id ORDER BY p.starts_on,p.id;
END $$;
REVOKE ALL ON FUNCTION public.list_accounting_periods(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_accounting_periods(uuid) TO authenticated;

CREATE FUNCTION finance_private.reject_period_event_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'period events are append-only' USING ERRCODE='23514'; END $$;
REVOKE ALL ON FUNCTION finance_private.reject_period_event_mutation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER period_events_append_only BEFORE UPDATE OR DELETE ON finance.period_events
  FOR EACH ROW EXECUTE FUNCTION finance_private.reject_period_event_mutation();

NOTIFY pgrst,'reload schema';
COMMIT;
