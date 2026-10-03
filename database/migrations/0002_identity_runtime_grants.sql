-- The web runtime can only access identity data needed for password auth and
-- session/token lifecycle. Financial schemas are granted by their own ported
-- command migrations, never by this baseline.
GRANT USAGE ON SCHEMA identity TO ams_runtime;
GRANT SELECT, INSERT, UPDATE ON identity.users TO ams_runtime;
GRANT SELECT, INSERT, UPDATE ON identity.verification_tokens TO ams_runtime;
GRANT SELECT, INSERT, UPDATE ON identity.auth_sessions TO ams_runtime;
