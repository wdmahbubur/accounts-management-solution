-- #174: the downloaded cutover evidence must retain individual original
-- references and due dates as well as summarized trial-balance totals.
CREATE OR REPLACE FUNCTION public.read_opening_cutover_summary(p_organization_id uuid,p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM finance_private.require_capability(p_organization_id,'accounting.read');
 RETURN (SELECT jsonb_build_object('cutover_date',s.cutover_date,'prior_trial_balance',s.prior_trial_balance,
  'ytd_summary',s.ytd_summary,'evidence_reference',s.evidence_reference,'created_at',s.created_at,
  'source_document',jsonb_build_object('id',d.id,'version',d.version,'state',d.state,'number',d.document_number,
    'accounting_date',d.accounting_date,'currency',d.currency),
  'control_items',COALESCE((SELECT jsonb_agg(jsonb_build_object('line_no',r.line_no,'account_id',r.account_id,
    'control_kind',a.control_kind,'party_id',r.party_id,'original_reference',r.open_item_reference,
    'original_due_date',r.open_item_due_date,'availability_date',d.accounting_date,'debit',r.debit::text,'credit',r.credit::text)
    ORDER BY r.line_no) FROM finance.manual_journal_rows r
    JOIN finance.accounts a ON a.organization_id=r.organization_id AND a.id=r.account_id
    WHERE r.organization_id=d.organization_id AND r.document_id=d.id AND a.control_kind IS NOT NULL),'[]'::jsonb))
 FROM finance_private.opening_cutover_summaries s
 JOIN finance.business_documents d ON d.organization_id=s.organization_id AND d.id=s.document_id
 WHERE s.organization_id=p_organization_id AND s.document_id=p_document_id AND d.document_type='opening_balance'
  AND finance_private.can_read_document(d.organization_id,d.id));
END $$;
REVOKE ALL ON FUNCTION public.read_opening_cutover_summary(uuid,uuid) FROM PUBLIC,ams_runtime,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_opening_cutover_summary(uuid,uuid) TO ams_runtime;
NOTIFY pgrst,'reload schema';
