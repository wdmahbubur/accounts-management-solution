BEGIN;

INSERT INTO finance.permissions (code, description)
VALUES
  ('company.read','Read company settings'),
  ('company.update','Update company settings'),
  ('users.read','Read members and roles'),
  ('users.manage','Manage members and roles'),
  ('sales.read','Read sales records'),
  ('sales.write','Create and edit sales drafts'),
  ('sales.post','Post sales-scope documents within policy'),
  ('purchases.read','Read purchase records'),
  ('purchases.write','Create and edit purchase drafts'),
  ('purchases.post','Post purchase-scope documents within policy'),
  ('contacts.read','Read contacts'),
  ('contacts.write','Create and edit contacts'),
  ('catalog.read','Read service and non-stock catalogue'),
  ('catalog.write','Create and edit service and non-stock catalogue'),
  ('documents.read','Read broad financial source documents'),
  ('banking.read','Read company-wide banking and cash information'),
  ('banking.write','Create banking and cash operations'),
  ('dues.read','Read receivable and payable dues'),
  ('dues.allocate','Allocate eligible open items'),
  ('accounting.read','Read accounting configuration'),
  ('journal.write','Create and edit manual journal drafts'),
  ('journal.post','Post journal-scope documents within policy'),
  ('ledger.read','Read general-ledger detail'),
  ('tax.read','Read tax configuration'),
  ('tax.manage','Manage tax configuration'),
  ('approvals.read','Read approval requests and decisions'),
  ('approvals.decide','Approve or reject another maker when policy permits'),
  ('periods.lock','Lock accounting periods'),
  ('periods.reopen','Reopen periods or years with reason and recent authentication'),
  ('reports.read','Read company-wide financial reports'),
  ('reports.export','Create broad financial report exports'),
  ('imports.read','Read import jobs and validation results'),
  ('imports.run','Run supported imports'),
  ('exports.read','Read authorized export jobs and downloads'),
  ('attachments.read','Read authorized financial evidence'),
  ('attachments.write','Attach authorized financial evidence'),
  ('audit.read','Read financial audit evidence'),
  ('subscription.read','Read subscription and entitlement state'),
  ('subscription.manage','Manage subscription settings')
ON CONFLICT (code) DO UPDATE
SET description = EXCLUDED.description;

CREATE FUNCTION finance_private.template_permission_codes(p_template_key text)
RETURNS TABLE (permission_code text)
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT unnest(
    CASE p_template_key
      WHEN 'owner' THEN ARRAY[
        'company.read','company.update','users.read','users.manage',
        'sales.read','sales.write','sales.post',
        'purchases.read','purchases.write','purchases.post',
        'contacts.read','contacts.write','catalog.read','catalog.write',
        'documents.read','banking.read','banking.write','dues.read','dues.allocate',
        'accounting.read','journal.write','journal.post','ledger.read',
        'tax.read','tax.manage','approvals.read','approvals.decide',
        'periods.lock','periods.reopen','reports.read','reports.export',
        'imports.read','imports.run','exports.read',
        'attachments.read','attachments.write','audit.read',
        'subscription.read','subscription.manage'
      ]::text[]
      WHEN 'admin' THEN ARRAY[
        'company.read','company.update','users.read','users.manage'
      ]::text[]
      WHEN 'finance_manager' THEN ARRAY[
        'sales.read','sales.write','sales.post',
        'purchases.read','purchases.write','purchases.post',
        'contacts.read','contacts.write','catalog.read','catalog.write',
        'documents.read','banking.read','banking.write','dues.read','dues.allocate',
        'accounting.read','journal.write','journal.post','ledger.read',
        'tax.read','tax.manage','approvals.read','approvals.decide',
        'periods.lock','periods.reopen','reports.read','reports.export',
        'imports.read','imports.run','exports.read',
        'attachments.read','attachments.write','audit.read'
      ]::text[]
      WHEN 'accountant' THEN ARRAY[
        'sales.read','sales.write','sales.post',
        'purchases.read','purchases.write','purchases.post',
        'contacts.read','contacts.write','catalog.read','catalog.write',
        'documents.read','banking.read','banking.write','dues.read','dues.allocate',
        'accounting.read','journal.write','journal.post','ledger.read',
        'tax.read','tax.manage','approvals.read',
        'reports.read','reports.export','imports.read','imports.run','exports.read',
        'attachments.read','attachments.write','audit.read'
      ]::text[]
      WHEN 'billing' THEN ARRAY[
        'sales.read','sales.write','sales.post',
        'contacts.write','catalog.read','dues.allocate'
      ]::text[]
      WHEN 'auditor' THEN ARRAY[
        'company.read','sales.read','purchases.read','contacts.read','catalog.read',
        'documents.read','banking.read','dues.read','accounting.read','ledger.read',
        'tax.read','approvals.read','reports.read','reports.export',
        'imports.read','exports.read','attachments.read','audit.read'
      ]::text[]
      ELSE ARRAY[]::text[]
    END
  )
