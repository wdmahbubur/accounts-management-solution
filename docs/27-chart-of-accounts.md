# US-014 chart of accounts implementation notes

This implementation adds an organization-scoped chart-of-accounts surface and versioned account/mapping commands in `supabase/migrations/20261002150000_chart_of_accounts_commands.sql`.

The application contract currently lives in `GET/POST /api/v1/organizations/{organizationId}/accounts` and `POST /api/v1/organizations/{organizationId}/account-mappings`. The version fields are implementation additions to the reference `accounts` and `account_mappings` tables; the original source dictionary and API contract remain verbatim.

## Implemented scope

- Company account listing, tree/table views, account create/edit/archive controls and mapping assignment UI.
- `accounting.read` plus `journal.write`, active membership, recent authentication and writable-company checks for mutations. Database routines repeat capability and organization checks.
- Composite organization references remain authoritative. Accounts carry a compare-and-swap row version; every accepted edit increments it and writes audit evidence in the same transaction.
- Database guards reject hierarchy cycles, children below postable/inactive parents, incompatible controls, classification changes after first ledger use, and incompatible mappings. Ledger line insertion locks its account and requires the same company's active postable account so first use and classification updates serialize.
- The 11 mapping keys seeded by company onboarding remain the supported contract. Mapping choices are constrained to the account type, side and control classification defined in the source rules. Missing mappings are shown as a blocking configuration problem; there is no suspense fallback.
- Account deletion is not exposed. Database foreign keys retain referenced records; used classifications and codes stay stable.

## Decision gate and verification status

US-001's owner/accountant approval of the chart and report mappings remains open. Existing source mappings are preserved, but this implementation does not represent that approval, tax advice or statutory reporting certification. The accounting posting engine and report drilldown belong to other stories.

Per the user's instruction to finish implementation before running tests, no application, migration, database, browser or static checks have been run for this slice. The focused draft PR must remain unverified until those checks and the required accounting/security reviews are completed. No hosted database or production migration was changed.
