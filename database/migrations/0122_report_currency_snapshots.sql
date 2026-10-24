-- Stamp the company's immutable accounting currency into new report snapshots.
-- Legacy stored BDT snapshots and issued files are not rewritten.
DO $$ DECLARE f record;body text;old text:='jsonb_build_object(''id'',v_org.id,''name'',v_org.name,''timezone'',v_org.timezone)';n integer:=0;
BEGIN
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
  WHERE ns.nspname IN ('public','finance_private') AND p.prokind='f'
 LOOP
  body:=pg_get_functiondef(f.oid);
  IF strpos(body,old)>0 THEN
   body:=replace(body,old,'jsonb_build_object(''id'',v_org.id,''name'',v_org.name,''timezone'',v_org.timezone,''base_currency'',v_org.base_currency)');
   EXECUTE body;n:=n+1;
  END IF;
 END LOOP;
 IF n<5 THEN RAISE EXCEPTION 'report company metadata anchors missing'; END IF;
END $$;
NOTIFY pgrst,'reload schema';
