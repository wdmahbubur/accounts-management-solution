# SaaS adapter evidence

Parent: PR #186 / `28aef3c`. Tests use isolated Neon PostgreSQL 18, restricted application/worker roles, synthetic accounts and the local development server. Paid billing stays disabled. No credentials or private object bytes are included.

- `saas-database.log`: real member usage, no paid/financial state, ordinary-role and foreign-company denial.
- `saas-http-final.log`: actual Auth.js sessions, concurrent Owner/Billing/nonmember reads, disabled checkout/webhook behavior and live revocation.
- `saas-unit-final.log`, `saas-lint-final.log`, `saas-typecheck-final.log`, `saas-build-final.log`: application/static/build receipts.
- `migration-0120.log`: canonical checksums verified, 119 files through 0120; only an isolated read function added.
- [Edge subscription view](saas-edge.txt) and [screenshot](saas-edge.png): billing disabled, four actual members, paid plan not configured. This desktop status view reuses the existing shell; no screen-reader, automated axe or visual-baseline certification is claimed.

See the [adapter operations contract](../../../operations/saas-billing-adapter.md) for the approvals, server catalog, atomic entitlements, provider verification and sandbox tests required before paid activation. The present disabled tests do not stand in for those tests.
