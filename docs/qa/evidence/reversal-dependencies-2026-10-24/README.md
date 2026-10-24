# Reversal dependency execution receipts

Candidate `666c69588a248cb5bffa42d902302c1a75fad3ed`. See the [full report](../../reversal-dependencies-2026-10-24.md) for scope, versions and limitations. Only synthetic UI records are published. Private profiles, credentials, backup keys, original production data and object bytes are excluded.

Final commands (source/fresh private profiles select distinct isolated databases):

```text
node --env-file=<source-profile> --conditions=react-server --test --test-reporter=tap tests/database/reversal-dependencies.test.mjs
node --env-file=<fresh-profile> --conditions=react-server --test --test-reporter=tap tests/database/reversal-dependencies.test.mjs
npm test
npm run lint
npm run typecheck
node --env-file=<source-profile> scripts/run-next.mjs build apps/web --webpack
```

Both final database commands pass **10/10**, application **352/352**, and static/build checks pass. `fresh-install.log` contains the actual empty-target 123-file installation through 0124. `upgrade-0124.log` upgrades the existing isolated database. `*-0125.json` records the subsequent guarded routine repair, all prior receipt validation and unchanged financial fingerprints. `apply-pending.mjs.txt` is the exact isolated-only operator command; it is not an authorized production script.

Earlier broad commands after 0124 / implementation `98ccb9d445f6bac4fc0f3a657dd343b722cb5021`:

```text
node --env-file=<source-profile> --conditions=react-server --test --test-concurrency=2 tests/database/golden-books.test.mjs tests/database/accounting-guards.test.mjs tests/database/approval-controls.test.mjs tests/database/period-year-controls.test.mjs tests/database/cutover-classification.test.mjs tests/database/concurrency-acceptance.test.mjs tests/database/bank-capacity-race.test.mjs tests/database/reversal-tenant-controls.test.mjs tests/database/refund-safety.test.mjs tests/database/transaction-recovery.test.mjs
node --env-file=<source-profile> --conditions=react-server --test --test-concurrency=2 tests/database/advance-refund-settlement.test.mjs tests/database/opening-advance-settlement.test.mjs tests/database/refund-safety.test.mjs
AMS_TEST_APP_URL=http://localhost:3001 node --env-file=<source-profile> --conditions=react-server --test --test-reporter=tap tests/database/http-security.test.mjs
node --env-file=<source-profile> --conditions=react-server --test --test-concurrency=2 tests/database/invitation-security.test.mjs tests/database/identity-verification.test.mjs tests/database/login-rate-limit.test.mjs tests/database/company-currency.test.mjs tests/database/dashboard-liquidity.test.mjs
node --env-file=<source-profile> --conditions=react-server --test --test-concurrency=2 tests/database/export-acceptance.test.mjs tests/database/issued-snapshot.test.mjs tests/database/recovery-files.test.mjs tests/database/worker-recovery.test.mjs tests/database/cash-flow-finalization.test.mjs
```

These are respectively **54/54**, **7/7**, **13/13**, **27/27**, and **15 passed / 1 failed**. The final combined command is deliberately named `files-workers-incomplete-restore.log`: its old recovered-file manifest did not identify a synthetic owner in this selected source database, so it stopped before the destructive file scenarios. No restore pass is claimed. Other tests in that command passed, including real lease expiry after killing a worker during loopback SMTP delivery. Shell environment assignment is shown in portable form; PowerShell used `$env:AMS_TEST_APP_URL='http://localhost:3001'` before the command.

`edge-*.txt` contains observed Edge states: active-match denial, 0-active/2-reversed match history, receipt/invoice/supplier reversals and earlier-date denial. The child-date receipt predates the final wording generalization from “credits” to “documents”; the guard is unchanged. `browser-verification.json` and its exact read-only script independently tie those UI commands to restricted-role ledger/subledger results. `edge-reversal.png` was brought forward and visually inspected; it shows the final supplier reversal and neutral issued-contact heading. Desktop Edge/dev checks do not establish mobile, cross-browser, optimized-local-server or load acceptance.

The source profile's real ClamAV test and dependency audit found separate delivery issues and are not presented as successful checks here. Their investigation/fixes belong to subsequent focused work. No production migration/deployment, external recipient email, paid billing, support elevation, independent review or worldwide compliance claim is included.
