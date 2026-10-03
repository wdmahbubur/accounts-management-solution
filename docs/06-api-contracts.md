# API, Command and Integration Contracts
## AMS V1.0 · 29 September 2026

## 1. API principles

The Next.js application exposes `/api/v1/...` Route Handlers or equivalent typed Server Actions. Both call the same domain services and database command routines. There must not be a second less-secure posting implementation behind a different UI. Server Actions and endpoints still require authentication/authorization; framework placement alone is not access control. [S8]

All organization-scoped requests include an org path segment. It is an input to validate, not proof of access. The server derives the actor from the verified Supabase session and active company membership. Never accept `created_by`, `posted_by`, privileged role claims, direct GL lines for business documents, or client-supplied journal totals as authoritative.

Reads return permission-scoped DTOs. A sales operator can receive eligible cash-account labels/IDs for authorized receipts without receiving account numbers or company-wide bank balances. A party statement may expose customer-side movements without granting unrestricted ledger access.

## 2. Common request/response types

Use UUID strings for IDs, `YYYY-MM-DD` for effective/accounting dates, ISO-8601 UTC timestamps for recorded time, and canonical decimal strings for money/quantity/rates. Currency is `BDT` in V1. Request schemas reject unknown critical fields, NaN, infinity, invalid scale and out-of-range amounts.

Mutation headers:

```http
Content-Type: application/json
Idempotency-Key: <random-128-bit-or-stronger-key>
X-Request-ID: <client-correlation-id-if-present>
```

The server creates its own request ID if absent. Do not allow a request ID to bypass validation. Persist an idempotency key for a material financial action; identical authorized replay returns the same result IDs, not another journal. Same key with a different canonical request hash returns conflict. Before replay, recheck current permissions and that the original actor/context is permitted to obtain the response.

```json
{
  "data": {
    "document_id": "uuid",
    "document_number": "INV-2026-000042",
    "state": "posted",
    "journal_entry_id": "uuid",
    "version": 4
  },
  "meta": { "request_id": "req_...", "replayed": false }
}
```

Error response:

```json
{
  "error": {
    "code": "PERIOD_LOCKED",
    "message": "The accounting date is in a locked period.",
    "fields": { "accounting_date": "Choose an open period or request an authorized reopen." }
  },
  "meta": { "request_id": "req_..." }
}
```

HTTP mapping: 401 invalid/expired authentication; 403 known authorized-company action lacking capability; 404 nonexistent or inaccessible cross-company resource to avoid existence disclosure; 409 stale version, duplicate command hash, locked state or capacity conflict; 422 field/business validation; 429 rate limit; 500 sanitized unexpected error. Do not return stack traces, raw SQL or another party's data.

