-- US-019: allocate immutable numbers in the posting transaction and retry only aborted transactions.

CREATE OR REPLACE FUNCTION finance_private.guard_source_document()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.state<>'draft' THEN RAISE EXCEPTION 'posted and approved documents cannot be deleted' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.state IN ('posted','void') THEN RAISE EXCEPTION 'posted and void documents are immutable' USING ERRCODE='40001'; END IF;
  IF NEW.version=OLD.version AND
    (NEW.organization_id,NEW.id,NEW.document_type,NEW.state,NEW.document_number,NEW.fiscal_year_id,NEW.party_id,NEW.issue_date,
     NEW.accounting_date,NEW.due_date,NEW.external_reference,NEW.description,NEW.currency,NEW.rounding_adjustment,NEW.rounding_reason,NEW.rounding_account_id,NEW.party_snapshot,
     NEW.material_digest,NEW.created_by_member_id,NEW.posted_by_member_id,NEW.posted_at,NEW.reversal_of_document_id,NEW.correction_reason,
     NEW.import_source_key,NEW.updated_at,NEW.created_at)
    IS NOT DISTINCT FROM
    (OLD.organization_id,OLD.id,OLD.document_type,OLD.state,OLD.document_number,OLD.fiscal_year_id,OLD.party_id,OLD.issue_date,
     OLD.accounting_date,OLD.due_date,OLD.external_reference,OLD.description,OLD.currency,OLD.rounding_adjustment,OLD.rounding_reason,OLD.rounding_account_id,OLD.party_snapshot,
     OLD.material_digest,OLD.created_by_member_id,OLD.posted_by_member_id,OLD.posted_at,OLD.reversal_of_document_id,OLD.correction_reason,
     OLD.import_source_key,OLD.updated_at,OLD.created_at) THEN
    RETURN NEW;
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.id IS DISTINCT FROM OLD.id OR
     NEW.document_type IS DISTINCT FROM OLD.document_type OR NEW.created_by_member_id IS DISTINCT FROM OLD.created_by_member_id OR
     (NEW.document_number IS DISTINCT FROM OLD.document_number AND NOT (OLD.document_number IS NULL AND NEW.document_number IS NOT NULL AND NEW.state='posted')) OR
     (NEW.state<>'posted' AND (NEW.posted_at IS NOT NULL OR NEW.posted_by_member_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'source identity or issued fields cannot be changed by draft save' USING ERRCODE='23514';
  END IF;
  IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'document version must advance by one' USING ERRCODE='40001'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION finance_private.allocate_document_number(p_organization_id uuid,p_document_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_document finance.business_documents%ROWTYPE; v_books_start date; v_year_id uuid; v_year_start date;
  v_year_status text; v_year_label text; v_prefix text; v_next bigint; v_display_year text;
BEGIN
  SELECT * INTO v_document FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='P0002'; END IF;
  IF v_document.document_number IS NOT NULL THEN RETURN v_document.document_number; END IF;
  IF v_document.state IN ('posted','void') THEN RAISE EXCEPTION 'posted or void source has no permanent number' USING ERRCODE='23514'; END IF;
  SELECT o.books_start_date INTO v_books_start FROM finance.organizations o WHERE o.id=p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'company unavailable' USING ERRCODE='P0002'; END IF;
  IF v_document.document_type='opening_balance' THEN
    SELECT fy.id,fy.starts_on,fy.status,fy.label INTO v_year_id,v_year_start,v_year_status,v_year_label FROM finance.fiscal_years fy
      WHERE fy.organization_id=p_organization_id AND fy.starts_on<=v_books_start AND fy.ends_on>=v_books_start AND fy.status='open'
      ORDER BY fy.starts_on LIMIT 1;
    IF NOT FOUND THEN
      SELECT fy.id,fy.starts_on,fy.status,fy.label INTO v_year_id,v_year_start,v_year_status,v_year_label FROM finance.fiscal_years fy
        WHERE fy.organization_id=p_organization_id AND fy.starts_on>=v_books_start AND fy.status='open' ORDER BY fy.starts_on LIMIT 1;
    END IF;
  ELSE
    v_year_id:=v_document.fiscal_year_id;
    SELECT fy.starts_on,fy.status,fy.label INTO v_year_start,v_year_status,v_year_label FROM finance.fiscal_years fy
      WHERE fy.organization_id=p_organization_id AND fy.id=v_year_id;
  END IF;
  IF v_year_id IS NULL OR v_year_start IS NULL OR v_year_status<>'open' THEN RAISE EXCEPTION 'an open fiscal year is required for document numbering' USING ERRCODE='23514'; END IF;
  v_display_year:=CASE WHEN v_document.document_type='opening_balance' THEN extract(year FROM v_books_start)::integer::text
    ELSE v_year_label END;
  v_prefix:=CASE v_document.document_type
    WHEN 'invoice' THEN 'INV' WHEN 'customer_credit' THEN 'CN' WHEN 'bill' THEN 'BILL' WHEN 'vendor_credit' THEN 'VCN'
    WHEN 'paid_expense' THEN 'EXP' WHEN 'receipt' THEN 'RCPT' WHEN 'vendor_payment' THEN 'PAY'
    WHEN 'customer_refund' THEN 'CRF' WHEN 'vendor_refund' THEN 'VRF' WHEN 'customer_advance' THEN 'CADV'
    WHEN 'vendor_advance' THEN 'VADV' WHEN 'advance_application' THEN 'ADV' WHEN 'transfer' THEN 'TRF'
    WHEN 'manual_journal' THEN 'JV' WHEN 'controlled_adjustment' THEN 'ADJ' WHEN 'deferred_revenue_release' THEN 'DRR'
    WHEN 'write_off' THEN 'WO' WHEN 'opening_balance' THEN 'OB' WHEN 'year_close' THEN 'YC' WHEN 'reversal' THEN 'REV'
  END;
  INSERT INTO finance.document_sequences(organization_id,fiscal_year_id,document_type,prefix,next_value)
    VALUES(p_organization_id,v_year_id,v_document.document_type,v_prefix,1)
    ON CONFLICT(organization_id,fiscal_year_id,document_type) DO NOTHING;
  SELECT s.prefix,s.next_value INTO v_prefix,v_next FROM finance.document_sequences s
    WHERE s.organization_id=p_organization_id AND s.fiscal_year_id=v_year_id AND s.document_type=v_document.document_type FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'document sequence unavailable' USING ERRCODE='23514'; END IF;
  UPDATE finance.document_sequences s SET next_value=v_next+1
    WHERE s.organization_id=p_organization_id AND s.fiscal_year_id=v_year_id AND s.document_type=v_document.document_type;
  RETURN v_prefix||'-'||v_display_year||'-'||lpad(v_next::text,6,'0');
END $$;
REVOKE ALL ON FUNCTION finance_private.allocate_document_number(uuid,uuid) FROM PUBLIC,ams_runtime;

COMMENT ON FUNCTION finance_private.allocate_document_number(uuid,uuid) IS
  'US-019 internal posting primitive. Call after fiscal-year/period and source locks; its sequence increment commits only with the source journal transaction. Opening balances use the first operational fiscal-year sequence and books-start year.';

