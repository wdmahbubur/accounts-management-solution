# Implementation progress

## US-049 — bank statement import

Implemented in the application on 3 October 2026. The organization-scoped wizard supports UTF-8 CSV and single-sheet XLSX files, maps transaction date and description plus either signed amount or debit/credit, and optionally maps value date, balance and bank reference. It saves mappings on the current device, previews sample rows, reports row validation errors, warns on repeated and prior fingerprints before confirmation, keeps exact raw row values, and rejects formula cells and unsupported or oversized files.

The confirm command checks the live `banking.write` capability and active cash account in a database-owned procedure. It stores the original file bytes in a private database schema, records the SHA-256 file hash, statement rows and import atomically, and creates no journal or cash-book movement. Same-account exact-file retries return the existing import. Matching transaction fingerprints are retained and flagged for review; provider transaction IDs remain unique per cash account.

Migrations `0040_bank_statement_imports.sql`, `0041_private_bank_import_source.sql` and `0042_statement_import_fingerprint_review.sql` were applied to the configured development Neon database. Lint, typecheck and production build passed. Automated, real-role authorization, replay/race and browser acceptance tests were not run, so the issue's required verification and human review remain open. Original source files can be recovered only by a privileged database operator; no source-file download UI is implemented by this story.

## US-050 — partial bank reconciliation matching

Implemented in the application on 3 October 2026. The reconciliation workspace shows the statement rows and posted book cash lines for a date range, residual capacities, exact same-date/amount suggestions, and supports partial many-to-many associations. It checks account, direction and date compatibility, locks both capacity rows before checking current matches, and allows draft matches to be reversed only with a reason. Reversals and match actions are append-only audit evidence; no matching command posts a journal.

Migrations `0043_reconciliation_matching.sql` and `0044_operational_cash_account_options.sql` were applied to the configured development Neon database. Lint, typecheck and production build passed. The concurrency and real-role acceptance cases were not run as instructed; the issue remains open pending that evidence. Reconciliation finalization and period reopen are tracked as separate work and are not implemented here.

## US-051 — finalize and reopen reconciliation evidence

Implemented on 3 October 2026 (the GitHub issue is closed as a duplicate of the reconciliation story). Finalization requires the statement opening plus imported movements to equal its statement closing, then requires statement closing adjusted by outstanding posted deposits/payments to equal the posted ledger closing. It records a detailed immutable evidence snapshot and audit event. Finalized date ranges cannot overlap; new statement rows or cash postings that would change a finalized book period are blocked until authorized reopen. Reopen requires `periods.reopen`, recent reauthentication and a reason; the prior snapshot and reopen reason are retained in append-only records. Source reversal remains blocked while finalized or active draft matches remain.

Migration `0045_reconciliation_finalize_reopen.sql` was applied to the configured development Neon database. Lint, typecheck and production build passed. Automated balance, recent-auth, authorization, reversal and concurrency cases were not run per instruction; no acceptance result is claimed.

## US-053 — opening-balance and mid-year cutover wizard (in progress)

The organization settings wizard collects the cutover date, exact BDT prior trial balance, AR/AP/advance details (party, reference and due date), nominal YTD balances and a source-evidence reference. It creates an ordinary opening-balance draft dated the day before books start; it does not create historic invoices. A protected database summary preserves the source trial balance and YTD component. A database transition guard blocks approval/posting until the source rows exactly match that trial balance, control details are complete, the trial balance balances, and opening suspense is zero. The stored summary is exposed through a permission-checked read command for annual-report integration.

The cutover evidence is downloadable as a permission-checked JSON export. Annual P&L inclusion of the stored YTD summary remains dependent on the V1 P&L/report implementation and is not complete here. Migration `0046_opening_cutover_wizard.sql` is applied to the configured development Neon database. Lint, typecheck and production build pass (with the existing private-storage tracing warnings). Automated tests were not run as requested.

## US-054 — report hub and snapshot context (in progress)

