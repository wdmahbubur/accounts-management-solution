-- Refund cash evidence records the actual method and an explicit external
-- payment/voucher reference. No transfer or provider payment is initiated.
DO $$
DECLARE f text; anchor text;
BEGIN
  f:=pg_get_functiondef('public.save_linked_settlement_draft(uuid,uuid,integer,text,text,text,jsonb)'::regprocedure);
  anchor:='-''reference''-''cash_flow_class'')';
  IF position(anchor IN f)=0 THEN RAISE EXCEPTION 'refund payload key anchor missing'; END IF;
  f:=replace(f,anchor,'-''reference''-''cash_flow_class''-''method'')');
  f:=replace(f,'    v_cash:=NULLIF(p_payload->>''cash_account_id'','''')::uuid;',
    $new$    IF length(btrim(COALESCE(p_payload->>'reference',''))) NOT BETWEEN 1 AND 160
      OR COALESCE(p_payload->>'method','') NOT IN ('cash','bank_transfer','mobile_wallet','card','other') THEN
      RAISE EXCEPTION 'refund payment method and evidence reference required' USING ERRCODE='22023'; END IF;
    v_cash:=NULLIF(p_payload->>'cash_account_id','')::uuid;$new$);
  f:=replace(f,$old$END,v_amount,'bank_transfer',NULLIF(p_payload->>'reference','')$old$,$new$END,v_amount,p_payload->>'method',btrim(p_payload->>'reference')$new$);
  EXECUTE f;
  f:=pg_get_functiondef('finance_private.validate_linked_settlement(uuid,uuid)'::regprocedure);
  anchor:='  IF NOT EXISTS(SELECT 1 FROM finance.accounts x WHERE';
  IF position(anchor IN f)=0 THEN RAISE EXCEPTION 'refund evidence validation anchor missing'; END IF;
  f:=replace(f,anchor,$new$  IF d.document_type IN ('customer_refund','vendor_refund') AND NOT EXISTS(
    SELECT 1 FROM finance.money_movements m WHERE m.organization_id=p_organization_id AND m.document_id=p_document_id
      AND length(btrim(COALESCE(m.reference,''))) BETWEEN 1 AND 160 AND m.method IN ('cash','bank_transfer','mobile_wallet','card','other')) THEN
    RAISE EXCEPTION 'refund payment evidence required' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM finance.accounts x WHERE$new$);
  EXECUTE f;
END $$;
