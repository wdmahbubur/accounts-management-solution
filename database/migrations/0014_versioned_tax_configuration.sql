-- US-015: append tax-code versions, resolve line snapshots, and keep totals exact.

ALTER TABLE finance.tax_codes ADD COLUMN version_no integer;
ALTER TABLE finance.tax_codes ADD COLUMN row_version integer NOT NULL DEFAULT 1;
WITH numbered AS (
  SELECT id,row_number() OVER(PARTITION BY organization_id,code ORDER BY effective_from,id)::integer AS version_no
  FROM finance.tax_codes
)
UPDATE finance.tax_codes t SET version_no=n.version_no FROM numbered n WHERE n.id=t.id;
ALTER TABLE finance.tax_codes ALTER COLUMN version_no SET NOT NULL;
ALTER TABLE finance.tax_codes ADD CONSTRAINT tax_codes_version_no_positive CHECK(version_no>0);
ALTER TABLE finance.tax_codes ADD CONSTRAINT tax_codes_row_version_positive CHECK(row_version>0);
ALTER TABLE finance.tax_codes ADD CONSTRAINT tax_codes_code_version_unique UNIQUE(organization_id,code,version_no);
ALTER TABLE finance.tax_codes ADD CONSTRAINT tax_codes_effective_ranges_exclude_overlap
  EXCLUDE USING gist(organization_id WITH =,code WITH =,daterange(effective_from,effective_to,'[]') WITH &&);

CREATE FUNCTION finance_private.guard_tax_code_version_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'tax versions are historical and cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF (NEW.id,NEW.organization_id,NEW.code,NEW.label,NEW.rate_percent,NEW.tax_kind,NEW.output_account_id,
      NEW.input_account_id,NEW.recoverability,NEW.effective_from,NEW.version_no,NEW.created_at)
      IS DISTINCT FROM
     (OLD.id,OLD.organization_id,OLD.code,OLD.label,OLD.rate_percent,OLD.tax_kind,OLD.output_account_id,
      OLD.input_account_id,OLD.recoverability,OLD.effective_from,OLD.version_no,OLD.created_at) THEN
    RAISE EXCEPTION 'tax versions are immutable; create a new effective-dated version' USING ERRCODE='23514';
  END IF;
  IF OLD.is_active=false AND NEW.is_active=true THEN
    RAISE EXCEPTION 'archived tax versions cannot be reactivated' USING ERRCODE='23514';
  END IF;
  IF NEW.effective_to IS DISTINCT FROM OLD.effective_to AND
     (NEW.effective_to IS NULL OR NEW.effective_to<NEW.effective_from OR
      (OLD.effective_to IS NOT NULL AND NEW.effective_to>OLD.effective_to)) THEN
    RAISE EXCEPTION 'tax-version end dates can only be shortened' USING ERRCODE='23514';
  END IF;
  IF (NEW.effective_to,NEW.is_active) IS DISTINCT FROM (OLD.effective_to,OLD.is_active) THEN
    IF NEW.row_version<>OLD.row_version+1 THEN RAISE EXCEPTION 'tax version is stale' USING ERRCODE='40001'; END IF;
  ELSIF NEW.row_version<>OLD.row_version THEN
    RAISE EXCEPTION 'tax version is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_tax_code_version_update() FROM PUBLIC,ams_runtime;
CREATE TRIGGER tax_code_versions_immutable BEFORE UPDATE OR DELETE ON finance.tax_codes
  FOR EACH ROW EXECUTE FUNCTION finance_private.guard_tax_code_version_update();

