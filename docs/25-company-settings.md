# US-012: company settings and immutable accounting foundation

The company settings screen at `/o/[organizationId]/settings/company` and its
GET/PATCH API at `/api/v1/organizations/[organizationId]/settings` require live
`company.read` and `company.update` respectively. Billing has no implicit
company-profile read capability; an explicit company.read role can view the
profile/calendar without changing it. Every API/Server Action uses the shared
verified-identity boundary. Cookie API writes also validate configured Origin,
current company and context nonce. No runtime service-role key is used.

Profile editing includes display/legal names, country code, contact details,
address, timezone, fiscal start month and books-start date. BDT is immutable.
Unknown fields and caller-supplied authority are rejected. An integer settings
version is required; stale edits return STALE_VERSION instead of last-write-wins.
Changing a timezone never rewrites stored accounting dates. Contact/address
values are redacted in the material-change audit, which retains actor, reason,
time, changed field names, before/after configuration and version numbers.

Only a genuinely unused onboarding calendar may be rebuilt. The opening period
is exactly the day before books start. Regular periods begin at books start and
remain inside the enclosing fiscal year. Exclusion constraints prevent overlap.
The first source/import/sequence/snapshot/export/close activity permanently freezes
foundational dates and increments the version. Removing later drafts does not
remove the lock. A non-onboarding company is also frozen. First activity takes
the organization row lock before freezing; settings changes take that same row
lock after the shared access-management advisory lock. Independent-session tests
exercise two settings writers and both orderings of first activity versus settings.
The winner commits a coherent configuration; a stale or locked edit is rejected.

Migration `20261001093408_company_settings_and_calendar_guards.sql` was already
created using the repository CLI in the original DB-first branch. The upgrade
backfills locks on used companies without changing original amounts, accounting
dates, membership identities or legacy address fields. Prefer forward corrections;
never restore older books or clear the permanent lock as an application rollback.

The form has read-only/offline/pending and validation/conflict feedback, a reason
field, a server-provided calendar, visible explanations for locked settings and an
explicit reload action that warns before discarding stale edits. Permissions are
rechecked by child page, API and SQL; the persistent shell is not an authority.

Verification includes strict input and DTO tests, ordinary-role pgTAP, real Auth
and browser forms/API tests, stale-tab and company-switch rejection, live removal,
Unicode/contact redaction, first-activity freeze, independent concurrent sessions,
and pre-settings upgrade preservation. Results belong to the final tested PR head,
not to this document or to the existence of test files.

T-50 is exercised through application and database currency rejection. T-34 is
covered here only at the configuration boundary: a locked period prevents calendar
rebuild. Complete posting/allocation/unapply/import/reversal period enforcement is
the US-016 guard and its financial-command consumers. Logo scanning/upload and
immutable issued PDF output belong to US-068 and output stories. This settings
story does not invent tax policy, post transactions, send emails, deploy production
or substitute for independent accountant/security/pilot approval.
