# Database and Security Design
## AMS V1.0 · 29 September 2026

## 1. Delivery boundary

`reference-schema.sql` defines **52 V1 tables**, exact numeric domains, types, tenant-scoped relationships, indexes and a read-only RLS baseline. `04-data-dictionary.md` documents every generated field and constraint. The SQL assumes a new Supabase/PostgreSQL environment with `auth.users` and the usual `anon`/`authenticated` roles. It is a design reference, not an already-applied migration or a complete accounting engine.

No write permission is granted to ordinary API users. This is deliberate: business command routines and the cross-row guards below must be implemented and tested before enabling application writes. Running this SQL does not by itself make invoices post, authenticate an app, process billing or satisfy the launch gate. The provided reference has not been executed against PostgreSQL in this conversation.

Use Supabase CLI-created versioned migrations during implementation, install supported extensions, seed permissions/role templates through a controlled onboarding command and test clean installation plus upgrade paths. Do not paste the reference into an existing live project with data.

## 2. Chosen architecture

```text
Responsive Next.js App Router application
  ├─ Server-rendered reads and explicit DTOs
  ├─ Client form/table interactions
  └─ Server Actions / Route Handlers (verify caller, validate request)
             ↓ caller-scoped API routines
Supabase PostgreSQL
  ├─ finance          private business tables + read RLS
  ├─ finance_private  permission helpers and validated command routines
  ├─ api              deliberate typed RPC wrappers created during implementation
  └─ auth             Supabase-managed identity, never recreated by this schema
             ↓ transactional outbox
Worker / scheduled queue consumer
  ├─ invoice/report rendering
  ├─ email delivery
  ├─ staged import processing
  └─ entitlement webhook processing

Supabase private Storage: source evidence and generated exports
Vercel: web deployment; queue consumer placement chosen to fit workload/runtime limits
```

The initial backend is a modular monolith, not multiple microservices. Keep pure accounting calculations in a tested TypeScript package with decimal-safe values, and transactional invariants close to PostgreSQL. Use PostgreSQL routines for atomic source→journal commands. UI components must not contain the only copy of a posting rule.

The finance and finance_private schemas are not directly exposed as broad CRUD APIs. Only deliberate RPC wrappers in the configured exposed API schema are public endpoints. Read routines use caller-scoped, RLS-safe access and return minimal DTOs; an endpoint is not authorized merely because it runs in a Server Action. [S8]

Use a current supported Next.js release and Supabase libraries pinned at implementation time. The design uses longstanding PostgreSQL 15+-compatible features; do not assume the database service runs the same major version as the public PostgreSQL “current” documentation. Review provider release notes before migrations. [S13]

## 3. Module/table map

| Module | Tables |
|---|---|
| Identity and tenancy | profiles, organizations, organization_members, permissions, roles, role_permissions, member_roles, invitations |
| Accounting configuration | fiscal_years, accounting_periods, accounts, account_mappings, cost_centers, tax_codes |
| Master data | contacts, items, cash_accounts |
| Source documents | document_sequences, business_documents, trade_documents, document_lines, money_movements, transfers, manual_journal_rows |
| General ledger | journal_entries, journal_lines |
| Subledgers | open_items, document_allocation_plans, settlement_allocations, allocation_reversals |
| Banking | bank_imports, statement_lines, reconciliations, reconciliation_matches |
| Review | approval_policies, approval_requests, approval_decisions |
| Evidence/audit | attachments, attachment_links, audit_events, period_events |
| Migration/report jobs | import_jobs, import_rows, export_jobs, report_snapshots |
| Reliability | idempotency_requests, outbox_events, notification_deliveries |
| SaaS commercial data | plans, subscriptions, billing_events |
| Year closing | year_close_runs |

There is no `profit_loss_balances` or editable `bank_balance` table. There is no independent `invoice_payments` total that can disagree with allocations. There is no standalone income/expense ledger parallel to journal_lines.

## 4. Entity relationships

```text
Organization 1 ── * Membership * ── * Role * ── * Permission
Organization 1 ── * Account / Contact / Period / Source document
Source document 1 ── 0..1 Trade extension
Source document 1 ── * Document lines
Source document 1 ── 0..1 Money movement or Transfer extension
Source document 1 ── * Manual draft rows, when its type needs them
Source document 1 ── 0..1 Posted journal
Posted journal 1 ── * Journal lines
Control-account journal line 1 ── 1 Open item
Debit open item * ── Allocation ── * Credit open item
Allocation 1 ── 0..1 Dated allocation reversal
Bank import 1 ── * Statement lines
Statement line * ── Reconciliation match ── * Cash journal line
Source document 1 ── * Approval requests / Attachment links / Audit events
Source document 1 ── 0..1 Reversal source document
```