Added a permission-filtered report hub containing only currently implemented Trial Balance, General Ledger, Journal Register and cashbook surfaces. Migration `0047_report_snapshot_contract.sql` adds a permission-checked report command that executes report rows and captures company, timezone, filters, generation time, database cutoff, template version and provisional status in one statement snapshot. The Trial Balance, General Ledger and Journal Register pages now consume this command; the cashbook API surface is wired to it as well. P&L and Balance Sheet will appear when their reports are implemented. Durable report/export jobs and filter-matched downloadable export history remain outstanding; this story is not marked complete. The migration is applied to development Neon. Automated tests were not run as requested.

## US-055 — accrual Profit and Loss with cutover and close behavior (in progress)

Implemented a permission-checked P&L snapshot from posted nominal account activity with date range, optional cost center and non-overlapping comparison period. Opening journals and year-close entries, including reversals of year-close entries, are excluded from period activity. An approved mid-year cutover YTD summary is included once when a requested range covers fiscal-year start through cutover, with its evidence reference and summary balances shown separately from post-cutover ledger movement. Cost-center reports disclose that unallocated imported YTD detail is excluded and are marked provisional. The report hub now links to P&L, and `reports.export` users can download the filter-matched JSON snapshot.

Migration `0048_profit_and_loss_report.sql` was applied to configured development Neon. `npm run lint`, `npm run typecheck` and `npm run build` passed; the build retains existing private-storage tracing warnings. Automated golden fixture, cutover, close and browser acceptance cases were not run per instruction, so the issue remains open and those criteria are not asserted as verified.

## US-056 — Balance Sheet without retained-profit double counting (in progress)

Added a permission-checked as-of Balance Sheet snapshot from cumulative posted ledger balances, with comparison date, account drilldown, assets/liabilities/equity sections, a separate untransferred-earnings line, exact balance difference and permission-gated JSON export. Closing journals affect retained-earnings account balances as posted; their nominal accounts are no longer counted after the close zeros them. A posted close reversal restores nominal balances and removes the corresponding transferred equity balance, so the report follows the effective ledger history without a plug. The statement is labeled as a management report, not a statutory filing.

Migration `0049_balance_sheet_report.sql` was applied to configured development Neon. `npm run lint`, `npm run typecheck` and `npm run build` passed (with the existing private-storage tracing warnings). Golden scenario, close/reclose and browser acceptance cases were not run per instruction; no independent accounting validation is claimed and the issue remains open.

## US-057 — historical AR/AP aging and credit presentation (in progress)

Added receivable and payable aging pages using the existing dated open-item residual helper. The report calculates balances at the selected effective date and database snapshot cutoff, groups trade debt into not-due, 1–30, 31–60, 61–90, 91+ and no-due-date buckets, and lists unapplied trade credits separately. Customer and vendor advances remain in their own control sections; a contact with both roles is reported separately in AR and AP. Each report bridges trade and advance open-item balances to their mapped GL control accounts, links to source documents where the reader has access, and offers receipt/payment draft links to writers. JSON download requires `reports.export`.

Migration `0050_historical_aging_reports.sql` was applied to configured development Neon. `npm run lint`, `npm run typecheck` and `npm run build` passed (with existing private-storage tracing warnings). Historical receipt/unapply fixtures, cross-role authorization and control tie-out cases were not run per instruction; the issue remains open and no acceptance results are claimed.

## US-058 — customer and vendor statements with allocation history (in progress)

Added a party-search statement workspace for scoped customer AR and vendor AP, with selected date range, opening balance, signed source movements, running and closing balances, and a separate advance statement/control. Allocation and unapply records appear as dated, zero-balance-effect evidence linked to the counter-document; receipt/payment source items provide the financial balance movement, so settlements are not counted twice. Party identity and role are verified in the tenant-scoped database command; a dual-role contact produces separate customer and vendor reports. The report includes ledger control bridges, generated/cutoff context, JSON export under `reports.export`, source links when the reader has access, and browser print/Save as PDF.