$$;

REVOKE ALL ON FUNCTION finance_private.template_permission_codes(text)
FROM PUBLIC, anon, authenticated;

CREATE FUNCTION finance_private.seed_system_role_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.is_system AND NEW.template_key IS NOT NULL THEN
    INSERT INTO finance.role_permissions (
      organization_id, role_id, permission_id
    )
    SELECT NEW.organization_id, NEW.id, p.id
    FROM finance_private.template_permission_codes(NEW.template_key) t
    JOIN finance.permissions p ON p.code = t.permission_code
    ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION finance_private.seed_system_role_permissions()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS seed_system_role_permissions ON finance.roles;
CREATE TRIGGER seed_system_role_permissions
AFTER INSERT ON finance.roles
FOR EACH ROW EXECUTE FUNCTION finance_private.seed_system_role_permissions();

INSERT INTO finance.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM finance.roles r
CROSS JOIN LATERAL finance_private.template_permission_codes(r.template_key) t
JOIN finance.permissions p ON p.code = t.permission_code
WHERE r.is_system
ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;

CREATE FUNCTION finance_private.lock_role_admin(p_organization_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text, 9009)
  )
$$;

REVOKE ALL ON FUNCTION finance_private.lock_role_admin(uuid)
FROM PUBLIC, anon, authenticated;

CREATE FUNCTION finance_private.member_has_capability(
  p_organization_id uuid,
  p_member_id uuid,
  p_permission_code text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM finance.organization_members m
    JOIN finance.member_roles mr
      ON mr.organization_id = m.organization_id
     AND mr.member_id = m.id
    JOIN finance.role_permissions rp
      ON rp.organization_id = mr.organization_id
     AND rp.role_id = mr.role_id
    JOIN finance.permissions p
      ON p.id = rp.permission_id
    WHERE m.organization_id = p_organization_id
      AND m.id = p_member_id
      AND m.status = 'active'
      AND p.code = p_permission_code
  )
$$;

REVOKE ALL ON FUNCTION finance_private.member_has_capability(uuid,uuid,text)
FROM PUBLIC, anon, authenticated;

CREATE FUNCTION finance_private.is_active_owner(
  p_organization_id uuid,
  p_member_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM finance.organization_members m
    JOIN finance.member_roles mr
      ON mr.organization_id = m.organization_id
     AND mr.member_id = m.id
    JOIN finance.roles r
      ON r.organization_id = mr.organization_id
     AND r.id = mr.role_id
    WHERE m.organization_id = p_organization_id
      AND m.id = p_member_id
      AND m.status = 'active'
      AND r.is_system
      AND r.template_key = 'owner'
  )
$$;

REVOKE ALL ON FUNCTION finance_private.is_active_owner(uuid,uuid)
FROM PUBLIC, anon, authenticated;

