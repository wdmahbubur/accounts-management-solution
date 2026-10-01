-- US-014: company-scoped, versioned chart and mapping commands.
BEGIN;

ALTER TABLE finance.accounts ADD COLUMN row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0);
ALTER TABLE finance.account_mappings ADD COLUMN row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0);

CREATE FUNCTION finance_private.guard_account_structure()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_parent finance.accounts%ROWTYPE;
BEGIN
  IF NEW.code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'
     OR btrim(NEW.name) = '' OR length(NEW.name) > 160
     OR btrim(NEW.report_group) = '' OR length(NEW.report_group) > 80 THEN
    RAISE EXCEPTION 'invalid account fields' USING ERRCODE='22023';
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    SELECT * INTO v_parent FROM finance.accounts p
      WHERE p.organization_id=NEW.organization_id AND p.id=NEW.parent_id FOR KEY SHARE;
    IF NOT FOUND OR v_parent.is_postable OR NOT v_parent.is_active
       OR v_parent.account_type <> NEW.account_type THEN
      RAISE EXCEPTION 'invalid account parent' USING ERRCODE='23514';
    END IF;
    IF EXISTS (
      WITH RECURSIVE ancestors(id,parent_id) AS (
        SELECT p.id,p.parent_id FROM finance.accounts p
          WHERE p.organization_id=NEW.organization_id AND p.id=NEW.parent_id
        UNION ALL
        SELECT p.id,p.parent_id FROM finance.accounts p
          JOIN ancestors a ON a.parent_id=p.id WHERE p.organization_id=NEW.organization_id
      ) SELECT 1 FROM ancestors WHERE id=NEW.id
    ) THEN RAISE EXCEPTION 'account cycle' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.control_kind IS NOT NULL AND (NOT NEW.is_postable OR
      (NEW.control_kind='ar' AND (NEW.account_type<>'asset' OR NEW.normal_side<>'debit')) OR
      (NEW.control_kind='vendor_advance' AND (NEW.account_type<>'asset' OR NEW.normal_side<>'debit')) OR
      (NEW.control_kind='ap' AND (NEW.account_type<>'liability' OR NEW.normal_side<>'credit')) OR
      (NEW.control_kind='customer_advance' AND (NEW.account_type<>'liability' OR NEW.normal_side<>'credit'))) THEN
    RAISE EXCEPTION 'incompatible control account' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.row_version <> OLD.row_version + 1 THEN
      RAISE EXCEPTION 'account version must advance by one' USING ERRCODE='22023';
    END IF;
    IF (NEW.account_type,NEW.normal_side,NEW.report_group,NEW.control_kind)
       IS DISTINCT FROM (OLD.account_type,OLD.normal_side,OLD.report_group,OLD.control_kind)
       AND EXISTS (SELECT 1 FROM finance.journal_lines l
         WHERE l.organization_id=OLD.organization_id AND l.account_id=OLD.id) THEN
      RAISE EXCEPTION 'account classification is locked after first ledger use' USING ERRCODE='23514';
    END IF;
    IF NEW.code IS DISTINCT FROM OLD.code AND EXISTS (SELECT 1 FROM finance.journal_lines l
         WHERE l.organization_id=OLD.organization_id AND l.account_id=OLD.id) THEN
      RAISE EXCEPTION 'account code is locked after first ledger use' USING ERRCODE='23514';
    END IF;
    IF OLD.is_active AND NOT NEW.is_active AND EXISTS (
      SELECT 1 FROM finance.account_mappings m WHERE m.organization_id=OLD.organization_id AND m.account_id=OLD.id
    ) THEN RAISE EXCEPTION 'remap system controls before archiving this account' USING ERRCODE='23514'; END IF;
    IF OLD.is_postable AND NOT NEW.is_postable AND EXISTS (
      SELECT 1 FROM finance.accounts c WHERE c.organization_id=OLD.organization_id AND c.parent_id=OLD.id AND c.is_active
    ) THEN RAISE EXCEPTION 'move active child accounts before archiving this group' USING ERRCODE='23514'; END IF;
    IF EXISTS (SELECT 1 FROM finance.accounts c WHERE c.organization_id=OLD.organization_id AND c.parent_id=OLD.id
      AND c.is_active AND (NEW.is_postable OR NOT NEW.is_active OR c.account_type<>NEW.account_type)) THEN
      RAISE EXCEPTION 'move active child accounts before changing this group' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_account_structure() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER accounts_structure_guard BEFORE INSERT OR UPDATE ON finance.accounts
  FOR EACH ROW EXECUTE FUNCTION finance_private.guard_account_structure();

