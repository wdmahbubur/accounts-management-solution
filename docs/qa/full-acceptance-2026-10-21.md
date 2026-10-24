# Accounting and security acceptance — 21 October 2026

Subsequent candidate: [advance applications and linked refunds](advance-refund-settlements-2026-10-21.md), PR #185, implements and verifies T-10/T-11/T-13 on the tested branch. The current matrix is **64 covered, 6 partial and 2 blocked**. The report below preserves the earlier PR #184 baseline and its execution boundaries; it is not a worldwide launch approval.

## Release decision

**Not ready for worldwide launch.** This is a measured V1 accounting/security test pass and gap register, not certification or a launch approval. The supported books remain BDT-only accrual accounting for Bangladesh service/non-stock SMEs. Worldwide access does not establish worldwide currency, tax, legal or regulatory support.

The recovery drill was performed first; see [database/file recovery evidence](database-file-recovery-2026-10-21.md). It restored a historical **isolated synthetic** database and independently backed-up PDF bytes. It does not prove automated production backup scheduling, retention or a combined production recovery objective.

Work is tracked by [US-085 #99](https://github.com/wdmahbubur/accounts-management-solution/issues/99). Accounting implementation/test tree: `517aacf317ae255e1fa970859b4b5be2b3b16d95`; final migration compatibility/dependency changes: `f90d5fd` on `feat/us-085-full-acceptance`, stacked on recovery PR #183 / cash-bank PR #182. No production migration or deployment, merge, real payment or external email was performed in this phase. All release gates remain open.

The 72-case matrix records **61 covered, 8 partial and 3 blocked** source cases. Partial and blocked cases are not passes. Runnable-test counts include grouped checks and parent tests and are **not** counts of source acceptance cases.

## Defects reproduced and repaired

| Defect | Resulting behavior | Change |
|---|---|---|
| Aging control bridge difference returned a JSON number | Exact decimal string at the report boundary | 0103 |
| Trial balance emitted zero-side `0` instead of `0.00` | HTTP trial balance no longer rejects valid report rows with 422 | 0104 |
| Posting swallowed the retryable transaction error | Existing bounded command retry receives the error; domain stale-version conflicts remain distinct | Posting service |
| Trial-balance CSV renderer received timestamp objects | Dates/cutoffs are projected as text, preserving PostgreSQL timestamp precision | Export worker |
| Shared cookie-authenticated financial routes accepted an untrusted origin | Configured-origin check precedes command execution; responses are private/no-store | Route adapter |
| Credit-free customer refund could post | Unlinked customer/supplier refund preview/post paths now fail closed; creation links are removed and the form explains unavailability | 0105 + UI |
| Tax-version replacement failed with ambiguous `row_version` | Effective-range update qualifies the existing table column, preserving issued snapshots | 0106 |

Refund blocking is a safety repair, **not implementation of eligible linked refunds**. The current movement draft has no explicit refundable source/control selection or atomic linked settlement workflow. No implicit FIFO selection or accounting policy was invented. The synthetic unsafe baseline remains in isolated test history; posted facts were not rewritten or deleted.

The four forward migrations replace existing functions only: no new tables, broad financial grants or posted-data rewrites. Migration 0102's invitation/revocation repair belongs to PR #183. Production remains through its previously authorized 0100.

The upgrade rehearsal also caught a compatibility problem in the first unreleased 0106 candidate: historical Windows function bodies retain CRLF, whereas current clean installs use LF. The final guard accepts either existing body format and preserves it. Both the historical recovered database and the new clean-install database then pass through 0106 (105 files). The earlier acceptance database retains its original candidate migration receipt; its history was not rewritten to bypass checksum checks.

## Dependency review

The initial production dependency audit reported two high and two moderate package findings. Next/ESLint configuration is updated from 16.3.7 to **16.4.2**; exact overrides select **source-map-js 1.2.2** and **uuid 11.1.1** for ExcelJS's compatible CommonJS `v4` use. Package manifests and lockfile are pinned and reinstall/retest evidence is retained. The [Next advisory](https://github.com/advisories/GHSA-cjq9-62q9-8jv4), [official upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16), [source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) and [uuid advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq) were checked before choosing versions.

After `npm ci`, the production audit reports **0 vulnerabilities**. The full audit reports **5 high development-only package findings** for the [unpatched braces stack-exhaustion advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), propagated through micromatch/fast-glob/Next's ESLint plugin. The registry has no patched braces release; lint consumes repository-controlled patterns here. This remains a recorded dependency-review risk, not a claim that every full-tree audit alert is cleared. No force downgrade to an incompatible Next lint configuration or unreviewed third-party fork was used.

The first GitHub job stopped before dependency installation because Node 24.22.0 now bundles npm 11.19.1, while this repository requires 11.19.0. CI now installs the exact pinned npm version before verifying it. Local validation used npm 11.19.0. This infrastructure fix does not relax the toolchain check.

## Execution environment and boundaries

- Actual Neon PostgreSQL 18.6, explicit isolated recovered host and separate fresh databases. No fallback to the original source or production database.
- The configured `ams_runtime` login is checked for real session identity, no superuser/bypass/create/replication powers, and no direct financial table/column DML. Earlier tests' obsolete `ams_app_login` name assumptions were repaired without granting permissions.
- Synthetic identities, memberships/roles, contacts, session timestamps, one void fixture and a formula-shaped company name are privileged fixtures. Setup/posting/approval/settlement/reversal/report commands run under the actual restricted login. Immutable financial fixtures are retained.
- Race tests use distinct PostgreSQL backend PIDs. Period-lock tests observe an actual blocked database contender in both commit orders. Serialization fault injection occurs **after** the posting RPC inside a real transaction; a genuine two-connection deadlock separately exercises the application retry path.
- A child process is killed after COMMIT before returning its posting receipt. Replaying its original key returns the existing journal and pending outbox.
- A real mail worker is killed during delivery to a **loopback SMTP fixture**. Its actual 120-second lease expires, a replacement delivers using the stable Message-ID, and the old token is denied. This does not promise exactly-once SMTP delivery or verify a production provider/scheduler.
- PDF/export tests use the real private Neon S3 bucket. Immutable PDF IDs/digests, exact CSV/XLSX snapshot values, formula escaping, missing/corrupt bytes and live access revocation are exercised. PDF visual layout/content extraction is not certified.
- HTTP security tests authenticate real passwords through Auth.js and retain real session cookies. Identity/tenant/capability/origin/revocation checks run against the locally started application, not mocked routes. They are not Edge UI tests.

Edge was rechecked and is absent from connected browser inventory. Chrome and the in-app browser were available; neither was substituted for the requested Edge session. The final browser golden scenario and company-switch/cache behavior remain unrun.

## Commands and evidence

Private target profiles and manifests are retained under ignored `output/recovery/2026-10-21/`. They contain credentials and must not be committed. Run the public commands only after explicitly loading an isolated profile. The private execution launcher merely supplies that profile; it invokes the exact package script. `node --env-file=... --run ...` did not forward the profile into its script on this Windows runtime and safely stopped at the isolation guards; the subsequent runs used the explicit child environment.

The repository's original `.env.local` was preserved and still points to the previous isolated source. It was not migrated in this phase. The final local server/export retest uses `final.private.env`, selecting the new clean database with the final 0106 receipt. Do not confuse the default local configuration with the explicitly tested candidate.

```text
node scripts/db-migrate.mjs                         clean installation and forward upgrades; isolated profiles only
npm run test:database:accounting                    actual accounting/authorization/concurrency/recovery commands
npm run test:database:exports                       actual private exports and issued snapshot preservation
npm run test:database:http-security                 local app required; AMS_TEST_APP_URL explicitly selected
npm run test:database:worker-recovery               real private storage; SMTP restricted to loopback
node --conditions=react-server --test tests/database/refund-safety.test.mjs tests/database/cash-posting-preview.mjs
                                                    16 cash groups + credit-free refund denial
npm run lint
npm run typecheck
npm test
npm run build -- --webpack
npm audit --omit=dev --json                        production dependency audit
npm audit --json                                   includes the retained dev-only lint advisory
git diff --check
```

The 13 older isolated regression suites were executed separately: company setup, cash-account balances, cash posting/preview, document detail, credit-note sources, supplier payments, credit application, banking reconciliation, balance-sheet earnings, dashboard liquidity, login limiter, identity verification and outbox claim. The seven outdated login-name guards were the initial failures; all seven passed after repair. The cash posting suite was rerun against 0105 and now explicitly rejects unlinked refunds. Those earlier refund-positive assertions are superseded.

Sanitized retained output: [acceptance evidence](evidence/acceptance-2026-10-21/). Reference Python and static specification checks are not substituted for any application/database/provider/browser result.

| Executed check | Result |
|---|---|
| Accounting aggregate (10 suites; grouped/parent tests included) | 53/53, no skips |
| Actual S3 export/issued snapshot suites | 7/7; repeated after dependency update against final clean target |
| Password-authenticated local HTTP security | 5/5; repeated on Next 16.4.2 against final clean target |
| Actual worker renderer/file failure and crash/lease recovery | 4/4 |
| Earlier regression suites | 13/13 suites; updated cash suite 16 grouped checks |
| Empty database install | 103 files through 0104; forward upgrades through 0106 give 105 files |
| Historical recovered database upgrade | 0103–0106, 105-file migration verification |
| Lint / typecheck / application tests / webpack production build | Passed; 332/332 application tests |
| Production dependency audit | Passed, 0 vulnerabilities |
| Full dependency audit | 5 high dev-only propagated findings, documented above |

Automatic approval review rejected starting a local **production-mode** server, giving only “blocked by policy.” The final HTTP retest uses a local **development-mode** server with the isolated final database. The production build itself passed; an optimized-server runtime smoke test is not claimed. No rejection was bypassed with an equivalent hidden launch.

## Blocking work and decisions

1. **Advance application and linked refund lifecycle:** T-10 is missing; T-11/T-13 remain partial. The enum/policy labels are present, but a runtime `advance_application` workflow and approval-bound paired allocations are absent. [US-041 #62](https://github.com/wdmahbubur/accounts-management-solution/issues/62), customer refunds #60 and supplier refunds #61 remain the owning work. US-042 #63 and unused advances #64 are consolidated duplicates of #62, not implementation-complete stories; they were not reopened as duplicate work.
2. **SaaS billing:** T-45/T-46 cannot run without an approved provider/account, prices/limits and actual webhook/entitlement enforcement. Schema tables alone are not an integration. No provider/pricing or subscription policy was selected on the owner's behalf.
3. **Scanner:** private quarantine/access and path guards pass, but this test profile has no `CLAMAV_HOST`. A real maintained engine/signature/EICAR run and production worker configuration remain required. No clean scan verdict was manufactured.
4. **Support access:** ordinary authenticated nonmembers are denied. Approved exceptional access with expiry/audit remains unimplemented/unverified; no privileged support bypass was added.
5. **Edge and release operations:** finish the browser golden workflow, company switching/cache checks, PDF visual checks, scheduled workers, measured load, production recovery/retention decisions and the applicable release reviews. Cash-flow finalization and year-close approval/UI gates remain separate from the tested database close arithmetic.
6. **Worldwide product scope:** multi-currency/FX, jurisdiction-specific tax/localization and legal/commercial promises require approved discovery and evidence. They are not delivered by these V1 fixes.

Refund UI review: the directory removes unavailable creation actions, the direct new-refund URL presents a concise status and a back link, existing document history remains accessible, and no new client-only authorization control was introduced. Browser visual/keyboard checks are still blocked by the unavailable Edge connection.

Production application/deployment and migrations 0101–0106 require separate explicit authorization under `AGENTS.md`; the old authorizations for 0086–0099 and 0100 do not cover these migrations. An application rollback must not restore old books over newer committed transactions. No independent professional review, real pilot, legal/tax sign-off or launch permission is claimed.

## Complete source-case traceability

The table below is generated from `tests/acceptance-matrix.json`. “Partial” and “Blocked” are not passes. Logs provide executed evidence; the matrix validator checks traceability and does not manufacture execution results.

| Case | Result | Evidence / remaining scope |
|---|---|---|
| T-01 | Passed | Actual draft/post/replay/collection commands and exact ledger results. [Test/source](../../tests/database/golden-books.test.mjs) |
| T-02 | Passed | Actual draft/post/replay/collection commands and exact ledger results. [Test/source](../../tests/database/golden-books.test.mjs) |
| T-03 | Passed | Actual draft/post/replay/collection commands and exact ledger results. [Test/source](../../tests/database/golden-books.test.mjs) |
| T-04 | Passed | Actual draft/post/replay/collection commands and exact ledger results. [Test/source](../../tests/database/golden-books.test.mjs) |
| T-05 | Passed | Actual draft/post/replay/collection commands and exact ledger results. [Test/source](../../tests/database/golden-books.test.mjs) |
| T-06 | Passed | Actual draft/post/replay/collection commands and exact ledger results. [Test/source](../../tests/database/golden-books.test.mjs) |
| T-07 | Passed | One receipt settles three invoices; every residual is asserted. [Test/source](../../tests/database/period-year-controls.test.mjs) |
| T-08 | Passed | Restricted posting and shared previews verify excess trade credit, true advances and atomic transfer/fees. [Test/source](../../tests/database/cash-posting-preview.mjs) |
| T-09 | Passed | Restricted posting and shared previews verify excess trade credit, true advances and atomic transfer/fees. [Test/source](../../tests/database/cash-posting-preview.mjs) |
| T-10 | Blocked | Advance application is not implemented in the runtime save/post/API path. T-10 cannot pass. [Test/source](../../docs/user-stories/US-042.md) |
| T-11 | Partial | Advance cash entries pass; advance application and linked refund lifecycle remain unavailable. [Test/source](../../tests/database/cash-posting-preview.mjs) |
| T-12 | Passed | Partial original-linked customer/supplier credits retain original basis and tax. [Test/source](../../tests/database/credit-note-sources.mjs) |
| T-13 | Partial | Unsafe credit-free refund was reproduced. Migration 0105 now rejects all unlinked refunds; eligible linked refund workflow is incomplete. [Test/source](../../tests/database/refund-safety.test.mjs) |
| T-14 | Passed | Bill and payment recognize one expense and preserve AP residual. [Test/source](../../tests/database/golden-books.test.mjs) |
| T-15 | Passed | Actual asset/tax/rounding/input/immutability checks with rejected commands leaving no committed journal. [Test/source](../../tests/database/accounting-guards.test.mjs) |
| T-16 | Passed | Actual asset/tax/rounding/input/immutability checks with rejected commands leaving no committed journal. [Test/source](../../tests/database/accounting-guards.test.mjs) |
| T-17 | Passed | Actual asset/tax/rounding/input/immutability checks with rejected commands leaving no committed journal. [Test/source](../../tests/database/accounting-guards.test.mjs) |
| T-18 | Passed | Actual asset/tax/rounding/input/immutability checks with rejected commands leaving no committed journal. [Test/source](../../tests/database/accounting-guards.test.mjs) |
| T-19 | Passed | Actual asset/tax/rounding/input/immutability checks with rejected commands leaving no committed journal. [Test/source](../../tests/database/accounting-guards.test.mjs) |
| T-20 | Passed | Actual asset/tax/rounding/input/immutability checks with rejected commands leaving no committed journal. [Test/source](../../tests/database/accounting-guards.test.mjs) |
| T-21 | Passed | Actual asset/tax/rounding/input/immutability checks with rejected commands leaving no committed journal. [Test/source](../../tests/database/accounting-guards.test.mjs) |
| T-22 | Passed | Actual asset/tax/rounding/input/immutability checks with rejected commands leaving no committed journal. [Test/source](../../tests/database/accounting-guards.test.mjs) |
| T-23 | Passed | Exact opposite dated reversal, immutable original, replay and second-reversal denial. [Test/source](../../tests/database/reversal-tenant-controls.test.mjs) |
| T-24 | Passed | Exact opposite dated reversal, immutable original, replay and second-reversal denial. [Test/source](../../tests/database/reversal-tenant-controls.test.mjs) |
| T-25 | Passed | Finalized reconciliation blocks source reversal until privileged reopen. [Test/source](../../tests/database/banking-reconciliation-workflow.mjs) |
| T-26 | Passed | Historical receipt and later unapply dates preserve earlier residuals and control bridges. [Test/source](../../tests/database/period-year-controls.test.mjs) |
| T-27 | Passed | Dual-role contact retains separate AR and AP. [Test/source](../../tests/database/accounting-guards.test.mjs) |
| T-28 | Passed | Restricted posting and shared previews verify excess trade credit, true advances and atomic transfer/fees. [Test/source](../../tests/database/cash-posting-preview.mjs) |
| T-29 | Passed | Import/matching/finalize/reopen use statement evidence without duplicate ledger activity. [Test/source](../../tests/database/banking-reconciliation-workflow.mjs) |
| T-30 | Passed | Exact-file replay and duplicate provider ID cannot duplicate observations; equal legitimate rows are retained and flagged. [Test/source](../../tests/database/bank-capacity-race.test.mjs) |
| T-31 | Passed | Exact-file replay and duplicate provider ID cannot duplicate observations; equal legitimate rows are retained and flagged. [Test/source](../../tests/database/bank-capacity-race.test.mjs) |
| T-32 | Passed | Import/matching/finalize/reopen use statement evidence without duplicate ledger activity. [Test/source](../../tests/database/banking-reconciliation-workflow.mjs) |
| T-33 | Passed | Import/matching/finalize/reopen use statement evidence without duplicate ledger activity. [Test/source](../../tests/database/banking-reconciliation-workflow.mjs) |
| T-34 | Passed | Locked posting/allocation/unapply/reversal deny; reopen enforces reason/capability/recent auth and retains snapshots. [Test/source](../../tests/database/period-year-controls.test.mjs) |
| T-35 | Passed | Locked posting/allocation/unapply/reversal deny; reopen enforces reason/capability/recent auth and retains snapshots. [Test/source](../../tests/database/period-year-controls.test.mjs) |
| T-36 | Passed | Genuine checker decisions invalidate after amount/date/bank/target edits; maker self-approval and invalid sole-operator policy deny. [Test/source](../../tests/database/approval-controls.test.mjs) |
| T-37 | Passed | Genuine checker decisions invalidate after amount/date/bank/target edits; maker self-approval and invalid sole-operator policy deny. [Test/source](../../tests/database/approval-controls.test.mjs) |
| T-38 | Passed | AR/AP opening details, balanced prior TB, zero suspense and once-only labeled YTD summary pass. [Test/source](../../tests/database/cutover-classification.test.mjs) |
| T-39 | Passed | AR/AP opening details, balanced prior TB, zero suspense and once-only labeled YTD summary pass. [Test/source](../../tests/database/cutover-classification.test.mjs) |
| T-40 | Passed | Close/reopen/reclose retain historical P&L and one active profit transfer. No independent accountant or year-close UI approval review is claimed. [Test/source](../../tests/database/period-year-controls.test.mjs) |
| T-41 | Passed | Close/reopen/reclose retain historical P&L and one active profit transfer. No independent accountant or year-close UI approval review is claimed. [Test/source](../../tests/database/period-year-controls.test.mjs) |
| T-42 | Partial | Unclassified cash is provisional and blocks period lock; dedicated cash-flow finalization workflow remains unverified. [Test/source](../../tests/database/cutover-classification.test.mjs) |
| T-43 | Passed | Injected PDF renderer failure and actual missing-object delivery failure preserve books; restored file retries delivery only through loopback SMTP. [Test/source](../../tests/database/worker-recovery.test.mjs) |
| T-44 | Partial | Actual private CSV/XLSX equal immutable screen cutoff despite later posting; PDF bytes/digest pass, but PDF content/layout and browser export flows remain unverified. [Test/source](../../tests/database/export-acceptance.test.mjs) |
| T-45 | Blocked | Billing provider, approved plans and runtime webhook/entitlement integration are absent. No billing-provider test was run. [Test/source](../../docs/qa/full-acceptance-2026-10-21.md) |
| T-46 | Blocked | Billing provider, approved plans and runtime webhook/entitlement integration are absent. No billing-provider test was run. [Test/source](../../docs/qa/full-acceptance-2026-10-21.md) |
| T-47 | Partial | Golden source journals, AR/AP, cashbook, statements, TB/P&L/BS/cash flow pass in PostgreSQL. Required Edge browser golden flow is blocked by disconnected Edge. [Test/source](../../tests/database/golden-books.test.mjs) |
| T-48 | Passed | Used-account classification changes and inactive-account posting deny; history is unchanged. [Test/source](../../tests/database/accounting-guards.test.mjs) |
| T-49 | Passed | Public contact/tax version changes preserve the original posted source and actual immutable PDF bytes/ID. [Test/source](../../tests/database/issued-snapshot.test.mjs) |
| T-50 | Passed | USD input rejects explicitly; no silent conversion to BDT. [Test/source](../../tests/database/accounting-guards.test.mjs) |
| T-51 | Passed | Historic allocation/reversal boundaries, original parent/party, cumulative quantity/basis and real credit race pass. [Test/source](../../tests/database/credit-note-sources.mjs) |
| T-52 | Passed | Historic allocation/reversal boundaries, original parent/party, cumulative quantity/basis and real credit race pass. [Test/source](../../tests/database/credit-note-sources.mjs) |
| S-01 | Passed | Ordinary role and real dual-company membership cannot mix foreign source/account identities. [Test/source](../../tests/database/reversal-tenant-controls.test.mjs) |
| S-02 | Passed | Ordinary role and real dual-company membership cannot mix foreign source/account identities. [Test/source](../../tests/database/reversal-tenant-controls.test.mjs) |
| S-03 | Passed | Billing/outsider denial covers P&L, AP aging, private cashbook and vendor statement; Auditor reads permitted data. [Test/source](../../tests/database/golden-books.test.mjs) |
| S-04 | Passed | Real Auth.js password sessions call direct APIs; forged Owner payload does not grant authority. Shared route origin checks are exercised. [Test/source](../../tests/database/http-security.test.mjs) |
| S-05 | Passed | Real Auth.js password sessions call direct APIs; forged Owner payload does not grant authority. Shared route origin checks are exercised. [Test/source](../../tests/database/http-security.test.mjs) |
| S-06 | Passed | Anonymous posting and restricted-login private helpers deny; application tests also reject forged actor/org fields. [Test/source](../../tests/database/reversal-tenant-controls.test.mjs) |
| S-07 | Passed | Still-unexpired authenticated session loses company source/report access immediately after public deactivation. [Test/source](../../tests/database/http-security.test.mjs) |
| S-08 | Passed | Distinct PostgreSQL backend sessions prove capacity/posting/lock/physical-cash/last-owner races; role escalation also denies through direct HTTP. [Test/source](../../tests/database/concurrency-acceptance.test.mjs) |
| S-09 | Passed | Distinct PostgreSQL backend sessions prove capacity/posting/lock/physical-cash/last-owner races; role escalation also denies through direct HTTP. [Test/source](../../tests/database/concurrency-acceptance.test.mjs) |
| S-10 | Passed | Distinct PostgreSQL backend sessions prove capacity/posting/lock/physical-cash/last-owner races; role escalation also denies through direct HTTP. [Test/source](../../tests/database/concurrency-acceptance.test.mjs) |
| S-11 | Passed | Distinct PostgreSQL backend sessions prove capacity/posting/lock/physical-cash/last-owner races; role escalation also denies through direct HTTP. [Test/source](../../tests/database/concurrency-acceptance.test.mjs) |
| S-12 | Passed | Two independent sessions in different reconciliation sessions cannot overconsume one statement row. [Test/source](../../tests/database/bank-capacity-race.test.mjs) |
| S-13 | Passed | Distinct PostgreSQL backend sessions prove capacity/posting/lock/physical-cash/last-owner races; role escalation also denies through direct HTTP. [Test/source](../../tests/database/concurrency-acceptance.test.mjs) |
| S-14 | Passed | Actual application private-artifact reads deny guessed/foreign/Billing IDs and revoked requester. Proxy downloads recheck live permission; no reusable signed provider URL is issued. [Test/source](../../tests/database/export-acceptance.test.mjs) |
| S-15 | Partial | Authenticated report responses are private/no-store and tenant scoped; Edge company-switch cache behavior remains unrun. [Test/source](../../tests/database/http-security.test.mjs) |
| S-16 | Partial | Actual CSV formula escaping, literal XLSX data, private paths and quarantine denial pass. No configured ClamAV engine/signature/EICAR provider run. [Test/source](../../tests/database/export-acceptance.test.mjs) |
| S-17 | Passed | Real deadlock and injected post-then-serialization abort verify bounded whole-transaction retries; exhaustion 503 leaves no journal/outbox. [Test/source](../../tests/database/transaction-recovery.test.mjs) |
| S-18 | Passed | Actual posting child is killed after COMMIT before receipt; retry returns the original journal with pending outbox. [Test/source](../../tests/database/transaction-recovery.test.mjs) |
| S-19 | Passed | Actual worker killed mid-loopback-SMTP; real 120-second lease expires, reclaim delivers with stable Message-ID and stale token denies. No exactly-once external email claim. [Test/source](../../tests/database/worker-recovery.test.mjs) |
| S-20 | Partial | Nonmember authenticated requests deny. Approved exceptional support access with expiry/audit is not implemented or verified. [Test/source](../../tests/database/http-security.test.mjs) |
