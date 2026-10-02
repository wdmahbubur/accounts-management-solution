CREATE OR REPLACE FUNCTION public.read_journal_register(
  p_organization_id uuid,
  p_account_query text DEFAULT NULL,
  p_source_query text DEFAULT NULL,
  p_period_query text DEFAULT NULL,
  p_limit integer DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, finance, finance_private AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT finance_private.has_permission(p_organization_id, 'ledger.read') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF p_limit < 1 OR p_limit > 200 THEN RAISE EXCEPTION 'invalid limit' USING ERRCODE='22023'; END IF;
  IF length(p_account_query) > 100 OR length(p_source_query) > 100 OR length(p_period_query) > 100 THEN RAISE EXCEPTION 'invalid filter' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.accounting_date DESC, q.document_number DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT j.id AS journal_entry_id, j.source_document_id, d.document_number, d.document_type::text AS source_type, d.description AS memo,
      j.accounting_date, p.label AS period_label, m.display_name_snapshot AS creator,
      sum(l.debit)::text AS debit_total, sum(l.credit)::text AS credit_total,
      string_agg(DISTINCT a.code || ' ' || a.name, ', ' ORDER BY a.code || ' ' || a.name) AS accounts,
      (SELECT rd.id FROM finance.business_documents rd WHERE rd.organization_id=d.organization_id AND rd.reversal_of_document_id=d.id) AS reversal_document_id,
      (SELECT rd.accounting_date FROM finance.business_documents rd WHERE rd.organization_id=d.organization_id AND rd.reversal_of_document_id=d.id) AS reversal_date,
      (SELECT rj.id FROM finance.business_documents rd JOIN finance.journal_entries rj ON rj.organization_id=rd.organization_id AND rj.source_document_id=rd.id AND rj.state='posted' WHERE rd.organization_id=d.organization_id AND rd.reversal_of_document_id=d.id) AS reversal_journal_entry_id,
      d.reversal_of_document_id AS reverses_document_id,
      (SELECT oj.id FROM finance.journal_entries oj WHERE oj.organization_id=d.organization_id AND oj.source_document_id=d.reversal_of_document_id AND oj.state='posted') AS reverses_journal_entry_id
    FROM finance.journal_entries j
    JOIN finance.business_documents d ON d.organization_id=j.organization_id AND d.id=j.source_document_id
    JOIN finance.accounting_periods p ON p.organization_id=j.organization_id AND p.id=j.period_id
    JOIN finance.organization_members m ON m.organization_id=j.organization_id AND m.id=j.posted_by_member_id
    JOIN finance.journal_lines l ON l.organization_id=j.organization_id AND l.journal_entry_id=j.id
    JOIN finance.accounts a ON a.organization_id=l.organization_id AND a.id=l.account_id
    WHERE j.organization_id=p_organization_id AND j.state='posted'
      AND (p_account_query IS NULL OR EXISTS (SELECT 1 FROM finance.journal_lines fl JOIN finance.accounts fa ON fa.organization_id=fl.organization_id AND fa.id=fl.account_id WHERE fl.organization_id=j.organization_id AND fl.journal_entry_id=j.id AND (fa.code ILIKE '%'||p_account_query||'%' OR fa.name ILIKE '%'||p_account_query||'%')))
      AND (p_source_query IS NULL OR d.document_number ILIKE '%'||p_source_query||'%' OR d.description ILIKE '%'||p_source_query||'%' OR d.document_type::text ILIKE '%'||p_source_query||'%')
      AND (p_period_query IS NULL OR p.label ILIKE '%'||p_period_query||'%')
    GROUP BY j.id,d.id,p.label,m.display_name_snapshot
    ORDER BY j.accounting_date DESC,d.document_number DESC LIMIT p_limit
  ) q;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.read_journal_register(uuid,text,text,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_journal_register(uuid,text,text,text,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.read_journal_register_detail(p_organization_id uuid, p_journal_entry_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, finance, finance_private AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT finance_private.has_permission(p_organization_id, 'ledger.read') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object(
    'journal_entry_id',j.id,'source_document_id',d.id,'document_number',d.document_number,'source_type',d.document_type::text,
    'accounting_date',j.accounting_date,'description',d.description,'period_label',p.label,'creator',m.display_name_snapshot,
    'debit_total',(SELECT sum(l.debit)::text FROM finance.journal_lines l WHERE l.organization_id=j.organization_id AND l.journal_entry_id=j.id),
    'credit_total',(SELECT sum(l.credit)::text FROM finance.journal_lines l WHERE l.organization_id=j.organization_id AND l.journal_entry_id=j.id),
    'reversal_document_id',(SELECT rd.id FROM finance.business_documents rd WHERE rd.organization_id=d.organization_id AND rd.reversal_of_document_id=d.id),
    'reversal_journal_entry_id',(SELECT rj.id FROM finance.business_documents rd JOIN finance.journal_entries rj ON rj.organization_id=rd.organization_id AND rj.source_document_id=rd.id AND rj.state='posted' WHERE rd.organization_id=d.organization_id AND rd.reversal_of_document_id=d.id),
    'reversal_date',(SELECT rd.accounting_date FROM finance.business_documents rd WHERE rd.organization_id=d.organization_id AND rd.reversal_of_document_id=d.id),
    'reverses_document_id',d.reversal_of_document_id,
    'reverses_journal_entry_id',(SELECT oj.id FROM finance.journal_entries oj WHERE oj.organization_id=d.organization_id AND oj.source_document_id=d.reversal_of_document_id AND oj.state='posted'),
    'lines',(SELECT COALESCE(jsonb_agg(jsonb_build_object('line_no',l.line_no,'account_code',a.code,'account_name',a.name,'party_id',l.party_id,'cost_center_id',l.cost_center_id,'description',l.description,'debit',l.debit::text,'credit',l.credit::text) ORDER BY l.line_no),'[]'::jsonb) FROM finance.journal_lines l JOIN finance.accounts a ON a.organization_id=l.organization_id AND a.id=l.account_id WHERE l.organization_id=j.organization_id AND l.journal_entry_id=j.id)
  ) INTO v_result
  FROM finance.journal_entries j
  JOIN finance.business_documents d ON d.organization_id=j.organization_id AND d.id=j.source_document_id
  JOIN finance.accounting_periods p ON p.organization_id=j.organization_id AND p.id=j.period_id
  JOIN finance.organization_members m ON m.organization_id=j.organization_id AND m.id=j.posted_by_member_id
  WHERE j.organization_id=p_organization_id AND j.id=p_journal_entry_id AND j.state='posted';
  IF v_result IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.read_journal_register_detail(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_journal_register_detail(uuid,uuid) TO authenticated;
