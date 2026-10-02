CREATE FUNCTION public.read_general_ledger_accounts(p_organization_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,finance,finance_private AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT finance_private.has_permission(p_organization_id,'ledger.read') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',a.id,'code',a.code,'name',a.name) ORDER BY a.code),'[]'::jsonb) INTO v_result
  FROM finance.accounts a WHERE a.organization_id=p_organization_id AND EXISTS(
    SELECT 1 FROM finance.journal_lines l JOIN finance.journal_entries j ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id
    WHERE l.organization_id=a.organization_id AND l.account_id=a.id AND j.state='posted');
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.read_general_ledger_accounts(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_general_ledger_accounts(uuid) TO authenticated;

CREATE FUNCTION public.read_general_ledger(
 p_organization_id uuid,p_account_id uuid,p_from date,p_to date,p_cost_center_id uuid DEFAULT NULL,p_source_query text DEFAULT NULL,
 p_cutoff_at timestamptz DEFAULT NULL,p_after_date date DEFAULT NULL,p_after_posted_at timestamptz DEFAULT NULL,p_after_journal_id uuid DEFAULT NULL,p_after_line_no integer DEFAULT NULL,p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,finance,finance_private AS $$
DECLARE v_cutoff timestamptz;v_result jsonb;v_opening finance.amount;
BEGIN
 IF NOT finance_private.has_permission(p_organization_id,'ledger.read') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_limit<1 OR p_limit>200 OR length(p_source_query)>100 THEN RAISE EXCEPTION 'invalid filters' USING ERRCODE='22023'; END IF;
 IF ((p_after_date IS NULL) <> (p_after_posted_at IS NULL)) OR ((p_after_date IS NULL) <> (p_after_journal_id IS NULL)) OR ((p_after_date IS NULL) <> (p_after_line_no IS NULL)) THEN RAISE EXCEPTION 'invalid cursor' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM finance.accounts WHERE organization_id=p_organization_id AND id=p_account_id) THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;
 v_cutoff:=COALESCE(p_cutoff_at,clock_timestamp());
 SELECT COALESCE(sum(l.debit-l.credit),0)::finance.amount INTO v_opening FROM finance.journal_lines l JOIN finance.journal_entries j ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id JOIN finance.business_documents d ON d.organization_id=j.organization_id AND d.id=j.source_document_id
 WHERE j.organization_id=p_organization_id AND l.account_id=p_account_id AND j.state='posted' AND j.posted_at<=v_cutoff AND j.accounting_date<p_from AND (p_cost_center_id IS NULL OR l.cost_center_id=p_cost_center_id) AND (p_source_query IS NULL OR d.document_number ILIKE '%'||p_source_query||'%' OR d.description ILIKE '%'||p_source_query||'%' OR d.document_type::text ILIKE '%'||p_source_query||'%');
 WITH ledger_rows AS (
   SELECT j.accounting_date,j.posted_at,j.id AS journal_entry_id,l.id AS journal_line_id,l.line_no,l.debit::text AS debit,l.credit::text AS credit,
     (v_opening+sum(l.debit-l.credit) OVER(ORDER BY j.accounting_date,j.posted_at,j.id,l.line_no ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))::text AS running_balance,
     d.id AS source_document_id,d.document_number,d.document_type::text AS source_type,d.description AS memo,l.description AS line_description
   FROM finance.journal_lines l JOIN finance.journal_entries j ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id JOIN finance.business_documents d ON d.organization_id=j.organization_id AND d.id=j.source_document_id
   WHERE j.organization_id=p_organization_id AND l.account_id=p_account_id AND j.state='posted' AND j.posted_at<=v_cutoff AND j.accounting_date BETWEEN p_from AND p_to AND (p_cost_center_id IS NULL OR l.cost_center_id=p_cost_center_id) AND (p_source_query IS NULL OR d.document_number ILIKE '%'||p_source_query||'%' OR d.description ILIKE '%'||p_source_query||'%' OR d.document_type::text ILIKE '%'||p_source_query||'%')
 ), selected AS (
   SELECT * FROM ledger_rows r WHERE p_after_date IS NULL OR (r.accounting_date,r.posted_at,r.journal_entry_id,r.line_no)<(p_after_date,p_after_posted_at,p_after_journal_id,p_after_line_no)
   ORDER BY accounting_date DESC,posted_at DESC,journal_entry_id DESC,line_no DESC LIMIT p_limit+1
 )
 SELECT jsonb_build_object('cutoff_at',v_cutoff,'opening_balance',v_opening::text,
  'period_debit',(SELECT COALESCE(sum(r.debit::finance.amount),0)::text FROM ledger_rows r),'period_credit',(SELECT COALESCE(sum(r.credit::finance.amount),0)::text FROM ledger_rows r),
  'closing_balance',(v_opening+COALESCE((SELECT sum(r.debit::finance.amount-r.credit::finance.amount) FROM ledger_rows r),0))::text,
  'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('accounting_date',s.accounting_date,'posted_at',s.posted_at,'journal_entry_id',s.journal_entry_id,'journal_line_id',s.journal_line_id,'line_no',s.line_no,'debit',s.debit,'credit',s.credit,'running_balance',s.running_balance,'source_document_id',s.source_document_id,'document_number',s.document_number,'source_type',s.source_type,'memo',s.memo,'line_description',s.line_description) ORDER BY s.accounting_date DESC,s.posted_at DESC,s.journal_entry_id DESC,s.line_no DESC) FROM (SELECT * FROM selected ORDER BY accounting_date DESC,posted_at DESC,journal_entry_id DESC,line_no DESC LIMIT p_limit) s),'[]'::jsonb),'has_more',(SELECT count(*)>p_limit FROM selected)) INTO v_result;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.read_general_ledger(uuid,uuid,date,date,uuid,text,timestamptz,date,timestamptz,uuid,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_general_ledger(uuid,uuid,date,date,uuid,text,timestamptz,date,timestamptz,uuid,integer,integer) TO authenticated;

CREATE FUNCTION public.read_trial_balance(p_organization_id uuid,p_as_of date,p_from date DEFAULT NULL,p_cutoff_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,finance,finance_private AS $$
DECLARE v_cutoff timestamptz;v_rows jsonb;v_debit finance.amount;v_credit finance.amount;
BEGIN
 IF NOT finance_private.has_permission(p_organization_id,'reports.read') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF p_as_of IS NULL OR (p_from IS NOT NULL AND p_from>p_as_of) THEN RAISE EXCEPTION 'invalid dates' USING ERRCODE='22023'; END IF;
 v_cutoff:=COALESCE(p_cutoff_at,clock_timestamp());
 WITH balances AS (
  SELECT a.id,a.code,a.name,a.account_type,
   COALESCE(sum(l.debit-l.credit) FILTER(WHERE j.id IS NOT NULL AND p_from IS NOT NULL AND j.accounting_date<p_from),0)::finance.amount AS opening,
   COALESCE(sum(l.debit) FILTER(WHERE j.id IS NOT NULL AND (p_from IS NULL OR j.accounting_date>=p_from) AND j.accounting_date<=p_as_of),0)::finance.amount AS movement_debit,
   COALESCE(sum(l.credit) FILTER(WHERE j.id IS NOT NULL AND (p_from IS NULL OR j.accounting_date>=p_from) AND j.accounting_date<=p_as_of),0)::finance.amount AS movement_credit,
   COALESCE(sum(l.debit-l.credit) FILTER(WHERE j.id IS NOT NULL),0)::finance.amount AS closing
  FROM finance.accounts a LEFT JOIN finance.journal_lines l ON l.organization_id=a.organization_id AND l.account_id=a.id
  LEFT JOIN finance.journal_entries j ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id AND j.state='posted' AND j.accounting_date<=p_as_of AND j.posted_at<=v_cutoff
  WHERE a.organization_id=p_organization_id AND (a.is_active OR j.id IS NOT NULL)
  GROUP BY a.id,a.code,a.name,a.account_type
 ), nonzero AS (SELECT * FROM balances WHERE opening<>0 OR movement_debit<>0 OR movement_credit<>0 OR closing<>0)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('account_id',id,'code',code,'name',name,'account_type',account_type,'opening_debit',greatest(opening,0)::text,'opening_credit',greatest(-opening,0)::text,'movement_debit',movement_debit::text,'movement_credit',movement_credit::text,'closing_debit',greatest(closing,0)::text,'closing_credit',greatest(-closing,0)::text) ORDER BY code),'[]'::jsonb),
  COALESCE(sum(greatest(closing,0)),0)::finance.amount,COALESCE(sum(greatest(-closing,0)),0)::finance.amount
 INTO v_rows,v_debit,v_credit FROM nonzero;
 RETURN jsonb_build_object('as_of',p_as_of,'from_date',p_from,'cutoff_at',v_cutoff,'accounts',v_rows,'total_debit',v_debit::text,'total_credit',v_credit::text,'difference',(v_debit-v_credit)::text,'balanced',v_debit=v_credit,'opening_inclusion',CASE WHEN p_from IS NULL THEN 'No separate movement period; balances include all posted activity through the as-of date.' ELSE 'Opening includes posted entries dated before the movement start; period movements include both dates.' END,'closing_inclusion','Includes posted entries and reversals by accounting date through the as-of date.');
END $$;
REVOKE ALL ON FUNCTION public.read_trial_balance(uuid,date,date,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_trial_balance(uuid,date,date,timestamptz) TO authenticated;
