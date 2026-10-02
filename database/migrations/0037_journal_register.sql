-- US-047: ledger-scoped immutable journal register, including dated reversals.
CREATE FUNCTION public.read_journal_register(p_organization_id uuid,p_search text DEFAULT NULL,p_from date DEFAULT NULL,p_to date DEFAULT NULL,p_limit integer DEFAULT 101)
RETURNS TABLE(id uuid,organization_id uuid,document_number text,document_type text,accounting_date date,description text,debit_total text,credit_total text,created_by text,reversal_of_document_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'ledger.read');
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 101 OR (p_search IS NOT NULL AND length(p_search)>100) OR
    (p_from IS NOT NULL AND NOT isfinite(p_from)) OR (p_to IS NOT NULL AND NOT isfinite(p_to)) OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from>p_to) THEN
    RAISE EXCEPTION 'invalid journal filters' USING ERRCODE='22023';
  END IF;
  RETURN QUERY SELECT d.id,d.organization_id,d.document_number,d.document_type::text,d.accounting_date,d.description,
    COALESCE(sum(jl.debit),0)::text,COALESCE(sum(jl.credit),0)::text,m.display_name_snapshot,d.reversal_of_document_id
  FROM finance.business_documents d
  JOIN finance.journal_entries je ON je.organization_id=d.organization_id AND je.source_document_id=d.id AND je.state='posted'
  JOIN finance.journal_lines jl ON jl.organization_id=je.organization_id AND jl.journal_entry_id=je.id
  JOIN finance.organization_members m ON m.organization_id=d.organization_id AND m.id=d.created_by_member_id
  WHERE d.organization_id=p_organization_id AND d.state='posted'
    AND (d.document_type='manual_journal' OR (d.document_type='reversal' AND EXISTS(SELECT 1 FROM finance.business_documents original
      WHERE original.organization_id=d.organization_id AND original.id=d.reversal_of_document_id AND original.document_type='manual_journal')))
    AND (p_from IS NULL OR d.accounting_date>=p_from) AND (p_to IS NULL OR d.accounting_date<=p_to)
    AND (p_search IS NULL OR btrim(p_search)='' OR d.document_number ILIKE '%'||btrim(p_search)||'%' OR d.description ILIKE '%'||btrim(p_search)||'%')
  GROUP BY d.id,m.display_name_snapshot ORDER BY d.accounting_date DESC,d.id DESC LIMIT p_limit;
END; $$;
REVOKE ALL ON FUNCTION public.read_journal_register(uuid,text,date,date,integer) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_journal_register(uuid,text,date,date,integer) TO ams_runtime;
NOTIFY pgrst,'reload schema';
