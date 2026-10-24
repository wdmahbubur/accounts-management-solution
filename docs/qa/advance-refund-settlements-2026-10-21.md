# Advance applications and linked refunds — 21 October 2026

Scope: [US-041 #62](https://github.com/wdmahbubur/accounts-management-solution/issues/62), including consolidated US-042/043, and the linked refund portions of [US-039 #60](https://github.com/wdmahbubur/accounts-management-solution/issues/60) / [US-040 #61](https://github.com/wdmahbubur/accounts-management-solution/issues/61). Closed duplicates #63/#64 were backlog consolidation, not completed implementation. This candidate builds on PR #184; it does not authorize production changes or close the launch gates.

## Accounting behavior

| Command | Debit | Credit | Settlement |
|---|---|---|---|
| Customer advance application | Customer advance liability | AR | Original advance and invoice each settle against their own new opposite control item |
| Supplier advance application | AP | Supplier advance asset | Original advance and bill each settle against their own new opposite control item |
| Customer refund | Selected eligible AR credit or customer advance liability | Cash/bank | Exactly the selected original credit/advance |
| Supplier refund received | Cash/bank | Selected eligible AP debit or supplier advance asset | Exactly the selected original credit/advance |

An application moves no cash and creates no income or expense. One application targets one invoice/bill, including an individual imported opening trade item; repeat applications support partial settlement across documents. Ordinary overpayments remain trade credit, separate from true advances. Refunds accept selected customer/vendor credits, residual receipt/payment credit, unused advances or corresponding opening items; they never choose an implicit FIFO source.

The dedicated draft stores source item, target item, amount and document version. Approval uses the existing source digest/version and policy snapshot. Material edits supersede decisions. The common posting transaction retains numbering, period/year locks, ledger/open-item checks, cash-floor enforcement, audit, outbox and command receipts. Selected items are locked in UUID order before numbering and capacity is rechecked at every historical effective-date boundary.

Applications create both allocations atomically. A standalone unapply is blocked for linked settlements; reverse the settlement document to undo its allocations and journal together. Active linked dependents must be reversed before their original source. Existing reconciliation reopen protections still apply. Original journals and dated settlement/reversal evidence remain append-only.

## Schema and authorization

- 0107: private `finance.linked_settlement_details`, composite company FKs and draft-only guard; dedicated save/validation/post helpers; extensions of common preview/post/reversal commands.
- 0108: permission-checked dated choices, advance totals/history and linked document references. No direct runtime grant on the new table.
- 0109: explicit source/target readability and effective-date-aware reversal status.
- 0110: refunds additionally require `banking.write`; Billing can collect invoices but cannot return company funds. Applications require journal authority and `dues.allocate`.
- 0111: refund drafts require an explicit payment method and external payment/voucher reference; posting rechecks the evidence metadata. Attachment evidence still uses the existing private evidence library and scan/link controls.
- 0112: future linked draft saves preserve the complete issued contact snapshot; posted snapshots are not edited.
- 0113–0115: imported opening advances and individual opening AR/AP items participate in the same workflow; original item references identify the selected balance within a batch. The apply API requires an explicit source item when an opening batch contains several advances. Ordinary supplier advance history remains visible after full settlement.

The migration extension normalizes stored function-body line endings before matching anchors. No posted data or migration receipts are rewritten. These forward migrations were applied only to `ams_clean_launch_20261021` on the isolated recovery branch. Production remains through 0100. Rolling application code back must retain all posted records and these additive schema objects.

## Application and API

`/o/[org]/advances` has customer/supplier tabs, original/applied/refunded/remaining amounts, dated activity and compatible targets. `/advances/[id]` selects the original advance's lifecycle, and `/advances/new` opens the shared advance draft form. Drafts use the shared document review, approval, posting and reversal surfaces. The page requires live company context and permissions; mutations pass the shared origin/idempotency/context guards. Unknown save outcomes retain a frozen request for retry. The form resets on company, advance, date or draft-version changes.

- `POST /api/v1/organizations/{org}/linked-settlements`: save a new or versioned application/refund draft using `{document_id, expected_version, payload}`.
- `POST /api/v1/organizations/{org}/advances/{advanceDocumentId}/apply`: save an application draft using `{target_open_item_id, amount, accounting_date, description}`; resolves the source item from the immutable advance. Add `source_open_item_id` for a batch containing multiple opening advances; ambiguity is rejected.
- Submit, preview and post use the existing document endpoints. Saving never posts automatically. Money is represented by decimal strings.

## Verification

Financial implementation: `46385464d1d8270f90c346450616c6bc765d7de4` (initial core `4aba36c9ccf0cdcff7ca9d9651f8b34a216454cf`); canonical UI route follow-up: `cc86a1fc3936fa26e70c7d51f7de3afe94da1778`. [PR #185](https://github.com/wdmahbubur/accounts-management-solution/pull/185) is stacked on #184. Synthetic posted fixtures are retained. Setup identities, role memberships and passwords are fixtures; financial commands use the actual restricted runtime login. No real payments or external emails are sent.

| Check | Exact command (explicit isolated profile loaded) | Result |
|---|---|---|
| Migrations | `node scripts/db-migrate.mjs` | 0107–0115 applied; 114 migration files checked |
| Linked settlement safety | `npm run test:database:advances` | 7/7 passed, no skips; ordinary and imported balances tested together |
| Accounting regression | `npm run test:database:accounting` | 53/53 passed, no skips |
| Real HTTP security | `npm run test:database:http-security` with `AMS_TEST_APP_URL=http://localhost:3001` | 5/5 passed, no skips |
| Private PDF/export regression | `npm run test:database:exports` | 7/7 passed, no skips; actual private object bytes and issued snapshots |
| Application/unit checks | `npm test` | 336/336 passed |
| Static checks | `npm run lint`; `npm run typecheck` | Passed |
| Local optimized build | `npm run build -- --webpack` | Passed at the financial implementation; route follow-up verified separately in Edge and static checks |
| Production dependencies | `npm audit --omit=dev --json` | 0 vulnerabilities |
| CI build | GitHub Actions `Lint, typecheck and build`; Vercel preview build | Passed at both the financial and canonical route commits above |
| Candidate historical restore | `node scripts/recovery-database.mjs capture <private-manifest>`; `node scripts/recovery-database.mjs verify <private-manifest>` | All 70 tables, 114 migration receipts, security definitions and 43 ledger groups matched; 53 linked details included |
| Candidate file recovery | `node --conditions=react-server output/advances/2026-10-21/candidate-file-restore.mjs` | 10/10 independent backups/restores match digest/size; 2 restricted PDF downloads; 8 revoked export requesters still denied |

The accounting regression ran before the final payment-reference/contact-snapshot extensions. The final combined advance/refund suite ran after all nine migrations. It imports two opening advances, an outstanding invoice/bill and trade credits, applies/refunds all six selected balances, verifies exact residuals and zero income/expense, and rejects ambiguous batch selection. Its application/refund race uses concurrent restricted-role connections. A separate service-alias check returned the same draft on replay and verified zero journal entries.

Exploratory failures caught a wrong expected supplier account code in the test (correct account: 1150), the Billing refund authority gap, missing explicit method/reference metadata and incomplete future-save contact snapshots. The opening extension briefly omitted ordinary supplier advances from its read filter; Edge caught this and forward migration 0115 repairs it. The final 7/7 run covers both ordinary and opening balances together. Intermediate candidate results are superseded by that run. No migration receipt or posted fact was rewritten to make a test pass.

## Edge browser evidence

Real password sign-in, company selection, draft save, preview, submit and posting were exercised in Edge against `http://localhost:3001`. Customer and supplier advances each started at BDT 10,000, applied BDT 6,000, refunded BDT 4,000 and ended at BDT 0. The page retains both posted history links. An excessive customer refund was rejected.

The canonical supplier detail route was opened directly without a tab parameter and selected Supplier advances with the correct application/refund history. Record advance followed `/advances/new?tab=vendor` to the shared New supplier advance form. No extra advance was posted in this routing check.

The customer path used the configured below-threshold policy. The supplier application required a checker: its maker received 403, a different authenticated synthetic Owner reviewed the selected advance/bill and 1150/AP preview, approved once, and posted. This is a test of maker/checker enforcement, not independent accountant or owner sign-off. Completed approval-history rows now say **Not required** where applicable and **No further action**, rather than suggesting a changed financial version.

Desktop (1440×900), tablet (768×1024), and phone (375×812) surface views were inspected with the user's existing 90% browser zoom retained. These are surface dimensions, not a claim of identical CSS pixel breakpoints. Phone layout uses a single-column form and an internally scrolling balance table; keyboard Tab focus was visible. The temporary viewport override was reset. No critical browser console errors were observed. There is no approved visual baseline, measured production Web Vitals, axe audit or screen-reader certification; the visual-regression verdict remains **inconclusive**.

This phase uses a development server for browser checks. Automatic approval review rejected starting the local Next production server with the reason **blocked by policy**; no equivalent start was retried. CI and Vercel build the optimized candidate; the automatically created preview was not an E2E database target. Production bundle browser tests, production migrations and deployment remain outside this evidence.

The current source-case matrix is **64 covered, 6 partial and 2 blocked**. Covered source cases do not imply worldwide launch approval. [Execution receipts and screenshots](evidence/advance-settlements-2026-10-21/README.md) retain exact commands/results and synthetic fixture identities.

## Remaining launch gates

This is BDT-only accrual accounting for Bangladesh service/non-stock SMEs. It does not add FX, foreign currencies, jurisdiction-specific tax or statutory certification. Independent accountant/owner review, production migration/deployment authorization, billing provider and approved commercial terms, scanner verification, time-bounded support access, measured production performance, scheduled worker/backup operations and pilot evidence remain required. The earlier isolated database/file recovery drill is documented separately and is not a production RTO/RPO promise.

Production backup retention and scheduling still need approved operational ownership. The original `.env.local` remains unchanged; this run explicitly loads the ignored final isolated profile. Existing development-only dependency findings from the parent audit remain unresolved; no dependency versions changed in this slice.

## Candidate database and file recovery follow-up

After the financial and Edge checks, a new read-only baseline was captured from `ams_clean_launch_20261021` at **06:33:16.538483 UTC**. It includes 70 application tables, 114 migration receipts, 43 ledger groups and 53 linked-settlement detail rows. Writers were idle apart from the deliberate synthetic identity marker committed at **06:35:20.346204 UTC**. No real recipients or workers were resumed.

In Edge, Neon restored the isolated source into retained branch `advance-recovery-20261021` (`br-morning-glitter-b4b1qies`) at **12:34:14.910 Asia/Dhaka / 06:34:14.910 UTC**. This point is after baseline capture and before the marker. All table fingerprints, migration checksums, ledger totals and authorization/routine/policy/trigger/constraint definitions match. The later marker is absent. The restored restricted runtime still has no journal INSERT or private linked-table SELECT grant. Its dated customer and supplier lifecycle reads each retain 10,000 original / 6,000 applied / 4,000 refunded / zero remaining and both history links.

Every referenced object class was inventoried: 2 issued PDFs and 8 completed exports, with no referenced attachments, staged/bank-import or report-object files in this candidate. All ten source byte streams were independently backed up locally, then conditionally written into a new, initially empty **private** `ams-candidate-recovery` bucket on the recovered branch. Original keys, sizes and SHA-256 values match. No existing object was overwritten or deleted. All ten unsigned requests were denied; both PDFs downloaded through the real restricted application authorization/integrity path. Anonymous and wrong-company requests were denied, and all eight export requesters remain denied because their memberships had already been revoked by the acceptance fixtures. Every database fingerprint remained unchanged after file recovery.

This supplements the earlier missing/corrupt-byte, live-revocation and quarantine recovery tests; those destructive negative scenarios were not repeated in this follow-up. The retained provider point and independent bytes are the recovery assets; the JSON manifest is verification evidence. This small synthetic exercise does not establish approved production retention, incident ownership, RTO/RPO, worker resumption or large-dataset capacity. Sanitized execution receipts and copies of the exact operational checks are linked in the evidence index.
