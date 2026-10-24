# Production release receipts

Release authorization and results: [full report](../../production-country-currency-2026-10-24.md).

| Receipt | Actual result |
|---|---|
| `backup-verified.json` | Retained provider branch matches 69 tables / 99 original migration receipts; two independent encrypted PDF backups match size/digest and decrypt correctly. |
| `rehearsal-upgrade.json`, `production-upgrade.json` | All 23 required migrations pass; 122 receipts through 0123; original 68 non-migration tables preserved; restricted/anonymous locale checks and no broad financial DML. |
| `merges.json` | Seven dependency merges #182–#188 preserve the tested combined tree. PR #189 then merges its five-file display-only correction. |
| `deployments.json` | Initial and final production builds READY, exact commits recorded; final canonical alias verified. |
| `final-database-verification.json` | Backup remains unchanged after setup; original financial facts, ledger and file metadata retained; actual US/USD and DE/EUR settings persist. |
| `post-smoke-database.json` | Eight original financial table fingerprints still match after the formatter tests; zero test documents/journals; schema remains 122 receipts. |
| `format-unit.log`, `format-typecheck.log`, `format-lint.log`, `format-build.log` | Actual local checks on formatter implementation `b6dc923`: 351/351 tests, no skips; TypeScript, zero-warning lint and optimized webpack build pass. |
| `browser-checks.json`, selected `*.txt` | Actual canonical-production Edge setup, restoration, currency/default-date views and corrected exact draft amounts. Unsaved inputs were discarded through normal navigation; nothing posted. |
| `observability.json` | No returned error/fatal groups in the recorded short provider windows; zero captured browser-console entries. |

`final-usd-setup.png` is the visually checked live production activation view after bringing Edge forward. `books-step.png` shows the books-start-date step, not the review step. Earlier background screenshots lagged DOM changes and one full-page capture timed out; those images are not used to establish corrected totals. The text receipts and ordinary database reads establish those assertions separately.

Exact application commands:

```text
npm test
npm run typecheck
npm run lint
node --env-file=<private-isolated-profile> scripts/run-next.mjs build apps/web --webpack
```

[CI for the same implementation](https://github.com/wdmahbubur/accounts-management-solution/actions/runs/40063025829) also passes application/static/build checks; GitGuardian and the preview build pass before PR #189 merges. The deployed `cb97b195ca32942f346c0c446e8e7e8407fbd646` tree equals that implementation tree. No new financial or schema calculation change is included in #189.

Provider backup, upgrade and verification commands are listed in the full report. Private manifests, original customer state, storage object keys/bytes, operational profiles and backup encryption keys remain excluded. Only synthetic-company UI evidence is published; the existing BDT company's raw financial view remains private. The production browser checks are scoped smoke tests and are not a rerun of the entire isolated accounting/concurrency suite or a worldwide compliance certification.