CREATE FUNCTION public.list_tax_codes(p_organization_id uuid)
RETURNS TABLE(id uuid,code text,version_no integer,row_version integer,label text,rate_percent text,tax_kind text,
  output_account_id uuid,output_account_label text,input_account_id uuid,input_account_label text,recoverability text,
  effective_from date,effective_to date,is_active boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT finance_private.has_permission(p_organization_id,'tax.read') THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT t.id,t.code,t.version_no,t.row_version,t.label,t.rate_percent::text,t.tax_kind,
    t.output_account_id,oa.code||' · '||oa.name,t.input_account_id,ia.code||' · '||ia.name,
    t.recoverability,t.effective_from,t.effective_to,t.is_active
  FROM finance.tax_codes t
  LEFT JOIN finance.accounts oa ON oa.organization_id=t.organization_id AND oa.id=t.output_account_id
  LEFT JOIN finance.accounts ia ON ia.organization_id=t.organization_id AND ia.id=t.input_account_id
  WHERE t.organization_id=p_organization_id ORDER BY t.code,t.version_no DESC;
END $$;
REVOKE ALL ON FUNCTION public.list_tax_codes(uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.list_tax_codes(uuid) TO ams_runtime;

CREATE FUNCTION public.list_tax_mapping_accounts(p_organization_id uuid)
RETURNS TABLE(id uuid,code text,name text,account_type text,normal_side text,mapping_key text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT finance_private.has_permission(p_organization_id,'tax.read') THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT a.id,a.code,a.name,a.account_type::text,a.normal_side::text,m.mapping_key
  FROM finance.accounts a
  LEFT JOIN finance.account_mappings m ON m.organization_id=a.organization_id AND m.account_id=a.id
  WHERE a.organization_id=p_organization_id AND a.is_active AND a.is_postable
    AND a.control_kind IS NULL AND
    ((a.account_type='liability' AND a.normal_side='credit') OR (a.account_type='asset' AND a.normal_side='debit'))
  ORDER BY a.account_type,a.code;
END $$;
REVOKE ALL ON FUNCTION public.list_tax_mapping_accounts(uuid) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.list_tax_mapping_accounts(uuid) TO ams_runtime;

CREATE FUNCTION public.create_tax_code_version(
  p_organization_id uuid,p_request_id text,p_reason text,p_code text,p_label text,p_rate_percent finance.rate,
  p_tax_kind text,p_output_account_id uuid,p_input_account_id uuid,p_recoverability text,
  p_effective_from date,p_effective_to date,p_expected_latest_row_version integer
) RETURNS TABLE(tax_code_id uuid,version_no integer,row_version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_status text; v_code text; v_id uuid:=gen_random_uuid(); v_version integer;
  v_latest finance.tax_codes%ROWTYPE; v_overlap finance.tax_codes%ROWTYPE; v_next date;
  v_output finance.accounts%ROWTYPE; v_input finance.accounts%ROWTYPE; v_end date:=p_effective_to;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'reason must be 10-1000 characters' USING ERRCODE='22023';
  END IF;
  v_actor:=finance_private.require_capability(p_organization_id,'tax.manage');
  PERFORM finance_private.require_recent_auth();
  SELECT o.status INTO v_status FROM finance.organizations o WHERE o.id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR v_status<>'active' THEN RAISE EXCEPTION 'company unavailable' USING ERRCODE='42501'; END IF;
  v_code:=upper(btrim(COALESCE(p_code,'')));
  IF v_code !~ '^[A-Z0-9][A-Z0-9_-]{0,31}$' OR p_label IS NULL OR length(btrim(p_label)) NOT BETWEEN 1 AND 160
    OR p_rate_percent IS NULL OR p_tax_kind IS NULL OR p_tax_kind NOT IN ('standard','zero_rated','exempt','out_of_scope')
    OR p_recoverability IS NULL OR p_recoverability NOT IN ('full','none') OR p_effective_from IS NULL OR NOT isfinite(p_effective_from)
    OR (v_end IS NOT NULL AND (NOT isfinite(v_end) OR v_end<p_effective_from)) THEN
    RAISE EXCEPTION 'invalid tax configuration' USING ERRCODE='22023';
  END IF;
  IF p_tax_kind<>'standard' AND (p_rate_percent<>0 OR p_recoverability<>'none' OR p_output_account_id IS NOT NULL OR p_input_account_id IS NOT NULL) THEN
    RAISE EXCEPTION 'zero, exempt, and out-of-scope codes require zero rate and no tax accounts' USING ERRCODE='23514';
  END IF;
  IF p_tax_kind='standard' AND p_output_account_id IS NULL THEN
    RAISE EXCEPTION 'standard tax requires an output-tax account' USING ERRCODE='23514';
  END IF;
  IF p_tax_kind='standard' AND p_recoverability='full' AND p_input_account_id IS NULL THEN
    RAISE EXCEPTION 'recoverable purchase tax requires an input-tax account' USING ERRCODE='23514';
  END IF;
  IF p_recoverability='none' AND p_input_account_id IS NOT NULL THEN
    RAISE EXCEPTION 'nonrecoverable tax must not use an input-tax account' USING ERRCODE='23514';
  END IF;
  IF p_output_account_id IS NOT NULL THEN
    SELECT * INTO v_output FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=p_output_account_id;
    IF NOT FOUND OR NOT finance_private.validate_mapping_target('output_tax',v_output) THEN
      RAISE EXCEPTION 'invalid output-tax account' USING ERRCODE='23514';
    END IF;
  END IF;
  IF p_input_account_id IS NOT NULL THEN
    SELECT * INTO v_input FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=p_input_account_id;
    IF NOT FOUND OR NOT finance_private.validate_mapping_target('input_tax',v_input) THEN
      RAISE EXCEPTION 'invalid input-tax account' USING ERRCODE='23514';
    END IF;
  END IF;
  SELECT * INTO v_latest FROM finance.tax_codes t WHERE t.organization_id=p_organization_id AND t.code=v_code
    ORDER BY t.version_no DESC LIMIT 1 FOR UPDATE;
  IF COALESCE(v_latest.row_version,0)<>COALESCE(p_expected_latest_row_version,0) THEN
    RAISE EXCEPTION 'tax configuration changed; reload versions' USING ERRCODE='40001';
  END IF;
  SELECT min(t.effective_from) INTO v_next FROM finance.tax_codes t
    WHERE t.organization_id=p_organization_id AND t.code=v_code AND t.effective_from>p_effective_from;
  IF v_end IS NULL AND v_next IS NOT NULL THEN v_end:=v_next-1; END IF;
  IF v_next IS NOT NULL AND v_end IS NOT NULL AND v_end>=v_next THEN
    RAISE EXCEPTION 'effective dates overlap a later tax version' USING ERRCODE='23P01';
  END IF;
  SELECT * INTO v_overlap FROM finance.tax_codes t WHERE t.organization_id=p_organization_id AND t.code=v_code
    AND t.effective_from<p_effective_from AND (t.effective_to IS NULL OR t.effective_to>=p_effective_from)
    ORDER BY t.effective_from DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    UPDATE finance.tax_codes SET effective_to=p_effective_from-1,row_version=row_version+1
      WHERE organization_id=p_organization_id AND id=v_overlap.id;
    PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'tax.version.close','tax_code',v_overlap.id,p_request_id,
      jsonb_build_object('effective_to',p_effective_from-1,'reason',btrim(p_reason)));
  END IF;
  SELECT COALESCE(max(t.version_no),0)+1 INTO v_version FROM finance.tax_codes t
    WHERE t.organization_id=p_organization_id AND t.code=v_code;
  INSERT INTO finance.tax_codes(id,organization_id,code,label,rate_percent,tax_kind,output_account_id,input_account_id,
    recoverability,effective_from,effective_to,version_no,row_version,is_active)
  VALUES(v_id,p_organization_id,v_code,btrim(p_label),p_rate_percent,p_tax_kind,p_output_account_id,p_input_account_id,
    p_recoverability,p_effective_from,v_end,v_version,1,true);
  PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'tax.version.create','tax_code',v_id,p_request_id,
    jsonb_build_object('code',v_code,'version',v_version,'label',btrim(p_label),'rate_percent',p_rate_percent,
      'tax_kind',p_tax_kind,'recoverability',p_recoverability,'effective_from',p_effective_from,
      'effective_to',v_end,'output_account_id',p_output_account_id,'input_account_id',p_input_account_id,'reason',btrim(p_reason)));
  RETURN QUERY SELECT v_id,v_version,1;
END $$;
REVOKE ALL ON FUNCTION public.create_tax_code_version(uuid,text,text,text,text,finance.rate,text,uuid,uuid,text,date,date,integer) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.create_tax_code_version(uuid,text,text,text,text,finance.rate,text,uuid,uuid,text,date,date,integer) TO ams_runtime;

CREATE FUNCTION public.archive_tax_code_version(
  p_organization_id uuid,p_tax_code_id uuid,p_expected_row_version integer,p_request_id text,p_reason text
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid; v_code finance.tax_codes%ROWTYPE; v_status text;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'reason must be 10-1000 characters' USING ERRCODE='22023';
  END IF;
  v_actor:=finance_private.require_capability(p_organization_id,'tax.manage');
  PERFORM finance_private.require_recent_auth();
  SELECT o.status INTO v_status FROM finance.organizations o WHERE o.id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR v_status<>'active' THEN RAISE EXCEPTION 'company unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_code FROM finance.tax_codes t WHERE t.organization_id=p_organization_id AND t.id=p_tax_code_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'tax version unavailable' USING ERRCODE='P0002'; END IF;
  IF v_code.row_version<>p_expected_row_version THEN RAISE EXCEPTION 'tax version is stale' USING ERRCODE='40001'; END IF;
  IF v_code.is_active THEN
    UPDATE finance.tax_codes SET is_active=false,row_version=row_version+1
      WHERE organization_id=p_organization_id AND id=p_tax_code_id;
    PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'tax.version.archive','tax_code',p_tax_code_id,p_request_id,
      jsonb_build_object('code',v_code.code,'version',v_code.version_no,'reason',btrim(p_reason)));
  END IF;
  RETURN v_code.row_version+CASE WHEN v_code.is_active THEN 1 ELSE 0 END;
END $$;
REVOKE ALL ON FUNCTION public.archive_tax_code_version(uuid,uuid,integer,text,text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.archive_tax_code_version(uuid,uuid,integer,text,text) TO ams_runtime;

CREATE FUNCTION finance_private.snapshot_draft_line_tax()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_document finance.business_documents%ROWTYPE; v_tax finance.tax_codes%ROWTYPE; v_original finance.document_lines%ROWTYPE;
  v_rate finance.rate:=0; v_recovery text:='none'; v_label text; v_tax_account uuid; v_base numeric; v_discount numeric; v_x numeric;
BEGIN
  SELECT * INTO v_document FROM finance.business_documents d WHERE d.organization_id=NEW.organization_id
    AND d.id=NEW.document_id FOR UPDATE;
  IF NOT FOUND OR v_document.state<>'draft' THEN RAISE EXCEPTION 'tax snapshots can only be set on draft lines' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.document_id IS DISTINCT FROM OLD.document_id) THEN
    RAISE EXCEPTION 'document lines cannot move between companies or documents' USING ERRCODE='23514';
  END IF;
  IF NEW.original_line_id IS NOT NULL AND v_document.document_type IN ('customer_credit','vendor_credit') THEN
    SELECT l.* INTO v_original
    FROM finance.document_lines l JOIN finance.business_documents d ON d.organization_id=l.organization_id AND d.id=l.document_id
    WHERE l.organization_id=NEW.organization_id AND l.id=NEW.original_line_id AND d.state='posted'
      AND ((v_document.document_type='customer_credit' AND d.document_type='invoice') OR
           (v_document.document_type='vendor_credit' AND d.document_type='bill'));
    IF NOT FOUND THEN RAISE EXCEPTION 'original tax snapshot unavailable' USING ERRCODE='P0002'; END IF;
    NEW.tax_code_id:=v_original.tax_code_id; NEW.tax_label_snapshot:=v_original.tax_label_snapshot;
    NEW.tax_rate_snapshot:=v_original.tax_rate_snapshot; NEW.tax_mode:=v_original.tax_mode;
    NEW.tax_recoverability_snapshot:=v_original.tax_recoverability_snapshot; NEW.tax_account_id:=v_original.tax_account_id;
    v_rate:=NEW.tax_rate_snapshot; v_recovery:=NEW.tax_recoverability_snapshot; v_label:=NEW.tax_label_snapshot; v_tax_account:=NEW.tax_account_id;
  ELSIF TG_OP='UPDATE' AND NEW.tax_code_id IS NOT DISTINCT FROM OLD.tax_code_id THEN
    v_rate:=OLD.tax_rate_snapshot; v_recovery:=OLD.tax_recoverability_snapshot; v_label:=OLD.tax_label_snapshot; v_tax_account:=OLD.tax_account_id;
    NEW.tax_rate_snapshot:=OLD.tax_rate_snapshot; NEW.tax_recoverability_snapshot:=OLD.tax_recoverability_snapshot;
    NEW.tax_label_snapshot:=OLD.tax_label_snapshot; NEW.tax_account_id:=OLD.tax_account_id;
  ELSIF NEW.tax_code_id IS NOT NULL THEN
    SELECT * INTO v_tax FROM finance.tax_codes t WHERE t.organization_id=NEW.organization_id AND t.id=NEW.tax_code_id
      AND t.is_active AND t.effective_from<=v_document.accounting_date
      AND (t.effective_to IS NULL OR t.effective_to>=v_document.accounting_date);
    IF NOT FOUND THEN RAISE EXCEPTION 'active tax version does not cover the accounting date' USING ERRCODE='23514'; END IF;
    IF v_document.document_type IN ('invoice','customer_credit') THEN
      v_tax_account:=v_tax.output_account_id;
      IF v_tax.tax_kind='standard' AND v_tax_account IS NULL THEN RAISE EXCEPTION 'output-tax account is not configured' USING ERRCODE='23514'; END IF;
      v_recovery:='none';
    ELSIF v_document.document_type IN ('bill','vendor_credit','paid_expense') THEN
      v_tax_account:=CASE WHEN v_tax.recoverability='full' THEN v_tax.input_account_id ELSE NULL END;
      v_recovery:=v_tax.recoverability;
      IF v_tax.recoverability='full' AND v_tax_account IS NULL THEN RAISE EXCEPTION 'input-tax account is not configured' USING ERRCODE='23514'; END IF;
    ELSE
      RAISE EXCEPTION 'tax codes are not supported for this document type' USING ERRCODE='23514';
    END IF;
    v_rate:=v_tax.rate_percent; v_label:=v_tax.label;
    NEW.tax_rate_snapshot:=v_rate; NEW.tax_label_snapshot:=v_label; NEW.tax_recoverability_snapshot:=v_recovery; NEW.tax_account_id:=v_tax_account;
  ELSE
    NEW.tax_rate_snapshot:=0; NEW.tax_label_snapshot:=NULL; NEW.tax_recoverability_snapshot:='none'; NEW.tax_account_id:=NULL;
  END IF;
  v_base:=round(NEW.quantity*NEW.unit_price,2); v_discount:=NEW.discount_amount;
  IF v_discount<0 OR v_discount>v_base THEN RAISE EXCEPTION 'line discount exceeds base' USING ERRCODE='23514'; END IF;
  v_x:=v_base-v_discount;
  IF NEW.tax_mode='inclusive' THEN
    NEW.net_amount:=round(v_x*100/(100+v_rate),2); NEW.tax_amount:=v_x-NEW.net_amount; NEW.gross_amount:=v_x;
  ELSE
    NEW.net_amount:=v_x; NEW.tax_amount:=round(v_x*v_rate/100,2); NEW.gross_amount:=NEW.net_amount+NEW.tax_amount;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.snapshot_draft_line_tax() FROM PUBLIC,ams_runtime;
CREATE TRIGGER snapshot_draft_line_tax BEFORE INSERT OR UPDATE
  ON finance.document_lines FOR EACH ROW EXECUTE FUNCTION finance_private.snapshot_draft_line_tax();

CREATE FUNCTION finance_private.recompute_draft_document_totals()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_org uuid; v_document uuid;
BEGIN
  v_org:=COALESCE(NEW.organization_id,OLD.organization_id); v_document:=COALESCE(NEW.document_id,OLD.document_id);
  UPDATE finance.business_documents d SET net_amount=x.net_amount,tax_amount=x.tax_amount,total_amount=x.total_amount,
    version=d.version+1,updated_at=clock_timestamp()
  FROM (SELECT COALESCE(sum(l.net_amount),0)::finance.amount AS net_amount,
        COALESCE(sum(l.tax_amount),0)::finance.amount AS tax_amount,
        COALESCE(sum(l.gross_amount),0)::finance.amount AS total_amount
        FROM finance.document_lines l WHERE l.organization_id=v_org AND l.document_id=v_document) x
  WHERE d.organization_id=v_org AND d.id=v_document AND d.state='draft';
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION finance_private.recompute_draft_document_totals() FROM PUBLIC,ams_runtime;
CREATE TRIGGER recompute_draft_document_totals AFTER INSERT OR UPDATE OR DELETE ON finance.document_lines
  FOR EACH ROW EXECUTE FUNCTION finance_private.recompute_draft_document_totals();