Stable error codes: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_FAILED`, `STALE_VERSION`, `PERIOD_LOCKED`, `DOCUMENT_ALREADY_POSTED`, `APPROVAL_REQUIRED`, `APPROVAL_STALE`, `JOURNAL_UNBALANCED`, `ACCOUNT_NOT_POSTABLE`, `CONTROL_ITEM_REQUIRED`, `ALLOCATION_EXCEEDED`, `PARTY_MISMATCH`, `RECONCILIATION_LOCKED`, `REVERSAL_EXISTS`, `IDEMPOTENCY_CONFLICT`, `DUPLICATE_IMPORT`, `PLAN_READ_ONLY`, `RATE_LIMITED`.

## 3. Route catalogue

In this table `O = /api/v1/organizations/{organizationId}`. All route handlers repeat authorization and call transaction-safe routines when mutating.

| Method/path | Capability | Purpose / atomicity |
|---|---|---|
| POST /api/v1/organizations | Authenticated permitted creator | Create company, owner, role seeds, mappings and periods atomically |
| GET /api/v1/organizations | Own memberships | Minimal accessible-company list |
| GET/PATCH O/settings | company.read/update | Validated mutable organization fields |
| POST O/invitations | users.manage | Issue expiring invitation hash and outbox email |
| POST O/members/{id}/deactivate | users.manage | Revoke membership, protect final owner, audit |
| PUT O/members/{id}/roles | users.manage | Prevent self-escalation and unauthorized grants |
| GET/POST/PATCH O/contacts | Appropriate read/write scope | Shared customer/vendor directory with scoped financial DTOs |
| GET/POST/PATCH O/items | catalog.read/write | Service/non-stock master data |
| GET/POST/PATCH O/accounts | accounting permissions | COA with hierarchy/used-field safeguards |
| GET O/documents | Document-type read scope | Paginated source-document list |
| POST O/documents | Type-specific write scope | Create validated draft and typed extension/rows |
| GET O/documents/{id} | can_read_document | Snapshot, available actions, scoped delivery/settlement data |
| PATCH O/documents/{id} | Type-specific write scope | Draft update with expected version; increment version and invalidate approvals |
| POST O/documents/{id}/allocation-plan | Type-specific write + dues permission | Save draft targets/amounts into document_allocation_plans, increment version |
| POST O/documents/{id}/preview-posting | Posting-preview scope | Deterministic read-only calculation and warnings; no journal allocation |
| POST O/documents/{id}/submit | Type-specific write | Bind current material digest and policy snapshot |
| POST O/approval-requests/{id}/decision | approvals.decide | One eligible decision with maker-checker and version checks |
| POST O/documents/{id}/post | Type-specific post | Source + journal + open items + planned settlement + audit/outbox in one transaction |
| POST O/documents/{id}/void | Type-specific write | Unposted document only; preserve audit and numbering history |
| POST O/documents/{id}/reverse | Explicit correction scope | Validate dependencies and create opposite event in open period |
| POST O/allocations | dues.allocate | Match two existing opposite open items with locks; no new journal |
| POST O/allocations/{id}/reverse | dues.allocate + correction | Append dated unapply record and audit |
| POST O/advances/{id}/apply | Finance advance application | Reclassification journal plus two corresponding allocation groups |
| POST O/documents/{id}/send | Authorized document delivery | Explicit recipient review; enqueue after checking source permission |
| POST O/bank-imports | banking.write | Upload/stage raw rows; no automatic financial posting |
| POST O/reconciliations | banking.write | Create statement session |
| POST/DELETE O/reconciliations/{id}/matches | banking.write | Draft-only matching with capacity locks; preserve audit |
| POST O/reconciliations/{id}/finalize | Reconcile capability | Zero unexplained difference and evidence snapshot |
| POST O/reconciliations/{id}/reopen | Explicit reopen scope | Reason/reauthentication, retain prior evidence |
| GET O/reports/{reportType} | Report-specific capability | Consistent-snapshot report, filters, cutoff and drilldown token |
| GET O/dashboard | reports.read plus scoped sales.read/purchases.read/dues.read | Compose the shared P&L, balance-sheet, cash-flow and aging snapshots; omit every metric the actor cannot read; disable response caching |
| POST O/exports | reports.export or scoped export | Create permission-bound export job |
| GET O/exports/{id}/download | Current report/source scope | Recheck access and issue short-lived private URL |
| POST O/periods/{id}/lock | periods.lock | Run checks, synchronize locks and save evidence |
| POST O/periods/{id}/reopen | periods.reopen | Reauthentication and reason; audit, invalidate affected caches |
| GET O/fiscal-years/{id}/close-preview | accounting.read | Nominal balance preview, period checklist and retained-earnings mapping |
| POST O/fiscal-years/{id}/close | periods.lock + recent authentication | Close journal + immutable close-run snapshot; avoid duplicate retained earnings |
| POST O/fiscal-years/{id}/reopen | periods.reopen + recent authentication | Open fiscal periods and post a linked close reversal while retaining prior evidence |
| POST O/import-jobs | imports.run | Stage supported structured import |
| POST O/import-jobs/{id}/validate | imports.run | Mapping checks and row error report |
| POST O/import-jobs/{id}/commit | imports.run + relevant write/post | Idempotent typed import; opening batch atomic |
| POST O/attachments/upload-intent | attachments.write + source write | Allocate a private path scoped to a permitted source/draft |
| POST O/attachments/{id}/complete | Same source capability | Validate actual object size/hash/type and scan state |
| GET O/attachments/{id}/download | Linked document scope | Short-lived permission-checked URL for clean object |
| GET O/audit | audit.read | Redacted append-only evidence |
| GET O/subscription | subscription.read | Platform plan/entitlements only |
| POST O/subscription/checkout | subscription.manage | Approved provider adapter; no local success shortcut |
| POST /api/v1/webhooks/billing/{provider} | Verified provider signature | Deduplicate raw provider event before entitlement change |
| POST /api/internal/outbox | Internal worker bearer secret | Claim bounded invitation mail batch; leased, fenced delivery with retry/backoff; no financial posting |
| GET /api/internal/outbox | Internal worker bearer secret | Read redacted failed-event metadata for operations |
| POST O/attachments/upload-intents | attachments.write plus source-module write capability | Create a short-lived organization-bound quarantine upload intent |
| POST O/attachments/uploads/{intentId}/complete | attachments.write plus source-module write capability | Verify private object digest and record a pending-scan evidence link |
| GET O/invoices/{documentId}/pdf | sales.read | Retrieve or render an immutable PDF for the current posted invoice version |
| POST O/exports | reports.export plus reports.read, accounting.read and ledger.read | Idempotently request a trial-balance CSV export |
| GET O/exports | exports.read | List only the current requester's export job metadata |
| POST /api/internal/exports | Internal export worker bearer secret | Render a bounded trial-balance batch under fenced leases and retry/backoff |

These are proposed contracts, not deployed endpoints. Exact RPC names can follow the same domain verbs. All writes must be present in the permission catalogue; do not add an endpoint with an implicit “all authenticated users” grant.

## 4. Invoice draft example

```json
{
  "document_type": "invoice",
  "party_id": "customer-uuid",
  "issue_date": "2026-09-29",
  "accounting_date": "2026-09-29",
  "due_date": "2026-10-29",
  "currency": "BDT",
  "recognition_mode": "earned_or_incurred",
  "performance_confirmed": true,
  "description": "Completed monthly support service",
  "lines": [
    {
      "description": "Support service",
      "quantity": "1.000000",
      "unit_price": "10000.000000",
      "discount_amount": "0.00",
      "account_id": "service-revenue-account-uuid",
      "tax_code_id": null,
      "tax_mode": "exclusive",
      "cost_center_id": null
    }
  ]
}
```

The response returns server-calculated totals and version. It does not accept a posted state supplied by the browser. The posting request is intentionally small:

```json
{ "expected_version": 4 }
```

The transaction uses the persisted source, lines, tax snapshots and approved allocation plan. User-supplied journal rows are accepted only by a separately authorized manual-journal draft operation, with control-account restrictions.

## 5. Receipt draft and allocation plan example

```json
{
  "document_type": "receipt",
  "party_id": "customer-uuid",
  "issue_date": "2026-09-29",
  "accounting_date": "2026-09-29",
  "movement": {
    "cash_account_id": "bank-uuid",
    "direction": "in",
    "amount": "6000.00",
    "method": "bank_transfer",
    "reference": "BANK-REF-001",
    "cash_flow_class": "operating"
  },
  "allocation_plan": [
    { "target_open_item_id": "invoice-ar-item-uuid", "amount": "6000.00" }
  ]
}
```

The plan is saved into typed same-tenant rows and included in the material digest. At posting, the newly created AR credit open item is matched to the eligible debit item. If its residual changed after approval, the operation returns conflict with a fresh preview; it does not silently use another invoice or create a different allocation.

## 6. Database command authority and idempotency

Ordinary authenticated callers have no direct INSERT/UPDATE/DELETE rights on ledger tables. Financial mutation occurs in validated private routines reached via a deliberate API wrapper. Fix search_path and qualify every referenced object; restrict EXECUTE; derive auth.uid and membership; avoid broad service-role CRUD. [S14]

A command can acquire a transaction-level advisory lock for the org/operation/key, then read an existing idempotency response or perform the command and persist the successful response at commit. Source-row locking and unique source_document_id still prevent double posting even when a caller changes the idempotency key. Do not use a short-lived request cache as the only protection against duplicate financial effects.

A repeated authorized request after an uncertain network response must return the existing resource. A different payload under the same key is conflict. A failed transaction rolls back all financial effects; the UI keeps the same key for a safe retry. Do not indiscriminately retry validation, permission or closed-period failures.

## 7. Workers and integrations

Outbox events include document.posted, document.send_requested, report.export_requested, import.validation_requested and subscription.event_received. The financial transaction persists the event; a worker claims rows with a lease, uses an event deduplication key and records outcomes. Delivery is at-least-once, so handlers must be idempotent. An invoice can have several email attempts without several journals.

Email/PDF: validate recipients, freeze issued content, store immutable rendered version/checksum, keep retry state outside document posting state. Billing: verify signature against the raw request body, compare provider event ID and company mapping, and process out-of-order events using a provider reconciliation check where needed. Never let a provider webhook change a tenant's business ledger automatically.

Storage: use private buckets, scoped paths and expiring URLs; a path naming convention alone is not authorization. Validate uploaded object metadata and link it to a permitted same-company source. The storage policy/command must not grant access solely because a user knows an object key. [S15]

Bank feeds, payment execution, accounting imports from other providers and AI are later adapters. Do not ship inactive “Connect Bank” buttons suggesting a completed integration.

## 8. Proposed codebase modules

```text
apps/web/
  app/(auth)/
  app/(tenant)/o/[org]/
  app/api/v1/
  components/finance/
  server/auth/
  server/commands/
  server/queries/
  server/integrations/
packages/accounting/        # pure decimal-safe calculation and posting rules
packages/contracts/        # shared request/response/error schemas
packages/permissions/      # capability names, no client-side authority
packages/reporting/        # report definitions, cash-flow mapping, DTOs
packages/test-fixtures/    # golden ledgers and cross-module expectations
supabase/migrations/       # generated during implementation, version-controlled
supabase/tests/            # database guards, RLS, concurrency and restore checks
workers/                   # outbox consumers and controlled imports/exports
```

Keep source code cohesive; a separate API deployment or worker service is justified only by measured workload/security needs. No repository, database or deployment has been modified by this specification work.
