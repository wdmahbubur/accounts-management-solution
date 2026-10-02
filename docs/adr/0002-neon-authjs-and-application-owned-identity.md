# ADR 0002: Neon PostgreSQL and Auth.js identity

- **Status:** Accepted by product owner on 3 October 2026
- **Decision owners:** Product owner
- **Supersedes:** Provider-specific implementation choices in the initial V1 handoff where they require Supabase Auth, PostgREST RPC, or Supabase Storage.

## Context

The V1 application is a Bangladesh-focused, BDT-only accrual accounting SaaS for service and non-stock SMEs. The product owner has selected Neon PostgreSQL for application data and Auth.js (NextAuth) for web authentication, and has instructed that Supabase must be removed. The existing implementation does not meet that requirement: SQL migrations depend on `auth.uid()`, `auth.users`, PostgREST roles, and Supabase Storage; application routes depend on Supabase Auth, RPC and object-storage clients.

The accounting contract remains unchanged. Company separation, live membership and capability checks, exact decimal money, append-only posted facts, atomic posting, period locks, idempotency and audit requirements remain mandatory.

## Decisions

1. **Database:** Neon PostgreSQL is the sole application database. Schema changes will use ordered, checksum-tracked SQL migrations under `database/migrations/`, applied by a Node migration runner using a dedicated migration connection. The application connection must not own the schema or have migration privileges.
2. **Authentication:** Auth.js Credentials is the initial sign-in method to preserve the existing email/password user flow. Identity records and password hashes are application-owned rows in PostgreSQL, with UUID primary keys so company memberships retain a stable identity. Passwords use Argon2id. Verification, recovery and revocation tokens are random, single-use, stored only as hashes, and expire.
3. **Sessions:** Auth.js issues secure, HTTP-only, same-site cookies. A server-owned session record/version is checked during authenticated requests so user disablement and session revocation take effect promptly. Role, membership, company and capability data are never accepted from session claims as authorization authority.
4. **Database authorization:** All database access is server-only, parameterized and transaction-scoped. A verified Auth.js user ID is set as a transaction-local database context; PostgreSQL row-level policies and command routines use that context plus live membership/capability rows. Every privileged financial command rechecks actor and tenant inside its transaction. Application roles receive only the grants needed by those routines; no client-side or service-role bypass is allowed.
5. **File bytes:** Neon stores metadata only. Private evidence bytes use a private S3-compatible object-store adapter with server-side permission checks and short-lived authorized delivery. Local development uses a private local adapter. Provider, retention and recovery behavior must be documented before production activation.
6. **Migration from the old provider:** No Supabase Auth user IDs, Storage objects, or financial rows are assumed to exist in Neon. A later data transfer must preserve UUID identity links, verify row counts and financial control totals, and be separately rehearsed. Fresh schema migration and existing-data transfer are distinct operations.
7. **Source documents:** The original v1.0 source documents remain preserved. This ADR and implementation-specific docs supersede the initial provider/tooling choices; they do not alter accounting policy.

## Migration sequence

1. Add the application identity/session schema and a plain-Neon migration runner.
2. Port and replay the full schema on a disposable PostgreSQL database. Replace provider-specific identity, role and storage dependencies while preserving tenant keys and financial invariants.
3. Port Auth.js, server authorization context, typed database repositories, invitation/profile/period workflows and private artifact access.
4. Port remaining approved V1 stories in dependency order. Remove Supabase packages, CLI, configuration, environment variables, SQL, tests and operational references only after replacement behavior exists.
5. Verify fresh install, upgrades, authorization, concurrency, accounting acceptance, private-file access, backup and restore. Only then run an explicitly scheduled migration of existing data to Neon.

## Consequences and gates

- Neon credentials are server-only and must not be committed, logged, exposed to the browser, or used as migration/runtime credentials interchangeably.
- The previously shared Neon URL is configured only in the ignored local `.env.local` at the product owner's direction. Its schema was inspected read-only and is currently empty. Production migration will use additive, transactional migrations after they are complete; data transfer will have separate reconciliation and rollback evidence.
- The product owner has authorized implementation against the approved accounting baseline. The documented pre-production accountant recommendation, tax/legal claims, retention approval, production deployment and release gates remain recorded separately; this ADR does not claim those actions occurred.
- Until the full port is complete, the current Supabase-backed application remains a transitional checkout and must not be represented as the finished Neon application.

## References

- Auth.js installation and credentials guidance: <https://authjs.dev/getting-started/installation?framework=Next.js>, <https://authjs.dev/getting-started/authentication/credentials>
- Auth.js Neon adapter guidance: <https://authjs.dev/getting-started/adapters/neon>
- Neon PostgreSQL driver: <https://neon.com/docs/serverless/serverless-driver>