Migration `0051_party_statements.sql` was applied to configured development Neon. `npm run lint`, `npm run typecheck` and `npm run build` passed (with existing private-storage tracing warnings). Statement allocation-history, cross-tenant, control-reconciliation and browser acceptance cases were not run per instruction. No email delivery action is implemented; the story remains open and no acceptance results are claimed.

## US-059 — classified management cash-flow report (in progress)

Added a permission-checked cash-flow snapshot and date-range page. The report derives opening/closing cash from posted ledger balances on explicitly designated cash-equivalent accounts, excludes non-cash entries and opening journals from current-period flows, separates operating/investing/financing, and shows internal transfer principal separately. Transfer fees are operating outflows. A transfer crossing the cash-equivalent boundary, an unclassified line, or an invalid internal/opening label is disclosed and keeps the report provisional. New drafts can explicitly classify cash movements and manual journal rows; posted history remains immutable. The report reconciles ledger closing cash to opening plus classified and exceptional net movements, and supports capability-gated JSON export and GL drilldown. It is labeled a management report, not an IAS 7 statement.

Migration `0052_classified_cash_flow.sql` was applied to configured development Neon; `npm run db:migrate` reported `Applied 0052_classified_cash_flow.sql` and `Migration check complete (52 files)`. `npm run lint`, `npm run typecheck`, and `npm run build` passed; the existing private-storage Turbopack tracing warnings remain. Automated golden scenario, transfer fee, classification-block and cross-role/browser acceptance cases were not run as requested. No finalization command exists for this report, and the issue remains open; no acceptance results or independent accounting approval are claimed.

## US-060 — month/period close checklist and controlled reopen (in progress)

Added a database-computed close checklist for pending approvals, draft documents, unfinished overlapping bank reconciliations, AR/AP/advance control-account tie-outs, non-zero mapped suspense, unclassified cash-equivalent activity and posted trial-balance integrity. Mapped input/output tax control balances are disclosed for filing review without inventing a tax policy. The period workspace can run and display checks and only offers Lock after a passing result; the lock routine recomputes the checklist while holding the existing fiscal-year/period lock and refuses any blocking exception. Its immutable `period_events` lock snapshot records all check results. Period history is available under `audit.read` and retains lock/reopen reasons and prior snapshots. Existing reopen remains capability-checked, reasoned, recent-authenticated and append-only.

Migration `0053_period_close_checklist.sql` was applied to configured development Neon; `npm run db:migrate` reported `Applied 0053_period_close_checklist.sql` and `Migration check complete (53 files)`. `npm run lint`, `npm run typecheck`, and `npm run build` passed; existing private-storage Turbopack tracing warnings remain. Automated period-lock race, financial path coverage, real-role authorization and browser acceptance cases were not run as requested, so no such acceptance result is claimed and the issue remains open.

## US-061 — fiscal-year close, retained earnings and reclose history (in progress)

Added a year-close preview for nominal account balances and mapped retained earnings, plus prerequisites for a complete locked fiscal calendar, passing period checklists, valid equity mapping, no active close and no earlier open fiscal year. Closing requires `periods.lock`, recent authentication and a reason; it creates an approved internal year-close source, balanced `is_year_close` journal, immutable close-run report snapshot, audit evidence and idempotent receipt in one database transaction. The year P&L excludes close mechanics. Reopening requires `periods.reopen`, recent authentication and reason, opens the year/periods under the shared year-then-period lock order, posts exact linked reversal lines in the original year end, records reopen events, and links the prior run to the reversal without replacing its snapshot. A reclose creates a new live run; a partial unique index still permits only one active close.

Migrations `0054_fiscal_year_close.sql` and `0055_year_close_transition_guards.sql` were applied to configured development Neon; the runner reported both applied and `Migration check complete (55 files)`. `npm run lint`, `npm run typecheck`, and `npm run build` passed; the existing private-storage Turbopack tracing warnings remain. Automated profit/loss golden, close/reopen/reclose, race, role and browser cases were not run as requested. The close operation uses the existing privileged period-lock capability and recent-auth gate; a separate multi-person year-close approval step is not implemented. The issue remains open and no acceptance result is claimed.

