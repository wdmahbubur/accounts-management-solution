-- US-046: permission-scoped transfer register; transfers themselves post atomically via US-018.
CREATE FUNCTION public.read_transfer_register(p_organization_id uuid,p_search text DEFAULT NULL,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 101)
RETURNS TABLE(id uuid,organization_id uuid,state text,document_number text,accounting_date date,from_account text,to_account text,
  amount text,fee_amount text,total_amount text,external_reference text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'banking.read');
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 101 OR (p_search IS NOT NULL AND length(p_search)>100) THEN RAISE EXCEPTION 'invalid transfer filters' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT d.id,d.organization_id,d.state::text,d.document_number,d.accounting_date,src.name,dst.name,t.amount::text,t.fee_amount::text,d.total_amount::text,d.external_reference
  FROM finance.business_documents d JOIN finance.transfers t ON t.organization_id=d.organization_id AND t.document_id=d.id
    JOIN finance.cash_accounts src ON src.organization_id=t.organization_id AND src.id=t.from_cash_account_id
    JOIN finance.cash_accounts dst ON dst.organization_id=t.organization_id AND dst.id=t.to_cash_account_id
  WHERE d.organization_id=p_organization_id AND d.document_type='transfer' AND (p_after IS NULL OR d.id<p_after)
    AND (p_search IS NULL OR btrim(p_search)='' OR d.document_number ILIKE '%'||btrim(p_search)||'%' OR src.name ILIKE '%'||btrim(p_search)||'%'
      OR dst.name ILIKE '%'||btrim(p_search)||'%' OR COALESCE(d.external_reference,'') ILIKE '%'||btrim(p_search)||'%')
  ORDER BY d.id DESC LIMIT p_limit;
END; $$;
REVOKE ALL ON FUNCTION public.read_transfer_register(uuid,text,uuid,integer) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_transfer_register(uuid,text,uuid,integer) TO ams_runtime;
NOTIFY pgrst,'reload schema';
