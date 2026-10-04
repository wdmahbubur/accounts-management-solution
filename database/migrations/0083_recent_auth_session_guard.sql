-- Auth.js owns identity.auth_sessions; the Supabase-style users.last_sign_in_at
-- column referenced by migration 0008 does not exist in this identity schema.
-- Use the recorded active-session authentication timestamp instead. Sign-in and
-- reauthentication already set/update auth_sessions.recent_auth_at.
CREATE OR REPLACE FUNCTION finance_private.require_recent_auth()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := identity.current_actor_id();
  v_last_sign_in_at timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT max(s.recent_auth_at)
  INTO v_last_sign_in_at
  FROM identity.auth_sessions s
  WHERE s.user_id = v_user_id
    AND s.revoked_at IS NULL
    AND s.expires_at > now();

  IF v_last_sign_in_at IS NULL
     OR v_last_sign_in_at < now() - interval '24 hours'
     OR v_last_sign_in_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'recent authentication required' USING ERRCODE = '42501';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION finance_private.require_recent_auth()
FROM PUBLIC, ams_runtime;

COMMENT ON FUNCTION finance_private.require_recent_auth()
IS 'Checks recent authentication from active Auth.js sessions in the application-owned identity schema.';
