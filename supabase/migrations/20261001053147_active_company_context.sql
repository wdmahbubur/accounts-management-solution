BEGIN;

CREATE FUNCTION public.list_active_memberships()
RETURNS TABLE (
  member_id uuid,
  organization_id uuid,
  organization_name text,
  legal_name text,
  organization_status text,
  role_names text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    m.id,
    o.id,
    o.name,
    o.legal_name,
    o.status,
    COALESCE(
      array_agg(DISTINCT r.name ORDER BY r.name)
        FILTER (WHERE r.name IS NOT NULL),
      ARRAY[]::text[]
    )
  FROM finance.organization_members m
  JOIN finance.organizations o
    ON o.id = m.organization_id
  LEFT JOIN finance.member_roles mr
    ON mr.organization_id = m.organization_id
   AND mr.member_id = m.id
  LEFT JOIN finance.roles r
    ON r.organization_id = mr.organization_id
   AND r.id = mr.role_id
  WHERE auth.uid() IS NOT NULL
    AND m.user_id = auth.uid()
    AND m.status = 'active'
  GROUP BY m.id, o.id, o.name, o.legal_name, o.status
  ORDER BY lower(o.name), o.id
$$;

REVOKE ALL ON FUNCTION public.list_active_memberships()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_active_memberships()
TO authenticated;

COMMENT ON FUNCTION public.list_active_memberships()
IS 'US-008 active company list for the verified auth.uid(). Inactive memberships are excluded; browser company context is not authority.';

COMMIT;
