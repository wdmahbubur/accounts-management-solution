# Product audit and repair handoff — 8 October 2026

## Status and scope

This is an AI product, engineering and usability review of the existing Accounts Management Solution.
The review covers the deployed application, its implementation branch, repository delivery evidence and a focused repair published in PR #167.
It does not establish that every workflow is broken or that the local repair completes the product.
The project scope remains separate BDT accrual books for service/non-stock companies.

**Repair branch:** `fix/product-workflow-repair`, based on `feat/neon-foundation-clean`.
**Verification:** local checks and GitHub CI passed; authenticated preview and mobile verification are blocked/pending as recorded below.
**Focused repair:** [PR #167][pr167], code commit `5725754191196a7ac6d80b5fd200e3c40a924d75`.
**Verified tree:** `ba91cacd33ec6b7e1c3de303ee608858e581db1c`, identical to the locally verified `714100b` code tree.
**Preview deployment:** `dpl_4GgLqyv9wx3Xh3KhFPPCddL3AhKq`, READY; landing/sign-in pages rendered, authenticated workspace verification blocked by missing preview `AUTH_SECRET`.

## Version and delivery baseline

| Item | Evidence at the start of this audit |
| --- | --- |
| Live implementation / PR #165 head | `4c957e69451fcf215a56d8026716b640d57e0d8f` |
| Default branch `master` | `ca45fe9bb5f77d95f157be2c7fc5f15c45f4c514`; earlier Supabase application shell |
| Current implementation | Neon/Auth.js work in [PR #165][pr165], open and unmerged |
| Deployed URL | <https://accounts-management-solution-web.vercel.app> |
| Deployment association | [Vercel status on PR #165][deployment] reports Ready for the October 4 deployment |
| Delivery closures | 33 stories closed with `QA pending`, recording code delivery on PR #165 |
| Business acceptance | All 52 T-cases pending in the baseline acceptance matrix |
| Security/concurrency acceptance | 18 S-cases pending; only S-05 and S-06 marked covered by shared-command tests |

The [closure register][closure] explicitly separates delivered code from merged, runtime-tested acceptance.
Issue state must not be used as a product-completion percentage.
[Issue #44][slice] still owns the first complete accounting slice; [issue #99][acceptance] owns the wider acceptance work.
The current [roadmap #115][roadmap] permits AI-led implementation, review, testing and release work without an extra human accountant signature.
In-app permissions, maker-checker controls, period locks and immutable posted records remain product requirements.

At the baseline commit, the [CI job][ci] failed on an unused `randomBytes` import in `scripts/provision-demo-account.mjs`.
Typecheck, application tests and build were skipped in that run, while the separate Vercel deployment was Ready.
A deployment status therefore did not demonstrate a passing product verification gate.

## Evidence categories

- **Runtime-observed:** directly visible during the integrating agent's live browser/screenshot inspection.
- **Code-reproduced:** a concrete source defect or local regression reproduction; not automatically a live database result.
- **Unverified candidate:** a remaining risk or incomplete acceptance scope requiring a targeted runtime check.

Historical progress notes are useful context but are not a substitute for current execution.
Where a later implementation supersedes an earlier note, inspect the current code before declaring the feature absent.

## Runtime-observed findings

| Finding | User consequence | Relevant source |
| --- | --- | --- |
| Invoice actions, status links and filter controls run together without clear shared layout | Creating, filtering and opening invoices is difficult to scan | `apps/web/app/o/[organizationId]/sales/invoices/page.tsx`, `invoice-filters.tsx`, `apps/web/app/globals.css` |
| Long, ungrouped sidebar places administration before daily business tasks | The application's main jobs are hard to find | `apps/web/components/shell/frame.tsx` |
| Reports hub has no direct sidebar entry | Existing reports are less discoverable than their route availability suggests | `frame.tsx`, `apps/web/app/o/[organizationId]/reports/page.tsx` |
| Active navigation and breadcrumb labels do not consistently match nested pages | Users lose context when opening a detail, report or reconciliation screen | `frame.tsx` |
| Checkbox/textarea layout lacks consistent shared treatment | Labels and controls appear disconnected or unlike adjacent fields | `apps/web/app/globals.css`, `apps/web/app/o/[organizationId]/contacts/contact-form.tsx` |
| Approval settings displays "Settings could not be loaded" | Approval-policy configuration cannot be used in the observed session | Screenshot `07-approval-error.jpg`; `apps/web/app/o/[organizationId]/settings/error.tsx`, `settings/approvals/page.tsx`, `apps/web/server/approvals/policy-contracts.ts` |
| Draft form defaults to October 8 while the dashboard's Dhaka date is October 9 | A new financial document can start with the wrong local accounting date | Baseline `accounting/documents/draft-editor.tsx` uses UTC `toISOString().slice(0,10)`; focused repair uses `bangladeshDate` |
| Customer form exposes address and tax-identifier JSON fields in the browser | Ordinary contact entry requires knowledge of a technical data format | `apps/web/app/o/[organizationId]/contacts/contact-form.tsx` |

The live demo also contained **two posted invoices**, with **BDT 252,000** shown on the dashboard.
This is positive evidence of existing posted documents and report display; the audit did not reproduce those records' original creation.
It does not verify the fresh-company activation path or the full receipt/allocation lifecycle.

These observations identify particular screens and controls. They do not establish that every route or transaction fails.
Seven baseline screenshots were captured and inspected: `01-landing.jpg`, `02-company-selection.jpg`, `03-dashboard.jpg`, `04-invoice-register.jpg`, `05-new-invoice-top.jpg`, `06-customer-form.jpg`, and `07-approval-error.jpg`. They are embedded in the accompanying visual audit report. No after-repair workspace screenshot is claimed.

## Code-reproduced defects and focused repair

### Shared RPC boundary

The generic PostgreSQL adapter previously passed JavaScript arrays without distinguishing JSON/JSONB arguments from native SQL arrays.
The driver serializes JavaScript arrays as PostgreSQL arrays, which is incompatible with JSON-array parameters used by commands.
The repair reads the selected procedure's input type OIDs and serializes array values only for JSON/JSONB arguments.
It preserves native SQL arrays, SQL nulls, exact decimal strings and binary values.
RPC result normalization also converts driver `Date` objects to the string contract expected by existing consumers.

- Sources: `apps/web/server/request-client.ts`, new `apps/web/server/rpc-values.ts`.
- Regression evidence: `tests/application/rpc-values.test.mjs` exercises the actual driver conversion boundary and contract consumers.
- The exact adapter SQL was also checked against PostgreSQL 18.3 through PGlite 0.5.8 with the installed Neon 1.2.0 driver and eight isolated cases.
- Cases covered JSON/JSONB arrays, native UUID arrays, reordered names, table/scalar/OUT returns, zero-input routines and timestamp/date normalization.
- The legacy JSON-array binding reproduced PostgreSQL error `22P02`; the repaired binding succeeded.
- Limit: this isolated PostgreSQL check does not verify the hosted Neon schema, ordinary application roles or authenticated financial commands.

### Draft editing and duplication

Draft preview/submission could refer to a saved version while the displayed form had unsaved changes.
The repair tracks revisions, clears stale previews, prevents review until changes are saved and serializes pending requests.
It prevents an earlier save or preview response from treating a later edit as reviewed.
Bill duplication now uses the same bounded new-draft path as invoice duplication.
Duplication retains editable values while removing issued identities, settled history, approval/posting state and derived totals.
Default draft dates use the Bangladesh calendar date consistently.

- Sources: `apps/web/app/o/[organizationId]/accounting/documents/draft-editor.tsx`, `new/new-draft-page.tsx`, new `draft-interactions.ts`.
- Regression evidence: `tests/application/draft-interactions.test.ts` covers dirty revisions, stale responses, invoice/bill copies and date rollover.
- Limit: browser save, preview, submit, approval and posting must still be exercised together against the integrated database.

### Issued invoice PDF unit prices

The renderer applied a two-decimal money validator to unit prices that the database returns with six-decimal precision.
A valid rate such as `100.000000` could therefore fail PDF rendering.
The repair accepts up to six rate decimals and preserves fractional precision while retaining two-decimal validation for posted money totals.

- Source: `apps/web/server/documents/invoice-pdf.ts`.
- Regression evidence: `tests/application/invoice-pdf.test.ts` covers valid rates, invalid precision, source identity and strict totals.
- A synthetic PDF was rendered and its extracted output inspected during integration.
- Limit: this is not proof of issued-document delivery, Bengali shaping for every name or SMTP/provider success.

### Navigation and shared finance layout

The repair groups authorized navigation by business task and places Dashboard and Reports first.
Existing bank import, reconciliation and opening-balance pages have discoverable links gated by their current page capabilities.
Most-specific route matching handles nested detail/edit paths and separates evidence from financial documents.
Readable report/detail breadcrumbs replace the long conditional label chain.
The mobile menu starts collapsed, exposes its expanded state and supports Escape with focus return.
Shared toolbar, action, status-navigation, scrolling-table, textarea and checkbox styles now exist.
The blue/slate visual language is retained; this is not a full visual redesign.

- Sources: `apps/web/components/shell/frame.tsx`, `shell.module.css`, new `navigation.ts`, `apps/web/app/globals.css`.
- Regression evidence: `tests/application/workspace-navigation.test.ts` covers capability filtering, nested selection, company boundaries and breadcrumbs.
- Limit: the integrating agent must verify desktop/mobile layout, focus and navigation in the built application.

The unused demo-provisioning import was also removed to repair the known lint failure.
No accounting migration, financial-policy change or new route is part of this repair set.

## Confirmed code findings still open

### Fresh companies have no application activation command

`create_company_atomic` inserts organization status `onboarding` in `database/migrations/0082_fix_company_onboarding_identity_email.sql:145–152`.
`finance_private.lock_accounting_date` rejects every non-`active` status in `0015_accounting_period_lock_protocol.sql:12–15`.
Migration `0084_enable_onboarding_setup_and_drafts.sql` permits setup and drafts during onboarding but deliberately retains the active-company posting guard.
A repository search of application commands and migrations found no application transition to `active`; the only matching organization activation write is direct SQL in `scripts/provision-demo-account.mjs:79–82`.
This is a missing fresh-company workflow, not a reason to remove the posting guard. Existing active demo data does not resolve it.

### Cash-movement and transfer previews show zero balanced totals

`previewFinancialDocument` and `previewApprovalDocument` in `apps/web/server/documents/service.ts` calculate trade lines or fall through to `journal_rows`.
They do not construct preview entries from a receipt/payment `movement` or a `transfer` payload.
Local calls to both functions with receipt, vendor-payment and transfer amounts of BDT 1,250 returned `debit: "0.00"`, `credit: "0.00"`, `balanced: true`.
The reproduction used synthetic RPC responses and the actual service functions. It establishes misleading preview output, not incorrect database posting entries.

### Saved receipt targets are not loaded into the editor

`apps/web/app/o/[organizationId]/accounting/documents/[documentId]/document-detail-page.tsx` passes no `receiptInvoices` to `DraftEditor`.
`draft-editor.tsx` defaults this prop to `[]`; its target query runs only after changing the customer or accounting date, which also clears the local allocation plan.
Consequently a reopened receipt draft can show no eligible targets even when its saved allocation plan exists. Persisted allocation loss has not been demonstrated.

### Draft readers are forced through write-only option loading

The same detail loader calls `readDraftOptions` for every supported draft before deciding how to render it.
`apps/web/server/documents/service.ts:55–58` requires the source module's write capability; a local call with `sales.read` and `documents.read` returned `FORBIDDEN`.
The loader maps that failure to "You do not have permission to open this document," preventing a permitted read-only draft view.
These four findings are outside the focused repair in PR #167 and remain implementation/acceptance work.

## Remaining functional and UX priorities

| Priority | Remaining work | Evidence and scope |
| --- | --- | --- |
| P0 | Complete one real invoice-to-ledger journey | [#44][slice]: company setup, customer, invoice, save, review/post, receipt/allocation and ledger/report tie-out. Local unit tests do not prove this loop. |
| P0 | Implement controlled onboarding completion and correct movement previews | The confirmed code findings above block a usable fresh-company path and misrepresent review totals. Preserve activation, accounting and approval guards while adding the missing behavior. |
| P0 | Re-establish current-platform acceptance | [#99][acceptance], `tests/acceptance-matrix.json`, `package.json`: 70 of 72 baseline cases pending; current scripts lack the previous browser/database/race harnesses. |
| P0 | Verify RPC changes against actual PostgreSQL and ordinary roles | `apps/web/server/request-client.ts`, `database/migrations/`: procedure signatures, JSON arrays, authorization, rollback, replay and competing connections. |
| P1 | Replace internal identifiers with business selectors | `accounting/documents/draft-editor.tsx`: generic credit flows expose original document/line IDs; vendor-payment allocation exposes open-item IDs. Their presence is verified in code; resulting full-flow failure is not assumed. |
| P1 | Repair saved receipt target loading and read-only draft detail | `accounting/documents/[documentId]/document-detail-page.tsx`, `draft-editor.tsx`, `apps/web/server/documents/service.ts`; add targeted browser and role-specific regression evidence. |
| P1 | Simplify customer and financial forms | `contacts/contact-form.tsx` still exposes address/tax JSON; the draft editor exposes advanced accounting controls and a raw preview. Design these around user tasks without weakening the accounting contract. |
| P1 | Finish recovery states and navigation consistency | [#73][ux]: loading, empty, forbidden, session expiry, conflicts, locked periods, offline and read-only flows require browser acceptance beyond the shared styling repair. |
| P1 | Verify report correctness with non-zero posted examples | P&L, Balance Sheet, aging, cash flow, cutover and close/reclose require golden ledger scenarios and cross-report reconciliation. See `apps/web/app/o/[organizationId]/reports/` and [#99][acceptance]. |
| P1 | Complete provider/worker success and failure paths | [#27][uploads], [#45][workers], [#88][invoice-delivery]: actual upload-to-scan-to-download, scheduled invocation, delivery/retry and failure recovery remain separate integration work. |
| P2 | Align branch and delivery records | [#165][pr165], [#166][policy-pr], `AGENTS.md`, `docs/11-ai-execution-guide.md`: integrate verified work and remove stale instructions/claims without treating old draft PRs as current acceptance. |

The implementation-progress record's October 4 browser smoke saved an invoice and supplier bill as drafts.
It explicitly did not exercise approval, posting, receipt/payment or journal creation.
That historical smoke must not be cited as a completed accounting workflow.

## Validation and final integration checklist

The integrating agent reported these results for the combined repair working tree:

| Check | Result recorded so far |
| --- | --- |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm test` | 148 passed; 0 failed; 0 skipped |
| Synthetic issued-invoice PDF rendering/extraction | Rendered and inspected |
| `npm run build` | Passed; Next.js 16.3.7 compiled successfully |
| PostgreSQL catalog/adapter verification | Passed in PGlite / PostgreSQL 18.3; exact SQL, eight isolated cases, driver arrays/timestamps, legacy `22P02` reproduced and repaired binding accepted |
| Built-preview inspection | Landing and sign-in rendered; authenticated workspace blocked. Mobile/focus acceptance not run. |
| Complete authenticated accounting workflow | Pending; not established by this handoff |
| Focused code publication | [PR #167][pr167], `5725754191196a7ac6d80b5fd200e3c40a924d75`; same tree as locally verified `714100b` |
| Preview deployment smoke | READY, Next.js preview; landing and sign-in rendered. Runtime logs at 19:52:48–19:52:49 UTC report Auth.js `MissingSecret` on sign-in/callback. No authenticated workspace verification. |
| GitHub CI | [Run 37835089947](https://github.com/wdmahbubur/accounts-management-solution/actions/runs/37835089947), commit `5725754`, completed successfully |

Application regression counts remain separate from the T-01..T-52 and S-01..S-20 acceptance matrix.
Do not mark pending cases passed merely because the repair compiles or the application test suite is green.

- [x] Record final build result; production build compiled successfully.
- [x] Record database-catalog/adapter check scope and results; isolated PGlite evidence does not establish hosted Neon or ordinary-role accounting acceptance.
- [x] Record baseline screenshot references. Desktop captures inspected; no mobile viewport or keyboard-menu acceptance claimed.
- [x] Record browser scope: baseline demo sign-in/company selection and read-only dashboard/register/new-form/settings inspection. No financial record was created, submitted, approved, posted or changed in this audit.
- [x] Record code commit, PR #167, successful CI and READY preview. Documentation-only follow-up does not change the tested application code.
- [x] Retain unresolved acceptance cases and defects; no business acceptance issue was closed.

## Preview verification limit

The preview landing and sign-in pages loaded through authorized Vercel access. After one public-demo sign-in attempt, the browser refused the next page observation because its URL policy rejected the resulting protocol. No workaround or repeated sign-in was attempted. Independent Vercel runtime logs for this same deployment confirmed Auth.js `MissingSecret: Please define a secret` during sign-in. The preview environment needs its own valid auth/database configuration before authenticated desktop/mobile verification can resume. No production secret was copied, no deployment protection was disabled and no production release was made.

Deployment record: <https://vercel.com/wdmahbuburs-projects/accounts-management-solution-web/4GgLqyv9wx3Xh3KhFPPCddL3AhKq>. A READY build is not authenticated workflow acceptance.

## GitHub evidence

[pr165]: https://github.com/wdmahbubur/accounts-management-solution/pull/165
[pr167]: https://github.com/wdmahbubur/accounts-management-solution/pull/167
[deployment]: https://github.com/wdmahbubur/accounts-management-solution/pull/165#issuecomment-5979170442
[closure]: https://github.com/wdmahbubur/accounts-management-solution/issues/99#issuecomment-5971792048
[slice]: https://github.com/wdmahbubur/accounts-management-solution/issues/44
[acceptance]: https://github.com/wdmahbubur/accounts-management-solution/issues/99
[roadmap]: https://github.com/wdmahbubur/accounts-management-solution/issues/115
[ci]: https://github.com/wdmahbubur/accounts-management-solution/actions/runs/37216442528/job/111477802210
[ux]: https://github.com/wdmahbubur/accounts-management-solution/issues/73
[uploads]: https://github.com/wdmahbubur/accounts-management-solution/issues/27
[workers]: https://github.com/wdmahbubur/accounts-management-solution/issues/45
[invoice-delivery]: https://github.com/wdmahbubur/accounts-management-solution/issues/88
[policy-pr]: https://github.com/wdmahbubur/accounts-management-solution/pull/166
