-- Banking readers can find and resume existing sessions without write permission.
-- Reopened is a presentation state derived from append-only reopen evidence;
-- the authoritative reconciliation state remains draft/finalized.
CREATE FUNCTION public.read_reconciliation_list(
  p_organization_id uuid,p_cash_account_id uuid DEFAULT NULL,p_status text DEFAULT NULL,p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_accounts jsonb;v_sessions jsonb;v_more boolean;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'banking.read');
  IF p_offset IS NULL OR p_offset<0 OR p_offset>1000000 OR p_offset%50<>0
    OR (p_status IS NOT NULL AND p_status NOT IN ('draft','reopened','finalized')) THEN
    RAISE EXCEPTION 'Invalid reconciliation list filters.' USING ERRCODE='22023';
  END IF;
  IF p_cash_account_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM finance.cash_accounts a WHERE a.organization_id=p_organization_id AND a.id=p_cash_account_id
  ) THEN RAISE EXCEPTION 'Cash account unavailable.' USING ERRCODE='P0002'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'kind',a.kind,'is_active',a.is_active) ORDER BY a.name,a.id),'[]'::jsonb)
    INTO v_accounts FROM finance.cash_accounts a WHERE a.organization_id=p_organization_id;
  WITH scoped AS (
    SELECT r.id,r.cash_account_id,a.name AS account_name,a.kind AS account_kind,a.is_active AS account_active,
      r.starts_on,r.ends_on,r.statement_opening,r.statement_closing,r.state,r.created_at,r.finalized_at,
      history.reopen_count,history.last_reopened_at,
      CASE WHEN r.state='finalized' THEN 'finalized' WHEN history.reopen_count>0 THEN 'reopened' ELSE 'draft' END AS status,
      matches.active_match_count
    FROM finance.reconciliations r
    JOIN finance.cash_accounts a ON a.organization_id=r.organization_id AND a.id=r.cash_account_id
    CROSS JOIN LATERAL(SELECT count(*)::integer AS reopen_count,max(e.created_at) AS last_reopened_at
      FROM finance.reconciliation_reopen_events e WHERE e.organization_id=r.organization_id AND e.reconciliation_id=r.id) history
    CROSS JOIN LATERAL(SELECT count(*)::integer AS active_match_count FROM finance.reconciliation_matches m
      WHERE m.organization_id=r.organization_id AND m.reconciliation_id=r.id AND NOT EXISTS(
        SELECT 1 FROM finance.reconciliation_match_reversals z WHERE z.organization_id=m.organization_id AND z.match_id=m.id)) matches
    WHERE r.organization_id=p_organization_id AND (p_cash_account_id IS NULL OR r.cash_account_id=p_cash_account_id)
  ), page AS (
    SELECT s.* FROM scoped s WHERE p_status IS NULL OR s.status=p_status
    ORDER BY s.created_at DESC,s.id DESC OFFSET p_offset LIMIT 51
  ), numbered AS (SELECT p.*,row_number() OVER(ORDER BY p.created_at DESC,p.id DESC) AS position FROM page p)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',p.id,'cash_account_id',p.cash_account_id,'account_name',p.account_name,
      'account_kind',p.account_kind,'account_active',p.account_active,'starts_on',p.starts_on,'ends_on',p.ends_on,
      'statement_opening',p.statement_opening::text,'statement_closing',p.statement_closing::text,
      'state',p.state,'status',p.status,'created_at',p.created_at,'finalized_at',p.finalized_at,
      'reopen_count',p.reopen_count,'last_reopened_at',p.last_reopened_at,'active_match_count',p.active_match_count)
      ORDER BY p.created_at DESC,p.id DESC) FILTER(WHERE p.position<=50),'[]'::jsonb),count(*)>50
    INTO v_sessions,v_more FROM numbered p;
  RETURN jsonb_build_object('organization_id',p_organization_id,'cash_account_id',p_cash_account_id,'status',p_status,
    'offset',p_offset,'page_size',50,'has_more',v_more,'accounts',v_accounts,'sessions',v_sessions);
END;
$$;
REVOKE ALL ON FUNCTION public.read_reconciliation_list(uuid,uuid,text,integer) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_reconciliation_list(uuid,uuid,text,integer) TO ams_runtime;

-- Preserve the existing read OR write workspace boundary and accounting data;
-- override only these numeric JSON fields with their exact SQL decimal strings.
DO $patch$
DECLARE definition text;needle text:='to_jsonb(v_recon)';replacement text:=
  'to_jsonb(v_recon)||jsonb_build_object(''statement_opening'',v_recon.statement_opening::text,''statement_closing'',v_recon.statement_closing::text)';
BEGIN
  SELECT pg_get_functiondef('public.read_reconciliation_workspace(uuid,uuid)'::regprocedure) INTO definition;
  IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN
    RAISE EXCEPTION 'Expected exactly one reconciliation JSON serialization anchor.';
  END IF;
  EXECUTE replace(definition,needle,replacement);
END;
$patch$;
