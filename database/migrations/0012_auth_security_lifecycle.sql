ALTER TABLE identity.auth_sessions
  ADD COLUMN recent_auth_at timestamptz;

ALTER TABLE identity.verification_tokens
  DROP CONSTRAINT verification_tokens_purpose_check;
ALTER TABLE identity.verification_tokens
  ADD CONSTRAINT verification_tokens_purpose_check
  CHECK (purpose IN ('verify_email', 'reset_password', 'reauthenticate'));

CREATE TABLE identity.auth_rate_limits (
  email_hash bytea PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 1000),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_rate_limit_hash_length CHECK (octet_length(email_hash) = 32),
  CONSTRAINT auth_rate_limit_block_order CHECK (blocked_until IS NULL OR blocked_until > window_started_at)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON identity.auth_rate_limits TO ams_runtime;
