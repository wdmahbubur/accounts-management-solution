-- UI-14 / US-030: readable saved document evidence without directory/write-option lookups.
-- Keep source visibility, exact amounts, snapshots, version and material digest unchanged.
-- Only metadata for this source's tenant-qualified references is returned; no bank numbers or balances.
-- Issued party labels use the immutable source snapshot. Other journal parties use directory labels.
-- Posted accounting data additionally requires ledger.read, matching the detail UI's existing boundary.
CREATE OR REPLACE FUNCTION public.read_financial_document(p_organization_id uuid,p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_document finance.business_documents%ROWTYPE; v_result jsonb;
BEGIN
  IF NOT finance_private.can_read_document(p_organization_id,p_document_id) THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_document FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id;
  SELECT jsonb_build_object('id',d.id,'document_type',d.document_type,'state',d.state,'document_number',d.document_number,'party_id',d.party_id,
    'reversal_of_document_id',d.reversal_of_document_id,'reversed_by_document_id',(SELECT r.id FROM finance.business_documents r WHERE r.organization_id=d.organization_id AND r.reversal_of_document_id=d.id),
    'reversed_by_document_number',(SELECT r.document_number FROM finance.business_documents r WHERE r.organization_id=d.organization_id AND r.reversal_of_document_id=d.id),
    'reversal_of_document_number',(SELECT original.document_number FROM finance.business_documents original WHERE original.organization_id=d.organization_id AND original.id=d.reversal_of_document_id AND finance_private.can_read_document(original.organization_id,original.id)),
    'party_snapshot',d.party_snapshot,'issue_date',d.issue_date,'accounting_date',d.accounting_date,'due_date',d.due_date,'external_reference',d.external_reference,
    'description',d.description,'currency',d.currency,'net_amount',d.net_amount::text,'tax_amount',d.tax_amount::text,'rounding_adjustment',d.rounding_adjustment::text,
    'rounding_reason',d.rounding_reason,'rounding_account_id',d.rounding_account_id,
    'rounding_account_code',ra.code,'rounding_account_name',ra.name,
    'total_amount',d.total_amount::text,'version',d.version,'material_digest',d.material_digest,
    'trade',CASE WHEN td.document_id IS NULL THEN NULL ELSE jsonb_build_object('original_document_id',td.original_document_id,'recognition_mode',td.recognition_mode,
      'performance_confirmed',td.performance_confirmed,'supplier_invoice_date',td.supplier_invoice_date,'supplier_invoice_key',td.supplier_invoice_key,'terms',td.terms,'notes',td.notes) END,
    'movement',CASE WHEN mm.document_id IS NULL THEN NULL ELSE jsonb_build_object('cash_account_id',mm.cash_account_id,'cash_account_name',mc.name,'cash_account_kind',mc.kind,'direction',mm.direction,'amount',mm.amount::text,
      'method',mm.method,'reference',mm.reference,'cash_flow_class',mm.cash_flow_class) END,
    'transfer',CASE WHEN tr.document_id IS NULL THEN NULL ELSE jsonb_build_object('from_cash_account_id',tr.from_cash_account_id,'from_cash_account_name',fc.name,
      'to_cash_account_id',tr.to_cash_account_id,'to_cash_account_name',tc.name,
      'amount',tr.amount::text,'fee_amount',tr.fee_amount::text,'fee_account_id',tr.fee_account_id,'fee_account_code',fa.code,'fee_account_name',fa.name) END,
    'lines',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',l.id,'line_no',l.line_no,'item_id',l.item_id,'original_line_id',l.original_line_id,'description',l.description,
      'quantity',l.quantity::text,'unit_price',l.unit_price::text,'discount_amount',l.discount_amount::text,'account_id',l.account_id,'account_code',la.code,'account_name',la.name,'cost_center_id',l.cost_center_id,
      'tax_code_id',l.tax_code_id,'tax_label_snapshot',l.tax_label_snapshot,'tax_rate_snapshot',l.tax_rate_snapshot::text,'tax_mode',l.tax_mode,
      'tax_recoverability_snapshot',l.tax_recoverability_snapshot,'tax_account_id',l.tax_account_id,'net_amount',l.net_amount::text,'tax_amount',l.tax_amount::text,
      'gross_amount',l.gross_amount::text,'cash_flow_class',l.cash_flow_class) ORDER BY l.line_no) FROM finance.document_lines l
      LEFT JOIN finance.accounts la ON la.organization_id=l.organization_id AND la.id=l.account_id
      WHERE l.organization_id=d.organization_id AND l.document_id=d.id),'[]'::jsonb),
    'journal_rows',COALESCE((SELECT jsonb_agg(jsonb_build_object('line_no',j.line_no,'account_id',j.account_id,'account_code',ja.code,'account_name',ja.name,'party_id',j.party_id,
      'party_name',CASE WHEN j.party_id=d.party_id THEN d.party_snapshot->>'display_name' ELSE jp.display_name END,
      'cost_center_id',j.cost_center_id,'cost_center_code',jc.code,'cost_center_name',jc.name,
      'debit',j.debit::text,'credit',j.credit::text,'description',j.description,'cash_flow_class',j.cash_flow_class,'open_item_reference',j.open_item_reference,
      'open_item_due_date',j.open_item_due_date) ORDER BY j.line_no) FROM finance.manual_journal_rows j
      LEFT JOIN finance.accounts ja ON ja.organization_id=j.organization_id AND ja.id=j.account_id
      LEFT JOIN finance.contacts jp ON jp.organization_id=j.organization_id AND jp.id=j.party_id
      LEFT JOIN finance.cost_centers jc ON jc.organization_id=j.organization_id AND jc.id=j.cost_center_id
      WHERE j.organization_id=d.organization_id AND j.document_id=d.id),'[]'::jsonb),
    'posted_journal',CASE WHEN finance_private.has_permission(p_organization_id,'ledger.read') THEN
      (SELECT jsonb_build_object('id',je.id,'accounting_date',je.accounting_date,'lines',COALESCE((
        SELECT jsonb_agg(jsonb_build_object('line_id',jl.id,'line_no',jl.line_no,'account_id',jl.account_id,
          'account_code',a.code,'account_name',a.name,'party_id',jl.party_id,
          'party_name',CASE WHEN jl.party_id=d.party_id THEN d.party_snapshot->>'display_name' ELSE party.display_name END,
          'description',jl.description,'cost_center_id',jl.cost_center_id,'cost_center_code',cc.code,'cost_center_name',cc.name,
          'debit',jl.debit::text,'credit',jl.credit::text,'cash_flow_class',jl.cash_flow_class,
          'open_item_id',oi.id,'open_item_reference',oi.reference,'open_item_due_date',oi.due_date) ORDER BY jl.line_no)
        FROM finance.journal_lines jl
        LEFT JOIN finance.accounts a ON a.organization_id=jl.organization_id AND a.id=jl.account_id
        LEFT JOIN finance.contacts party ON party.organization_id=jl.organization_id AND party.id=jl.party_id
        LEFT JOIN finance.cost_centers cc ON cc.organization_id=jl.organization_id AND cc.id=jl.cost_center_id
        LEFT JOIN finance.open_items oi ON oi.organization_id=jl.organization_id AND oi.journal_line_id=jl.id
        WHERE jl.organization_id=je.organization_id AND jl.journal_entry_id=je.id),'[]'::jsonb))
      FROM finance.journal_entries je WHERE je.organization_id=d.organization_id AND je.source_document_id=d.id AND je.state='posted')
      ELSE NULL END,
    'write_off',(SELECT jsonb_build_object('target_open_item_id',w.target_open_item_id,'expense_account_id',w.expense_account_id,'expense_account_code',wa.code,'expense_account_name',wa.name,'amount',w.amount::text,'reason',w.reason)
      FROM finance.write_off_details w LEFT JOIN finance.accounts wa ON wa.organization_id=w.organization_id AND wa.id=w.expense_account_id WHERE w.organization_id=d.organization_id AND w.document_id=d.id),
    'allocation_plan',COALESCE((SELECT jsonb_agg(jsonb_build_object('target_open_item_id',p.target_open_item_id,'amount',p.amount::text,
      'target_document_id',CASE WHEN finance_private.can_read_document(target.organization_id,target.id) THEN target.id ELSE NULL END,
      'target_document_number',CASE WHEN finance_private.can_read_document(target.organization_id,target.id) THEN target.document_number ELSE NULL END) ORDER BY p.target_open_item_id)
      FROM finance.document_allocation_plans p
      LEFT JOIN finance.open_items target_item ON target_item.organization_id=p.organization_id AND target_item.id=p.target_open_item_id
      LEFT JOIN finance.journal_lines target_line ON target_line.organization_id=target_item.organization_id AND target_line.id=target_item.journal_line_id
      LEFT JOIN finance.journal_entries target_entry ON target_entry.organization_id=target_line.organization_id AND target_entry.id=target_line.journal_entry_id
      LEFT JOIN finance.business_documents target ON target.organization_id=target_entry.organization_id AND target.id=target_entry.source_document_id
      WHERE p.organization_id=d.organization_id AND p.document_id=d.id),'[]'::jsonb))
    INTO v_result FROM finance.business_documents d LEFT JOIN finance.trade_documents td ON td.organization_id=d.organization_id AND td.document_id=d.id
      LEFT JOIN finance.money_movements mm ON mm.organization_id=d.organization_id AND mm.document_id=d.id
      LEFT JOIN finance.transfers tr ON tr.organization_id=d.organization_id AND tr.document_id=d.id
      LEFT JOIN finance.accounts ra ON ra.organization_id=d.organization_id AND ra.id=d.rounding_account_id
      LEFT JOIN finance.cash_accounts mc ON mc.organization_id=mm.organization_id AND mc.id=mm.cash_account_id
      LEFT JOIN finance.cash_accounts fc ON fc.organization_id=tr.organization_id AND fc.id=tr.from_cash_account_id
      LEFT JOIN finance.cash_accounts tc ON tc.organization_id=tr.organization_id AND tc.id=tr.to_cash_account_id
      LEFT JOIN finance.accounts fa ON fa.organization_id=tr.organization_id AND fa.id=tr.fee_account_id
    WHERE d.organization_id=p_organization_id AND d.id=p_document_id;
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.read_financial_document(uuid,uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_financial_document(uuid,uuid) TO ams_runtime;
