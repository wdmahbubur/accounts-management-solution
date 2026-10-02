-- US-046: validate transfer evidence, order cash locks, and separate fee cash flow.
BEGIN;

CREATE FUNCTION finance_private.guard_transfer_draft()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_doc finance.business_documents%ROWTYPE;v_from finance.cash_accounts%ROWTYPE;v_to finance.cash_accounts%ROWTYPE;v_fee finance.accounts%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN
    SELECT d.* INTO v_doc FROM finance.business_documents d WHERE d.organization_id=OLD.organization_id AND d.id=OLD.document_id;
    IF NOT FOUND OR v_doc.state<>'draft' THEN RAISE EXCEPTION 'posted transfer details are immutable' USING ERRCODE='23514';END IF;
    RETURN OLD;
  END IF;
  SELECT d.* INTO v_doc FROM finance.business_documents d WHERE d.organization_id=NEW.organization_id AND d.id=NEW.document_id;
  IF NOT FOUND OR v_doc.document_type<>'transfer' OR v_doc.state<>'draft' THEN RAISE EXCEPTION 'transfer must belong to an editable draft' USING ERRCODE='23514';END IF;
  IF length(btrim(COALESCE(v_doc.external_reference,''))) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'transfer reference is required' USING ERRCODE='23514';
  END IF;
  IF v_doc.rounding_adjustment<>0 THEN RAISE EXCEPTION 'transfers do not accept rounding adjustments' USING ERRCODE='23514';END IF;
  SELECT * INTO v_from FROM finance.cash_accounts ca WHERE ca.organization_id=NEW.organization_id AND ca.id=NEW.from_cash_account_id;
  SELECT * INTO v_to FROM finance.cash_accounts ca WHERE ca.organization_id=NEW.organization_id AND ca.id=NEW.to_cash_account_id;
  IF NOT FOUND OR v_from.id IS NULL OR v_to.id IS NULL OR NOT v_from.is_active OR NOT v_to.is_active OR v_from.id=v_to.id OR v_from.account_id=v_to.account_id THEN
    RAISE EXCEPTION 'transfer requires two distinct active cash accounts' USING ERRCODE='23514';
  END IF;
  IF NEW.fee_amount>0 THEN
    SELECT * INTO v_fee FROM finance.accounts a WHERE a.organization_id=NEW.organization_id AND a.id=NEW.fee_account_id;
    IF NOT FOUND OR NOT v_fee.is_active OR NOT v_fee.is_postable OR v_fee.account_type<>'expense' OR v_fee.control_kind IS NOT NULL THEN
      RAISE EXCEPTION 'transfer fee requires an active postable expense account' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.fee_account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM finance.accounts a WHERE a.organization_id=NEW.organization_id AND a.id=NEW.fee_account_id
    AND a.is_active AND a.is_postable AND a.account_type='expense' AND a.control_kind IS NULL) THEN
    RAISE EXCEPTION 'transfer fee account is invalid' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_transfer_draft() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER transfer_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON finance.transfers
  FOR EACH ROW EXECUTE FUNCTION finance_private.guard_transfer_draft();

CREATE FUNCTION finance_private.prepare_transfer_cash_posting_line()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_entry finance.journal_entries%ROWTYPE;v_doc finance.business_documents%ROWTYPE;v_transfer finance.transfers%ROWTYPE;
  v_from finance.cash_accounts%ROWTYPE;v_to finance.cash_accounts%ROWTYPE;v_fee finance.accounts%ROWTYPE;v_cash_flow finance.cash_flow_class;