## US-062 — ledger-driven finance dashboard (in progress)

Replaced the company details landing page with a dynamic, Auth.js/Neon-backed dashboard. The new `read_finance_dashboard` routine composes the existing shared P&L, balance-sheet, cash-flow and aging snapshots, uses exact money strings in its output, and only includes report, receivable, payable and audit fields when the current actor has the corresponding capability. The page shows date-filtered accrual performance, cash-equivalent balance as of the selected date, assets, receivables/payables and overdue totals, upcoming bills, monthly post-cutover trend, provisional notices and safe report drilldowns. It identifies the ledger cutoff and empty state and does not cache tenant dashboard data. Pre-cutover YTD summaries remain in headline report totals and are not spread across chart months.

Migrations `0056_ledger_dashboard.sql` and `0057_dashboard_cash_as_of.sql` were applied to configured development Neon. `npm run lint`, `npm run typecheck` and `npm run build` passed; the build reports the existing three private-storage filesystem tracing warnings. Automated golden-ledger, role-denial, tenant-switch/cache and browser acceptance checks were not run as requested, so the issue remains open and those acceptance outcomes are unverified.

## US-066 — scoped audit search (in progress)

Added a read-only audit trail page with actor, Dhaka date, entity and action filters and keyset pagination. Migration `0059_scoped_audit_search.sql` adds a tenant-scoped query, per-module read checks and recursive sensitive-field redaction. The issue's listed prerequisites and authorization/tenant acceptance cases remain unverified; the issue remains open.

## US-068 — private attachment upload (in progress)

Added organization-bound upload intents and multipart completion routes with filename, MIME/signature, 10 MiB size and SHA-256 checks. Objects are stored privately and linked as `pending` scan status. The authorized download path requires `clean` status and rechecks access around the read; no scanner is connected, so uploaded files remain unavailable for download. Migration `0061_private_attachment_uploads.sql` is applied. Automated security and tenant tests were not run as instructed; the issue remains open.

## US-069 — leased outbox delivery (in progress)

Added a bounded, fenced outbox worker for invitation, invoice PDF and generic reminder email with exponential retry, sanitized errors and internal bearer authentication. Migrations `0058` and `0060` add fenced leases/dead letters and immutable invitation cancellation; `0069` queues invoice delivery from an immutable PDF version; `0071` adds opt-in reminder events; `0072` extends the claim filter and records reminder delivery state. Local development writes private mail previews. SMTP delivery, cron invocation and crash/retry acceptance cases remain unverified; the issue remains open.

## US-070 — export orchestration (in progress)

Added idempotent trial-balance CSV export requests, requester-owned export job UI, leased rendering, permission-checked downloads and cancellation of queued jobs. Cancellation is serialized against worker claim and audited in migration `0070`. Existing migrations `0062`, `0064` and `0065` provide request, worker and digest-verified download behavior. Migration `0073` adds bounded UTF-8 CSV staging, validation previews and retryable row progress for contacts and service items; each committed row uses the existing typed save command with a stable per-row idempotency key. Financial/opening-balance imports remain disabled. The import screen is linked from the workspace navigation and preview/result identifiers are capability-filtered. Export orchestration currently covers Trial Balance; invoice CSV remains a separate direct read, and filtered statement/P&L/Balance Sheet exports are not implemented as jobs. Scheduled worker invocation, expired export-object cleanup, abandoned import-upload cleanup and the issue's acceptance cases remain outstanding; the issue remains open.

## US-071 — invoice PDF versions (in progress)

