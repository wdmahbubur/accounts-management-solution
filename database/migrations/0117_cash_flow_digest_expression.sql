-- Disambiguate JSONB subtraction from the -> operator on PostgreSQL.
DO $$
DECLARE signature text;body text;
BEGIN
 FOREACH signature IN ARRAY ARRAY['public.read_cash_flow_review(uuid,date,date,uuid)','public.finalize_cash_flow_report(uuid,date,date,text,text,text,text)'] LOOP
  SELECT pg_get_functiondef(signature::regprocedure) INTO body;
  IF position('(v_snapshot->''data''-''cutoff_at'')' IN body)=0 THEN RAISE EXCEPTION 'cash flow digest anchor missing'; END IF;
  EXECUTE replace(body,'(v_snapshot->''data''-''cutoff_at'')','((v_snapshot->''data'')-''cutoff_at'')');
 END LOOP;
END $$;
