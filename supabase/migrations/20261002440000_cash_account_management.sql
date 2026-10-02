BEGIN;

ALTER TABLE finance.cash_accounts ADD COLUMN row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0);

CREATE FUNCTION public.read_cash_accounts(p_organization_id uuid)
RETURNS TABLE(id uuid,name text,kind text,institution text,masked_account_number text,is_cash_equivalent boolean,is_active boolean,
  account_id uuid,account_code text,account_name text,book_balance text,last_reconciled_on date,row_version integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'banking.read');
  RETURN QUERY SELECT ca.id,ca.name,ca.kind,ca.institution,ca.masked_account_number,ca.is_cash_equivalent,ca.is_active,
    a.id,a.code,a.name,COALESCE(sum(jl.debit-jl.credit),0)::finance.amount::text,
    (SELECT max(r.ends_on) FROM finance.reconciliations r WHERE r.organization_id=ca.organization_id AND r.cash_account_id=ca.id AND r.state='finalized'),ca.row_version
  FROM finance.cash_accounts ca JOIN finance.accounts a ON a.organization_id=ca.organization_id AND a.id=ca.account_id
  LEFT JOIN finance.journal_entries je ON je.organization_id=ca.organization_id AND je.state='posted'
  LEFT JOIN finance.journal_lines jl ON jl.organization_id=je.organization_id AND jl.journal_entry_id=je.id AND jl.account_id=ca.account_id
  WHERE ca.organization_id=p_organization_id GROUP BY ca.id,a.id ORDER BY ca.is_active DESC,ca.name,ca.id;
END $$;
REVOKE ALL ON FUNCTION public.read_cash_accounts(uuid) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.read_cash_accounts(uuid) TO authenticated;

