BEGIN;

CREATE FUNCTION public.get_own_profile()
RETURNS TABLE (
  display_name text,
  locale text,
  timezone text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.display_name, p.locale, p.timezone
  FROM finance.profiles p
  WHERE p.user_id = auth.uid()
$$;

CREATE FUNCTION public.update_own_profile(
  p_display_name text,
  p_locale text,
  p_timezone text
)
RETURNS TABLE (
  display_name text,
  locale text,
  timezone text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF p_display_name IS NULL OR btrim(p_display_name) = '' OR char_length(p_display_name) > 120 THEN
    RAISE EXCEPTION 'invalid display name' USING ERRCODE = '22023';
  END IF;

  IF p_locale NOT IN ('en-BD', 'bn-BD') THEN
    RAISE EXCEPTION 'invalid locale' USING ERRCODE = '22023';
  END IF;

  IF p_timezone NOT IN ('Asia/Dhaka', 'UTC') THEN
    RAISE EXCEPTION 'invalid timezone' USING ERRCODE = '22023';
  END IF;

  INSERT INTO finance.profiles (user_id, display_name, locale, timezone)
  VALUES (v_user_id, btrim(p_display_name), p_locale, p_timezone)
  ON CONFLICT (user_id) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      locale = EXCLUDED.locale,
      timezone = EXCLUDED.timezone;

  RETURN QUERY
  SELECT p.display_name, p.locale, p.timezone
  FROM finance.profiles p
  WHERE p.user_id = v_user_id;
END
$$;

CREATE FUNCTION public.resolve_active_membership(p_organization_id uuid)
RETURNS TABLE (
  member_id uuid,
  organization_id uuid,
  capabilities text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    m.id,
    m.organization_id,
    COALESCE(
      array_agg(DISTINCT p.code ORDER BY p.code)
        FILTER (WHERE p.code IS NOT NULL),
      ARRAY[]::text[]
    )
  FROM finance.organization_members m
  LEFT JOIN finance.member_roles mr
    ON mr.organization_id = m.organization_id
   AND mr.member_id = m.id
  LEFT JOIN finance.role_permissions rp
    ON rp.organization_id = mr.organization_id
   AND rp.role_id = mr.role_id
  LEFT JOIN finance.permissions p
    ON p.id = rp.permission_id
  WHERE auth.uid() IS NOT NULL
    AND m.user_id = auth.uid()
    AND m.organization_id = p_organization_id
    AND m.status = 'active'
  GROUP BY m.id, m.organization_id
$$;

REVOKE ALL ON FUNCTION public.get_own_profile() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_own_profile(text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_active_membership(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_own_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_own_profile(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_active_membership(uuid) TO authenticated;

COMMENT ON FUNCTION public.update_own_profile(text,text,text)
IS 'US-006 own-profile mutation. Actor is auth.uid(); no user or role authority is accepted from input.';

COMMENT ON FUNCTION public.resolve_active_membership(uuid)
IS 'US-006 live membership/capability lookup for the verified auth.uid() only.';

COMMIT;