CREATE FUNCTION finance_private.require_capability(
  p_organization_id uuid,
  p_permission_code text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_member_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT m.id
  INTO v_member_id
  FROM finance.organization_members m
  WHERE m.organization_id = p_organization_id
    AND m.user_id = v_user_id
    AND m.status = 'active';

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  IF NOT finance_private.member_has_capability(
    p_organization_id,
    v_member_id,
    p_permission_code
  ) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  RETURN v_member_id;
END
$$;

REVOKE ALL ON FUNCTION finance_private.require_capability(uuid,text)
FROM PUBLIC, anon, authenticated;

CREATE FUNCTION finance_private.require_recent_auth()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_last_sign_in_at timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT u.last_sign_in_at
  INTO v_last_sign_in_at
  FROM auth.users u
  WHERE u.id = v_user_id;

  IF v_last_sign_in_at IS NULL
     OR v_last_sign_in_at < now() - interval '24 hours'
     OR v_last_sign_in_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'recent authentication required' USING ERRCODE = '42501';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION finance_private.require_recent_auth()
FROM PUBLIC, anon, authenticated;

CREATE FUNCTION finance_private.validate_request_id(p_request_id text)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_request_id IS NULL
     OR p_request_id !~ '^[A-Za-z0-9._:-]{1,128}$' THEN
    RAISE EXCEPTION 'invalid request id' USING ERRCODE = '22023';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION finance_private.validate_request_id(text)
FROM PUBLIC, anon, authenticated;

CREATE FUNCTION finance_private.write_role_audit(
  p_organization_id uuid,
  p_actor_member_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_request_id text,
  p_change jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM finance_private.validate_request_id(p_request_id);

  INSERT INTO finance.audit_events (
    organization_id,
    actor_member_id,
    actor_kind,
    action,
    entity_type,
    entity_id,
    request_id,
    redacted_change
  )
  VALUES (
    p_organization_id,
    p_actor_member_id,
    'user',
    p_action,
    p_entity_type,
    p_entity_id,
    p_request_id,
    COALESCE(p_change, '{}'::jsonb)
  );
END
$$;

REVOKE ALL ON FUNCTION finance_private.write_role_audit(uuid,uuid,text,text,uuid,text,jsonb)
FROM PUBLIC, anon, authenticated;

CREATE FUNCTION finance_private.assert_permission_codes_grantable(
  p_organization_id uuid,
  p_actor_member_id uuid,
  p_permission_codes text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_codes text[];
BEGIN
  SELECT COALESCE(
    array_agg(DISTINCT requested.permission_code ORDER BY requested.permission_code),
    ARRAY[]::text[]
  )
  INTO v_codes
  FROM unnest(COALESCE(p_permission_codes, ARRAY[]::text[]))
    AS requested(permission_code);

  IF EXISTS (
    SELECT 1
    FROM unnest(v_codes) AS requested(permission_code)
    LEFT JOIN finance.permissions p
      ON p.code = requested.permission_code
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'unknown permission code' USING ERRCODE = '22023';
  END IF;

  IF finance_private.is_active_owner(p_organization_id, p_actor_member_id) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_codes) AS requested(permission_code)
    WHERE NOT finance_private.member_has_capability(
      p_organization_id,
      p_actor_member_id,
      requested.permission_code
    )
  ) THEN
    RAISE EXCEPTION 'permission grant exceeds actor authority'
      USING ERRCODE = '42501';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION finance_private.assert_permission_codes_grantable(uuid,uuid,text[])
FROM PUBLIC, anon, authenticated;

CREATE FUNCTION finance_private.assert_roles_grantable(
  p_organization_id uuid,
  p_actor_member_id uuid,
  p_role_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_is_owner boolean :=
    finance_private.is_active_owner(p_organization_id, p_actor_member_id);
BEGIN
  IF v_actor_is_owner THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM finance.role_permissions rp
    JOIN finance.permissions p ON p.id = rp.permission_id
    WHERE rp.organization_id = p_organization_id
      AND rp.role_id = ANY(COALESCE(p_role_ids, ARRAY[]::uuid[]))
      AND NOT finance_private.member_has_capability(
        p_organization_id,
        p_actor_member_id,
        p.code
      )
  ) THEN
    RAISE EXCEPTION 'role grant exceeds actor authority'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM finance.roles r
    WHERE r.organization_id = p_organization_id
      AND r.id = ANY(COALESCE(p_role_ids, ARRAY[]::uuid[]))
      AND r.is_system
      AND r.template_key = 'owner'
  ) THEN
    RAISE EXCEPTION 'only an active owner may grant Owner'
      USING ERRCODE = '42501';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION finance_private.assert_roles_grantable(uuid,uuid,uuid[])
FROM PUBLIC, anon, authenticated;

CREATE FUNCTION finance_private.guard_owner_role_floor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_role boolean;
  v_member_active boolean;
BEGIN
  SELECT r.is_system AND r.template_key = 'owner'
  INTO v_owner_role
  FROM finance.roles r
  WHERE r.organization_id = OLD.organization_id
    AND r.id = OLD.role_id;

  IF NOT COALESCE(v_owner_role, false) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.role_id = OLD.role_id
     AND NEW.member_id = OLD.member_id
     AND NEW.organization_id = OLD.organization_id THEN
    RETURN NEW;
  END IF;

  SELECT m.status = 'active'
  INTO v_member_active
  FROM finance.organization_members m
  WHERE m.organization_id = OLD.organization_id
    AND m.id = OLD.member_id;

  IF NOT COALESCE(v_member_active, false) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  PERFORM finance_private.lock_role_admin(OLD.organization_id);

  IF NOT EXISTS (
    SELECT 1
    FROM finance.organization_members m
    JOIN finance.member_roles mr
      ON mr.organization_id = m.organization_id
     AND mr.member_id = m.id
    JOIN finance.roles r
      ON r.organization_id = mr.organization_id
     AND r.id = mr.role_id
    WHERE m.organization_id = OLD.organization_id
      AND m.status = 'active'
      AND r.is_system
      AND r.template_key = 'owner'
      AND mr.id <> OLD.id
  ) THEN
    RAISE EXCEPTION 'cannot remove last active owner'
      USING ERRCODE = '23514';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

REVOKE ALL ON FUNCTION finance_private.guard_owner_role_floor()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_owner_role_floor ON finance.member_roles;
CREATE TRIGGER guard_owner_role_floor
BEFORE DELETE OR UPDATE ON finance.member_roles
FOR EACH ROW EXECUTE FUNCTION finance_private.guard_owner_role_floor();

CREATE FUNCTION finance_private.guard_owner_membership_floor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status <> 'active' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = 'active' THEN
    RETURN NEW;
  END IF;

  IF NOT finance_private.is_active_owner(OLD.organization_id, OLD.id) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  PERFORM finance_private.lock_role_admin(OLD.organization_id);

  IF NOT EXISTS (
    SELECT 1
    FROM finance.organization_members m
    JOIN finance.member_roles mr
      ON mr.organization_id = m.organization_id
     AND mr.member_id = m.id
    JOIN finance.roles r
      ON r.organization_id = mr.organization_id
     AND r.id = mr.role_id
    WHERE m.organization_id = OLD.organization_id
      AND m.id <> OLD.id
      AND m.status = 'active'
      AND r.is_system
      AND r.template_key = 'owner'
  ) THEN
    RAISE EXCEPTION 'cannot remove last active owner'
      USING ERRCODE = '23514';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

REVOKE ALL ON FUNCTION finance_private.guard_owner_membership_floor()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_owner_membership_floor ON finance.organization_members;
CREATE TRIGGER guard_owner_membership_floor
BEFORE DELETE OR UPDATE OF status ON finance.organization_members
FOR EACH ROW EXECUTE FUNCTION finance_private.guard_owner_membership_floor();

CREATE FUNCTION public.list_permissions_for_role_management(
  p_organization_id uuid
)
RETURNS TABLE (
  code text,
  description text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM finance_private.require_capability(
    p_organization_id,
    'users.read'
  );

  RETURN QUERY
  SELECT p.code, p.description
  FROM finance.permissions p
  ORDER BY p.code;
END
$$;

CREATE FUNCTION public.list_roles_for_management(
  p_organization_id uuid
)
RETURNS TABLE (
  role_id uuid,
  role_name text,
  template_key text,
  is_system boolean,
  permission_codes text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM finance_private.require_capability(
    p_organization_id,
    'users.read'
  );

  RETURN QUERY
  SELECT
    r.id,
    r.name,
    r.template_key,
    r.is_system,
    COALESCE(
      array_agg(DISTINCT p.code ORDER BY p.code)
        FILTER (WHERE p.code IS NOT NULL),
      ARRAY[]::text[]
    )
  FROM finance.roles r
  LEFT JOIN finance.role_permissions rp
    ON rp.organization_id = r.organization_id
   AND rp.role_id = r.id
  LEFT JOIN finance.permissions p
    ON p.id = rp.permission_id
  WHERE r.organization_id = p_organization_id
  GROUP BY r.id, r.name, r.template_key, r.is_system
  ORDER BY r.is_system DESC, lower(r.name), r.id;
END
$$;

CREATE FUNCTION public.list_members_for_management(
  p_organization_id uuid
)
RETURNS TABLE (
  member_id uuid,
  display_name text,
  member_status text,
  role_ids uuid[],
  role_names text[],
  is_owner boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM finance_private.require_capability(
    p_organization_id,
    'users.read'
  );

  RETURN QUERY
  SELECT
    m.id,
    m.display_name_snapshot,
    m.status,
    COALESCE(
      array_agg(DISTINCT r.id ORDER BY r.id)
        FILTER (WHERE r.id IS NOT NULL),
      ARRAY[]::uuid[]
    ),
    COALESCE(
      array_agg(DISTINCT r.name ORDER BY r.name)
        FILTER (WHERE r.name IS NOT NULL),
      ARRAY[]::text[]
    ),
    COALESCE(bool_or(
      m.status = 'active'
      AND r.is_system
      AND r.template_key = 'owner'
    ), false)
  FROM finance.organization_members m
  LEFT JOIN finance.member_roles mr
    ON mr.organization_id = m.organization_id
   AND mr.member_id = m.id
  LEFT JOIN finance.roles r
    ON r.organization_id = mr.organization_id
   AND r.id = mr.role_id
  WHERE m.organization_id = p_organization_id
  GROUP BY m.id, m.display_name_snapshot, m.status
  ORDER BY lower(m.display_name_snapshot), m.id;
END
$$;

CREATE FUNCTION public.create_custom_role(
  p_organization_id uuid,
  p_name text,
  p_permission_codes text[],
  p_request_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_member_id uuid;
  v_role_id uuid;
  v_name text := btrim(p_name);
  v_codes text[];
BEGIN
  PERFORM finance_private.lock_role_admin(p_organization_id);
  v_actor_member_id := finance_private.require_capability(
    p_organization_id,
    'users.manage'
  );
  PERFORM finance_private.require_recent_auth();
  PERFORM finance_private.validate_request_id(p_request_id);

  IF v_name IS NULL OR v_name = '' OR char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'invalid role name' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM finance.roles r
    WHERE r.organization_id = p_organization_id
      AND lower(r.name) = lower(v_name)
  ) THEN
    RAISE EXCEPTION 'role name already exists' USING ERRCODE = '23505';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT code ORDER BY code), ARRAY[]::text[])
  INTO v_codes
  FROM unnest(COALESCE(p_permission_codes, ARRAY[]::text[])) AS code;

  PERFORM finance_private.assert_permission_codes_grantable(
    p_organization_id,
    v_actor_member_id,
    v_codes
  );

  INSERT INTO finance.roles (
    organization_id, name, template_key, is_system
  )
  VALUES (
    p_organization_id, v_name, NULL, false
  )
  RETURNING id INTO v_role_id;

  INSERT INTO finance.role_permissions (
    organization_id, role_id, permission_id
  )
  SELECT p_organization_id, v_role_id, p.id
  FROM finance.permissions p
  WHERE p.code = ANY(v_codes);

  PERFORM finance_private.write_role_audit(
    p_organization_id,
    v_actor_member_id,
    'role.custom.create',
    'role',
    v_role_id,
    p_request_id,
    jsonb_build_object(
      'name', v_name,
      'permission_codes', to_jsonb(v_codes)
    )
  );

  RETURN v_role_id;
END
$$;

CREATE FUNCTION public.update_custom_role(
  p_organization_id uuid,
  p_role_id uuid,
  p_name text,
  p_permission_codes text[],
  p_request_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_member_id uuid;
  v_name text := btrim(p_name);
  v_codes text[];
BEGIN
  PERFORM finance_private.lock_role_admin(p_organization_id);
  v_actor_member_id := finance_private.require_capability(
    p_organization_id,
    'users.manage'
  );
  PERFORM finance_private.require_recent_auth();
  PERFORM finance_private.validate_request_id(p_request_id);

  IF NOT EXISTS (
    SELECT 1
    FROM finance.roles r
    WHERE r.organization_id = p_organization_id
      AND r.id = p_role_id
      AND NOT r.is_system
      AND r.template_key IS NULL
  ) THEN
    RAISE EXCEPTION 'custom role not found' USING ERRCODE = '22023';
  END IF;

  IF v_name IS NULL OR v_name = '' OR char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'invalid role name' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM finance.roles r
    WHERE r.organization_id = p_organization_id
      AND r.id <> p_role_id
      AND lower(r.name) = lower(v_name)
  ) THEN
    RAISE EXCEPTION 'role name already exists' USING ERRCODE = '23505';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT code ORDER BY code), ARRAY[]::text[])
  INTO v_codes
  FROM unnest(COALESCE(p_permission_codes, ARRAY[]::text[])) AS code;

  PERFORM finance_private.assert_permission_codes_grantable(
    p_organization_id,
    v_actor_member_id,
    v_codes
  );

  UPDATE finance.roles
  SET name = v_name
  WHERE organization_id = p_organization_id
    AND id = p_role_id;

  DELETE FROM finance.role_permissions
  WHERE organization_id = p_organization_id
    AND role_id = p_role_id;

  INSERT INTO finance.role_permissions (
    organization_id, role_id, permission_id
  )
  SELECT p_organization_id, p_role_id, p.id
  FROM finance.permissions p
  WHERE p.code = ANY(v_codes);

  PERFORM finance_private.write_role_audit(
    p_organization_id,
    v_actor_member_id,
    'role.custom.update',
    'role',
    p_role_id,
    p_request_id,
    jsonb_build_object(
      'name', v_name,
      'permission_codes', to_jsonb(v_codes)
    )
  );
