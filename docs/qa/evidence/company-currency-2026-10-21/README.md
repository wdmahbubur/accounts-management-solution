# Country/currency evidence

Parent: PR #187 / `5c1ebbd`. Synthetic isolated Neon PostgreSQL 18 and private S3 storage; actual restricted roles. Production remains unchanged.

Receipts are copied here only after the corresponding command completes successfully. Private env profiles, database manifests, encryption keys and object bytes remain under ignored `output/launch/2026-10-21/`.

Exact commands (load the private isolated profile explicitly):

```text
npm run lint
npm run typecheck
npm test
node --env-file=<private-profile> scripts/run-next.mjs build apps/web --webpack
node --env-file=<private-profile> scripts/db-migrate.mjs
node --env-file=<private-profile> --conditions=react-server --test tests/database/company-currency.test.mjs
node --env-file=<private-fresh-profile> --conditions=react-server --test tests/database/company-currency-install.test.mjs
AMS_TEST_APP_URL=http://localhost:3001
node --env-file=<private-profile> --conditions=react-server --test tests/database/http-security.test.mjs
node --env-file=<private-profile> --conditions=react-server --test --test-concurrency=2 tests/database/golden-books.test.mjs tests/database/accounting-guards.test.mjs tests/database/approval-controls.test.mjs tests/database/period-year-controls.test.mjs tests/database/cutover-classification.test.mjs tests/database/concurrency-acceptance.test.mjs tests/database/bank-capacity-race.test.mjs tests/database/reversal-tenant-controls.test.mjs tests/database/refund-safety.test.mjs tests/database/transaction-recovery.test.mjs
```

Completed receipts: 351 application tests, five currency/database groups, one fresh-install USD smoke, 54 existing accounting/security tests and 11 Auth.js HTTP tests; no skips. Lint, TypeScript and optimized build pass. The fresh target has 122 canonical migration receipts through 0123. `routine-changes.diff` isolates the affected existing routine changes from the full forward migration for review.

Recovery uses the existing `scripts/recovery-database.mjs capture|verify` tool, a provider-created historical branch and independent encrypted object backups. Public receipts record counts/outcomes; credentials and file contents are not published. Recovery through 0120 precedes the currency changes; do not describe those later records as restored. `recovery-upgrade.log` verifies the recovered books can upgrade through 0123 without changing their historical facts.

Edge screenshots and DOM observations show actual local development-server behavior, not a production deployment or worldwide tax/currency certification. `usd-active.png` shows activation with USD; `usd-dashboard.txt` retains the observed currency labels. The catalog names/order fix addresses an observed hydration mismatch.
