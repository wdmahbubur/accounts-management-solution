-- Cutover preserves individual trade/advance control items. Their opening batch
-- is not a new cash receipt: settle the explicitly selected original item.
DO $$
DECLARE f text;
BEGIN
  f:=pg_get_functiondef('finance_private.validate_linked_settlement(uuid,uuid)'::regprocedure);
  f:=replace(f,$old$v_type='customer_advance'$old$,$new$v_type IN ('customer_advance','opening_balance')$new$);
  f:=replace(f,$old$v_type='vendor_advance'$old$,$new$v_type IN ('vendor_advance','opening_balance')$new$);
  f:=replace(f,$old$v_type IN ('customer_credit','receipt')$old$,$new$v_type IN ('customer_credit','receipt','opening_balance')$new$);
  f:=replace(f,$old$v_type IN ('vendor_credit','vendor_payment')$old$,$new$v_type IN ('vendor_credit','vendor_payment','opening_balance')$new$);
  f:=replace(f,$old$x.document_type=CASE WHEN a.control_kind='customer_advance' THEN 'invoice'::finance.document_type ELSE 'bill'::finance.document_type END$old$,
    $new$(x.document_type='opening_balance' OR x.document_type=CASE WHEN a.control_kind='customer_advance' THEN 'invoice'::finance.document_type ELSE 'bill'::finance.document_type END)$new$);
  IF position('''customer_advance'',''opening_balance''' IN f)=0 THEN RAISE EXCEPTION 'opening advance validation anchor missing'; END IF;
  EXECUTE f;
  f:=pg_get_functiondef('public.read_linked_settlement_options(uuid,date)'::regprocedure);
  f:=replace(f,$old$d.document_type IN ('customer_advance','customer_credit','receipt')$old$,$new$d.document_type IN ('customer_advance','customer_credit','receipt','opening_balance')$new$);
  f:=replace(f,$old$d.document_type IN ('vendor_advance','vendor_credit','vendor_payment')$old$,$new$d.document_type IN ('vendor_credit','vendor_payment','opening_balance')$new$);
  f:=replace(f,$old$d.document_type='invoice' AND oi.control_kind='ar'$old$,$new$d.document_type IN ('invoice','opening_balance') AND oi.control_kind='ar'$new$);
  f:=replace(f,$old$d.document_type='bill' AND oi.control_kind='ap'$old$,$new$d.document_type IN ('bill','opening_balance') AND oi.control_kind='ap'$new$);
  f:=replace(f,$old$'party_id',oi.party_id,$old$,$new$'reference',oi.reference,'party_id',oi.party_id,$new$);
  EXECUTE f;
END $$;