BEGIN
  SELECT * INTO v_entry FROM finance.journal_entries je WHERE je.organization_id=NEW.organization_id AND je.id=NEW.journal_entry_id;
  IF NOT FOUND OR v_entry.state<>'building' THEN RETURN NEW;END IF;
  SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=NEW.organization_id AND d.id=v_entry.source_document_id AND d.document_type='transfer';
  IF NOT FOUND THEN RETURN NEW;END IF;
  SELECT * INTO v_transfer FROM finance.transfers t WHERE t.organization_id=NEW.organization_id AND t.document_id=v_doc.id;
  IF NOT FOUND THEN RETURN NEW;END IF;
  -- Lock both configured balances in their GL-account order; reverse transfers take the same order.
  PERFORM ca.id FROM finance.cash_accounts ca WHERE ca.organization_id=NEW.organization_id
    AND ca.id IN (v_transfer.from_cash_account_id,v_transfer.to_cash_account_id) ORDER BY ca.account_id,ca.id FOR UPDATE;
  SELECT * INTO v_from FROM finance.cash_accounts ca WHERE ca.organization_id=NEW.organization_id AND ca.id=v_transfer.from_cash_account_id;
  SELECT * INTO v_to FROM finance.cash_accounts ca WHERE ca.organization_id=NEW.organization_id AND ca.id=v_transfer.to_cash_account_id;
  IF v_from.id IS NULL OR v_to.id IS NULL OR NOT v_from.is_active OR NOT v_to.is_active THEN
    RAISE EXCEPTION 'transfer cash account is inactive' USING ERRCODE='23514';
  END IF;
  IF v_doc.external_reference IS NULL OR length(btrim(v_doc.external_reference)) NOT BETWEEN 1 AND 160 OR
    v_doc.rounding_adjustment<>0 OR v_transfer.amount+v_transfer.fee_amount<>v_doc.total_amount THEN
    RAISE EXCEPTION 'transfer reference, total, or rounding is invalid' USING ERRCODE='23514';
  END IF;
  IF v_transfer.fee_amount>0 THEN
    SELECT * INTO v_fee FROM finance.accounts a WHERE a.organization_id=NEW.organization_id AND a.id=v_transfer.fee_account_id;
    IF NOT FOUND OR NOT v_fee.is_active OR NOT v_fee.is_postable OR v_fee.account_type<>'expense' OR v_fee.control_kind IS NOT NULL THEN
      RAISE EXCEPTION 'transfer fee account is unavailable' USING ERRCODE='23514';
    END IF;
  END IF;
  v_cash_flow:=CASE WHEN v_from.is_cash_equivalent AND v_to.is_cash_equivalent THEN 'internal'::finance.cash_flow_class
    WHEN v_from.is_cash_equivalent IS DISTINCT FROM v_to.is_cash_equivalent THEN 'investing'::finance.cash_flow_class
    ELSE 'internal'::finance.cash_flow_class END;
  IF NEW.account_id=v_to.account_id AND NEW.debit=v_transfer.amount THEN NEW.cash_flow_class:=v_cash_flow;END IF;
  IF NEW.account_id=v_from.account_id AND NEW.credit=v_transfer.amount+v_transfer.fee_amount THEN
    IF v_transfer.fee_amount>0 THEN NEW.credit:=v_transfer.amount;END IF;
    NEW.cash_flow_class:=v_cash_flow;
    NEW.description:='Transfer principal · '||v_doc.external_reference;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.prepare_transfer_cash_posting_line() FROM PUBLIC,anon,authenticated;
-- BEFORE triggers run alphabetically, so both account locks precede the physical-cash balance guard.
CREATE TRIGGER aaa_transfer_cash_account_locks BEFORE INSERT ON finance.journal_lines
  FOR EACH ROW EXECUTE FUNCTION finance_private.prepare_transfer_cash_posting_line();

CREATE FUNCTION finance_private.add_transfer_fee_cash_leg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_entry finance.journal_entries%ROWTYPE;v_doc finance.business_documents%ROWTYPE;v_transfer finance.transfers%ROWTYPE;
  v_from finance.cash_accounts%ROWTYPE;v_line_no integer;