END
$$;

CREATE FUNCTION public.set_member_roles(
  p_organization_id uuid,
  p_member_id uuid,
  p_role_ids uuid[],
  p_request_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_member_id uuid;
  v_role_ids uuid[];
BEGIN
  PERFORM finance_private.lock_role_admin(p_organization_id);
  v_actor_member_id := finance_private.require_capability(
    p_organization_id,
    'users.manage'
  );
  PERFORM finance_private.require_recent_auth();
  PERFORM finance_private.validate_request_id(p_request_id);

  IF p_member_id = v_actor_member_id THEN
    RAISE EXCEPTION 'self role changes are not allowed'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM finance.organization_members m
    WHERE m.organization_id = p_organization_id
      AND m.id = p_member_id
      AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'active member not found' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT role_id ORDER BY role_id), ARRAY[]::uuid[])
  INTO v_role_ids
  FROM unnest(COALESCE(p_role_ids, ARRAY[]::uuid[])) AS role_id;

  IF (
    SELECT count(*)
    FROM finance.roles r
    WHERE r.organization_id = p_organization_id
      AND r.id = ANY(v_role_ids)
  ) <> cardinality(v_role_ids) THEN
    RAISE EXCEPTION 'unknown role id' USING ERRCODE = '22023';
  END IF;

  PERFORM finance_private.assert_roles_grantable(
    p_organization_id,
    v_actor_member_id,
    v_role_ids
  );

  IF finance_private.is_active_owner(p_organization_id, p_member_id)
     AND NOT EXISTS (
       SELECT 1
       FROM finance.roles r
       WHERE r.organization_id = p_organization_id
         AND r.id = ANY(v_role_ids)
         AND r.is_system
         AND r.template_key = 'owner'
     )
     AND NOT finance_private.is_active_owner(
       p_organization_id,
       v_actor_member_id
     ) THEN
    RAISE EXCEPTION 'only an active owner may remove Owner'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM finance.member_roles mr
  WHERE mr.organization_id = p_organization_id
    AND mr.member_id = p_member_id
    AND NOT (mr.role_id = ANY(v_role_ids));

  INSERT INTO finance.member_roles (
    organization_id, member_id, role_id
  )
  SELECT p_organization_id, p_member_id, role_id
  FROM unnest(v_role_ids) AS role_id
  ON CONFLICT (organization_id, member_id, role_id) DO NOTHING;

  PERFORM finance_private.write_role_audit(
    p_organization_id,
    v_actor_member_id,
    'member.roles.set',
    'organization_member',
    p_member_id,
    p_request_id,
    jsonb_build_object('role_ids', to_jsonb(v_role_ids))
  );
