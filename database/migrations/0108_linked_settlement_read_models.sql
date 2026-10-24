-- Permission-checked, dated choices and advance lifecycle; no runtime table grant.
CREATE INDEX linked_settlement_source_idx ON finance.linked_settlement_details(organization_id,source_open_item_id);
CREATE INDEX linked_settlement_target_idx ON finance.linked_settlement_details(organization_id,target_open_item_id);
CREATE FUNCTION public.read_linked_settlement_options(p_organization_id uuid,p_effective_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_sources jsonb; v_targets jsonb;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'dues.read');
  IF p_effective_date IS NULL OR NOT isfinite(p_effective_date) THEN RAISE EXCEPTION 'valid date required' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(jsonb_agg(x.value ORDER BY x.accounting_date DESC,x.id),'[]'::jsonb) INTO v_sources FROM (
    SELECT d.accounting_date,oi.id,jsonb_build_object('id',oi.id,'document_id',d.id,'document_type',d.document_type,'document_number',d.document_number,
      'party_id',oi.party_id,'party_name',c.display_name,'control_kind',oi.control_kind,'original_amount',oi.original_amount::text,
      'remaining_amount',finance_private.open_item_residual_as_of(p_organization_id,oi.id,p_effective_date)::text,
      'reversed',EXISTS(SELECT 1 FROM finance.business_documents r WHERE r.organization_id=d.organization_id AND r.reversal_of_document_id=d.id),
      'applied_amount',COALESCE((SELECT sum(a.amount) FROM finance.settlement_allocations a JOIN finance.business_documents s ON s.organization_id=a.organization_id AND s.id=a.source_document_id
        WHERE a.organization_id=p_organization_id AND oi.id IN (a.debit_open_item_id,a.credit_open_item_id) AND s.document_type='advance_application' AND a.effective_date<=p_effective_date
        AND NOT EXISTS(SELECT 1 FROM finance.allocation_reversals r WHERE r.organization_id=a.organization_id AND r.allocation_id=a.id AND r.effective_date<=p_effective_date)),0)::finance.amount::text,
      'refunded_amount',COALESCE((SELECT sum(a.amount) FROM finance.settlement_allocations a JOIN finance.business_documents s ON s.organization_id=a.organization_id AND s.id=a.source_document_id
        WHERE a.organization_id=p_organization_id AND oi.id IN (a.debit_open_item_id,a.credit_open_item_id) AND s.document_type IN ('customer_refund','vendor_refund') AND a.effective_date<=p_effective_date
        AND NOT EXISTS(SELECT 1 FROM finance.allocation_reversals r WHERE r.organization_id=a.organization_id AND r.allocation_id=a.id AND r.effective_date<=p_effective_date)),0)::finance.amount::text,
      'history',COALESCE((SELECT jsonb_agg(jsonb_build_object('document_id',s.id,'document_type',s.document_type,'document_number',s.document_number,'amount',a.amount::text,
        'effective_date',a.effective_date,'reversed_on',(SELECT r.effective_date FROM finance.allocation_reversals r WHERE r.organization_id=a.organization_id AND r.allocation_id=a.id)) ORDER BY a.effective_date,a.id)
        FROM finance.settlement_allocations a JOIN finance.business_documents s ON s.organization_id=a.organization_id AND s.id=a.source_document_id
        WHERE a.organization_id=p_organization_id AND oi.id IN (a.debit_open_item_id,a.credit_open_item_id) AND a.effective_date<=p_effective_date
          AND finance_private.can_read_document(p_organization_id,s.id)),'[]'::jsonb)
    ) AS value FROM finance.open_items oi JOIN finance.journal_lines l ON l.organization_id=oi.organization_id AND l.id=oi.journal_line_id
      JOIN finance.journal_entries j ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id
      JOIN finance.business_documents d ON d.organization_id=j.organization_id AND d.id=j.source_document_id
      JOIN finance.contacts c ON c.organization_id=oi.organization_id AND c.id=oi.party_id
    WHERE oi.organization_id=p_organization_id AND d.state='posted' AND j.state='posted' AND oi.issue_date<=p_effective_date
      AND ((d.document_type IN ('customer_advance','customer_credit','receipt') AND oi.side='credit' AND oi.control_kind IN ('ar','customer_advance'))
        OR (d.document_type IN ('vendor_advance','vendor_credit','vendor_payment') AND oi.side='debit' AND oi.control_kind IN ('ap','vendor_advance')))
      AND finance_private.can_read_document(p_organization_id,d.id)
  ) x;
  SELECT COALESCE(jsonb_agg(x.value ORDER BY x.accounting_date,x.id),'[]'::jsonb) INTO v_targets FROM (
    SELECT d.accounting_date,oi.id,jsonb_build_object('id',oi.id,'document_id',d.id,'document_type',d.document_type,'document_number',d.document_number,
      'party_id',oi.party_id,'control_kind',oi.control_kind,'remaining_amount',finance_private.open_item_residual_as_of(p_organization_id,oi.id,p_effective_date)::text) AS value
    FROM finance.open_items oi JOIN finance.journal_lines l ON l.organization_id=oi.organization_id AND l.id=oi.journal_line_id
      JOIN finance.journal_entries j ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id
      JOIN finance.business_documents d ON d.organization_id=j.organization_id AND d.id=j.source_document_id
    WHERE oi.organization_id=p_organization_id AND d.state='posted' AND j.state='posted' AND oi.issue_date<=p_effective_date
      AND ((d.document_type='invoice' AND oi.control_kind='ar' AND oi.side='debit') OR (d.document_type='bill' AND oi.control_kind='ap' AND oi.side='credit'))
      AND finance_private.open_item_residual_as_of(p_organization_id,oi.id,p_effective_date)>0
      AND NOT EXISTS(SELECT 1 FROM finance.business_documents r WHERE r.organization_id=d.organization_id AND r.reversal_of_document_id=d.id)
      AND finance_private.can_read_document(p_organization_id,d.id)
  ) x;
  RETURN jsonb_build_object('organization_id',p_organization_id,'effective_date',p_effective_date,'sources',v_sources,'targets',v_targets);
