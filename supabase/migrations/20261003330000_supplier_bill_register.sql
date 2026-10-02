-- US-033: tenant-scoped supplier bill register and ledger-derived AP balances.
CREATE FUNCTION public.read_bill_register(
  p_organization_id uuid,p_status text DEFAULT 'all',p_search text DEFAULT NULL,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 101
) RETURNS TABLE(id uuid,organization_id uuid,state text,document_number text,vendor_name text,invoice_reference text,
  issue_date date,due_date date,total_amount text,residual_amount text,settlement_status text,duplicate_reference boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_today date;v_timezone text;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'purchases.read');
  IF p_status NOT IN ('all','drafts','awaiting_approval','posted') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 101
    OR (p_search IS NOT NULL AND length(p_search)>100) THEN RAISE EXCEPTION 'invalid bill filters' USING ERRCODE='22023'; END IF;
  SELECT o.timezone INTO v_timezone FROM finance.organizations o WHERE o.id=p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'organization unavailable' USING ERRCODE='P0002'; END IF;
  v_today:=(now() AT TIME ZONE v_timezone)::date;
  RETURN QUERY SELECT d.id,d.organization_id,d.state::text,d.document_number,c.display_name,td.supplier_invoice_key,d.issue_date,d.due_date,d.total_amount::text,
    CASE WHEN d.state='posted' THEN balances.residual::text ELSE NULL END,
    CASE WHEN d.state<>'posted' THEN 'not_posted' WHEN balances.residual=0 THEN 'paid' WHEN balances.residual<d.total_amount THEN 'partially_paid' ELSE 'unpaid' END,
    COALESCE(NULLIF(btrim(td.supplier_invoice_key),'') IS NOT NULL AND EXISTS(
      SELECT 1 FROM finance.trade_documents other_td JOIN finance.business_documents other_d ON other_d.organization_id=other_td.organization_id AND other_d.id=other_td.document_id
      WHERE other_td.organization_id=d.organization_id AND other_td.document_id<>d.id AND other_d.document_type='bill' AND other_d.party_id=d.party_id
        AND lower(btrim(other_td.supplier_invoice_key))=lower(btrim(td.supplier_invoice_key))),false)
  FROM finance.business_documents d JOIN finance.contacts c ON c.organization_id=d.organization_id AND c.id=d.party_id
    JOIN finance.trade_documents td ON td.organization_id=d.organization_id AND td.document_id=d.id
  CROSS JOIN LATERAL (SELECT CASE WHEN d.state<>'posted' THEN 0::finance.amount ELSE COALESCE(sum(GREATEST(oi.original_amount-COALESCE(applied.amount,0),0)),0)::finance.amount END AS residual
    FROM finance.open_items oi JOIN finance.journal_lines jl ON jl.organization_id=oi.organization_id AND jl.id=oi.journal_line_id
      JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id
    LEFT JOIN LATERAL (SELECT COALESCE(sum(events.delta),0)::finance.amount AS amount FROM (
      SELECT a.amount AS delta FROM finance.settlement_allocations a WHERE a.organization_id=oi.organization_id AND (a.debit_open_item_id=oi.id OR a.credit_open_item_id=oi.id) AND a.effective_date<=v_today
      UNION ALL SELECT -a.amount FROM finance.settlement_allocations a JOIN finance.allocation_reversals r ON r.organization_id=a.organization_id AND r.allocation_id=a.id
        WHERE a.organization_id=oi.organization_id AND (a.debit_open_item_id=oi.id OR a.credit_open_item_id=oi.id) AND r.effective_date<=v_today
    ) events) applied ON true WHERE d.state='posted' AND je.source_document_id=d.id AND oi.control_kind='ap' AND oi.side='credit') balances
  WHERE d.organization_id=p_organization_id AND d.document_type='bill'
    AND (p_status='all' OR (p_status='drafts' AND d.state='draft') OR (p_status='awaiting_approval' AND d.state='pending_approval') OR (p_status='posted' AND d.state='posted'))
    AND (p_after IS NULL OR d.id<p_after) AND (p_search IS NULL OR btrim(p_search)='' OR d.document_number ILIKE '%'||btrim(p_search)||'%'
      OR c.display_name ILIKE '%'||btrim(p_search)||'%' OR COALESCE(td.supplier_invoice_key,'') ILIKE '%'||btrim(p_search)||'%' OR COALESCE(d.external_reference,'') ILIKE '%'||btrim(p_search)||'%')
  ORDER BY d.id DESC LIMIT p_limit;
END; $$;
REVOKE ALL ON FUNCTION public.read_bill_register(uuid,text,text,uuid,integer) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_bill_register(uuid,text,text,uuid,integer) TO ams_runtime;
NOTIFY pgrst,'reload schema';