Added a server-side renderer and immutable PDF metadata bound to the posted invoice version and material digest, with an authorized retrieval route and invoice-detail link. Migration `0063` stores immutable PDF versions; `0069` adds an authorized idempotent send request, durable delivery rows and lease-fenced metadata lookup. The invoice detail exposes send/resend for `sales.write`; requests use the issued PDF version and never invoke posting. The outbox worker attaches that exact PDF and checks stored digest/size. Bengali conjunct shaping and SMTP/provider delivery remain unverified. Prerequisites US-021 (#44), US-068 (#27) and US-069 (#45) remain open; this issue stays in progress.

## US-083 — customer/vendor and invoice list search (in progress)

Customer, vendor and invoice directories accept bounded URL search/status filters, preserve filters across deterministic keyset pagination, and provide saved per-user filters plus `/` and Escape shortcuts that respect editable fields and unsaved forms. Invoice saved filters are isolated by user and organization. No migration was needed; prerequisite US-021 and acceptance evidence remain outstanding, so the issue remains open.

## US-021 — first invoice-to-ledger vertical evidence (blocked)

The existing implementation includes draft/approval/post commands, customer receipts and allocations, ledger queries and dated reversal routines, with tenant-scoped SQL guards. The acceptance matrix still marks T-01/T-02/T-03/T-06/T-22/T-23/T-24/T-47/S-09/S-18 pending with no execution evidence, and its five closed prerequisites still identify QA as pending. Per product-owner instruction no automated test suite or concurrency/replay acceptance run was performed. A normal local UI walkthrough would not prove runtime-role grants, database negative cases, competing connection behavior or commit-before-response replay; issue #44 therefore remains open/status:blocked and no acceptance result is claimed.

For the E10 import and US-083 invoice-filter batch, migration `0073_staged_master_data_imports.sql` was applied to development Neon; `npm run db:migrate` reported `Migration check complete (72 files)`. One consolidated `npm run lint`, `npm run typecheck`, and `npm run build` passed after correcting the importer findings. `git diff --check` passed. The build emits three existing dynamic private-storage filesystem-tracing warnings, now including the importer route. Automated suites and authenticated financial/import acceptance flows were not run. No production deployment was performed.

For these slices, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run db:migrate` (65 migrations) and `git diff --check` passed. The production build reports three private-storage filesystem tracing warnings. Automated test suites were not run at the product owner's instruction. The app smoke check returned HTTP 200 for `/` and `/auth/sign-in`, and HTTP 401 JSON for unauthenticated export/PDF requests; no authenticated financial workflow or provider integration was simulated.

## US-067 — private evidence library (in progress)

Added `/o/[organizationId]/documents` with bounded filename/source/uploader search, Dhaka upload-date filters, safe source/uploader metadata, scan state, pagination and clean-only download links. Migration `0066_scoped_evidence_library.sql` requires `attachments.read`, checks every linked source against current actor access, and returns no object keys, digests or bytes. No malware scanner is connected, so uploaded files remain pending and cannot be downloaded. The issue remains open.

## US-072 — customer/vendor search, saved filters and keyboard access (in progress)

Completed the customer/vendor list slice: URL-scoped search and status filters use the server's tenant-scoped keyset query. Saved filters are isolated by user, organization and directory in local storage; `/` focuses search and Escape clears it while respecting focused inputs and other unsaved forms. Invoice-list search and full cross-screen acceptance remain outstanding. No migration was needed; the issue remains open.

## US-073 — in-app notification center (in progress)

Added a member-scoped notification center for approvals, due invoices/bills, failed document email and the current user's failed exports. Migration `0068` adds read state; `0071` adds default-off per-member email preferences and a company-local-date deduplicated reminder scheduler that rechecks current member access, preferences and actionable source state at delivery. The worker support in `0072` sends generic links without amounts or source names. The internal scheduler needs a configured cron caller; SMTP, retry acceptance and due-date behavior remain unverified. The issue remains open.

The 0066/0068 batch previously passed `npm run lint`, `npm run typecheck`, `npm run build`, `npm run db:migrate` (67 files) and `git diff --check`; it emitted three private-storage filesystem tracing warnings. Migrations `0069`–`0072` are now applied in the configured development Neon database (71 migration files total). For this E10 batch, `npm run lint`, `npm run typecheck`, `npm run build` and `git diff --check` passed; the build retains the same three private-storage tracing warnings. Automated test suites remain skipped per product-owner instruction.
