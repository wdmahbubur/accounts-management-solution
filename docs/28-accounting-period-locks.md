# US-016 accounting period lock implementation notes

`supabase/migrations/20261002160000_accounting_period_lock_protocol.sql` adds an internal accounting-date lock helper and organization-scoped period lock/reopen commands.

## Lock protocol

The internal `finance_private.lock_accounting_date(organization_id, accounting_date, allow_opening)` helper is for financial database routines. Call it inside the same transaction, before locking source documents or subledger rows. It locks the organization policy row, then the fiscal-year row, then the accounting-period row; it rejects dates before books start, dates without an open period, closed fiscal years and locked periods. Opening dates are only accepted for books-start minus one when a trusted opening-balance routine explicitly enables that path.

Period lock and reopen commands use the same organization → fiscal year → period order, require live `periods.lock` or `periods.reopen` capability plus recent authentication, compare the current row version, require a 10–1000 character reason, append a protected period event and audit record in the same transaction. Reopening a period within a closed fiscal year is rejected; year-close owns that transition. The lock event snapshot currently records draft and posted document counts; this is not the full close checklist owned by US-060.

The UI provides period status, dates, visible lock history subject to audit permissions, and reason forms for the caller's lock/reopen capabilities. Read access continues to use `accounting.read`.

## Integration and verification status

The posting, allocation, unapply, import and reversal commands are later stories and do not exist yet on `master`. Their routines must call the shared lock helper before acquiring their source-specific locks for US-016's cross-path race guarantee to be complete. This PR supplies the shared protocol and period state commands; it does not claim those future entry paths are implemented.

Per the user's instruction to complete implementation before running tests, no application, migration, database, race, browser or static checks have been run. No hosted database or production migration was changed.