BEGIN
  IF NEW.description NOT LIKE 'Transfer principal · %' OR NEW.credit<=0 THEN RETURN NEW;END IF;
  SELECT * INTO v_entry FROM finance.journal_entries je WHERE je.organization_id=NEW.organization_id AND je.id=NEW.journal_entry_id;
  IF NOT FOUND OR v_entry.state<>'building' THEN RETURN NEW;END IF;
  SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=NEW.organization_id AND d.id=v_entry.source_document_id AND d.document_type='transfer';
  IF NOT FOUND THEN RETURN NEW;END IF;
  SELECT * INTO v_transfer FROM finance.transfers t WHERE t.organization_id=NEW.organization_id AND t.document_id=v_doc.id;
  IF NOT FOUND OR v_transfer.fee_amount<=0 OR NEW.credit<>v_transfer.amount THEN RETURN NEW;END IF;
  SELECT * INTO v_from FROM finance.cash_accounts ca WHERE ca.organization_id=NEW.organization_id AND ca.id=v_transfer.from_cash_account_id;
  IF NOT FOUND OR NEW.account_id<>v_from.account_id THEN RETURN NEW;END IF;
  SELECT COALESCE(max(l.line_no),0)+1 INTO v_line_no FROM finance.journal_lines l
    WHERE l.organization_id=NEW.organization_id AND l.journal_entry_id=NEW.journal_entry_id;
  INSERT INTO finance.journal_lines(organization_id,journal_entry_id,line_no,account_id,party_id,cost_center_id,debit,credit,description,cash_flow_class)
    VALUES(NEW.organization_id,NEW.journal_entry_id,v_line_no,v_from.account_id,NULL,NULL,0,v_transfer.fee_amount,'Transfer fee cash outflow','operating');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.add_transfer_fee_cash_leg() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER transfer_fee_cash_leg AFTER INSERT ON finance.journal_lines
  FOR EACH ROW EXECUTE FUNCTION finance_private.add_transfer_fee_cash_leg();

