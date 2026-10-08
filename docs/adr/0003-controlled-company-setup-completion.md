# ADR 0003: Explicit opening position and atomic company activation

Status: implemented for review on `fix/company-setup-completion` (2026-10-08).

## Problem and decision

Company creation seeds the chart, mappings and fiscal calendar but leaves the company in `onboarding`. Posting requires an active company. The opening workflow previously had no supported way to bridge these states and saved the opening document and cutover evidence in separate requests.

The setup command now has two explicit modes:

| Mode | Required evidence | Atomic effect |
| --- | --- | --- |
| Fresh books (`zero_opening`) | Explicit confirmation that no earlier balances, open items, advances or imported year-to-date activity exist; no existing journal, open item or nonvoid opening document | Append completion evidence and activate; create no journal |
| Migrated books (`import_opening`) | Current approved opening document, exact expected version, correct cutover date, and stored trial-balance/YTD evidence | Append completion evidence, activate, and call the existing posting engine in the same transaction |

A zero-valued journal is not fabricated to represent an empty opening position. Existing posting rules require a positive balanced journal. The explicit zero-opening record is the evidence for that case. This is a bounded resolution of the original onboarding/opening-journal wording, not permission to omit existing balances.

The user's explicit AI-led accountant/review/release policy, recorded in issue #115 and this implementation session, overrides external human sign-off prerequisites for this project work. In-app live Owner authorization, `company.update`, import `journal.post`, source-version/digest approval, exact money, period locks and existing posting controls remain required. The command neither creates an approval policy nor silently enables self approval. Sole-owner self approval remains an explicit existing policy choice.

## Invariants and locking

Only a live active Owner may inspect or complete setup. Setup takes the role-administration advisory lock, rechecks authority, and locks the organization. Import preacquires its nested posting idempotency lock before the organization lock to match the existing posting order. Relevant mapped accounts, fiscal years and periods are locked before readiness is checked. Current company identity, all eleven required mappings, the exact initial fiscal calendar and the cutover opening period must be ready.

The immutable completion row records the mode, completing member, time and readiness snapshot, plus document/version/digest for an import. A failed nested posting rolls back activation, completion, journal and idempotency receipt together. Same-key retries replay the receipt; different-key attempts cannot complete twice. Opening document guards prohibit adding a later opening to zero-start books, substituting a second import, or posting multiple opening batches.

Cash accounts and sales/purchase approval policies are shown as actionable tasks for first transactions. Their absence does not imply that an empty legal company's starting ledger is invalid, nor does activation bypass them when a transaction later requires them. This avoids requiring every supported document policy for a company that only uses a subset.

The dedicated cutover preparation workflow requires `journal.write`, `documents.read` and `accounting.read`, so a preparer can inspect the evidence they are replacing. Generic document submission retains its existing capability checks.

`save_opening_cutover_draft` combines the existing source-save and cutover-summary commands in one transaction and stores an outer retry receipt. The wizard retains the exact pending request and key in session storage for uncertain responses. Existing opening drafts resume with party/reference/due-date detail intact; the generic journal editor is not used for them. Unsupported existing dimensions are rejected rather than silently discarded.

## API and UI

- `GET /api/v1/organizations/:organizationId/setup`: live Owner readiness and recorded completion.
- `POST /api/v1/organizations/:organizationId/setup/complete`: idempotent explicit mode and, for imports, current opening document/version.
- `POST /api/v1/organizations/:organizationId/opening-cutover/drafts`: atomic idempotent draft plus evidence save/update.
- `/o/:organizationId/settings/setup`: foundations, mode selection, work in progress, completion receipt and next setup tasks.
- The company creation receipt and onboarding company selector lead to setup. Opening drafts lead to dedicated cutover editing, approval review, and setup activation.

## Validation and limits

`node --conditions=react-server scripts/test-company-setup.mjs` requires explicitly named `TEST_DATABASE_URL` and `TEST_DATABASE_RUNTIME_URL` for the same isolated database; it never falls back to application database credentials. Six sequential cases roll back unique fixtures. Three two-connection races retain unique synthetic organizations and immutable evidence because both connections need committed fixture visibility. Actual restricted runtime cases and privileged fault-injection cases are reported separately.

`node --conditions=react-server --test tests/application/company-setup.test.ts` verifies request/receipt contracts, exact control detail, permissions before RPC, error distinctions and recoverable byte-identical requests. These application tests do not substitute for the PostgreSQL integration scenarios.

The existing open-item engine uses the opening journal accounting date as the open-item issue date and rejects an earlier due date. Therefore overdue historical items cannot yet be faithfully imported by this wizard. This change preserves the rule and does not invent source issue dates. A separate bounded change must add an authoritative original-date contract before claiming arbitrary historical migration support.

Legacy active companies are not backfilled with invented setup evidence. Unsupported hand-authored opening draft dimensions receive an explicit edit failure. This is not a full historical-import implementation, production migration, or blanket acceptance of all accounting workflows. Browser/release evidence is tracked separately by the integrating review.
