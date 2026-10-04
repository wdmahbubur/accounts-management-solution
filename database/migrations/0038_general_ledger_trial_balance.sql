-- US-048: dated ledger drilldown and trial balance from posted journal lines.
CREATE FUNCTION public.list_report_accounts(p_organization_id uuid)
RETURNS TABLE(id uuid,code text,name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'ledger.read');
  RETURN QUERY SELECT a.id,a.code,a.name FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.is_postable ORDER BY a.code;
END; $$;
REVOKE ALL ON FUNCTION public.list_report_accounts(uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.list_report_accounts(uuid) TO ams_runtime;

CREATE FUNCTION public.read_general_ledger(p_organization_id uuid,p_account_id uuid,p_from date,p_to date,p_source text DEFAULT NULL,p_cost_center_id uuid DEFAULT NULL,
  p_after_date date DEFAULT NULL,p_after_journal_id uuid DEFAULT NULL,p_after_line_no integer DEFAULT NULL,p_limit integer DEFAULT 501)
RETURNS TABLE(line_id uuid,journal_id uuid,source_document_id uuid,document_number text,source_type text,account_id uuid,account_code text,account_name text,
  accounting_date date,line_no integer,description text,cost_center_id uuid,debit text,credit text,movement text,running_balance text,opening_balance text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_open finance.amount;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'ledger.read');
  IF p_account_id IS NULL OR p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_from>p_to OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 501 OR
    (p_source IS NOT NULL AND length(p_source)>100) OR ((p_after_date IS NULL OR p_after_journal_id IS NULL OR p_after_line_no IS NULL) AND (p_after_date IS NOT NULL OR p_after_journal_id IS NOT NULL OR p_after_line_no IS NOT NULL)) OR
    (p_after_line_no IS NOT NULL AND p_after_line_no<1) THEN RAISE EXCEPTION 'invalid ledger filters' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=p_account_id) THEN RAISE EXCEPTION 'account unavailable' USING ERRCODE='P0002'; END IF;
  SELECT COALESCE(sum(jl.debit-jl.credit),0)::finance.amount INTO v_open FROM finance.journal_lines jl
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
    JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id AND d.state='posted'
  WHERE jl.organization_id=p_organization_id AND jl.account_id=p_account_id AND je.accounting_date<p_from AND (p_cost_center_id IS NULL OR jl.cost_center_id=p_cost_center_id)
    AND (p_source IS NULL OR btrim(p_source)='' OR d.document_number ILIKE '%'||btrim(p_source)||'%' OR d.document_type::text ILIKE '%'||btrim(p_source)||'%' OR d.description ILIKE '%'||btrim(p_source)||'%');
  RETURN QUERY WITH base AS (
    SELECT jl.id AS line_id,je.id AS journal_id,d.id AS source_document_id,d.document_number,d.document_type::text AS source_type,a.id AS account_id,a.code AS account_code,a.name AS account_name,
      je.accounting_date,jl.line_no,jl.description,jl.cost_center_id,jl.debit,jl.credit,(jl.debit-jl.credit)::finance.amount AS movement
    FROM finance.journal_lines jl JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
    JOIN finance.accounts a ON a.organization_id=jl.organization_id AND a.id=jl.account_id
    JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id AND d.state='posted'
    WHERE jl.organization_id=p_organization_id AND jl.account_id=p_account_id AND je.accounting_date BETWEEN p_from AND p_to
      AND (p_cost_center_id IS NULL OR jl.cost_center_id=p_cost_center_id)
      AND (p_source IS NULL OR btrim(p_source)='' OR d.document_number ILIKE '%'||btrim(p_source)||'%' OR d.document_type::text ILIKE '%'||btrim(p_source)||'%' OR d.description ILIKE '%'||btrim(p_source)||'%')
  ), running AS (SELECT base.*,v_open+sum(movement) OVER(ORDER BY accounting_date,journal_id,line_no ROWS UNBOUNDED PRECEDING) AS running_balance FROM base),
  page AS (SELECT * FROM running r WHERE p_after_date IS NULL OR (r.accounting_date,r.journal_id,r.line_no)>(p_after_date,p_after_journal_id,p_after_line_no)
    ORDER BY accounting_date,journal_id,line_no LIMIT p_limit)
  SELECT r.line_id,r.journal_id,r.source_document_id,r.document_number,r.source_type,r.account_id,r.account_code,r.account_name,r.accounting_date,r.line_no,r.description,r.cost_center_id,
    r.debit::text,r.credit::text,r.movement::text,r.running_balance::text,v_open::text FROM page r ORDER BY r.accounting_date,r.journal_id,r.line_no;
