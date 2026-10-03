-- Application-owned identity for Auth.js Credentials.
-- This migration is deliberately provider-neutral and contains no user/customer data.
CREATE SCHEMA IF NOT EXISTS identity;
REVOKE ALL ON SCHEMA identity FROM PUBLIC;

CREATE TABLE identity.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_normalized text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  password_hash text NOT NULL,
  email_verified_at timestamptz,
  disabled_at timestamptz,
  session_version bigint NOT NULL DEFAULT 0 CHECK (session_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_normalized CHECK (
    email_normalized = lower(btrim(email_normalized))
    AND length(email_normalized) BETWEEN 3 AND 254
    AND position('@' IN email_normalized) > 1
  ),
  CONSTRAINT users_password_hash_format CHECK (
    password_hash LIKE '$argon2id$%'
  )
);

CREATE UNIQUE INDEX users_email_normalized_uq
  ON identity.users (email_normalized);

CREATE TABLE identity.verification_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  token_hash bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT verification_token_hash_length CHECK (octet_length(token_hash) = 32),
  CONSTRAINT verification_token_expiry CHECK (expires_at > created_at),
  CONSTRAINT verification_token_consumed_after_issue CHECK (
    consumed_at IS NULL OR consumed_at >= created_at
  )
);

CREATE UNIQUE INDEX verification_tokens_hash_uq
  ON identity.verification_tokens (token_hash);
CREATE INDEX verification_tokens_user_purpose_idx
  ON identity.verification_tokens (user_id, purpose, expires_at DESC);

CREATE TABLE identity.auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  session_version bigint NOT NULL CHECK (session_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  user_agent_hash bytea,
  CONSTRAINT auth_session_expiry CHECK (expires_at > created_at),
  CONSTRAINT auth_session_revoked_after_issue CHECK (
    revoked_at IS NULL OR revoked_at >= created_at
  ),
  CONSTRAINT auth_session_user_agent_hash_length CHECK (
    user_agent_hash IS NULL OR octet_length(user_agent_hash) = 32
  )
);

CREATE INDEX auth_sessions_user_active_idx
  ON identity.auth_sessions (user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE identity.users IS
  'Application-owned Auth.js identity. Authorization never reads user-editable profile metadata.';
COMMENT ON TABLE identity.verification_tokens IS
  'Hashed, expiring, single-use email verification and password recovery tokens.';
COMMENT ON TABLE identity.auth_sessions IS
  'Server-owned session revocation and version registry for Auth.js sessions.';