CREATE FUNCTION public.list_cash_account_gl_options(p_organization_id uuid)
RETURNS TABLE(id uuid,code text,name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM finance_private.require_capability(p_organization_id,'banking.write');
  RETURN QUERY SELECT a.id,a.code,a.name FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.is_active AND a.is_postable
    AND a.account_type='asset' AND a.normal_side='debit' AND a.control_kind IS NULL ORDER BY a.code;
END $$;
REVOKE ALL ON FUNCTION public.list_cash_account_gl_options(uuid) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.list_cash_account_gl_options(uuid) TO authenticated;

CREATE FUNCTION public.save_cash_account(p_organization_id uuid,p_request_id text,p_account_id uuid,p_expected_version integer,
  p_name text,p_kind text,p_institution text,p_masked_account_number text,p_is_cash_equivalent boolean,p_gl_account_id uuid)
RETURNS TABLE(account_id uuid,row_version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid;v_row finance.cash_accounts%ROWTYPE;v_used boolean;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);v_actor:=finance_private.require_capability(p_organization_id,'banking.write');
  IF p_account_id IS NULL OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 160 OR p_kind IS NULL OR p_kind NOT IN ('cash','bank','mobile_wallet','payment_clearing') OR
    (p_institution IS NOT NULL AND length(btrim(p_institution))>160) OR (p_masked_account_number IS NOT NULL AND (length(btrim(p_masked_account_number))>80 OR btrim(p_masked_account_number)!~'^[Xx*•-]*[0-9]{4}$')) OR p_is_cash_equivalent IS NULL OR p_gl_account_id IS NULL THEN
    RAISE EXCEPTION 'invalid cash account configuration' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=p_gl_account_id AND a.is_active AND a.is_postable
    AND a.account_type='asset' AND a.normal_side='debit' AND a.control_kind IS NULL) THEN
    RAISE EXCEPTION 'cash accounts require an active postable debit asset account without a control role' USING ERRCODE='23514'; END IF;
  IF p_expected_version IS NULL THEN
    SELECT * INTO v_row FROM finance.cash_accounts ca WHERE ca.organization_id=p_organization_id AND ca.id=p_account_id FOR UPDATE;
    IF FOUND THEN
      IF (v_row.name,v_row.account_id,v_row.kind,v_row.institution,v_row.masked_account_number,v_row.is_cash_equivalent)
        IS DISTINCT FROM (btrim(p_name),p_gl_account_id,p_kind,NULLIF(btrim(p_institution),''),NULLIF(btrim(p_masked_account_number),''),p_is_cash_equivalent) THEN
        RAISE EXCEPTION 'cash account identifier is already in use' USING ERRCODE='23505';
      END IF;
      RETURN QUERY SELECT v_row.id,v_row.row_version;RETURN;
    END IF;
    INSERT INTO finance.cash_accounts(id,organization_id,name,account_id,kind,institution,masked_account_number,is_cash_equivalent)
      VALUES(p_account_id,p_organization_id,btrim(p_name),p_gl_account_id,p_kind,NULLIF(btrim(p_institution),''),NULLIF(btrim(p_masked_account_number),''),p_is_cash_equivalent)
      RETURNING * INTO v_row;
  ELSE
    SELECT * INTO v_row FROM finance.cash_accounts ca WHERE ca.organization_id=p_organization_id AND ca.id=p_account_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'cash account not found' USING ERRCODE='P0002'; END IF;
    IF v_row.row_version<>p_expected_version THEN RAISE EXCEPTION 'cash account changed' USING ERRCODE='40001'; END IF;
    SELECT EXISTS(SELECT 1 FROM finance.money_movements m WHERE m.organization_id=p_organization_id AND m.cash_account_id=p_account_id)
      OR EXISTS(SELECT 1 FROM finance.transfers t WHERE t.organization_id=p_organization_id AND p_account_id IN (t.from_cash_account_id,t.to_cash_account_id))
      OR EXISTS(SELECT 1 FROM finance.bank_imports i WHERE i.organization_id=p_organization_id AND i.cash_account_id=p_account_id)
      OR EXISTS(SELECT 1 FROM finance.reconciliations r WHERE r.organization_id=p_organization_id AND r.cash_account_id=p_account_id)
      INTO v_used;
    IF v_used AND (p_gl_account_id<>v_row.account_id OR p_kind<>v_row.kind) THEN
      RAISE EXCEPTION 'used cash account mapping and kind are protected; archive and create another account' USING ERRCODE='23514'; END IF;
    UPDATE finance.cash_accounts ca SET name=btrim(p_name),kind=p_kind,institution=NULLIF(btrim(p_institution),''),
      masked_account_number=NULLIF(btrim(p_masked_account_number),''),is_cash_equivalent=p_is_cash_equivalent,
      account_id=p_gl_account_id,allow_negative_balance=CASE WHEN p_kind='bank' THEN ca.allow_negative_balance ELSE false END,row_version=ca.row_version+1
      WHERE ca.organization_id=p_organization_id AND ca.id=p_account_id RETURNING * INTO v_row;
  END IF;
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'cash_account.save','cash_account',v_row.id,p_request_id,
    jsonb_build_object('name',v_row.name,'kind',v_row.kind,'gl_account_id',v_row.account_id,'active',v_row.is_active));
  RETURN QUERY SELECT v_row.id,v_row.row_version;
END $$;
REVOKE ALL ON FUNCTION public.save_cash_account(uuid,text,uuid,integer,text,text,text,text,boolean,uuid) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.save_cash_account(uuid,text,uuid,integer,text,text,text,text,boolean,uuid) TO authenticated;

CREATE FUNCTION public.archive_cash_account(p_organization_id uuid,p_request_id text,p_account_id uuid,p_expected_version integer)
RETURNS TABLE(account_id uuid,row_version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid;v_row finance.cash_accounts%ROWTYPE;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);v_actor:=finance_private.require_capability(p_organization_id,'banking.write');
  SELECT * INTO v_row FROM finance.cash_accounts ca WHERE ca.organization_id=p_organization_id AND ca.id=p_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cash account not found' USING ERRCODE='P0002'; END IF;
  IF v_row.row_version<>p_expected_version THEN RAISE EXCEPTION 'cash account changed' USING ERRCODE='40001'; END IF;
  IF v_row.is_active THEN UPDATE finance.cash_accounts ca SET is_active=false,row_version=ca.row_version+1 WHERE ca.organization_id=p_organization_id AND ca.id=p_account_id RETURNING * INTO v_row; END IF;
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'cash_account.archive','cash_account',v_row.id,p_request_id,jsonb_build_object('active',false));
  RETURN QUERY SELECT v_row.id,v_row.row_version;
END $$;
REVOKE ALL ON FUNCTION public.archive_cash_account(uuid,text,uuid,integer) FROM PUBLIC,anon,authenticated,ams_job_worker;
GRANT EXECUTE ON FUNCTION public.archive_cash_account(uuid,text,uuid,integer) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