END; $$;
REVOKE ALL ON FUNCTION public.read_general_ledger(uuid,uuid,date,date,text,uuid,date,uuid,integer,integer) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_general_ledger(uuid,uuid,date,date,text,uuid,date,uuid,integer,integer) TO ams_runtime;

CREATE FUNCTION public.read_general_ledger_opening(p_organization_id uuid,p_account_id uuid,p_from date,p_source text DEFAULT NULL,p_cost_center_id uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_open finance.amount;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'ledger.read');
  IF p_account_id IS NULL OR p_from IS NULL OR NOT isfinite(p_from) OR (p_source IS NOT NULL AND length(p_source)>100) THEN RAISE EXCEPTION 'invalid ledger filters' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(sum(jl.debit-jl.credit),0)::finance.amount INTO v_open FROM finance.journal_lines jl JOIN finance.journal_entries je
    ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
    JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id AND d.state='posted'
  WHERE jl.organization_id=p_organization_id AND jl.account_id=p_account_id AND je.accounting_date<p_from AND (p_cost_center_id IS NULL OR jl.cost_center_id=p_cost_center_id)
    AND (p_source IS NULL OR btrim(p_source)='' OR d.document_number ILIKE '%'||btrim(p_source)||'%' OR d.document_type::text ILIKE '%'||btrim(p_source)||'%' OR d.description ILIKE '%'||btrim(p_source)||'%');
  RETURN v_open::text;
END; $$;
REVOKE ALL ON FUNCTION public.read_general_ledger_opening(uuid,uuid,date,text,uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_general_ledger_opening(uuid,uuid,date,text,uuid) TO ams_runtime;

CREATE FUNCTION public.read_trial_balance(p_organization_id uuid,p_as_of date,p_from date DEFAULT NULL)
RETURNS TABLE(account_id uuid,account_code text,account_name text,account_type text,opening_balance text,movement_debit text,movement_credit text,closing_debit text,closing_credit text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'reports.read');
  IF p_as_of IS NULL OR NOT isfinite(p_as_of) OR (p_from IS NOT NULL AND (NOT isfinite(p_from) OR p_from>p_as_of)) THEN RAISE EXCEPTION 'invalid trial balance dates' USING ERRCODE='22023'; END IF;
  RETURN QUERY WITH balances AS (
    SELECT a.id,a.code,a.name,a.account_type,
      COALESCE(sum(jl.debit-jl.credit) FILTER(WHERE je.accounting_date<COALESCE(p_from,p_as_of+1)),0)::finance.amount AS opening,
      COALESCE(sum(jl.debit) FILTER(WHERE p_from IS NOT NULL AND je.accounting_date>=p_from AND je.accounting_date<=p_as_of),0)::finance.amount AS movement_dr,
      COALESCE(sum(jl.credit) FILTER(WHERE p_from IS NOT NULL AND je.accounting_date>=p_from AND je.accounting_date<=p_as_of),0)::finance.amount AS movement_cr,
      COALESCE(sum(jl.debit-jl.credit) FILTER(WHERE je.accounting_date<=p_as_of),0)::finance.amount AS closing
    FROM finance.accounts a LEFT JOIN finance.journal_lines jl ON jl.organization_id=a.organization_id AND jl.account_id=a.id
    LEFT JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
    WHERE a.organization_id=p_organization_id AND a.is_postable GROUP BY a.id,a.code,a.name,a.account_type
  ) SELECT b.id,b.code,b.name,b.account_type,b.opening::text,b.movement_dr::text,b.movement_cr::text,
    greatest(b.closing,0)::text,greatest(-b.closing,0)::text FROM balances b ORDER BY b.code;
END; $$;
REVOKE ALL ON FUNCTION public.read_trial_balance(uuid,date,date) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_trial_balance(uuid,date,date) TO ams_runtime;
NOTIFY pgrst,'reload schema';