`document_allocation_plans` stores the intended existing open-item targets and amounts before approval. Plans are part of the version/digest, freeze on posting, and are revalidated against live residuals. The posting command connects each plan to its newly generated opposite-side open item; stale capacity invalidates the attempt rather than silently reallocating.

The document supertype reduces duplicated posting/state/audit logic, but extensions are typed—not a single arbitrary JSON transaction table. At posting, validate required/forbidden extensions for each document type. Example: invoice requires one trade header and item lines; receipt requires a money movement; transfer requires a transfer extension; manual journal requires manual draft rows. Paid expense has trade lines plus a money movement. Advance application uses a validated controlled-adjustment row plan; unrestricted manual creation is not allowed.

## 5. Core field conventions

All tenant-owned tables carry `organization_id`. All same-company financial foreign keys use `(organization_id, referenced_id)` against a unique `(organization_id, id)` pair. This prevents a row in company A referencing an account in company B even if application validation fails. UUID IDs are not treated as authorization secrets. PostgreSQL supports composite foreign-key constraints. [S4]

Money is exact decimal, quantities/unit prices have six places, timestamps are timestamptz, accounting/report dates are date. Store API money as strings such as `"10500.00"`, not JSON numbers. [S5]

`created_at` is a record-time timestamp; `accounting_date`/`effective_date` determine accounting impact. Both are necessary for reproducible historical reports. `created_by_member_id` references a retained organization membership, avoiding dependence on a person's editable display name. To deprovision, first deactivate membership, then remove login access according to the retention policy. Do not hard-delete financial memberships as a casual user-management action.

`party_snapshot` and line tax snapshots preserve issued-document content. Contact names, tax rates and addresses can change later without rewriting evidence. Report snapshots preserve template version, filters and ledger cutoff. They are not substitutes for the underlying ledger.

## 6. Mandatory database guard contracts

The following are **implementation requirements**, not guarantees supplied by the row-local DDL. PostgreSQL row-local CHECK constraints cannot safely enforce sums across other rows; use appropriate database constraints, locking, triggers and validated posting routines. [S4]

| ID | Guard | Enforcement and failure behavior |
|---|---|---|
| DB-G01 | Balanced complete journal | Posting function plus deferred constraint trigger: ≥2 lines, positive debits, debit=credit, state posted at commit |
| DB-G02 | Source/journal agreement | Exactly one journal per posted source; source type, accounting date, currency, period and totals agree; no journal for an unposted/void source |
| DB-G03 | Immutable posted record | Reject UPDATE/DELETE of posted source financial fields, journal headers/lines, open-item amounts and posted child snapshots; no client TRUNCATE privilege |
| DB-G04 | Locked-period safety | Lock/check fiscal year and period before posting or settlement; period-lock command uses compatible lock order so race cannot bypass close |
| DB-G05 | Valid account/tenant mapping | Composite FK plus active/postable/classification/control checks; account cycles and used classification changes rejected |
| DB-G06 | Complete subledger | Each control ledger line has one matching open item; other ledger lines have none; same party/account/amount/side |
| DB-G07 | Allocation capacity | Lock both items in ID order; same tenant/party/control/currency; dates not earlier than source availability; cumulative allocated amount stays within 0..original at every effective-date boundary, not just today |
| DB-G08 | Allocation reversal | One full reversal per allocation; date ≥ allocation date; open-period check; append-only evidence |
| DB-G09 | Reversal integrity | Source is posted and not already reversed; exact swapped amounts; correct reversal period; dependent settlements/reconciliation resolved |
| DB-G10 | Approval validity | Expected source version/digest and policy snapshot must match; authorized approver; maker-checker; approval invalidated by material edits |
| DB-G11 | Cash constraints | Cash-account mapping matches GL line; avoid negative configured physical cash under concurrent spend; internal transfer legs/classification agree |
| DB-G12 | Tax/totals | Recompute line/header totals, recognition mode, original credit-line references/caps, non-overlapping tax versions, snapshot/recovery policy and explicit rounding; never trust client-calculated totals |
| DB-G13 | Reconciliation capacity | Lock statement and GL rows; same bank account/direction; matched sums ≤ amount; finalized sessions protected; no overlapping conflicting finalized coverage |
| DB-G14 | Number/idempotency | Lock sequence; permanent unique number; unique source journal; key+request hash handling; never reuse numbered documents |
| DB-G15 | Audit/outbox | Append business audit and outbox within same financial transaction; worker events idempotent; audit updates/deletes denied |
| DB-G16 | Closing/earnings | One active close per fiscal year; recognized close/reopen link; no double transfer; period and nominal balances validated |
| DB-G17 | Onboarding/member ownership | Atomic initial owner/roles/COA; user cannot self-escalate; cannot remove last active owner; organization access rechecked live |
| DB-G18 | Private-file/job ownership | Object path, attachment links, import/export IDs and worker org context checked; no cross-module evidence leakage |

