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
