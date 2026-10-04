-- Keep the exact imported workbook in a private table inaccessible to the runtime role.
CREATE TABLE finance_private.bank_import_sources (
  organization_id uuid NOT NULL,
  import_id uuid NOT NULL,
  source_content bytea NOT NULL CHECK (octet_length(source_content) BETWEEN 1 AND 8388608),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, import_id),
  FOREIGN KEY (organization_id, import_id) REFERENCES finance.bank_imports (organization_id, id) ON DELETE RESTRICT
);
REVOKE ALL ON finance_private.bank_import_sources FROM PUBLIC, ams_runtime;
REVOKE ALL ON FUNCTION public.import_bank_statement_rows(uuid,uuid,text,text,jsonb) FROM PUBLIC, ams_runtime;

CREATE FUNCTION public.import_bank_statement_rows(
  p_organization_id uuid,
  p_cash_account_id uuid,
  p_file_sha256 text,
  p_source_name text,
  p_rows jsonb,
  p_source_content bytea
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_import_id uuid;
  v_count integer;
  v_inserted integer;
  v_member_id uuid;
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'banking.write');
  SELECT m.id INTO v_member_id FROM finance.organization_members m
   WHERE m.organization_id=p_organization_id AND m.user_id=identity.current_actor_id() AND m.status='active';
  IF v_member_id IS NULL THEN RAISE EXCEPTION 'Active membership required.' USING ERRCODE='42501'; END IF;
  IF p_file_sha256 !~ '^[0-9a-f]{64}$' OR jsonb_typeof(p_rows)<>'array' OR p_source_content IS NULL
    OR octet_length(p_source_content) NOT BETWEEN 1 AND 8388608 THEN
    RAISE EXCEPTION 'Invalid statement import.' USING ERRCODE='22023';
  END IF;
  v_count := jsonb_array_length(p_rows);
  IF v_count < 1 OR v_count > 10000 THEN
    RAISE EXCEPTION 'Statement row count is outside the supported range.' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM finance.cash_accounts c WHERE c.organization_id=p_organization_id AND c.id=p_cash_account_id AND c.is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cash account unavailable.' USING ERRCODE='P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_cash_account_id::text||':'||p_file_sha256,0));
  SELECT id INTO v_import_id FROM finance.bank_imports
   WHERE organization_id=p_organization_id AND cash_account_id=p_cash_account_id AND file_sha256=p_file_sha256;
  IF FOUND THEN RETURN jsonb_build_object('id',v_import_id,'duplicate',true,'row_count',0); END IF;

  INSERT INTO finance.bank_imports(organization_id,cash_account_id,file_sha256,file_object_key,source_name,status,row_count,created_by_member_id)
   VALUES(p_organization_id,p_cash_account_id,p_file_sha256,NULL,left(regexp_replace(p_source_name,'[^[:alnum:] ._()-]','','g'),160),'imported',v_count,v_member_id)
   RETURNING id INTO v_import_id;

  INSERT INTO finance.statement_lines(organization_id,import_id,cash_account_id,row_no,transaction_date,value_date,description,amount,balance_after,source_transaction_id,fingerprint,raw_row,review_required)
  SELECT p_organization_id,v_import_id,p_cash_account_id,(r->>'row_no')::integer,(r->>'transaction_date')::date,
    NULLIF(r->>'value_date','')::date,left(r->>'description',500),(r->>'amount')::numeric,
    NULLIF(r->>'balance_after','')::numeric,NULLIF(left(r->>'source_transaction_id',160),''),r->>'fingerprint',r->'raw_row',
    EXISTS (SELECT 1 FROM finance.statement_lines prior WHERE prior.organization_id=p_organization_id AND prior.cash_account_id=p_cash_account_id AND prior.fingerprint=r->>'fingerprint')
      OR (SELECT count(*) FROM jsonb_array_elements(p_rows) same WHERE same->>'fingerprint'=r->>'fingerprint')>1
  FROM jsonb_array_elements(p_rows) r;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted<>v_count THEN RAISE EXCEPTION 'Statement import incomplete.' USING ERRCODE='22023'; END IF;
  INSERT INTO finance_private.bank_import_sources(organization_id,import_id,source_content)
   VALUES(p_organization_id,v_import_id,p_source_content);
  RETURN jsonb_build_object('id',v_import_id,'duplicate',false,'row_count',v_inserted,
    'review_count',(SELECT count(*) FROM finance.statement_lines WHERE organization_id=p_organization_id AND import_id=v_import_id AND review_required));
END; $$;
REVOKE ALL ON FUNCTION public.import_bank_statement_rows(uuid,uuid,text,text,jsonb,bytea) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.import_bank_statement_rows(uuid,uuid,text,text,jsonb,bytea) TO ams_runtime;
NOTIFY pgrst,'reload schema';