CREATE OR REPLACE FUNCTION finance_private.can_read_document(p_organization_id uuid,p_document_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS(
    SELECT 1 FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id AND (
      finance_private.has_permission(d.organization_id,'documents.read')
      OR (d.document_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance') AND finance_private.has_permission(d.organization_id,'sales.read'))
      OR (d.document_type IN ('bill','vendor_credit','vendor_payment','vendor_refund','vendor_advance','paid_expense') AND finance_private.has_permission(d.organization_id,'purchases.read'))
      OR (d.document_type='transfer' AND finance_private.has_permission(d.organization_id,'banking.read'))
      OR (d.document_type='reversal' AND EXISTS(SELECT 1 FROM finance.business_documents original
        JOIN finance.advance_actions a ON a.organization_id=original.organization_id AND a.document_id=original.id AND a.action_kind='apply'
        JOIN finance.open_items oi ON oi.organization_id=a.organization_id AND oi.id=a.advance_open_item_id
        WHERE original.organization_id=d.organization_id AND original.id=d.reversal_of_document_id
          AND finance_private.has_permission(d.organization_id,CASE WHEN oi.control_kind='customer_advance' THEN 'sales.read' ELSE 'purchases.read' END)))
      OR (d.document_type='advance_application' AND EXISTS(SELECT 1 FROM finance.advance_actions a JOIN finance.open_items oi
        ON oi.organization_id=a.organization_id AND oi.id=a.advance_open_item_id WHERE a.organization_id=d.organization_id AND a.document_id=d.id
        AND finance_private.has_permission(d.organization_id,CASE WHEN oi.control_kind='customer_advance' THEN 'sales.read' ELSE 'purchases.read' END)))
    )
  );
$$;
REVOKE ALL ON FUNCTION finance_private.can_read_document(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION finance_private.can_read_document(uuid,uuid) TO authenticated;

CREATE FUNCTION public.read_transfer_register(p_organization_id uuid,p_search text DEFAULT NULL,p_limit integer DEFAULT 51)
RETURNS TABLE(document_id uuid,document_number text,state text,accounting_date date,reference text,from_account text,to_account text,
  principal_amount text,fee_amount text,total_amount text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 51 OR (p_search IS NOT NULL AND length(p_search)>100) THEN RAISE EXCEPTION 'invalid transfer register filters' USING ERRCODE='22023';END IF;
  PERFORM finance_private.require_capability(p_organization_id,'banking.read');
  RETURN QUERY SELECT d.id,d.document_number,d.state::text,d.accounting_date,d.external_reference,src.name,dst.name,t.amount::text,t.fee_amount::text,d.total_amount::text
    FROM finance.transfers t JOIN finance.business_documents d ON d.organization_id=t.organization_id AND d.id=t.document_id
    JOIN finance.cash_accounts src ON src.organization_id=t.organization_id AND src.id=t.from_cash_account_id
    JOIN finance.cash_accounts dst ON dst.organization_id=t.organization_id AND dst.id=t.to_cash_account_id
    WHERE t.organization_id=p_organization_id AND (p_search IS NULL OR btrim(p_search)='' OR COALESCE(d.document_number,'') ILIKE '%'||btrim(p_search)||'%'
      OR COALESCE(d.external_reference,'') ILIKE '%'||btrim(p_search)||'%' OR src.name ILIKE '%'||btrim(p_search)||'%' OR dst.name ILIKE '%'||btrim(p_search)||'%')
    ORDER BY d.accounting_date DESC,d.created_at DESC,d.id DESC LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.read_transfer_register(uuid,text,integer) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_transfer_register(uuid,text,integer) TO authenticated;

CREATE FUNCTION public.read_transfer_lifecycle(p_organization_id uuid,p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_doc finance.business_documents%ROWTYPE;v_transfer finance.transfers%ROWTYPE;
BEGIN
  SELECT * INTO v_doc FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id AND d.document_type='transfer';
  IF NOT FOUND OR NOT finance_private.can_read_document(p_organization_id,p_document_id) THEN RAISE EXCEPTION 'transfer unavailable' USING ERRCODE='P0002';END IF;
  SELECT * INTO v_transfer FROM finance.transfers t WHERE t.organization_id=p_organization_id AND t.document_id=p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer details unavailable' USING ERRCODE='P0002';END IF;
  RETURN jsonb_build_object('document_id',v_doc.id,'document_number',v_doc.document_number,'state',v_doc.state::text,'accounting_date',v_doc.accounting_date,
    'reference',v_doc.external_reference,'description',v_doc.description,'total_amount',v_doc.total_amount::text,'version',v_doc.version,
    'from_account_id',v_transfer.from_cash_account_id,'from_account_name',(SELECT ca.name FROM finance.cash_accounts ca WHERE ca.organization_id=p_organization_id AND ca.id=v_transfer.from_cash_account_id),
    'from_is_cash_equivalent',(SELECT ca.is_cash_equivalent FROM finance.cash_accounts ca WHERE ca.organization_id=p_organization_id AND ca.id=v_transfer.from_cash_account_id),
    'to_account_id',v_transfer.to_cash_account_id,'to_account_name',(SELECT ca.name FROM finance.cash_accounts ca WHERE ca.organization_id=p_organization_id AND ca.id=v_transfer.to_cash_account_id),
    'to_is_cash_equivalent',(SELECT ca.is_cash_equivalent FROM finance.cash_accounts ca WHERE ca.organization_id=p_organization_id AND ca.id=v_transfer.to_cash_account_id),
    'principal_amount',v_transfer.amount::text,'fee_amount',v_transfer.fee_amount::text,'fee_account_id',v_transfer.fee_account_id,
    'fee_account_name',(SELECT a.name FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=v_transfer.fee_account_id),
    'journal_entry_id',(SELECT j.id FROM finance.journal_entries j WHERE j.organization_id=p_organization_id AND j.source_document_id=p_document_id AND j.state='posted'),
    'approvals',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'state',r.state,'version',r.document_version,'created_at',r.created_at,
      'decisions',COALESCE((SELECT jsonb_agg(jsonb_build_object('decision',ad.decision,'reason',ad.reason,'created_at',ad.created_at) ORDER BY ad.created_at,ad.id)
        FROM finance.approval_decisions ad WHERE ad.organization_id=r.organization_id AND ad.request_id=r.id),'[]'::jsonb)) ORDER BY r.created_at,r.id)
      FROM finance.approval_requests r WHERE r.organization_id=p_organization_id AND r.document_id=p_document_id),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.read_transfer_lifecycle(uuid,uuid) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_transfer_lifecycle(uuid,uuid) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