END; $$;
REVOKE ALL ON FUNCTION public.read_linked_settlement_options(uuid,date) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_linked_settlement_options(uuid,date) TO ams_runtime;

DO $$
DECLARE f text; anchor text:='''allocation_plan'',COALESCE(';
BEGIN
  f:=replace(pg_get_functiondef('public.read_financial_document(uuid,uuid)'::regprocedure),E'\r\n',E'\n');
  IF position(anchor IN f)=0 THEN RAISE EXCEPTION 'document read extension anchor missing'; END IF;
  f:=replace(f,anchor,$new$'linked_settlement',(SELECT jsonb_build_object('source_open_item_id',s.source_open_item_id,'target_open_item_id',s.target_open_item_id,
      'amount',s.amount::text,'document_version',s.document_version,'source_document_id',sd.id,'source_document_number',sd.document_number,
      'target_document_id',tdoc.id,'target_document_number',tdoc.document_number)
      FROM finance.linked_settlement_details s JOIN finance.open_items soi ON soi.organization_id=s.organization_id AND soi.id=s.source_open_item_id
      JOIN finance.journal_lines sl ON sl.organization_id=soi.organization_id AND sl.id=soi.journal_line_id
      JOIN finance.journal_entries sj ON sj.organization_id=sl.organization_id AND sj.id=sl.journal_entry_id
      JOIN finance.business_documents sd ON sd.organization_id=sj.organization_id AND sd.id=sj.source_document_id
      LEFT JOIN finance.open_items toi ON toi.organization_id=s.organization_id AND toi.id=s.target_open_item_id
      LEFT JOIN finance.journal_lines tl ON tl.organization_id=toi.organization_id AND tl.id=toi.journal_line_id
      LEFT JOIN finance.journal_entries tj ON tj.organization_id=tl.organization_id AND tj.id=tl.journal_entry_id
      LEFT JOIN finance.business_documents tdoc ON tdoc.organization_id=tj.organization_id AND tdoc.id=tj.source_document_id
      WHERE s.organization_id=d.organization_id AND s.document_id=d.id
        AND finance_private.can_read_document(s.organization_id,sd.id) AND (tdoc.id IS NULL OR finance_private.can_read_document(s.organization_id,tdoc.id))),
    'allocation_plan',COALESCE($new$);
  EXECUTE f;
END $$;
NOTIFY pgrst,'reload schema';
