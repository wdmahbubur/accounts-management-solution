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
