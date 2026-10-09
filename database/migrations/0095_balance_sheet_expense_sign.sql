-- Balance-sheet nominal rows are contributions to equity, not unsigned cost
-- display values. A debit expense reduces untransferred earnings; adding it
-- previously overstated equity by twice the expense despite a balanced ledger.
-- Preserve cumulative opening/close/reversal/date logic and existing privileges.
DO $patch$
DECLARE v_signature regprocedure:='public.read_balance_sheet_snapshot(uuid,date,date)'::regprocedure;
  v_definition text;v_old text;v_new text;
BEGIN
  v_old:=$needle$WHEN 'income' THEN credit-debit WHEN 'expense' THEN debit-credit END AS amount,$needle$;
  v_new:=$replacement$WHEN 'income' THEN credit-debit WHEN 'expense' THEN credit-debit END AS amount,$replacement$;
  v_definition:=pg_catalog.pg_get_functiondef(v_signature);
  IF position(v_old IN v_definition)=0 OR length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) THEN
    RAISE EXCEPTION 'expected one balance-sheet nominal expense sign expression in %',v_signature;
  END IF;
  EXECUTE replace(v_definition,v_old,v_new);
END;
$patch$;