END
$$;

CREATE FUNCTION public.deactivate_member(
  p_organization_id uuid,
  p_member_id uuid,
  p_request_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_member_id uuid;
BEGIN
  PERFORM finance_private.lock_role_admin(p_organization_id);
  v_actor_member_id := finance_private.require_capability(
    p_organization_id,
    'users.manage'
  );
  PERFORM finance_private.require_recent_auth();
  PERFORM finance_private.validate_request_id(p_request_id);

  IF p_member_id = v_actor_member_id THEN
    RAISE EXCEPTION 'self deactivation is not allowed'
      USING ERRCODE = '42501';
  END IF;

  IF finance_private.is_active_owner(p_organization_id, p_member_id)
     AND NOT finance_private.is_active_owner(
       p_organization_id,
       v_actor_member_id
     ) THEN
    RAISE EXCEPTION 'only an active owner may deactivate an Owner'
      USING ERRCODE = '42501';
  END IF;

  UPDATE finance.organization_members
  SET status = 'inactive'
  WHERE organization_id = p_organization_id
    AND id = p_member_id
    AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active member not found' USING ERRCODE = '22023';
  END IF;

  PERFORM finance_private.write_role_audit(
    p_organization_id,
    v_actor_member_id,
    'member.deactivate',
    'organization_member',
    p_member_id,
    p_request_id,
    '{}'::jsonb
  );
END
$$;

CREATE FUNCTION public.transfer_ownership(
  p_organization_id uuid,
  p_target_member_id uuid,
  p_request_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_member_id uuid;
  v_owner_role_id uuid;
BEGIN
  PERFORM finance_private.lock_role_admin(p_organization_id);
  v_actor_member_id := finance_private.require_capability(
    p_organization_id,
    'users.manage'
  );
  PERFORM finance_private.require_recent_auth();
  PERFORM finance_private.validate_request_id(p_request_id);

  IF NOT finance_private.is_active_owner(
    p_organization_id,
    v_actor_member_id
  ) THEN
    RAISE EXCEPTION 'only an active owner may transfer ownership'
      USING ERRCODE = '42501';
  END IF;

  IF p_target_member_id = v_actor_member_id THEN
    RAISE EXCEPTION 'target must be another active member'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM finance.organization_members m
    WHERE m.organization_id = p_organization_id
      AND m.id = p_target_member_id
      AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'active target member not found'
      USING ERRCODE = '22023';
  END IF;

  SELECT r.id
  INTO v_owner_role_id
  FROM finance.roles r
  WHERE r.organization_id = p_organization_id
    AND r.is_system
    AND r.template_key = 'owner';

  IF v_owner_role_id IS NULL THEN
    RAISE EXCEPTION 'Owner role missing' USING ERRCODE = '23514';
  END IF;

  INSERT INTO finance.member_roles (
    organization_id, member_id, role_id
  )
  VALUES (
    p_organization_id, p_target_member_id, v_owner_role_id
  )
  ON CONFLICT (organization_id, member_id, role_id) DO NOTHING;

  DELETE FROM finance.member_roles
  WHERE organization_id = p_organization_id
    AND member_id = v_actor_member_id
    AND role_id = v_owner_role_id;

  PERFORM finance_private.write_role_audit(
    p_organization_id,
    v_actor_member_id,
    'ownership.transfer',
    'organization_member',
    p_target_member_id,
    p_request_id,
    jsonb_build_object('from_member_id', v_actor_member_id)
  );
END
$$;

REVOKE ALL ON FUNCTION public.list_permissions_for_role_management(uuid)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_roles_for_management(uuid)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_members_for_management(uuid)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_custom_role(uuid,text,text[],text)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_custom_role(uuid,uuid,text,text[],text)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_member_roles(uuid,uuid,uuid[],text)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.deactivate_member(uuid,uuid,text)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transfer_ownership(uuid,uuid,text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_permissions_for_role_management(uuid)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_roles_for_management(uuid)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_members_for_management(uuid)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_custom_role(uuid,text,text[],text)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_custom_role(uuid,uuid,text,text[],text)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_roles(uuid,uuid,uuid[],text)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_member(uuid,uuid,text)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_ownership(uuid,uuid,text)
TO authenticated;

COMMENT ON FUNCTION public.set_member_roles(uuid,uuid,uuid[],text)
IS 'US-009 role assignment. Actor comes from auth.uid(); self-escalation and grants beyond actor authority are denied; owner floor is protected.';
COMMENT ON FUNCTION public.deactivate_member(uuid,uuid,text)
IS 'US-009 membership deactivation with live users.manage, recent-auth and last-active-owner protection.';
COMMENT ON FUNCTION public.transfer_ownership(uuid,uuid,text)
IS 'US-009 atomic ownership transfer under the organization role-admin lock.';

COMMIT;