Enforce guards at database boundaries, not only form validation. Trigger recursion, bulk import paths, direct SQL through service roles, unusual null values and restore behavior need tests. Administrative superusers remain operationally privileged; least-privilege service roles and audited procedures are necessary because RLS alone does not constrain all privileged access. [S7]

## 7. Authorization implementation

Supabase Auth provides the identity. Never trust a browser-supplied `actor_id`, an organization dropdown, user-editable metadata or the mere presence of a JWT as proof of permission. Resolve the current member and exact action against database rows. RLS policies protect reads, while mutations use narrow routines that repeat action authorization. [S7, S9]

The reference includes hardened private read helpers with fixed search_path, explicit auth.uid checks and restricted EXECUTE. Broad `documents.read` is for financial users; sales-only and purchase-only read paths distinguish document types. A billing operator does not get blanket ledger/bank/report access. Attachments require access to the linked document, or the uploader's eligible draft context.

During implementation, private security-definer command routines must be owned by a dedicated least-privilege executor when feasible, not used casually to bypass failing RLS. They derive the actor, validate the company and permission, and reject anonymous access. Exposed wrappers are intentional narrow API operations, with PUBLIC/anon EXECUTE revoked. Do not create a “run arbitrary SQL” or “post arbitrary client journal” RPC.

The client uses only publishable credentials. Service/secret keys remain server-side and are not the routine substitute for caller-scoped permissions. Background workers use a separate restricted role/command surface. They cannot invent financial postings from email/provider payloads. Views should preserve caller security (security-invoker where applicable), and report routines must not leak aggregates from another tenant. [S7, S14]

## 8. Performance and transactions

Index tenant-first dates/states for document lists; tenant/account/journal for GL; tenant/party/control/due-date for aging; both sides of settlement links; bank account/date for statement lines; and status/available_at for outbox. The generated reference includes a broad starting index set; remove redundant indexes only after query-plan/workload measurements. Every index adds write/storage cost.

Use cursor pagination on high-volume lists; default 50 rows and bounded limits. Report reads use a consistent transaction snapshot. Materialized/cached aggregates must be rebuildable and keyed by org, filters, effective date, permission scope and ledger cutoff; invalidate them on posting/reversal/reopen. Never share a tenant-specific cache entry by URL alone.

For writers, use a consistent lock hierarchy and retry whole transactions on safe transient conflicts. Never hold a financial transaction while waiting for an email, external tax request, PDF renderer or user interaction. Use outbox leases, capped retries and a dead-letter/failed state with operational visibility.

## 9. Opening and year-end special cases

Opening period has a single cutover date, outside normal posting periods. It is for opening-balance documents only. Normal financial periods reference fiscal years and cannot overlap. The opening document can use a reserved `OB-<books-start-year>-<counter>` numbering namespace tied to the first operational fiscal year, while its journal period remains the special opening period.

`manual_journal_rows` for opening balances carries party, original reference and due date for each outstanding control item. Importing an aggregate AR balance plus detailed invoices as fresh sales is prohibited. For mid-year onboarding, record clearly identified YTD nominal summaries and include them exactly once in annual reporting.

`year_close_runs` links the fiscal year and its close document. Only one live non-reopened close exists. Reopening links a reversal document and preserves the prior report evidence; reclose produces a new run rather than overwriting the old one.

## 10. Data lifecycle and recovery

Financial records are never cascade-deleted through contact/account/company cleanup. Archive records and deactivate access. Plan a legally reviewed retention schedule and a tenant termination process covering database rows, source evidence, exports, logs and backups. Avoid promising immediate erasure from immutable backups without a defined lifecycle.

Back up PostgreSQL and private object bytes; store integrity manifests. Supabase database backups do not by themselves back up Storage object contents. [S12] Test restoring a company dataset and full-system restoration, including object permissions, role grants, command routines, sequences and worker deduplication. Revalidate tenant isolation and accounting tie-outs after restore.

## 11. Phase-2 extension map (not V1 tables)

Projects/budgets: add projects, project_members, budgets and budget_lines with same-tenant FKs; introduce dimensions without rewriting posted amounts. Recurrence: templates create new drafts, not mutated past documents. Fixed assets: asset register, depreciation schedules and versioned posted runs. Payroll: staff privacy boundary, approved pay runs and summarized accounting. Multi-currency: transaction/base currency amounts, rate source and date, settlement FX differences, revaluation and translation policies; it is a migration project, not just adding a currency dropdown. Consolidation: separate group, ownership, intercompany matching and elimination journals, never SUM across organizations without policy.
