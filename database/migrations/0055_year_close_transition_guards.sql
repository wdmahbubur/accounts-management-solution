-- US-061: serialize year-state transitions to preserve chronological close integrity.
CREATE FUNCTION finance_private.guard_fiscal_year_close_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.organization_id::text),711061);
    IF OLD.status='open' AND NEW.status='closed' AND EXISTS(
      SELECT 1 FROM finance.fiscal_years prior WHERE prior.organization_id=NEW.organization_id
        AND prior.ends_on<NEW.starts_on AND prior.status<>'closed'
    ) THEN RAISE EXCEPTION 'all earlier fiscal years must be closed first' USING ERRCODE='23514'; END IF;
    IF OLD.status='closed' AND NEW.status='open' AND EXISTS(
      SELECT 1 FROM finance.fiscal_years later WHERE later.organization_id=NEW.organization_id
        AND later.starts_on>NEW.starts_on AND later.status='closed'
    ) THEN RAISE EXCEPTION 'reopen later fiscal years before reopening this year' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_fiscal_year_close_order() FROM PUBLIC,ams_runtime;
CREATE TRIGGER fiscal_year_close_order_guard BEFORE UPDATE OF status ON finance.fiscal_years
  FOR EACH ROW EXECUTE FUNCTION finance_private.guard_fiscal_year_close_order();

-- Year-close reversals preserve their source value in the document register.
CREATE FUNCTION finance_private.complete_year_close_reversal_amounts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.document_type='reversal' AND NEW.reversal_of_document_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM finance.business_documents source WHERE source.organization_id=NEW.organization_id
      AND source.id=NEW.reversal_of_document_id AND source.document_type='year_close'
  ) THEN
    NEW.net_amount:=NEW.total_amount;NEW.tax_amount:=0;NEW.rounding_adjustment:=0;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.complete_year_close_reversal_amounts() FROM PUBLIC,ams_runtime;
CREATE TRIGGER year_close_reversal_amounts BEFORE INSERT ON finance.business_documents
  FOR EACH ROW EXECUTE FUNCTION finance_private.complete_year_close_reversal_amounts();
NOTIFY pgrst,'reload schema';