CREATE FUNCTION finance_private.require_chart_write(p_organization_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member_id uuid; v_status text;
BEGIN
  v_member_id:=finance_private.require_capability(p_organization_id,'accounting.read');
  PERFORM finance_private.require_capability(p_organization_id,'journal.write');
  PERFORM finance_private.require_recent_auth();
  SELECT o.status INTO v_status FROM finance.organizations o WHERE o.id=p_organization_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'organization not found' USING ERRCODE='P0002'; END IF;
  IF v_status<>'active' THEN RAISE EXCEPTION 'organization is not writable' USING ERRCODE='42501'; END IF;
  RETURN v_member_id;
END $$;
REVOKE ALL ON FUNCTION finance_private.require_chart_write(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.save_account(
  p_organization_id uuid,p_request_id text,p_account_id uuid,p_expected_version integer,
  p_code text,p_name text,p_parent_id uuid,p_account_type text,p_normal_side text,
  p_report_group text,p_control_kind text,p_is_postable boolean,p_is_active boolean
) RETURNS TABLE(account_id uuid,row_version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid; v_account_id uuid; v_version integer; v_old finance.accounts%ROWTYPE;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  v_actor:=finance_private.require_chart_write(p_organization_id);
  IF p_account_type NOT IN ('asset','liability','equity','income','expense')
     OR p_normal_side NOT IN ('debit','credit') OR p_is_postable IS NULL OR p_is_active IS NULL
     OR (p_control_kind IS NOT NULL AND p_control_kind NOT IN ('ar','ap','customer_advance','vendor_advance')) THEN
    RAISE EXCEPTION 'invalid account classification' USING ERRCODE='22023';
  END IF;
  IF p_account_id IS NULL THEN
    IF p_expected_version IS NOT NULL THEN RAISE EXCEPTION 'unexpected version' USING ERRCODE='22023'; END IF;
    INSERT INTO finance.accounts(organization_id,code,name,parent_id,account_type,normal_side,report_group,control_kind,is_postable,is_active,is_system)
    VALUES(p_organization_id,p_code,btrim(p_name),p_parent_id,p_account_type,p_normal_side,btrim(p_report_group),p_control_kind,p_is_postable,p_is_active,false)
    RETURNING id,finance.accounts.row_version INTO v_account_id,v_version;
    PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'account.create','account',v_account_id,p_request_id,
      jsonb_build_object('code',p_code,'name',btrim(p_name),'account_type',p_account_type,'normal_side',p_normal_side));
  ELSE
    IF p_expected_version IS NULL OR p_expected_version<1 THEN RAISE EXCEPTION 'expected version required' USING ERRCODE='22023'; END IF;
    SELECT * INTO v_old FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=p_account_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'account not found' USING ERRCODE='P0002'; END IF;
    UPDATE finance.accounts a SET code=p_code,name=btrim(p_name),parent_id=p_parent_id,account_type=p_account_type,
      normal_side=p_normal_side,report_group=btrim(p_report_group),control_kind=p_control_kind,
      is_postable=p_is_postable,is_active=p_is_active,row_version=a.row_version+1
      WHERE a.organization_id=p_organization_id AND a.id=p_account_id AND a.row_version=p_expected_version
      RETURNING a.id,a.row_version INTO v_account_id,v_version;
    IF NOT FOUND THEN RAISE EXCEPTION 'stale account version' USING ERRCODE='40001'; END IF;
    PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'account.update','account',v_account_id,p_request_id,
      jsonb_build_object('from_version',v_old.row_version,'to_version',v_version,'code',p_code,'name',btrim(p_name),
        'account_type',p_account_type,'normal_side',p_normal_side,'report_group',btrim(p_report_group),
        'control_kind',p_control_kind,'is_postable',p_is_postable,'is_active',p_is_active));
  END IF;
  RETURN QUERY SELECT v_account_id,v_version;
END $$;
REVOKE ALL ON FUNCTION public.save_account(uuid,text,uuid,integer,text,text,uuid,text,text,text,text,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_account(uuid,text,uuid,integer,text,text,uuid,text,text,text,text,boolean,boolean) TO authenticated;

CREATE FUNCTION finance_private.validate_mapping_target(p_mapping_key text,p_account finance.accounts)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_account.is_active AND p_account.is_postable AND CASE p_mapping_key
    WHEN 'cash' THEN p_account.account_type='asset' AND p_account.normal_side='debit' AND p_account.control_kind IS NULL
    WHEN 'bank' THEN p_account.account_type='asset' AND p_account.normal_side='debit' AND p_account.control_kind IS NULL
    WHEN 'ar' THEN p_account.account_type='asset' AND p_account.normal_side='debit' AND p_account.control_kind='ar'
    WHEN 'vendor_advance' THEN p_account.account_type='asset' AND p_account.normal_side='debit' AND p_account.control_kind='vendor_advance'
    WHEN 'input_tax' THEN p_account.account_type='asset' AND p_account.normal_side='debit' AND p_account.control_kind IS NULL
    WHEN 'ap' THEN p_account.account_type='liability' AND p_account.normal_side='credit' AND p_account.control_kind='ap'
    WHEN 'output_tax' THEN p_account.account_type='liability' AND p_account.normal_side='credit' AND p_account.control_kind IS NULL
    WHEN 'customer_advance' THEN p_account.account_type='liability' AND p_account.normal_side='credit' AND p_account.control_kind='customer_advance'
    WHEN 'retained_earnings' THEN p_account.account_type='equity' AND p_account.normal_side='credit' AND p_account.control_kind IS NULL
    WHEN 'opening_suspense' THEN p_account.account_type='equity' AND p_account.normal_side='credit' AND p_account.control_kind IS NULL
    WHEN 'rounding_difference' THEN p_account.account_type='expense' AND p_account.normal_side='debit' AND p_account.control_kind IS NULL
    ELSE false END
$$;
REVOKE ALL ON FUNCTION finance_private.validate_mapping_target(text,finance.accounts) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION finance_private.guard_mapped_account_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (NEW.account_type,NEW.normal_side,NEW.control_kind,NEW.is_postable,NEW.is_active)
      IS DISTINCT FROM (OLD.account_type,OLD.normal_side,OLD.control_kind,OLD.is_postable,OLD.is_active)
     AND EXISTS (SELECT 1 FROM finance.account_mappings m WHERE m.organization_id=NEW.organization_id
       AND m.account_id=NEW.id AND NOT finance_private.validate_mapping_target(m.mapping_key,NEW)) THEN
    RAISE EXCEPTION 'remap system controls before changing this account classification' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_mapped_account_update() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER account_mapping_compat_guard BEFORE UPDATE ON finance.accounts
  FOR EACH ROW EXECUTE FUNCTION finance_private.guard_mapped_account_update();

CREATE FUNCTION finance_private.guard_journal_line_account()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_account finance.accounts%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    RAISE EXCEPTION 'posted ledger account reference is immutable' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_account FROM finance.accounts a WHERE a.organization_id=NEW.organization_id
    AND a.id=NEW.account_id FOR UPDATE;
  IF NOT FOUND OR NOT v_account.is_active OR NOT v_account.is_postable THEN
    RAISE EXCEPTION 'journal lines require an active postable account in the same company' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finance_private.guard_journal_line_account() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER journal_line_account_guard BEFORE INSERT OR UPDATE OF account_id ON finance.journal_lines
  FOR EACH ROW EXECUTE FUNCTION finance_private.guard_journal_line_account();

CREATE FUNCTION public.set_account_mapping(
  p_organization_id uuid,p_request_id text,p_mapping_key text,p_account_id uuid,p_expected_version integer
) RETURNS TABLE(mapping_key text,account_id uuid,row_version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid; v_map finance.account_mappings%ROWTYPE; v_account finance.accounts%ROWTYPE;
  v_id uuid; v_version integer;
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);
  v_actor:=finance_private.require_chart_write(p_organization_id);
  IF p_mapping_key NOT IN ('cash','bank','ar','vendor_advance','input_tax','ap','output_tax','customer_advance','retained_earnings','opening_suspense','rounding_difference') THEN
    RAISE EXCEPTION 'unsupported mapping key' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_account FROM finance.accounts a WHERE a.organization_id=p_organization_id AND a.id=p_account_id FOR KEY SHARE;
  IF NOT FOUND OR NOT finance_private.validate_mapping_target(p_mapping_key,v_account) THEN
    RAISE EXCEPTION 'incompatible account mapping' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_map FROM finance.account_mappings m WHERE m.organization_id=p_organization_id AND m.mapping_key=p_mapping_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'mapping not found' USING ERRCODE='P0002'; END IF;
  IF p_expected_version IS NULL OR p_expected_version<1 OR v_map.row_version<>p_expected_version THEN
    RAISE EXCEPTION 'stale mapping version' USING ERRCODE='40001';
  END IF;
  IF v_map.account_id<>p_account_id THEN
    UPDATE finance.account_mappings m SET account_id=p_account_id,row_version=m.row_version+1
      WHERE m.organization_id=p_organization_id AND m.id=v_map.id RETURNING m.id,m.row_version INTO v_id,v_version;
    PERFORM finance_private.write_role_audit(p_organization_id,v_actor,'account.mapping.update','account_mapping',v_id,p_request_id,
      jsonb_build_object('mapping_key',p_mapping_key,'from_account_id',v_map.account_id,'to_account_id',p_account_id,
        'from_version',v_map.row_version,'to_version',v_version));
  ELSE
    v_id:=v_map.id; v_version:=v_map.row_version;
  END IF;
  RETURN QUERY SELECT p_mapping_key,p_account_id,v_version;
END $$;
REVOKE ALL ON FUNCTION public.set_account_mapping(uuid,text,text,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_account_mapping(uuid,text,text,uuid,integer) TO authenticated;

CREATE FUNCTION public.list_accounts_for_management(p_organization_id uuid)
RETURNS TABLE(id uuid,code text,name text,parent_id uuid,account_type text,normal_side text,
  report_group text,control_kind text,is_postable boolean,is_active boolean,is_system boolean,row_version integer,
  mapping_key text,mapping_version integer)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NOT finance_private.has_permission(p_organization_id,'accounting.read') THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT a.id,a.code,a.name,a.parent_id,a.account_type,a.normal_side,a.report_group,a.control_kind,
    a.is_postable,a.is_active,a.is_system,a.row_version,m.mapping_key,m.row_version
    FROM finance.accounts a LEFT JOIN finance.account_mappings m
      ON m.organization_id=a.organization_id AND m.account_id=a.id
    WHERE a.organization_id=p_organization_id ORDER BY a.code,a.id;
END $$;
REVOKE ALL ON FUNCTION public.list_accounts_for_management(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_accounts_for_management(uuid) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
