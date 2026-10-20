# Signup, verification and invoice email regression checks

Related scope: US-006 (#20), US-069 (#45), US-071 (#88). This is a bounded defect repair, not completion of those broader acceptance gates.

## Findings and changes

Actual Edge testing against the deployed `1a4985f83a6b2bdc2183783318b26a797603e597` source found:

1. Production had no SMTP configuration. With the user's explicit authorization, the existing DukanPOS SMTP account was verified and connected through Vercel Production Secrets. No credential or real recipient address is committed.
2. `AUTH_REQUIRE_EMAIL_VERIFICATION=false` remained from an earlier smoke-test window. A newly registered, unverified identity could sign in. Production was restored to `true`, rebuilt, and the unverified login was then denied. These settings repairs do not require application source changes.
3. Signup's server redirect discarded the display name and email after a password-policy error. Signup and resend now use action state with controlled non-secret fields and pending buttons. Passwords are not returned in action state. Invalid verification links now have a specific recovery link. This follows the [Next.js form/action-state guidance](https://nextjs.org/docs/app/guides/forms).
4. Missing deployment-wide email configuration still returned a misleading check-inbox flow. Signup and resend now return a generic unavailable state before identity access, and production invoice sends fail with a safe 503 before recording an undeliverable request. Existing/absent accounts and per-account delivery failures retain indistinguishable public results.
5. Token issuance lacked a resend cooldown. An advisory transaction lock now serializes issuance per account/purpose across app instances and permits one new token per 60 seconds. A throttled request preserves the existing usable link. Recovery and verification have separate limits.
6. The invoice worker failed with PostgreSQL `42702` before claiming its queued event. The bare `ON CONFLICT(organization_id,...,recipient)` list collided with output variables in `claim_outbox_batch`. Forward migration `0100_disambiguate_outbox_claim_conflict.sql` resolves the existing unique constraint by metadata and uses `ON CONFLICT ON CONSTRAINT`, an explicitly supported [PostgreSQL conflict target](https://www.postgresql.org/docs/17/sql-insert.html). It replaces one guarded clause, preserves the existing function ACL and performs no financial DML.

The SMTP transport uses the existing account and verified sender configuration, with bounded connection/greeting/socket timeouts in its private URL. Identity transports close after delivery. [Nodemailer's SMTP documentation](https://nodemailer.com/smtp) describes these options.

## Actual Edge/provider results

- Live signup using a dedicated alias of the user's authorized Gmail inbox created an unverified identity and delivered a real verification email.
- After restoring the production verification requirement, the correct password was denied before verification.
- Resend delivered a replacement message. The superseded link failed, the replacement verified the identity, and replay failed. A read-only database observation confirmed two issued tokens, both consumed/superseded, and a verified identity.
- The verified identity signed in and had no company memberships. No membership or verification flag was seeded for this hosted signup test.
- The repaired local production build preserves display name/email after invalid-password submission and clears the password. Missing SMTP produces an unavailable state for signup and resend while retaining those fields. Invalid verification links show recovery guidance.
- A separate synthetic owner created and posted `INV-FY 2026-000002`, BDT 10.00, in the existing E2E company, with its issued recipient set to the authorized test inbox. This is a synthetic test entry, not a real charge or payment. Its PDF downloaded normally and the UI recorded one email request.
- **Pending production gate:** the production worker returns `worker_failed` while the event remains queued with zero attempts. Real invoice attachment delivery cannot pass until migration 0100 is separately authorized and applied. No invoice email has yet been marked sent or claimed delivered.

The currently verified settings deployment is `dpl_DwpzSYGScu9SrJnaj3c8dnYDTsdN`, same merged source `1a4985f`, on the canonical production domain. The form/cooldown changes in this repair branch have not yet been merged or deployed.

## Database and object backup

Before requesting production migration authorization, created `backup-email-worker-20261020`, ID `br-broad-moon-b41pu7yf`, from production with data and schema and auto-delete **Never**. Read-only verification confirms it matches production at migration 0099 (98 migration files), including fingerprints of business documents, journals, lines, open items, allocations and PDF versions. Both registered PDF objects were independently downloaded and copied to private local backup files with matching recorded SHA-256 and byte counts. No general recovery/restore certification is claimed.

Migration 0100 has been applied only to the isolated `e2e-local-20261020` branch. It reports 99 migration files. Production remains at 0099 pending explicit authorization under AGENTS.md. Rollout is compatible with the existing deployed worker. If a further defect appears, correct through another forward migration; do not restore older books over newer transactions.

## Exact validation

All commands below passed on this repair's source. The database commands require `AMS_DATABASE_TESTS=isolated` and `AMS_TEST_DATABASE_HOST` equal to the explicitly selected non-production Neon endpoint. The guards refuse the production host.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
node output/playwright/2026-10-20-email-e2e/migrate-isolated.mjs
npm run test:database:identity-verification
node --conditions=react-server --test tests/database/outbox-claim.test.mjs
git diff --check
```

- Application tests: **330/330**. New tests cover configuration gating before identity access, normalized signup, password non-disclosure and enumeration-safe signup/resend outcomes.
- Identity database tests: **4/4**, including cooldown preservation, one-use/replay, expiration, separate purposes, and four independent app processes producing exactly one verification link.
- Outbox database tests: **4/4** after migration 0100. Ordinary app access to claims is denied; restricted worker claim/scoped PDF metadata succeeds; wrong/completed leases are denied; completion is rolled back. The test sends no email, and financial fingerprints remain identical.
- The corresponding worker test failed with 42702 before migration 0100. A production diagnostic using the existing restricted worker credential reproduced that same ambiguity inside a rolled-back transaction.
- Production worker failure observation separately verifies that communication attempts did not change the six observed financial tables or issued PDF metadata.

Sanitized, committed evidence is in [evidence/email-e2e-2026-10-20/](evidence/email-e2e-2026-10-20/). Real-recipient messages, PDFs, raw mailbox state, live tokens and credentials are excluded. Additional private operational evidence is retained under `output/playwright/2026-10-20-email-e2e/`.

This work does not certify full abuse prevention across IPs/accounts, all provider retry/crash cases, scheduled worker invocation, DMARC/SPF/DKIM policy, all business/security acceptance cases, performance, a complete accessibility audit, visual regression baselines or independent accountant review. The pending production migration/deployment and final invoice-inbox check remain explicit gates.
