# Accounts Management SaaS
## Complete Product & Engineering Specification

**Version:** 1.0  
**Date:** 29 September 2026  
**Scope:** BDT-only, multi-tenant, service/non-stock SME accounting.  
**Status:** Proposed implementation baseline. No live database or app has been modified.

This reading edition includes the full PRD, accounting rules, database design and data dictionary, page-by-page UI structure, API contracts, acceptance plan, sources and verification boundaries. The developer ZIP additionally contains the SQL, machine-readable catalogues and runnable reference tests.

---

# Accounts Management SaaS — Developer Handoff
## Version 1.0 · 29 September 2026

A proposed V1 specification for a multi-tenant company-finance and accounting web application. Start here, then read the files in order. This is a development handoff, not a shipped application.

## Scope assumed

Bangladesh service/non-stock SMEs; BDT-only accrual books; one company per organization; one login may access multiple companies without consolidation. Core ledger, invoices, bills, expenses, recorded payments, credits/refunds/advances, reconciliation, period controls, reporting and SaaS operations are in scope. Inventory costing, payroll, multi-currency, statutory filing and autonomous AI posting are excluded from V1.

These choices are proposed defaults. Product owner, brand, final pricing, provider contracts and accounting/tax policy require approval before implementation.

## Package contents

| File | Use |
|---|---|
| `01-product-requirements.md` | Product goals, scope, personas, role matrix, 19 functional-requirement groups, workflows, non-functional requirements and commercial boundaries |
| `02-accounting-rules.md` | Posting matrix, double-entry invariants, decimal/tax rounding, subledger allocations, correction/history, opening balances and report formulas |
| `03-database-design.md` | Architecture, 52-table model, tenant isolation, 18 cross-row guard contracts and security/recovery design |
| `04-data-dictionary.md` | Field-by-field types, keys and row-local constraints for the 52 tables |
| `05-ui-specification.md` | Shared shell/components, 54 screen/workflow groups, routes, fields, actions, validation, states and acceptance behavior |
| `06-api-contracts.md` | Proposed API/command routes, request examples, authorization, idempotency, errors, imports, jobs and integration contracts |
| `07-acceptance-and-delivery.md` | Golden accounting fixture, 52 business tests and 20 security/concurrency cases to implement, milestones and release gates |
| `08-sources.md` | 15 primary-reference groups and professional-review boundaries |
| `09-verification-report.md` | Checks actually run on this package and limitations |
| `reference-schema.sql` | Physical SQL design reference with tenant keys, numeric domains, indexes and read-only RLS baseline |
| `schema-catalog.json` | Machine-readable table/field/constraint catalogue |
| `ui-screen-catalog.json` | Machine-readable screen catalogue |
| `tests/test_accounting_reference.py` | 35 dependency-free Python tests for selected arithmetic/ledger examples |
| `verification/check_spec.py` | Repeatable artifact-consistency checks, not a SQL parser or security scanner |
| `verification/` | Captured check results and test output |

## Readiness and important limits

The SQL has **not** been applied to PostgreSQL or Supabase. It is not a migration into an existing production project. It assumes Supabase-managed auth/users and roles in a new development environment. It deliberately withholds ordinary API-user write privileges. Validated business-command routines and the DB-G01–DB-G18 cross-row guards still need implementation and actual database tests.

The reference does not yet enforce every ledger rule: row-level constraints and a read-RLS baseline are not substitutes for transactional posting, immutability triggers, row locks, subledger checks or tested authorization. No live project was changed, no app was deployed, and no browser, RLS, concurrency, load, billing-provider or restore test was performed in this handoff.

The 35 passing Python tests validate a small reference model, not the future TypeScript/PostgreSQL application. The additional 72 acceptance/security cases describe expected implementation behavior; they have not been run against an app.

## Re-run the included checks

Requirements: Python 3.10 or later; standard library only. From this directory:

```bash
python -m unittest discover -s tests -v
python verification/check_spec.py
```

The consistency checker loads the catalogues and examines expected SQL text patterns, links and source IDs. It does not parse, compile or execute SQL.

## Implementation order

M0 approve the product/accounting assumptions → M1 identity/tenancy/security → M2 posting, allocation and correction engine → M3 daily finance workflows → M4 reports, reconciliation and close → M5 commercial operations and recovery → M6 accountant-reviewed pilot.

Build a thin, tested company → earned invoice → receipt → ledger/report → reversal path before implementing all screens. Use versioned migrations generated through the selected toolchain; test both clean installation and upgrades. Never enable broad database writes just to bypass missing command routines.

## Reading copies

The accompanying combined Markdown and self-contained HTML editions provide the full narrative and data dictionary. The ZIP is the canonical engineering handoff because it also includes the SQL, JSON catalogues, runnable reference tests and validation scripts.


---

# Product Requirements Document
## Accounts Management SaaS · Version 1.0 · 29 September 2026

**Status:** Proposed implementation baseline, not a launched product.  
**Product owner:** To be assigned by the project sponsor.  
**Working name:** Accounts Management SaaS (AMS); final brand/domain remains undecided.  
**Release covered:** V1 general-ledger-based finance and accounting for service/non-stock SMEs.

## 1. Product decision and assumptions

Build a responsive web application in which a company can maintain sales invoices, customer collections, supplier bills, expenses, cash/bank accounts, accounting adjustments and financial reports. An accountant gets reliable books and controls; an owner gets understandable profit, dues and liquidity information.

The following are **planning assumptions**, not previously confirmed business facts: initial market Bangladesh; BDT-only books; service agencies, consultancies, software businesses and comparable non-stock SMEs; accrual accounting; online posting; a company normally has 2–20 participating users. One organization represents one legal entity and one isolated set of books. One login can join several organizations, but a company switch is not consolidation. There is no cross-company posting or combined financial statement in V1.

English is the initial application language; Bangla names, descriptions and addresses must work throughout. Navigation and invoice templates are localization-ready. Dates follow the company timezone; accounting dates are date-only, independent of browser timezone. A fiscal year is explicitly configured rather than assumed to begin in January or July.

Do not market V1 as an ERP, inventory system, payroll engine, statutory filing system, bank, payment processor or autonomous accountant. “Record payment” means book a payment that occurred; it does not send money to a bank or wallet.

## 2. Problem, value and boundaries

The product hypothesis is that target companies find it hard to connect source documents, actual cash movements, outstanding balances and period-end reports in one auditable process. Validate this hypothesis with pilot companies rather than treating it as measured market research.

The primary promise is: **Enter a financial event once, review it, and obtain consistent ledger, dues and management reports.** Ease of entry cannot override double-entry integrity. A fast but incorrect dashboard is a failed product.

V1 is commercially useful only after onboarding, opening balances, correction workflows, reconciliation, export and recovery work together. Tax fields alone do not establish local compliance. The accounting model uses accrual/double-entry principles; statutory framework selection and accounting judgments require professional review. [S1, S2, S3]

## 3. Users and jobs to be done

| Persona | Main job | Successful outcome |
|---|---|---|
| Owner/director | Understand profit, available money and upcoming obligations | Dashboard figures tie to reports; cash and profit are not confused |
| Finance manager | Approve material transactions and close periods | Maker-checker review, exception queue and reproducible close evidence |
| Accountant | Maintain source documents, subledgers and adjustments | Accurate trial balance, AR/AP tie-outs, corrections without overwritten history |
| Billing operator | Maintain customer invoices and recorded collections | Quick invoice flow without access to company-wide profit or supplier banking data |
| Company administrator | Manage users and company setup | User administration does not automatically grant accounting visibility |
| Auditor | Inspect evidence without changing books | Read-only drilldown from report to journal to source and attachments |
| Platform support | Operate the SaaS service | Service metadata access; no routine access to tenant financial records |

## 4. Goals and measures

These are **proposed pilot targets**, not measured results or contractual guarantees.

| Measure | Definition | Initial target |
|---|---|---|
| Ledger correctness | Posted journals failing balance/control checks | Zero |
| Tenant isolation | Unauthorized company records returned in adversarial tests | Zero |
| Onboarding activation | Organization configures COA and posts its first legitimate event within 7 days | At least 60% of qualified pilot organizations |
| Invoice task usability | Observed trained pilot user creates a standard 5-line invoice | Median under 2 minutes |
| Closing readiness | Pilot accountant completes checklist without spreadsheet balance corrections | At least 80% of pilot closing sessions |
| Posting reliability | Duplicate journal after repeated same financial command | Zero |
| Retention signal | Activated pilot companies posting in 4 consecutive weeks | At least 70% |

Collect product events such as organization_created, opening_import_validated, invoice_posted, receipt_allocated and period_locked. Do not send invoice amounts, bank references, contact details or document bodies to a third-party analytics tool by default.

## 5. Release scope

| Capability | V1 launch | Later |
|---|---|---|
| Auth/company switching | Email authentication, verified invitations, roles, sensitive-action reauthentication | Enterprise SSO |
| Bookkeeping | COA, journals, posting, reversals, opening balances, period lock, year close | Advanced group accounting |
| Sales | Customers, services, invoices, partial collections, credits, refunds, advances | Estimates, recurring invoicing, customer portal |
| Purchases | Vendors, bills, supplier payments, credits, refunds, advances | Purchase orders, three-way matching |
| Expenses | Finance-entered paid expenses and approved bills | Employee claims/reimbursement portal |
| Banking | Cash/bank/wallet ledger, transfers, CSV/XLSX import, manual matching | Direct bank/payment-provider feeds |
| Controls | Simple amount-based approvals, audit, exports, read-only auditor | Complex approval workflow builder |
| Reports | P&L, balance sheet, TB, GL, aging, statements, cashbook, classified cash-flow management report | Certified/local statutory packs, group consolidation |
| Tax | Configurable simple rates, inclusive/exclusive, preserved snapshots, full/no input recovery | Withholding, compound taxes, Mushak exports and filing integrations after validation |
| Dimensions | Optional cost centers | Projects, budgets and profitability planning |
| SaaS | Trial/active/read-only states, plan entitlements, verified billing events | Organization groups and enterprise contracts |
| AI | None in the posting path | Receipt extraction, categorization suggestions, explainable insights |

V1 exclusions are intentional: stock quantity, costing, COGS automation, multi-currency/FX, depreciation schedules, payroll, payment execution, offline posting, intercompany elimination, statutory e-filing and AI-initiated posting. Fixed-asset purchases may be booked to asset accounts by an accountant; that does not mean an asset register or automated depreciation exists.

## 6. Role and permission model

Permissions are assigned to company memberships, never globally to a user account. The union of a member's roles gives capabilities within that company only. Role changes are evaluated using live database membership, not a user-editable metadata field. Authorization is checked at every command and protected data access. [S7, S9]

| Capability | Owner | Admin | Finance manager | Accountant | Billing | Auditor |
|---|---|---|---|---|---|---|
| Company/user settings | Yes | Yes | Optional | No | No | Read where needed |
| Draft invoices/receipts | Yes | No | Yes | Yes | Yes | No |
| Draft bills/expenses | Yes | No | Yes | Yes | No | No |
| Post within policy | Yes | No | Yes | Yes | Only explicitly delegated sales scope | No |
| Approve another maker | Yes | No | Yes | Optional delegated | No | No |
| Manual journal | Yes | No | Yes | Yes | No | No |
| AR/AP controlled adjustments | Yes | No | Yes | Requires review | No | No |
| View company-wide P&L/bank | Yes | No | Yes | Yes | No | Yes |
| Lock period | Yes | No | Yes | Delegated | No | No |
| Reopen period/year | Explicit capability + reason | No | Explicit capability + reason | No by default | No | No |
| Audit/export | Yes | User-admin audit only | Yes | Scoped | Sales-only exports | Financial read/export |
| Subscription/billing | Yes | Delegated | No by default | No | No | No |

Owner does not bypass balanced posting, closed periods, reference isolation or immutable history. A sole-operator exception to maker-checker must be enabled explicitly, logged and shown on every affected approval. It does not allow a larger company to silently self-approve. Custom role editing is V1; the default templates above are seeds, not hard-coded UI assumptions.

Permission families: company.read/update; users.read/manage; sales.read/write/post; purchases.read/write/post; contacts.read/write; catalog.read/write; documents.read; banking.read/write; dues.read/allocate; accounting.read; journal.write/post; ledger.read; tax.read/manage; approvals.read/decide; periods.lock/reopen; reports.read/export; imports.read/run; exports.read; attachments.read/write; audit.read; subscription.read/manage. `documents.read` is broad financial access and must not be assigned to a restricted billing operator.

## 7. Functional requirements and acceptance criteria

### FR-01 Identity and access

A user can sign in, recover access, accept a verified invitation, sign out and switch among active memberships. Token/session errors must not show private data. Sensitive actions—ownership transfer, role escalation, period reopening, bulk export and support access—require recent authentication, with MFA enabled for privileged production accounts. A removed member immediately fails a subsequent financial command. No shared demo credentials in production.

**Accept when:** user A cannot retrieve company B by editing a URL, request body, attachment key, export ID or background job ID; inactive users cannot post; an expired invite cannot be replayed; the final owner cannot be removed without ownership transfer.

### FR-02 Company onboarding

The wizard collects legal/display name, country, BDT base currency, timezone, fiscal-year dates, books-start date, invoice identity and optional tax identifiers. It creates company membership, role templates, starter COA, system mappings and initial periods transactionally. A preview explains which choices become restricted after first posting.

**Accept when:** a failure creates neither a half-company nor duplicate seeded accounts; first posting is blocked until required mappings and periods exist; changing books-start date/base currency after posting is not a normal settings action.

### FR-03 Opening balances and migration

Support CSV/XLSX staging, field mapping, row errors, preview and one approved opening-balance batch. Cutover opening is dated one day before normal books-start. Opening AR/AP is imported per original outstanding document with party, date and due date, not just as an aggregate. Opening advances remain in separate control accounts. Mid-year cutover imports year-to-date income/expense totals where needed for accurate annual reporting; prior-year profits belong in equity. Require a balanced opening journal and accountant sign-off before activation.

**Accept when:** opening subledger totals equal their control accounts, no historic invoice is recognized as fresh revenue, retry creates no duplicate, and unresolved suspense/opening differences block completion. Source evidence remains attached to the import batch.

### FR-04 COA and mappings

Create account codes, parent groups, normal sides and report mappings. Group accounts cannot receive postings. AR, AP and advance accounts are system control accounts. Protect used classification, control kind and cash-equivalent designation from silent retroactive edits. Archive rather than delete used accounts. Renaming preserves identity and audit history.

**Accept when:** an archived/group account fails posting; account-tree cycles fail validation; mapping an AR control to a revenue account is rejected; statements have no unexplained unmapped balances.

### FR-05 Contacts and catalogue

Manage customers, vendors or both using one party identity. Display sales, purchases and advance balances separately. Support payment terms and a credit-limit warning with a permissioned override reason. Search existing contacts before allowing duplicates; duplicate names are not automatically the same legal person. Items are services/non-stock products with default account, price and tax code.

**Accept when:** a dual-role party is not silently netted across receivable and payable; contact editing does not alter an issued invoice snapshot; archived contacts remain visible in historic reports.

### FR-06 Sales invoices

Create drafts with customer, invoice/recognition/due dates, service lines, quantity, unit price, line discount, tax mode, notes and evidence. Server recomputes totals. An earned invoice requires the user to confirm the service/goods recognition basis. Unperformed prepaid service is deferred revenue, not automatic current revenue. A posted invoice has a permanent number and immutable financial snapshot. [S2]

**Accept when:** a 3-line draft survives a validation error, posting creates exactly one balanced journal and AR open item, draft/sent email changes never affect revenue, and posted financial edits are replaced by credit/reversal workflows.

### FR-07 Customer receipts and settlement

Record a receipt with customer, bank/cash account, date, method and external reference. Allocate to one or several invoices; allow partial allocation. Distinguish invoice settlement, excess trade credit and true advance. The page shows total received, applied and remaining credit. Recording is bookkeeping only.

**Accept when:** simultaneous receipts cannot over-allocate an invoice, one receipt can settle multiple invoices without duplicate revenue, an unallocated credit remains visible, and as-of aging uses dated allocations and reversals.

### FR-08 Customer credits, refunds and write-offs

Issue a credit with reference to the original invoice and tax snapshot; record reason and reviewed line amounts. Apply credit to invoices or refund available credit. A cash refund is not a negative sale. Write-off is a controlled adjustment with separate approval and tax-review rules.

**Accept when:** refund cannot exceed the eligible credit; a partial credit does not cancel the entire invoice; tax is not reversed automatically on bad-debt write-off without an approved tax policy.

### FR-09 Supplier bills and credits

Record vendor invoice reference, invoice/accounting/due dates, line accounts, tax recoverability and attachment. Warn or block an exact supplier-reference duplicate; legitimate reference reuse needs explicit review. Bills can debit an expense, prepaid asset or fixed-asset account. Vendor credits reverse the relevant account/tax treatment and create an AP debit open item.

**Accept when:** posting a bill does not reduce cash; a paid bill is not expensed twice; supplier aging ties to AP and credit notes cannot be allocated across unrelated parties.

### FR-10 Paid expenses and supplier payments

A paid expense is for an expense incurred and paid in the same accounting context; debit the selected expense/asset and credit cash/bank. An unpaid or previously accrued supplier obligation uses a bill plus payment, not a second paid expense. Support attachments and cost center tags. Employee reimbursement submission is later scope, not an undocumented V1 path.

**Accept when:** payment allocation reduces AP without another expense; an asset purchase is not forced into P&L; attaching a receipt does not itself post a transaction.

### FR-11 Advances

Maintain customer advances as liabilities and supplier advances as assets. On application, reclassify between the advance control and AR/AP, then settle the corresponding same-control open items. Support unused advance refunds. Display advances independently of ordinary trade dues.

**Accept when:** no revenue/expense is created solely from receiving/paying an advance; application does not move bank cash a second time; residual advance and trade balances are independently traceable.

### FR-12 Banking and transfers

Maintain cash, bank, mobile-wallet and payment-clearing accounts. Balances come from posted GL lines, not editable fields. Same-currency transfers create both legs atomically; fees are explicit expenses. Block negative physical cash by default; bank overdraft support requires configuration and appropriate presentation. Wallet/payment-clearing names are ledger classifications, not evidence of live integrations.

**Accept when:** a failed transfer leaves neither leg, same-account transfer fails, and internal transfer between cash equivalents does not inflate operating receipts/payments.

### FR-13 Statement import and reconciliation

Import CSV/XLSX using a column-mapping preview. Preserve original rows and source checksum. Reject duplicate provider IDs and exact-file reimports; identical date/amount fingerprints are warnings because legitimate duplicate-value transactions can exist. Suggest matches using account, amount, date and reference, but require confirmation. Handle one-to-many and partial matching. Bank fees/missing receipts need approved new accounting documents; matching itself never generates another journal.

**Accept when:** book/statement differences are explained, capacities cannot be exceeded, finalized matching is locked, and a reconciled payment cannot be reversed without an authorized reconciliation reopen.

### FR-14 Manual journals and corrections

Accountants enter debit/credit rows with memo, evidence and cost center. Unrestricted manual journals cannot bypass AR/AP/advance subledgers. Provide controlled-adjustment workflows with party/open-item metadata. A posted journal is immutable; a reversal produces opposite lines dated in an open period and references its original.

**Accept when:** one-sided or unbalanced entries fail, reversing twice fails, original and reversal both appear in GL, and previous-period reports remain correct under their effective dates.

### FR-15 Approvals

V1 uses amount thresholds and eligible roles, not a visual workflow builder. Submission binds a document version and digest to a policy snapshot. Changes require resubmission. Approve/reject requires reason where policy says so. Financial posting remains a separate authorized command after approval.

**Accept when:** the maker cannot approve in normal maker-checker mode; changed bank/tax/amount invalidates approval; rejected documents return for correction without journal impact.

### FR-16 Financial reports

Deliver management P&L, balance sheet, trial balance, GL, journal register, cashbook, customer/vendor statements, AR/AP aging and classified cash-flow report. Include cost-center filters where meaningful. Every total supports drilldown to journal and source. No hidden balancing plug. Cash-flow finalization requires reviewed classifications, including financing/investing and exclusion of non-cash events. [S3]

**Accept when:** report formulas match the accounting specification; assets equal liabilities plus equity; AR/AP tie; original/reversal date logic is respected; exports match on-screen filters and historical cutoff.

### FR-17 Period/year close

A close checklist checks balance, control tie-outs, reconciliations, pending approvals, unmapped accounts, unclassified cash and opening suspense. Locking blocks all backdated postings, allocations and allocation reversals. Reopening requires capability, reason, reauthentication and audit. Year close transfers nominal balances to retained earnings through an identified close journal; reports exclude the close journal from period performance without excluding it from the ledger.

**Accept when:** posting racing with close either completes before the lock or fails; close/reopen history cannot be deleted; reclosed years avoid duplicate transfer of profit.

### FR-18 Documents, audit and exports

Use private storage, validated content types, file size limits, malware-scanning states and permission-checked expiring downloads. Show append-only history of draft changes, approvals, posts, reversals, imports, reconciliation and role changes. Financially relevant evidence cannot be silently swapped after posting. Export PDF, CSV and XLSX through permissioned jobs; spreadsheet-formula-like text must be safely escaped.

**Accept when:** a user cannot fetch another company's object or another module's restricted attachment, deleted/revoked permissions prevent a new export download, and an email/PDF job failure leaves the committed journal intact.

### FR-19 Platform subscription and operations

Separate the SaaS provider's subscriptions from tenant sales invoices. Store provider event IDs and reject replayed/invalid webhooks. Enforce seats/features on the server. Trial expiry or cancellation changes entitlements/read-only policy, not ledger content. Provide a documented export/grace policy. Platform administrators see health/usage metadata; exceptional financial-data access requires tenant consent, time limit and audit.

**Accept when:** a fake browser “payment succeeded” event cannot upgrade a plan, downgrade does not delete books, a retrying webhook cannot cause repeated entitlements and a plan limit cannot interrupt an already atomic posting.

## 8. Shared state model

The financial document state is `draft → pending_approval → approved → posted`. Approval may be skipped by explicit policy, allowing `draft → posted`. Unposted documents can be voided; numbers already issued are never reused. Rejected approval returns a corrected document to draft with a new version. A posted source remains posted even after reversal; reversal status is derived from its linked posted reversal.

Payment state is derived independently: unpaid, partially settled, settled, or unused credit. Overdue is a date-based property of a posted obligation with residual balance. Email state is queued/sent/delivered/failed and never changes accounting recognition.

## 9. Non-functional requirements

| Area | Proposed requirement / verification |
|---|---|
| Correctness | Exact decimal arithmetic; 0.00 journal difference; deterministic rounding; property-based tests |
| Tenancy | Explicit org context + same-tenant FKs + RLS + command permission checks + isolated object/export paths |
| Security | Private keys remain server-side; no untrusted metadata for roles; least privilege; dependency lockfiles; documented support access |
| Privacy | Minimize financial data in telemetry; redact logs; retention/deletion rules approved before launch |
| Performance | Proposed p95: ordinary paginated reads <500 ms server time; posting ≤100 lines <1 s; typical report <3 s on 100k lines/org; benchmark under a declared concurrency/load environment |
| Scale | Pilot envelope: 100 companies, up to 20 members/company, 100k ledger lines/company; pagination and indexes from day one, partition only after measurement |
| Reliability | Target 99.9% availability; measured later, not a current guarantee |
| Recovery | Target RPO ≤15 minutes and RTO ≤4 hours only after funded backup/PITR and separate object recovery are configured and restore-tested |
| Accessibility | Aim for WCAG 2.2 AA: keyboard operation, labeled controls, visible focus, errors not conveyed by color alone [S10] |
| Localization | Unicode throughout; BDT formatting; company timezone and explicit fiscal calendar |
| Observability | Request IDs, posting failure codes, queue age, reconciliation differences, unauthorized attempts, backup age |
| Portability | PostgreSQL schema, documented exports and typed adapter boundaries; no business logic solely inside UI components |

Database backup and object-storage recovery must be validated independently; a provider's database backup is not an assumption that every uploaded object is recoverable. Backup schedule, retention, residency and cost remain deployment decisions. [S12]

## 10. Launch gate

Launch only after an independent accountant reviews the posting map and representative month/year close; the security test suite passes; opening migration has been rehearsed; backups have been restored into a clean environment; operations have incident/restore runbooks; at least three pilot companies complete one period with reconciled books; and critical/high-impact defects affecting money, tenant access or recovery are resolved.

Tax rates, withholding, Mushak-specific layouts, retention periods and official filing claims must be assessed for the actual jurisdiction/business. NBR identifies VAT invoicing and transaction-record obligations, but that does not certify this proposed software. [S11]

## 11. Commercial model and decisions still open

Proposed packaging: Starter for core books, Business for more users/approval customization, and Partner for accounting firms managing multiple separate clients. Security, balanced accounting, data export, corrections and period integrity are not premium-only protections. Exact prices, trial duration, included seats/storage, payment provider and customer acquisition economics need pilot validation; no market prices are assumed here.

Before implementation lock: final brand; first three pilot organizations; final SaaS billing provider; email provider; operational budget/data residency; tax/accounting reviewer; launch retention/privacy terms. These do not prevent building the documented accounting foundation now.


---

# Accounting Rules and Posting Contracts
## AMS V1.0 · 29 September 2026

These are proposed software posting policies for the defined service/non-stock scope. They do not claim that every accounting framework, tax position or exceptional transaction is covered. An accountant must approve mappings, recognition judgments and local compliance before launch. Accrual records obligations and earned/incurred activity independently of the timing of cash; double entry supplies the balanced ledger. [S1]

## 1. Vocabulary and non-negotiable invariants

**Business document** is a source event. **Posting** converts an approved event into one journal. **Journal line** is a debit/credit in the general ledger. **Open item** is a party-level control-account line that can be settled. **Allocation** matches opposite open items; it normally creates no new GL entry. **Bank reconciliation** matches external bank observations to already-posted cash lines.

AR-01: Each committed journal contains at least two lines, positive total debits, and exactly equal total debits/credits in BDT to two decimals. Each line has one positive side; the other is zero.

AR-02: Every financial source event posts at most once. Its source document and journal are committed atomically with open items, relevant allocations, audit and outbox. There must never be a committed `building` journal. Drafts and approvals are not ledger entries.

AR-03: All financial references are same-company; UUID uniqueness alone does not establish tenant isolation. A source cannot refer to another tenant's account, contact, document, period, bank line or attachment. [S4]

AR-04: Posted financial rows are immutable. Correction creates new posted events; original dates/amounts remain. Reversal never deletes the original journal from a report.

AR-05: Normal journals cannot post to control accounts without complete, matching subledger records. For each AR/AP/advance GL line, exactly one open item must exist with the same party, account, side and amount.

AR-06: Monetary computations use decimal arithmetic; never use binary floating point for posting or comparisons. API monetary values are canonical strings. PostgreSQL `numeric` supports exact calculations where possible. [S5]

AR-07: The accounting date must be in a valid open period. Posting, allocations, credit application and backdated corrections use the same period-lock protocol. The creator's device clock does not define the effective accounting date.

AR-08: Account balances, invoice residuals and report totals are derived. Caches may accelerate them but cannot become another authoritative financial database.

AR-09: Approval binds the exact document version and material-field digest. An altered amount, account, bank, party, tax, date or allocation plan invalidates approval.

AR-10: System mappings must point to active, appropriate accounts. No balancing-difference account may be used to disguise an error. Limited document rounding is explicit and disclosed.

## 2. Number conventions and rounding

Storage: amounts `numeric(20,2)`; quantities and unit prices `numeric(20,6)`; percentage rates `numeric(9,6)`. Reject NaN, infinities and malformed/over-precision financial inputs at the API before conversion. V1 currency is BDT only. Use half-up for positive amounts, equivalent to ties away from zero for signed corrections. Reverse posted amounts exactly rather than recalculating with today's rates.

For every line, let `R(x)` round a decimal value to 2 places:

```text
base = R(quantity × unit_price)
discount = R(base × discount_percent / 100) OR explicit 2-decimal line discount
x = base − discount; require 0 ≤ discount ≤ base

Tax-exclusive:
  net = x
  tax = R(net × rate / 100)
  gross = net + tax

Tax-inclusive:
  gross = x
  net = R(gross / (1 + rate / 100))
  tax = gross − net

Document net = sum(line.net)
Document tax = sum(line.tax)
Document total = sum(line.gross) + explicit rounding_adjustment
```

There is no additional header discount in V1; the header displays the sum of line discounts. This avoids distributing an undisclosed mixed-tax discount incorrectly. A paid vendor bill that differs by a few paisa may use an explicit signed rounding adjustment of at most 0.05 BDT with a dedicated account and reason. A difference above that is a validation failure, not an automatically accepted “rounding” amount. Any specific tax authority's rounding method must be independently validated before enabling statutory output.

A simple illustrative test rate is 10%; this is **not a claim about any applicable Bangladesh rate**. At that test rate, 10,000 exclusive becomes 11,000 gross; 11,000 inclusive becomes 10,000 net and 1,000 tax. Keep zero-rated, exempt and out-of-scope labels separate even when the amount is zero.

## 3. Starter accounts and mappings

| Code | Name | Type/normal side | Special role |
|---|---|---|---|
| 1000 | Cash on hand | Asset/debit | Cash account |
| 1010 | Bank | Asset/debit | Cash account |
| 1020 | Mobile wallet | Asset/debit | Cash-equivalent status reviewed |
| 1030 | Payment clearing | Asset/debit | Not automatically cash equivalent |
| 1100 | Trade receivables | Asset/debit | AR control |
| 1150 | Supplier advances | Asset/debit | Vendor-advance control |
| 1200 | Recoverable input tax | Asset/debit | Conditional on valid recovery policy |
| 1300 | Prepaid expenses | Asset/debit | Ordinary GL |
| 1500 | Equipment | Asset/debit | No automated asset register |
| 1590 | Accumulated depreciation | Contra-asset/credit | Ordinary GL, shown net against assets |
| 2000 | Trade payables | Liability/credit | AP control |
| 2100 | Output tax payable | Liability/credit | Tax mapping |
| 2200 | Customer advances | Liability/credit | Customer-advance control |
| 2250 | Deferred revenue | Liability/credit | Earned later |
| 2300 | Loans payable | Liability/credit | Financing |
| 3000 | Owner/share capital | Equity/credit | Not sales revenue |
| 3100 | Retained earnings | Equity/credit | Prior closed-year earnings |
| 3200 | Distributions/drawings | Contra-equity/debit | Entity-type policy must be reviewed |
| 3900 | Opening suspense | Equity/credit | Must be zero before completed cutover |
| 4000 | Service revenue | Income/credit | Earned revenue |
| 4090 | Sales returns/allowances | Contra-income/debit | Customer credit mapping |
| 5000 | Direct service costs | Expense/debit | Cost of sales, no stock automation |
| 6000 | Rent | Expense/debit | Operating |
| 6100 | Utilities | Expense/debit | Operating |
| 6200 | Salaries | Expense/debit | Manual payroll expense only |
| 6300 | Marketing | Expense/debit | Operating |
| 6400 | Bank charges | Expense/debit | Operating |
| 6500 | Bad debts | Expense/debit | Controlled write-off |
| 6600 | Rounding difference | Expense/debit | Signed, tightly limited |
```
Normal side informs presentation, not a rule that all balances must be positive.
Contra accounts retain their correct account type and net presentation.
```

## 4. Posting matrix

Amounts below are illustrative BDT values. Tax is omitted except where explicitly shown. Transactions require the configured recognition/recovery policy.

| Event | Debit | Credit | Result / guard |
|---|---|---|---|
| Earned invoice 10,000 | AR 10,000 | Service revenue 10,000 | Creates AR debit open item |
| Earned invoice + illustrative tax 1,000 | AR 11,000 | Revenue 10,000; output tax 1,000 | Tax not included in revenue |
| Invoice for future service, no tax example | AR 10,000 | Deferred revenue 10,000 | Later release only as earned [S2] |
| Earn deferred service 2,000 | Deferred revenue 2,000 | Service revenue 2,000 | No cash or new AR |
| Receipt against receivable 6,000 | Bank 6,000 | AR 6,000 | AR credit item; allocation reduces invoice residual |
| Excess trade receipt 12,000 for 10,000 invoice | Bank 12,000 | AR 12,000 | Allocate 10,000; show 2,000 customer credit, not extra revenue |
| True customer advance 5,000 | Bank 5,000 | Customer advances 5,000 | Liability credit item; not income |
| Apply customer advance 5,000 | Customer advances 5,000 | AR 5,000 | Settle advance pair and invoice pair separately; no cash |
| Refund unused customer advance | Customer advances | Bank | Settle advance control; no sales reversal |
| Customer credit 2,000, no tax | Sales returns/revenue reversal 2,000 | AR 2,000 | Credit item; apply or refund |
| Customer credit with reversed tax 200 | Sales returns 2,000; output tax 200 | AR 2,200 | Original approved tax snapshot, within allowable credited amounts |
| Refund customer trade credit 2,000 | AR 2,000 | Bank 2,000 | Debit item settles eligible credit |
| Expense bill 4,000 | Expense 4,000 | AP 4,000 | AP credit item; no immediate cash |
| Bill with fully recoverable input tax 400 | Expense/asset 4,000; input tax 400 | AP 4,400 | Recovery is policy-dependent |
| Bill with non-recoverable tax 400 | Expense/asset 4,400 | AP 4,400 | Do not create an input-tax asset |
| Supplier payment 3,000 | AP 3,000 | Bank 3,000 | AP debit item; allocation, not another expense |
| Supplier advance 2,000 | Supplier advances 2,000 | Bank 2,000 | Asset debit item |
| Apply supplier advance 2,000 | AP 2,000 | Supplier advances 2,000 | Two within-control settlement pairs |
| Refund unused supplier advance | Bank | Supplier advances | Supplier-advance credit settles original debit |
| Vendor credit 1,000, no tax | AP 1,000 | Original expense/asset 1,000 | Reverse eligible original recognition, not generic income |
| Cash refund of vendor credit 1,000 | Bank 1,000 | AP 1,000 | AP credit settles available vendor-credit debit |
| Paid operating expense 800 | Expense 800 | Cash/bank 800 | No AP item if nothing remained unpaid |
| Paid equipment purchase 30,000 | Equipment 30,000 | Bank 30,000 | Not automatically a P&L expense |
| Transfer between cash equivalents 10,000 | Destination bank 10,000 | Source bank 10,000 | Internal; no company income/expense |
| Transfer plus bank fee 50 | Destination bank 10,000; bank charges 50 | Source bank 10,050 | Transfer 10,000 internal, fee 50 operating |
| Owner contribution 100,000 | Bank 100,000 | Capital 100,000 | Financing, not revenue |
| Loan received 50,000 | Bank 50,000 | Loan payable 50,000 | Financing, not revenue |
| Loan repayment principal 5,000 + interest 500 | Loan payable 5,000; interest expense 500 | Bank 5,500 | Split classifications under approved accounting policy |
| Accrued unpaid cost 1,000 | Expense 1,000 | Accrued liability 1,000 | No bank movement |
| Prepaid rent 12,000 | Prepaid rent 12,000 | Bank 12,000 | Asset first; recognize approved period charge later |
| One period of prepaid rent 1,000 | Rent expense 1,000 | Prepaid rent 1,000 | Non-cash recognition |
| Bad-debt write-off 1,000 | Bad debts 1,000 | AR 1,000 | Party/control item mandatory; no automatic tax reversal |
| Correct an eligible posting | Exact original credits as debits | Exact original debits as credits | New reversal source in open period |

Credit lines reference their original document lines with `original_line_id`; validate that each belongs to the selected original source and preserve its approved tax basis. Cumulative credited quantities/basis cannot exceed the eligible original amount without a separately controlled adjustment.

Amounts allocated to credits/refunds cannot exceed remaining eligible balances. For an invoice originally credited to deferred revenue, an unearned credit reduces deferred revenue, not earned revenue. Partial fulfillment/credit requires an accountant-approved allocation of earned and unearned components.

## 5. Open-item and allocation algorithm

For each control account, sides follow the actual journal: invoice AR debit; receipt AR credit; bill AP credit; payment AP debit; customer advance credit; supplier advance debit. Same-party AR/AP are not netted together.

`open_items` contains original immutable amount, account, party, side, issue/reference and due date. `settlement_allocations` matches a debit item to a credit item of the **same tenant, party, control account and currency**. `allocation_reversals` is a full dated reversal of a match; partial unapply is represented by reversing the old match and applying a new smaller one. No source financial row is overwritten.

```text
active allocation at date D, cutoff T:
  allocation.effective_date ≤ D and allocation.created_at ≤ T
  minus its reversal only when reversal.effective_date ≤ D and reversal.created_at ≤ T

residual(open item, D, T) = original amount available by D/T
                         − sum(active allocations involving that item)
```

Use a common historical cutoff for the source journal, allocations and allocation reversals. An allocation dated after a report's date cannot reduce that report's outstanding balance. Future receipts cannot settle an earlier as-of snapshot. A control-account journal reversal adds opposite open items; it does not make historic original items disappear.

Allocate command: authenticate → authorize → lock effective period → lock both open items in UUID order → validate same party/account and opposite sides → recompute both current balances and their dated allocation/reversal timelines → reject any over-allocation at any effective-date boundary → insert allocation and audit → commit. Use row locking and transaction retries for concurrency, not two separate client reads followed by a write. [S6]

**Backdated-allocation guard:** checking today's residual alone is insufficient. For each affected item, construct dated allocation (+amount) and reversal (−amount) events, group by effective date and compute the cumulative allocated amount. After the proposed change, it must remain between zero and original amount at every boundary, including dates after a backdated application. A credit freed in May must not be reused with an April application that would over-settle April. Lock both items while validating this timeline.

A true advance application creates a reclassification journal and **two** allocations, one within the advance control and one within AR/AP. It does not directly match an advance account to AR/AP without a journal. A pure allocation between an existing invoice and receipt creates no journal.

## 6. Reversals and period history

Original documents remain `posted`. Show “Reversed by REV-…” as a derived relationship. Original and reversal both belong in GL, trial balance and balance sheet calculations at their effective dates.

V1 reversal workflow must check dependent allocations and finalized bank reconciliation. Reconciled cash documents require an authorized reconciliation reopen first. Dependent allocations are explicitly unapplied using dated reversal records before reversing a source; the command shows the effect on related invoices. The new reversal creates opposite control items and matches them to the original where appropriate. The remaining related receipts/credits are visible for reallocation/refund.

For normal corrections, reversal date cannot precede the original accounting date and must be in an open period. A historical correction requiring prior-period restatement is a controlled reopen/reclose workflow; never silently backdate around a lock. Reversing a receipt is not a replacement for recording a genuine customer refund.

## 7. Report definitions

| Report | Definition and reconciliation |
|---|---|
| General ledger | Posted journal lines within effective-date range and historical cutoff; stable ordering by accounting date, posting time, journal ID, line no |
| Trial balance | Per account: debit-positive cumulative sum `Σ(debit−credit)`; split positive/negative to debit/credit columns; total debit equals credit |
| P&L | Revenue/contra revenue net credit minus expense/contra expense net debit for the selected period; exclude opening/close mechanics as specified below |
| Balance sheet | Cumulative asset, liability and equity accounts through date plus **not-yet-transferred earnings**; no balancing plug |
| Cashbook | Opening GL cash-account balance + dated debit receipts − dated credit payments = closing GL balance |
| AR aging | Residual debit obligations by due-date bucket; unallocated credits shown separately; include a bridge to net AR control |
| AP aging | Residual credit obligations by due-date bucket; supplier debit credits shown separately; include a bridge to AP control |
| Customer/vendor statement | Opening balance + dated control movements + dated allocations/credit explanation; closing reconciles to the relevant control |
| Cash-flow report | Classified posted cash-equivalent movements: operating/investing/financing; internal transfers excluded from external activity totals; no non-cash events [S3] |

Aging buckets: not yet due; 1–30; 31–60; 61–90; 91+ days overdue, relative to the selected company-local report date. Today-due is not overdue. Reports must display the date and whether credits are netted for presentation; they cannot silently offset unrelated customer/vendor balances. Material credit balances may need reclassification for statutory presentation; management aging itself is not a statutory classification engine.

### Profit versus cash versus tax

Revenue is not collections; expenses are not all cash payments; tax collected is not ordinary sales revenue; owner capital and loan receipts are not profit. Recognition follows the configured accounting policy and performance/expense context, not simply “invoice sent.” [S1, S2]

### Year closing and current earnings

A year-close journal transfers nominal account balances to retained earnings. Mark close journals `is_year_close`; exclude these mechanical entries, and reversals of close mechanics, when calculating operating performance for the historical P&L. Include them in GL/TB and equity balances. In the balance sheet, add only nominal-account earnings that remain untransferred as of the selected date/cutoff. Do not add the already-closed year's profit again to retained earnings.

If earlier years remain open, their untransferred earnings also need inclusion until closed; a “current-year only” shortcut is wrong. An audit period close snapshot preserves its version/cutoff, so a later authorized reopening does not overwrite what was previously published.

Opening imports at mid-year must preserve YTD nominal balances for full-year reporting. The opening journal's nominal YTD components belong in the applicable year-to-date comparative calculation, not new operating revenue on the migration day. V1 UI must label pre-cutover detail as imported summary rather than pretend to offer original transaction-level drilldown. Transaction-period P&L after books-start excludes opening mechanics; full-year P&L includes the approved imported YTD component exactly once.

### Cash-flow completeness

Cash-equivalent account designation is explicit and reviewed, not inferred from all asset accounts. Classify each relevant cash line, splitting mixed transactions where necessary. Operating/investing/financing totals plus opening cash reconcile to closing cash in the BDT-only scope. Non-cash adjustments do not belong in cash flows; transfers between cash-equivalent accounts net to zero. A transfer to an investment outside cash equivalents is not an “internal” cash-equivalent transfer. [S3]

Unclassified entries appear in a conspicuous exception total; the report is marked provisional and cannot be finalized. Do not advertise the V1 management report as fully IAS 7-compliant without complete required presentation/disclosure and professional validation.

## 8. Reconciliation rules

The bank statement is an external observation, not a competing authoritative GL. A match is valid only for the same cash account and same direction; matched capacities across sessions cannot exceed either the absolute statement amount or ledger amount. Import fingerprint matches require review; they are not reliable uniqueness keys by themselves.

Statement opening plus raw statement movements must equal statement ending for a complete statement. Book opening plus posted cash movements equals book ending. Final reconciliation documents all outstanding book deposits/payments and bank-only differences. For a simple case:

```text
adjusted statement ending = statement ending
                          + book deposits not yet on statement
                          − book payments not yet on statement
adjusted statement ending = book ending
```

Bank-only fees, interest or receipts require properly dated new documents before finalizing. Existing finalized matches are immutable until a permissioned reopen event; the reopen keeps an audit snapshot. Arbitrary exclusion must not be used to force the difference to zero.

## 9. Atomic posting command

```text
BEGIN
  authenticate verified caller; derive actor from active membership
  claim (org, operation, idempotency key), verify request hash
  lock fiscal year/period and source document using fixed lock order
  check period open, document version/state, action capability, approval digest
  validate same-tenant references, tax/recognition policy, account mappings
  re-read and recompute all monetary amounts using exact decimal rules
  lock numbered sequence; assign permanent document number
  generate journal header in transaction-local building state
  insert balanced GL lines and complete control open items
  apply requested settlements with capacity locks and effective-date checks
  verify GL balance, source totals, control equality and required cash classes
  mark journal and source posted; no building state may survive commit
  append audit event and idempotent outbox event
  store idempotent response resource IDs
COMMIT

Only after commit: worker renders PDF, sends mail and updates delivery status.
```

A worker is an implemented queue consumer with retry/lease rules, not an assumption that a serverless request continues indefinitely. Lock order is organization policy (where needed), fiscal year, period, documents ordered by ID, open items ordered by ID, bank rows ordered by ID, then sequence. Retriable serialization/deadlock failures rerun the complete transaction with the same idempotency key; business-validation failures do not retry endlessly.

## 10. Tax and prohibited shortcuts

Tax codes are effective-dated and posted lines preserve label/rate/mode/recovery/account snapshots. Archive old configurations rather than change old invoices. V1 supports one simple tax per line, not withholding, tax-on-tax or mixed recovery ratios. Input-tax recovery must be a verified business policy. A generic invoice PDF is not automatically an approved Mushak document. [S11]

Prohibited shortcuts: editing balance columns; saving float amounts; direct client GL writes; recomputing old invoices with new rates; marking every bank deposit as revenue; expensing a payment for an already-recorded bill; deleting allocated receipts; dropping original reversed entries from reports; accepting cross-company references; trusting a UI-only permission; or fixing a mismatch with an unexplained journal plug.


---

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


---

# Database dictionary

Version 1.0 · 29 September 2026

This dictionary mirrors `reference-schema.sql`. `organization_id` scopes all tenant-owned rows. Monetary columns use exact domains. `auth.users` is supplied by Supabase and is not recreated.

**Delivery boundary:** full V1 table/column/foreign-key reference and read-only RLS baseline. Write command functions, cross-row guards and migration integration tests are implementation work, not silently supplied by this DDL. See `03-database-design.md`.

## 01. `profiles`

Non-financial user preferences; identity and passwords remain in Supabase Auth.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `user_id` | `uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE` |
| `display_name` | `text NOT NULL` |
| `locale` | `text NOT NULL DEFAULT 'en-BD'` |
| `timezone` | `text NOT NULL DEFAULT 'Asia/Dhaka'` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

## 02. `organizations`

One legal company equals one isolated accounting tenant.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `name` | `text NOT NULL` |
| `slug` | `text NOT NULL UNIQUE` |
| `legal_name` | `text NOT NULL` |
| `country_code` | `char(2) NOT NULL DEFAULT 'BD'` |
| `base_currency` | `char(3) NOT NULL DEFAULT 'BDT' CHECK (base_currency = 'BDT')` |
| `timezone` | `text NOT NULL DEFAULT 'Asia/Dhaka'` |
| `books_start_date` | `date NOT NULL` |
| `fiscal_year_start_month` | `smallint NOT NULL CHECK (fiscal_year_start_month BETWEEN 1 AND 12)` |
| `address` | `jsonb NOT NULL DEFAULT '{}'::jsonb` |
| `tax_identifiers` | `jsonb NOT NULL DEFAULT '{}'::jsonb` |
| `status` | `text NOT NULL DEFAULT 'onboarding' CHECK (status IN ('onboarding','active','read_only','archived'))` |
| `single_operator_mode` | `boolean NOT NULL DEFAULT false` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

## 03. `organization_members`

Membership retained as an audit identity after login access is removed.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `user_id` | `uuid REFERENCES auth.users(id) ON DELETE SET NULL` |
| `display_name_snapshot` | `text NOT NULL` |
| `status` | `text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))` |
| `joined_at` | `timestamptz NOT NULL DEFAULT now()` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `UNIQUE (organization_id, user_id)`
- `CHECK (status <> 'active' OR user_id IS NOT NULL)`

## 04. `permissions`

Global permission catalogue, not a tenant-specific role assignment.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `code` | `text NOT NULL UNIQUE` |
| `description` | `text NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

## 05. `roles`

Company-specific named roles, seeded from documented templates.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `name` | `text NOT NULL` |
| `template_key` | `text` |
| `is_system` | `boolean NOT NULL DEFAULT false` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `UNIQUE (organization_id, name)`

## 06. `role_permissions`

Permissions granted to a role within the same company.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `role_id` | `uuid NOT NULL` |
| `permission_id` | `uuid NOT NULL REFERENCES finance.permissions(id) ON DELETE RESTRICT` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, role_id) REFERENCES finance.roles (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, role_id, permission_id)`

## 07. `member_roles`

Many roles can be assigned to one membership, never across tenants.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `member_id` | `uuid NOT NULL` |
| `role_id` | `uuid NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, role_id) REFERENCES finance.roles (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, member_id, role_id)`

## 08. `invitations`

Expiring, single-use invitations; store only token hashes.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `email_normalized` | `text NOT NULL` |
| `role_id` | `uuid NOT NULL` |
| `token_hash` | `text NOT NULL UNIQUE` |
| `expires_at` | `timestamptz NOT NULL` |
| `invited_by_member_id` | `uuid NOT NULL` |
| `accepted_by_member_id` | `uuid` |
| `status` | `text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked','expired'))` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, role_id) REFERENCES finance.roles (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, invited_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, accepted_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`

## 09. `fiscal_years`

Explicit reporting years, including unusual first-year lengths.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `label` | `text NOT NULL` |
| `starts_on` | `date NOT NULL` |
| `ends_on` | `date NOT NULL` |
| `status` | `text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed'))` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `CHECK (ends_on >= starts_on)`
- `UNIQUE (organization_id, label)`
- `EXCLUDE USING gist (organization_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&)`

## 10. `accounting_periods`

Regular posting periods plus a separate cutover opening period.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `fiscal_year_id` | `uuid` |
| `label` | `text NOT NULL` |
| `kind` | `text NOT NULL DEFAULT 'regular' CHECK (kind IN ('regular','opening'))` |
| `starts_on` | `date NOT NULL` |
| `ends_on` | `date NOT NULL` |
| `status` | `text NOT NULL DEFAULT 'open' CHECK (status IN ('open','locked'))` |
| `locked_at` | `timestamptz` |
| `locked_by_member_id` | `uuid` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, fiscal_year_id) REFERENCES finance.fiscal_years (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, locked_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `CHECK (ends_on >= starts_on)`
- `CHECK ((kind = 'regular' AND fiscal_year_id IS NOT NULL) OR (kind = 'opening' AND fiscal_year_id IS NULL AND starts_on = ends_on))`
- `CHECK ((status = 'locked' AND locked_at IS NOT NULL AND locked_by_member_id IS NOT NULL) OR (status = 'open' AND locked_at IS NULL AND locked_by_member_id IS NULL))`
- `EXCLUDE USING gist (organization_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&)`

## 11. `accounts`

Chart of accounts; used classification and control type cannot be silently changed.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `code` | `text NOT NULL` |
| `name` | `text NOT NULL` |
| `parent_id` | `uuid` |
| `account_type` | `text NOT NULL CHECK (account_type IN ('asset','liability','equity','income','expense'))` |
| `normal_side` | `text NOT NULL CHECK (normal_side IN ('debit','credit'))` |
| `report_group` | `text NOT NULL` |
| `control_kind` | `text CHECK (control_kind IN ('ar','ap','customer_advance','vendor_advance'))` |
| `is_postable` | `boolean NOT NULL DEFAULT true` |
| `is_active` | `boolean NOT NULL DEFAULT true` |
| `is_system` | `boolean NOT NULL DEFAULT false` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, parent_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, code)`
- `CHECK (parent_id IS NULL OR parent_id <> id)`

## 12. `account_mappings`

Configurable system mappings such as AR, AP, output tax and retained earnings.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `mapping_key` | `text NOT NULL` |
| `account_id` | `uuid NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, mapping_key)`

## 13. `contacts`

Shared party directory. One contact can be both customer and supplier; balances stay separate.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `display_name` | `text NOT NULL` |
| `legal_name` | `text` |
| `is_customer` | `boolean NOT NULL DEFAULT false` |
| `is_vendor` | `boolean NOT NULL DEFAULT false` |
| `email` | `text` |
| `phone` | `text` |
| `billing_address` | `jsonb NOT NULL DEFAULT '{}'::jsonb` |
| `tax_identifiers` | `jsonb NOT NULL DEFAULT '{}'::jsonb` |
| `payment_terms_days` | `integer NOT NULL DEFAULT 0 CHECK (payment_terms_days BETWEEN 0 AND 3650)` |
| `credit_limit` | `finance.amount CHECK (credit_limit >= 0)` |
| `external_key` | `text` |
| `is_active` | `boolean NOT NULL DEFAULT true` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `CHECK (is_customer OR is_vendor)`
- `UNIQUE (organization_id, external_key)`

## 14. `cost_centers`

Optional V1 department/location tagging; not consolidated branch accounting.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `code` | `text NOT NULL` |
| `name` | `text NOT NULL` |
| `is_active` | `boolean NOT NULL DEFAULT true` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `UNIQUE (organization_id, code)`

## 15. `tax_codes`

Effective-dated simple tax configurations. No built-in claim of statutory compliance.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `code` | `text NOT NULL` |
| `label` | `text NOT NULL` |
| `rate_percent` | `finance.rate NOT NULL` |
| `tax_kind` | `text NOT NULL CHECK (tax_kind IN ('standard','zero_rated','exempt','out_of_scope'))` |
| `output_account_id` | `uuid` |
| `input_account_id` | `uuid` |
| `recoverability` | `text NOT NULL DEFAULT 'none' CHECK (recoverability IN ('full','none'))` |
| `effective_from` | `date NOT NULL` |
| `effective_to` | `date` |
| `is_active` | `boolean NOT NULL DEFAULT true` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, output_account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, input_account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, code, effective_from)`
- `CHECK (effective_to IS NULL OR effective_to >= effective_from)`
- `CHECK (tax_kind = 'standard' OR rate_percent = 0)`

## 16. `items`

Service/non-stock catalogue only. There is no V1 inventory valuation.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `sku` | `text` |
| `name` | `text NOT NULL` |
| `unit` | `text NOT NULL DEFAULT 'unit'` |
| `default_unit_price` | `finance.unit_price NOT NULL DEFAULT 0` |
| `sales_account_id` | `uuid` |
| `purchase_account_id` | `uuid` |
| `tax_code_id` | `uuid` |
| `is_active` | `boolean NOT NULL DEFAULT true` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, sales_account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, purchase_account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, tax_code_id) REFERENCES finance.tax_codes (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, sku)`

## 17. `cash_accounts`

Maps each cash/bank/wallet account to exactly one GL account.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `name` | `text NOT NULL` |
| `account_id` | `uuid NOT NULL` |
| `kind` | `text NOT NULL CHECK (kind IN ('cash','bank','mobile_wallet','payment_clearing'))` |
| `institution` | `text` |
| `masked_account_number` | `text` |
| `is_cash_equivalent` | `boolean NOT NULL DEFAULT false` |
| `allow_negative_balance` | `boolean NOT NULL DEFAULT false` |
| `is_active` | `boolean NOT NULL DEFAULT true` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, account_id)`

## 18. `document_sequences`

Counter rows locked at posting; issued numbers are never reused.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `fiscal_year_id` | `uuid NOT NULL` |
| `document_type` | `finance.document_type NOT NULL` |
| `prefix` | `text NOT NULL` |
| `next_value` | `bigint NOT NULL DEFAULT 1 CHECK (next_value > 0)` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, fiscal_year_id) REFERENCES finance.fiscal_years (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, fiscal_year_id, document_type)`

## 19. `business_documents`

Common financial document envelope; financial fields become immutable after posting.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `document_type` | `finance.document_type NOT NULL` |
| `state` | `finance.document_state NOT NULL DEFAULT 'draft'` |
| `document_number` | `text` |
| `fiscal_year_id` | `uuid` |
| `party_id` | `uuid` |
| `issue_date` | `date NOT NULL` |
| `accounting_date` | `date NOT NULL` |
| `due_date` | `date` |
| `external_reference` | `text` |
| `description` | `text NOT NULL DEFAULT ''` |
| `currency` | `char(3) NOT NULL DEFAULT 'BDT' CHECK (currency = 'BDT')` |
| `net_amount` | `finance.amount NOT NULL DEFAULT 0 CHECK (net_amount >= 0)` |
| `tax_amount` | `finance.amount NOT NULL DEFAULT 0 CHECK (tax_amount >= 0)` |
| `rounding_adjustment` | `finance.amount NOT NULL DEFAULT 0 CHECK (abs(rounding_adjustment) <= 0.05)` |
| `total_amount` | `finance.amount NOT NULL DEFAULT 0 CHECK (total_amount >= 0)` |
| `party_snapshot` | `jsonb NOT NULL DEFAULT '{}'::jsonb` |
| `version` | `integer NOT NULL DEFAULT 1 CHECK (version > 0)` |
| `created_by_member_id` | `uuid NOT NULL` |
| `posted_by_member_id` | `uuid` |
| `posted_at` | `timestamptz` |
| `reversal_of_document_id` | `uuid` |
| `correction_reason` | `text` |
| `import_source_key` | `text` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, fiscal_year_id) REFERENCES finance.fiscal_years (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, party_id) REFERENCES finance.contacts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, created_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, posted_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, reversal_of_document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, document_number)`
- `UNIQUE (organization_id, import_source_key)`
- `UNIQUE (organization_id, reversal_of_document_id)`
- `CHECK ((state = 'posted' AND document_number IS NOT NULL AND posted_at IS NOT NULL AND posted_by_member_id IS NOT NULL) OR (state <> 'posted' AND posted_at IS NULL AND posted_by_member_id IS NULL))`
- `CHECK (due_date IS NULL OR due_date >= issue_date)`
- `CHECK ((document_type = 'reversal' AND reversal_of_document_id IS NOT NULL AND correction_reason IS NOT NULL) OR (document_type <> 'reversal' AND reversal_of_document_id IS NULL))`

## 20. `trade_documents`

Typed extension for invoice, bill, credit note and paid-expense documents.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `document_id` | `uuid NOT NULL` |
| `original_document_id` | `uuid` |
| `recognition_mode` | `text NOT NULL DEFAULT 'earned_or_incurred' CHECK (recognition_mode IN ('earned_or_incurred','deferred_revenue'))` |
| `performance_confirmed` | `boolean NOT NULL DEFAULT false` |
| `supplier_invoice_date` | `date` |
| `supplier_invoice_key` | `text` |
| `terms` | `text` |
| `notes` | `text` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, original_document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, document_id)`

## 21. `document_lines`

Immutable posted item and tax snapshots; the server recomputes every amount.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `document_id` | `uuid NOT NULL` |
| `line_no` | `integer NOT NULL CHECK (line_no > 0)` |
| `item_id` | `uuid` |
| `original_line_id` | `uuid` |
| `description` | `text NOT NULL` |
| `quantity` | `finance.quantity NOT NULL` |
| `unit_price` | `finance.unit_price NOT NULL` |
| `discount_amount` | `finance.amount NOT NULL DEFAULT 0 CHECK (discount_amount >= 0)` |
| `account_id` | `uuid NOT NULL` |
| `cost_center_id` | `uuid` |
| `tax_code_id` | `uuid` |
| `tax_label_snapshot` | `text` |
| `tax_rate_snapshot` | `finance.rate NOT NULL DEFAULT 0` |
| `tax_mode` | `text NOT NULL DEFAULT 'exclusive' CHECK (tax_mode IN ('exclusive','inclusive'))` |
| `tax_recoverability_snapshot` | `text NOT NULL DEFAULT 'none' CHECK (tax_recoverability_snapshot IN ('full','none'))` |
| `tax_account_id` | `uuid` |
| `net_amount` | `finance.amount NOT NULL CHECK (net_amount >= 0)` |
| `tax_amount` | `finance.amount NOT NULL CHECK (tax_amount >= 0)` |
| `gross_amount` | `finance.amount NOT NULL CHECK (gross_amount >= 0)` |
| `cash_flow_class` | `finance.cash_flow_class` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, item_id) REFERENCES finance.items (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, original_line_id) REFERENCES finance.document_lines (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, cost_center_id) REFERENCES finance.cost_centers (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, tax_code_id) REFERENCES finance.tax_codes (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, tax_account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, document_id, line_no)`
- `CHECK (gross_amount = net_amount + tax_amount)`

## 22. `money_movements`

Typed extension for receipts, payments, advances, refunds and paid-expense cash leg.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `document_id` | `uuid NOT NULL` |
| `cash_account_id` | `uuid NOT NULL` |
| `direction` | `text NOT NULL CHECK (direction IN ('in','out'))` |
| `amount` | `finance.amount NOT NULL CHECK (amount > 0)` |
| `method` | `text NOT NULL CHECK (method IN ('cash','bank_transfer','mobile_wallet','card','other'))` |
| `reference` | `text` |
| `cash_flow_class` | `finance.cash_flow_class NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, cash_account_id) REFERENCES finance.cash_accounts (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, document_id)`

## 23. `transfers`

A transfer posts both cash legs in one transaction; fees are separate explicit lines.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `document_id` | `uuid NOT NULL` |
| `from_cash_account_id` | `uuid NOT NULL` |
| `to_cash_account_id` | `uuid NOT NULL` |
| `amount` | `finance.amount NOT NULL CHECK (amount > 0)` |
| `fee_amount` | `finance.amount NOT NULL DEFAULT 0 CHECK (fee_amount >= 0)` |
| `fee_account_id` | `uuid` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, from_cash_account_id) REFERENCES finance.cash_accounts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, to_cash_account_id) REFERENCES finance.cash_accounts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, fee_account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, document_id)`
- `CHECK (from_cash_account_id <> to_cash_account_id)`
- `CHECK (fee_amount = 0 OR fee_account_id IS NOT NULL)`

## 24. `manual_journal_rows`

Draft input for manual journals, opening balances and controlled adjustments; not the GL.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `document_id` | `uuid NOT NULL` |
| `line_no` | `integer NOT NULL CHECK (line_no > 0)` |
| `account_id` | `uuid NOT NULL` |
| `party_id` | `uuid` |
| `cost_center_id` | `uuid` |
| `debit` | `finance.amount NOT NULL DEFAULT 0` |
| `credit` | `finance.amount NOT NULL DEFAULT 0` |
| `description` | `text NOT NULL` |
| `cash_flow_class` | `finance.cash_flow_class` |
| `open_item_reference` | `text` |
| `open_item_due_date` | `date` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, party_id) REFERENCES finance.contacts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, cost_center_id) REFERENCES finance.cost_centers (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, document_id, line_no)`
- `CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))`

## 25. `journal_entries`

One posted journal per financial document. building is transaction-local, never committed.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `source_document_id` | `uuid NOT NULL` |
| `period_id` | `uuid NOT NULL` |
| `accounting_date` | `date NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'building' CHECK (state IN ('building','posted'))` |
| `is_opening` | `boolean NOT NULL DEFAULT false` |
| `is_year_close` | `boolean NOT NULL DEFAULT false` |
| `posted_at` | `timestamptz` |
| `posted_by_member_id` | `uuid NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, source_document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, period_id) REFERENCES finance.accounting_periods (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, posted_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, source_document_id)`
- `CHECK ((state = 'posted' AND posted_at IS NOT NULL) OR (state = 'building' AND posted_at IS NULL))`
- `CHECK (NOT (is_opening AND is_year_close))`

## 26. `journal_lines`

Authoritative double-entry ledger; debit or credit, never both or neither.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `journal_entry_id` | `uuid NOT NULL` |
| `line_no` | `integer NOT NULL CHECK (line_no > 0)` |
| `account_id` | `uuid NOT NULL` |
| `party_id` | `uuid` |
| `cost_center_id` | `uuid` |
| `debit` | `finance.amount NOT NULL DEFAULT 0` |
| `credit` | `finance.amount NOT NULL DEFAULT 0` |
| `description` | `text NOT NULL DEFAULT ''` |
| `cash_flow_class` | `finance.cash_flow_class` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, journal_entry_id) REFERENCES finance.journal_entries (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, party_id) REFERENCES finance.contacts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, cost_center_id) REFERENCES finance.cost_centers (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, journal_entry_id, line_no)`
- `CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))`

## 27. `open_items`

One open item for every control-account ledger line; residual balances are derived.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `journal_line_id` | `uuid NOT NULL` |
| `account_id` | `uuid NOT NULL` |
| `party_id` | `uuid NOT NULL` |
| `control_kind` | `text NOT NULL CHECK (control_kind IN ('ar','ap','customer_advance','vendor_advance'))` |
| `side` | `text NOT NULL CHECK (side IN ('debit','credit'))` |
| `original_amount` | `finance.amount NOT NULL CHECK (original_amount > 0)` |
| `reference` | `text NOT NULL` |
| `issue_date` | `date NOT NULL` |
| `due_date` | `date` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, journal_line_id) REFERENCES finance.journal_lines (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, account_id) REFERENCES finance.accounts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, party_id) REFERENCES finance.contacts (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, journal_line_id)`

## 28. `document_allocation_plans`

Version-bound proposed settlements stored on the draft before approval; targets are real same-tenant open items.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `document_id` | `uuid NOT NULL` |
| `target_open_item_id` | `uuid NOT NULL` |
| `amount` | `finance.amount NOT NULL CHECK (amount > 0)` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, target_open_item_id) REFERENCES finance.open_items (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, document_id, target_open_item_id)`

## 29. `settlement_allocations`

Append-only debit/credit matching within one party and control account; no duplicate GL posting.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `debit_open_item_id` | `uuid NOT NULL` |
| `credit_open_item_id` | `uuid NOT NULL` |
| `amount` | `finance.amount NOT NULL CHECK (amount > 0)` |
| `effective_date` | `date NOT NULL` |
| `created_by_member_id` | `uuid NOT NULL` |
| `source_document_id` | `uuid` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, debit_open_item_id) REFERENCES finance.open_items (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, credit_open_item_id) REFERENCES finance.open_items (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, created_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, source_document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `CHECK (debit_open_item_id <> credit_open_item_id)`

## 30. `allocation_reversals`

Full reversal of an allocation at an effective date; original row is never deleted.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `allocation_id` | `uuid NOT NULL` |
| `effective_date` | `date NOT NULL` |
| `reason` | `text NOT NULL` |
| `created_by_member_id` | `uuid NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, allocation_id) REFERENCES finance.settlement_allocations (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, created_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, allocation_id)`

## 31. `bank_imports`

Raw statement provenance. Exact-file duplicates are blocked per bank account.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `cash_account_id` | `uuid NOT NULL` |
| `file_sha256` | `text NOT NULL` |
| `file_object_key` | `text NOT NULL` |
| `source_name` | `text NOT NULL` |
| `status` | `text NOT NULL DEFAULT 'staged' CHECK (status IN ('staged','validated','imported','failed'))` |
| `row_count` | `integer NOT NULL DEFAULT 0 CHECK (row_count >= 0)` |
| `created_by_member_id` | `uuid NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, cash_account_id) REFERENCES finance.cash_accounts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, created_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, cash_account_id, file_sha256)`

## 32. `statement_lines`

Immutable imported bank observations; importing is not financial posting.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `import_id` | `uuid NOT NULL` |
| `cash_account_id` | `uuid NOT NULL` |
| `row_no` | `integer NOT NULL CHECK (row_no > 0)` |
| `transaction_date` | `date NOT NULL` |
| `value_date` | `date` |
| `description` | `text NOT NULL` |
| `amount` | `finance.amount NOT NULL CHECK (amount <> 0)` |
| `balance_after` | `finance.amount` |
| `source_transaction_id` | `text` |
| `fingerprint` | `text NOT NULL` |
| `raw_row` | `jsonb NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, import_id) REFERENCES finance.bank_imports (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, cash_account_id) REFERENCES finance.cash_accounts (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, import_id, row_no)`
- `UNIQUE (organization_id, cash_account_id, source_transaction_id)`

## 33. `reconciliations`

Bank statement session, difference and finalized evidence; not a second balance source.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `cash_account_id` | `uuid NOT NULL` |
| `starts_on` | `date NOT NULL` |
| `ends_on` | `date NOT NULL` |
| `statement_opening` | `finance.amount NOT NULL` |
| `statement_closing` | `finance.amount NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','finalized'))` |
| `finalized_by_member_id` | `uuid` |
| `finalized_at` | `timestamptz` |
| `evidence_snapshot` | `jsonb NOT NULL DEFAULT '{}'::jsonb` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, cash_account_id) REFERENCES finance.cash_accounts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, finalized_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `CHECK (ends_on >= starts_on)`
- `CHECK ((state = 'finalized' AND finalized_at IS NOT NULL AND finalized_by_member_id IS NOT NULL) OR (state = 'draft' AND finalized_at IS NULL AND finalized_by_member_id IS NULL))`

## 34. `reconciliation_matches`

Many-to-many partial bank-to-book matching, with capacity checks in the command layer.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `reconciliation_id` | `uuid NOT NULL` |
| `statement_line_id` | `uuid NOT NULL` |
| `journal_line_id` | `uuid NOT NULL` |
| `amount` | `finance.amount NOT NULL CHECK (amount > 0)` |
| `created_by_member_id` | `uuid NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, reconciliation_id) REFERENCES finance.reconciliations (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, statement_line_id) REFERENCES finance.statement_lines (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, journal_line_id) REFERENCES finance.journal_lines (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, created_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, reconciliation_id, statement_line_id, journal_line_id)`

## 35. `approval_policies`

Simple V1 amount-based maker-checker rules; policy snapshots bind approvals to document versions.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `name` | `text NOT NULL` |
| `document_type` | `finance.document_type NOT NULL` |
| `threshold_amount` | `finance.amount NOT NULL CHECK (threshold_amount >= 0)` |
| `approver_role_id` | `uuid NOT NULL` |
| `required_approvals` | `integer NOT NULL DEFAULT 1 CHECK (required_approvals BETWEEN 1 AND 5)` |
| `allow_self_approval` | `boolean NOT NULL DEFAULT false` |
| `is_active` | `boolean NOT NULL DEFAULT true` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, approver_role_id) REFERENCES finance.roles (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, name)`

## 36. `approval_requests`

Submitted version/hash and policy requirements; later draft edits invalidate approval.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `document_id` | `uuid NOT NULL` |
| `document_version` | `integer NOT NULL CHECK (document_version > 0)` |
| `document_digest` | `text NOT NULL` |
| `policy_snapshot` | `jsonb NOT NULL` |
| `requested_by_member_id` | `uuid NOT NULL` |
| `state` | `text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected','superseded'))` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, requested_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, document_id, document_version)`

## 37. `approval_decisions`

Append-only approval/rejection evidence, one decision per member per request.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `request_id` | `uuid NOT NULL` |
| `decided_by_member_id` | `uuid NOT NULL` |
| `decision` | `text NOT NULL CHECK (decision IN ('approve','reject'))` |
| `reason` | `text` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, request_id) REFERENCES finance.approval_requests (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, decided_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, request_id, decided_by_member_id)`

## 38. `attachments`

Private objects; store metadata and object paths, never public URLs.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `object_key` | `text NOT NULL` |
| `original_filename` | `text NOT NULL` |
| `content_type` | `text NOT NULL` |
| `byte_size` | `bigint NOT NULL CHECK (byte_size > 0)` |
| `sha256` | `text NOT NULL` |
| `scan_status` | `text NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending','clean','rejected'))` |
| `uploaded_by_member_id` | `uuid NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, uploaded_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, object_key)`

## 39. `attachment_links`

Document-only attachment ownership avoids an unconstrained polymorphic financial link.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `attachment_id` | `uuid NOT NULL` |
| `document_id` | `uuid NOT NULL` |
| `linked_by_member_id` | `uuid NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, attachment_id) REFERENCES finance.attachments (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, linked_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, attachment_id, document_id)`

## 40. `audit_events`

Append-only business/security history; do not store credentials or complete sensitive payloads.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `actor_member_id` | `uuid` |
| `actor_kind` | `text NOT NULL CHECK (actor_kind IN ('user','system','support'))` |
| `action` | `text NOT NULL` |
| `entity_type` | `text NOT NULL` |
| `entity_id` | `uuid` |
| `document_id` | `uuid` |
| `request_id` | `text NOT NULL` |
| `reason` | `text` |
| `redacted_change` | `jsonb NOT NULL DEFAULT '{}'::jsonb` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, actor_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`

## 41. `period_events`

Append-only lock/reopen events with justification and a reconciliation checklist snapshot.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `period_id` | `uuid NOT NULL` |
| `action` | `text NOT NULL CHECK (action IN ('lock','reopen'))` |
| `actor_member_id` | `uuid NOT NULL` |
| `reason` | `text NOT NULL` |
| `checklist_snapshot` | `jsonb NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, period_id) REFERENCES finance.accounting_periods (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, actor_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`

## 42. `import_jobs`

Staging and validation for contact, catalogue, opening-balance and supported transaction imports.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `import_type` | `text NOT NULL CHECK (import_type IN ('contacts','items','opening_balance','invoice_drafts','bill_drafts'))` |
| `file_sha256` | `text NOT NULL` |
| `file_object_key` | `text NOT NULL` |
| `mapping` | `jsonb NOT NULL DEFAULT '{}'::jsonb` |
| `status` | `text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','validating','ready','running','completed','failed'))` |
| `created_by_member_id` | `uuid NOT NULL` |
| `result_summary` | `jsonb NOT NULL DEFAULT '{}'::jsonb` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, created_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, import_type, file_sha256)`

## 43. `import_rows`

Row-level validation and result references enable safe retry without duplicate records.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `job_id` | `uuid NOT NULL` |
| `row_no` | `integer NOT NULL CHECK (row_no > 0)` |
| `input_data` | `jsonb NOT NULL` |
| `errors` | `jsonb NOT NULL DEFAULT '[]'::jsonb` |
| `status` | `text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','valid','invalid','imported'))` |
| `result_document_id` | `uuid` |
| `result_contact_id` | `uuid` |
| `result_item_id` | `uuid` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, job_id) REFERENCES finance.import_jobs (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, result_document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, result_contact_id) REFERENCES finance.contacts (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, result_item_id) REFERENCES finance.items (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, job_id, row_no)`

## 44. `export_jobs`

Tenant-scoped report/document exports with request filters and historical ledger cutoff.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `requested_by_member_id` | `uuid NOT NULL` |
| `export_type` | `text NOT NULL` |
| `parameters` | `jsonb NOT NULL` |
| `ledger_cutoff_at` | `timestamptz NOT NULL` |
| `format` | `text NOT NULL CHECK (format IN ('csv','xlsx','pdf','json'))` |
| `status` | `text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','expired'))` |
| `object_key` | `text` |
| `expires_at` | `timestamptz` |
| `error_code` | `text` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, requested_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`

## 45. `report_snapshots`

Locked-period report evidence with filters, template version, ledger cutoff and checksum.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `period_id` | `uuid NOT NULL` |
| `report_type` | `text NOT NULL` |
| `parameters` | `jsonb NOT NULL` |
| `ledger_cutoff_at` | `timestamptz NOT NULL` |
| `template_version` | `text NOT NULL` |
| `result_sha256` | `text NOT NULL` |
| `object_key` | `text NOT NULL` |
| `created_by_member_id` | `uuid NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, period_id) REFERENCES finance.accounting_periods (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, created_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`

## 46. `idempotency_requests`

Private command-deduplication record; same key with different request hash is rejected.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `operation` | `text NOT NULL` |
| `idempotency_key` | `text NOT NULL` |
| `request_hash` | `text NOT NULL` |
| `actor_member_id` | `uuid NOT NULL` |
| `response_status` | `integer NOT NULL` |
| `response_body` | `jsonb NOT NULL` |
| `resource_document_id` | `uuid` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, actor_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, resource_document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, operation, idempotency_key)`

## 47. `outbox_events`

Same-transaction event recording; workers perform email/PDF work only after financial commit.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `event_type` | `text NOT NULL` |
| `document_id` | `uuid` |
| `deduplication_key` | `text NOT NULL` |
| `payload` | `jsonb NOT NULL` |
| `status` | `text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','delivered','failed'))` |
| `attempt_count` | `integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0)` |
| `available_at` | `timestamptz NOT NULL DEFAULT now()` |
| `lease_until` | `timestamptz` |
| `last_error_code` | `text` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, deduplication_key)`

## 48. `notification_deliveries`

Separate delivery state: an email failure never changes invoice posting state.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `outbox_event_id` | `uuid NOT NULL` |
| `document_id` | `uuid` |
| `channel` | `text NOT NULL CHECK (channel IN ('email','in_app'))` |
| `recipient` | `text NOT NULL` |
| `provider_message_id` | `text` |
| `status` | `text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','failed'))` |
| `delivered_at` | `timestamptz` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, outbox_event_id) REFERENCES finance.outbox_events (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, outbox_event_id, channel, recipient)`

## 49. `plans`

SaaS product plans only; not the tenant company's own sales.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `code` | `text NOT NULL UNIQUE` |
| `name` | `text NOT NULL` |
| `entitlements` | `jsonb NOT NULL` |
| `is_active` | `boolean NOT NULL DEFAULT true` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

## 50. `subscriptions`

One platform subscription per company. Prices and provider choices remain commercial decisions.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `plan_id` | `uuid NOT NULL REFERENCES finance.plans(id) ON DELETE RESTRICT` |
| `provider` | `text` |
| `provider_customer_id` | `text` |
| `provider_subscription_id` | `text` |
| `status` | `text NOT NULL CHECK (status IN ('trialing','active','past_due','canceled','read_only'))` |
| `current_period_start` | `timestamptz` |
| `current_period_end` | `timestamptz` |
| `grace_until` | `timestamptz` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `UNIQUE (organization_id)`
- `UNIQUE (provider, provider_subscription_id)`

## 51. `billing_events`

Verified provider events; provider/event-ID uniqueness blocks duplicate webhook effects.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `provider` | `text NOT NULL` |
| `provider_event_id` | `text NOT NULL` |
| `event_type` | `text NOT NULL` |
| `payload_redacted` | `jsonb NOT NULL` |
| `processing_status` | `text NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received','processed','failed','ignored'))` |
| `processed_at` | `timestamptz` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `UNIQUE (provider, provider_event_id)`

## 52. `year_close_runs`

One close event per fiscal year; reopening is an audited reversal of the close document.

| Field | PostgreSQL definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `organization_id` | `uuid NOT NULL REFERENCES finance.organizations(id) ON DELETE RESTRICT` |
| `fiscal_year_id` | `uuid NOT NULL` |
| `close_document_id` | `uuid NOT NULL` |
| `reopen_document_id` | `uuid` |
| `created_by_member_id` | `uuid NOT NULL` |
| `report_snapshot` | `jsonb NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

**Constraints:**

- `UNIQUE (organization_id, id)`
- `FOREIGN KEY (organization_id, fiscal_year_id) REFERENCES finance.fiscal_years (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, close_document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, reopen_document_id) REFERENCES finance.business_documents (organization_id, id) ON DELETE RESTRICT`
- `FOREIGN KEY (organization_id, created_by_member_id) REFERENCES finance.organization_members (organization_id, id) ON DELETE RESTRICT`
- `UNIQUE (organization_id, close_document_id)`


---

# Page-by-page UI Specification
## AMS V1.0 · 29 September 2026

This is a screen/workflow specification, not a generated visual prototype. The routes below are proposed, and shorthand sibling paths inherit `/o/[org]`. One screen group can include list, create, detail and editor states that share a domain component.

## Shared application shell

Use a clean, information-dense finance interface: desktop sidebar approximately 240 px; top bar approximately 64 px; content padding approximately 24 px. Company switcher and company name remain visible. Top bar includes current period context, quick create, scoped search, notifications and profile. Use compact readable forms, tabular numerals, right-aligned amounts, explicit BDT currency and dates without ambiguity. Do not use decorative charts that obscure reconciliation or a dense table of unexplained totals.

Proposed sidebar: Dashboard; Sales (Customers, Invoices, Receipts, Credits, Refunds); Purchases (Vendors, Bills, Payments, Credits); Expenses; Advances; Banking (Accounts, Transfers, Imports, Reconciliation); Accounting (COA, Journals, Ledger, Period/Year Close); Reports; Approvals; Documents; Settings. Render only allowed modules, while keeping API authorization independent of visibility.

Every list has server pagination, search, relevant filters, deterministic sorting, row actions and export permission checks. Every form has field-level errors plus an error summary, unsaved-change protection, decimal-safe money input, a pending state and a stale-version conflict resolution path. Posting is an explicit action with a preview, not triggered by tabbing out of a field. No hard-delete action for posted financial documents.

Each data page needs loading, empty, success, validation failure, request failure, permission denied, stale-data conflict and company-read-only states. Display skeletons for loading, not zeros that look like actual balances. On mobile, use labeled summary cards and a scrollable line editor; preserve action labels, keyboard access, focus and touch targets. Aim for WCAG 2.2 AA and verify rather than assume accessibility. [S10]

## Reusable components

`CompanySwitcher`, `PermissionGate` (presentation only), `MoneyInput`, `AccountPicker`, `PartyPicker`, `TaxPicker`, `DateField`, `CostCenterPicker`, `DocumentLineGrid`, `PostingPreview`, `ApprovalTimeline`, `SettlementGrid`, `AttachmentPanel`, `AuditDrawer`, `ReportFilters`, `ReportDrilldown`, `ExportJobStatus`, `PeriodLockBanner` and `IdempotentSubmitButton`.

Data contracts should distinguish raw amounts from formatted strings. Keep numerical formatting out of stored values. Reuse the calculation contract, not browser arithmetic as accounting truth. Report tables expose their as-of date, cutoff and inclusion policy.

## Key wireframes (structural, not branded design)

### Dashboard
```text
[Company ▼] [Dashboard]                    [Date range ▼] [+ Create]
[Revenue] [Expenses] [Net profit] [Cash/bank] [Receivable] [Payable]
[Revenue / expense trend]                  [Cash movement + exceptions]
[Overdue invoices + drilldown]             [Bills due + approval queue]
[Closing readiness / incomplete opening]   [Recent authorized activity]
```

### Financial document editor
```text
[Back] [New invoice] [Draft]                      [Save] [Submit]
[Customer ▼]  [Invoice date] [Accounting date] [Due date]
[Recognition basis] [Terms]
[Item | Description | Qty | Unit price | Discount | Tax | Amount]
[+ Add line]
[Notes and attachments]                        [Net]
[Accounting preview]                          [Tax]
                                              [Total BDT]
```

### Reconciliation
```text
[Bank account] [Statement range] [Statement closing] [Difference]
[Bank rows / suggestions]       [Posted book transactions]
[Selected amount / remainder]   [Selected amount / remainder]
[Match] [Create missing entry through review]
[Outstanding deposits/payments / evidence]      [Finalize]
```

## V1 screen/workflow groups

### UI-01 · Public landing and pricing
**Routes:** `/; /pricing`  
**Access:** Public  
**Structure:** Value proposition for company books; scope/features; illustrative product preview labeled as a demo; plan comparison; security/export explanation; contact/demo route.
**Primary actions:** Start trial, sign in, request demo.
**Validation and exception states:** No fabricated client logos, compliance certification, live-bank integration claims or prices. Only approved commercial values are shown.
**Acceptance:** Visitor understands the product records accounts, not that it operates a bank or autonomously pays suppliers.

### UI-02 · Authentication, recovery and invitation
**Routes:** `/auth/sign-in; /auth/sign-up; /auth/recover; /auth/verify; /invite/[token]`  
**Access:** Public or invited user  
**Structure:** One focused form per route; email/password or configured auth method; terms/privacy links; invite company and proposed role; accessible error summary.
**Primary actions:** Sign in, request reset, verify email, accept invite, resend verification with limits.
**Validation and exception states:** Generic account-enumeration-safe errors; expired invite state; no financial content before verified session. Invite email/identity and role must match the server record.
**Acceptance:** Expired or revoked invitation cannot grant membership, and switching accounts cannot accept another person's invite silently.

### UI-03 · Company switcher and company list
**Routes:** `/companies`  
**Access:** Active membership  
**Structure:** Company cards/table with legal/display name, membership role and onboarding/read-only status. Persistent current-company indicator after selection.
**Primary actions:** Open company, create company, leave allowed membership.
**Validation and exception states:** Creating a company follows entitlements; final owner cannot leave without transfer. Clear company-specific caches on switch.
**Acceptance:** Switching companies updates all navigation, searches, report filters and pending form context without mixing balances.

### UI-04 · Company setup wizard
**Routes:** `/onboarding/company`  
**Access:** Company creator / owner  
**Structure:** Steps: company identity → fiscal calendar and books start → template COA → bank/cash → tax preferences → invite team → review. Save progress between steps.
**Primary actions:** Back, continue, save draft, finish setup.
**Validation and exception states:** BDT-only with explicit label; fiscal range validation; required system mappings; first-post restrictions preview.
**Acceptance:** Finishing creates one complete tenant setup; repeated submission does not duplicate roles/accounts.

### UI-05 · Opening-balance migration wizard
**Routes:** `/o/[org]/settings/opening-balances`  
**Access:** imports.run + accounting permission  
**Structure:** Cutover explanation, upload, column map, trial-balance rows, AR/AP detail, advances, YTD summary, errors, tie-out and review.
**Primary actions:** Download template, validate, fix rows, preview opening journal, submit for approval, post approved opening.
**Validation and exception states:** Disable posting for imbalance, duplicate import key, missing original due/reference, unresolved suspense or incomplete subledger.
**Acceptance:** Closing opening asset/liability/control balances match approved source records; historic invoices are not recognized as fresh revenue.

### UI-06 · Company dashboard
**Routes:** `/o/[org]/dashboard`  
**Access:** reports.read, with role-specific reduced variants  
**Structure:** Date range and as-of label; revenue, expenses, profit, cash/bank, AR and AP cards; overdue obligations; upcoming bills; monthly trend; closing exceptions; recent authorized events.
**Primary actions:** Date filter, drilldown card, quick create invoice/bill/expense, review exceptions.
**Validation and exception states:** Hide unauthorized card values at API level. Empty state offers setup tasks rather than fake figures. Show unclassified cash or incomplete opening warnings.
**Acceptance:** Revenue is posted earned income, not collected cash; each card matches its linked report under the same filters.

### UI-07 · Customer list
**Routes:** `/o/[org]/sales/customers`  
**Access:** sales.read; contacts.write for editing  
**Structure:** Searchable table: name, phone/email, open receivables, overdue, available credits, advances and status. Filters for active/overdue. New-customer drawer.
**Primary actions:** Create, edit, archive, import, open profile.
**Validation and exception states:** Credit limit nonnegative; contact names can duplicate with warning; financial history blocks deletion.
**Acceptance:** A customer with an advance is not shown as having earned revenue from that advance.

### UI-08 · Customer detail and statement tabs
**Routes:** `/o/[org]/sales/customers/[id]`  
**Access:** sales.read  
**Structure:** Identity header; separate AR/credit/advance totals; tabs Invoices, Receipts, Credits, Advances, Statement and Activity. Statement dates clearly shown.
**Primary actions:** New invoice/receipt, apply permitted credit, export statement, edit future contact details.
**Validation and exception states:** Posted invoice snapshots stay unchanged after address edit. No vendor netting for dual-role contacts.
**Acceptance:** Opening plus dated customer movements equals closing; finance-only journal views remain hidden for billing users.

### UI-09 · Vendor list
**Routes:** `/o/[org]/purchases/vendors`  
**Access:** purchases.read  
**Structure:** Table: vendor, contact, outstanding AP, overdue, available vendor credits, advances, status. Search and due-date filters.
**Primary actions:** Create/edit/archive vendor, import, open profile.
**Validation and exception states:** No hard deletion of used vendor; isolate purchase data from sales-only users.
**Acceptance:** List totals bridge to AP aging and do not include customer-side balances.

### UI-10 · Vendor profile
**Routes:** `/o/[org]/purchases/vendors/[id]`  
**Access:** purchases.read  
**Structure:** Profile with Bills, Payments, Credits, Advances, Statement and Activity tabs; vendor invoice references prominent.
**Primary actions:** Add bill, record payment, apply advance through finance flow, export statement.
**Validation and exception states:** Show disputed/duplicate-reference warnings; never imply recording a payment sends funds.
**Acceptance:** A paid bill is not still overdue, and supplier credit/refund movements remain visible.

### UI-11 · Service/non-stock catalogue
**Routes:** `/o/[org]/catalog/items`  
**Access:** catalog.read/write  
**Structure:** Item/service table with SKU, name, unit, default selling price, revenue/purchase account, tax and active state; editor drawer.
**Primary actions:** Add/edit/archive, CSV import.
**Validation and exception states:** Explicit non-stock scope; no stock quantity or margin claims. Used historical descriptions and amounts remain snapshots.
**Acceptance:** Selecting an item populates defaults but server validates and snapshots the final invoice line.

### UI-12 · Invoice list
**Routes:** `/o/[org]/sales/invoices`  
**Access:** sales.read  
**Structure:** Tabs All/Drafts/Awaiting approval/Posted; columns number, customer, issue/due dates, total, residual, settlement badge, delivery badge, overdue marker.
**Primary actions:** Create, filter, open, duplicate into new draft, export authorized list.
**Validation and exception states:** Do not put Paid, Sent and Posted in one mutually exclusive state column. No bulk silent posting/deletion.
**Acceptance:** A posted invoice with failed email remains in posted revenue and separately shows delivery failed.

### UI-13 · Invoice editor
**Routes:** `/o/[org]/sales/invoices/new; /sales/invoices/[id]/edit`  
**Access:** sales.write  
**Structure:** Header fields customer, dates, recognition mode, terms; editable line grid; evidence panel; totals summary; accounting preview tab; sticky save/submit footer.
**Primary actions:** Save draft, preview PDF, submit, post when policy permits.
**Validation and exception states:** Inline field errors; unsaved-change guard; stale-version conflict; disabled posted editor; no future/unearned revenue default. Rounding and tax are server-derived.
**Acceptance:** Keyboard-only entry of multiple lines works; posting creates the reviewed amount and returns permanent source/journal IDs.

### UI-14 · Invoice detail
**Routes:** `/o/[org]/sales/invoices/[id]`  
**Access:** sales.read  
**Structure:** Immutable preview, source/settlement/delivery status strip, total and balance; tabs Details, Payments/Credits, Attachments, Activity, Accounting (permissioned).
**Primary actions:** Send/resend, export PDF, record collection, issue credit, request reversal.
**Validation and exception states:** Financial edit action absent after posting. Reverse shows affected allocations and locked-period restrictions.
**Acceptance:** The PDF and UI show the original issued contact/tax snapshot; all linked settlements explain residual balance.

### UI-15 · Customer receipt list, editor and detail
**Routes:** `/o/[org]/sales/receipts; /sales/receipts/new; /sales/receipts/[id]`  
**Access:** sales.read/write; authorized receipt posting  
**Structure:** List of receipts; editor with customer/date/account/method/reference, received amount and invoice allocation grid; detail with applied and unused trade credit.
**Primary actions:** Allocate one/many invoices, save draft, submit/post, unapply through dated correction.
**Validation and exception states:** Applied amount ≤ receipt and each available invoice balance; stale balances revalidated. True advance uses the advance flow, not extra revenue.
**Acceptance:** A 6,000 collection on a 10,000 invoice leaves exactly 4,000 outstanding and no additional revenue.

### UI-16 · Customer credit notes
**Routes:** `/o/[org]/sales/credits; /sales/credits/new; /sales/credits/[id]`  
**Access:** sales.read/write  
**Structure:** Original invoice lookup, eligible lines, original tax snapshot, reason, proposed amounts and intended application; list/detail views.
**Primary actions:** Create partial/full credit, submit/post, apply or leave available, link to refund.
**Validation and exception states:** Cumulative credits cannot exceed eligible original basis without a separately reviewed adjustment. Account choice respects earned/deferred recognition.
**Acceptance:** Partial credit preserves the remaining invoice and produces the exact appropriate AR/tax reduction.

### UI-17 · Customer refunds
**Routes:** `/o/[org]/sales/refunds; /sales/refunds/new; /sales/refunds/[id]`  
**Access:** sales.read; finance payment capability  
**Structure:** Customer credit/advance selector, available balance, refund account/date/method/reference, accounting preview and detail history.
**Primary actions:** Save, approve, record refund.
**Validation and exception states:** Refund ≤ eligible credit or unused advance; no negative invoice workaround. Display “Record refund already paid” wording.
**Acceptance:** Cash decreases once and the relevant credit/advance residual decreases by the recorded amount.

### UI-18 · Advance management and application
**Routes:** `/o/[org]/advances; /advances/new; /advances/[id]`  
**Access:** Finance / dues.allocate; scoped statements for billing  
**Structure:** Separate Customer advances and Supplier advances tabs; original, applied, refunded and remaining totals; apply drawer selects compatible invoices/bills.
**Primary actions:** Record advance, apply partially, refund unused balance, inspect reclassification.
**Validation and exception states:** No matching across different controls without generated reclassification; same party and BDT; applications require explicit finance authorization.
**Acceptance:** An application creates no new bank cash movement and settles both the advance and AR/AP control pairs.

### UI-19 · Supplier bill list
**Routes:** `/o/[org]/purchases/bills`  
**Access:** purchases.read  
**Structure:** Number/reference, vendor, bill/accounting/due dates, amount, AP residual, approval and overdue state; duplicate warning indicator.
**Primary actions:** Create, filter, export, duplicate as draft, open.
**Validation and exception states:** No “paid” toggle that bypasses payment/allocations; hide vendor data from billing role.
**Acceptance:** Outstanding list agrees with AP aging and all payments are drillable.

### UI-20 · Supplier bill editor
**Routes:** `/o/[org]/purchases/bills/new; /purchases/bills/[id]/edit`  
**Access:** purchases.write  
**Structure:** Vendor and original invoice reference/date; accounting/due dates; expense/asset line grid; tax recoverability; attachment; totals and journal preview.
**Primary actions:** Save, validate duplicate reference, submit/post.
**Validation and exception states:** Warn on missing evidence by policy; asset accounts allowed; full/no tax recovery explicit; original source total must reconcile within rounding rule.
**Acceptance:** A 4,000 bill raises AP and expense without reducing cash.

### UI-21 · Supplier bill detail
**Routes:** `/o/[org]/purchases/bills/[id]`  
**Access:** purchases.read  
**Structure:** Document snapshot with Payments/Credits, Attachments, Activity and Accounting tabs. Distinct approval and settlement state.
**Primary actions:** Record payment, issue vendor credit, export, request correction.
**Validation and exception states:** Posted fields read-only; show unapplied payment and reconciliation dependencies before reversal.
**Acceptance:** Paying the bill reduces AP without recognizing the same expense again.

### UI-22 · Supplier payments
**Routes:** `/o/[org]/purchases/payments; /purchases/payments/new; /purchases/payments/[id]`  
**Access:** purchases.read/write + posting capability  
**Structure:** Vendor, payment account/date/reference/amount; bill allocation grid; total applied and remaining vendor debit credit; list and immutable detail.
**Primary actions:** Prepare, approve, record payment, allocate/unapply with history.
**Validation and exception states:** No automatic bank payout; cannot apply to another vendor or oversettle due; recheck account/period permissions.
**Acceptance:** One payment can settle several bills with one cash reduction and correct residuals.

### UI-23 · Vendor credits and refunds
**Routes:** `/o/[org]/purchases/credits; /purchases/refunds; corresponding /new and /[id]`  
**Access:** purchases.read/write + finance capability  
**Structure:** Original bill reference, credit lines/tax recovery reversal, application plan; refund received selects available vendor credit or unused advance.
**Primary actions:** Record credit, apply, record cash refund received.
**Validation and exception states:** Do not use generic other income for reversing a bill credit. Refund follows eligible balance and actual cash direction.
**Acceptance:** Bill credit and cash refund do not reduce expense twice.

### UI-24 · Paid expenses
**Routes:** `/o/[org]/expenses; /expenses/new; /expenses/[id]`  
**Access:** purchases.read/write  
**Structure:** List of paid expenses; editor with expense/asset account, optional vendor, incurred/payment date, bank/cash, line taxes, cost center, memo and receipt.
**Primary actions:** Save draft, attach evidence, submit/record, view accounting.
**Validation and exception states:** Use a bill when unpaid or previously accrued; prevent choosing an existing bill and expensing it again. V1 does not include employee claim submission.
**Acceptance:** Expense approval alone does not post; recorded paid expense has one correct expense/asset debit and cash credit.

### UI-25 · Cash/bank account overview
**Routes:** `/o/[org]/banking/accounts`  
**Access:** banking.read/write  
**Structure:** Cards/table of named cash/bank/wallet/clearing accounts with book balances, last reconciliation and cash-equivalent classification. Setup drawer maps a GL account.
**Primary actions:** Create/archive account, open account ledger, start transfer or reconciliation.
**Validation and exception states:** Opening balances use opening journal, not editable balance field; no promise of bank connectivity from an institution name.
**Acceptance:** Displayed balances are derived from posted GL; inactive bank accounts remain in historic reports.

### UI-26 · Bank-account ledger/detail
**Routes:** `/o/[org]/banking/accounts/[id]`  
**Access:** banking.read  
**Structure:** Opening/closing balance, transaction-date range, debit/credit/running balance, reference, source link, match status; tabs Ledger/Statements/Reconciliations.
**Primary actions:** Open source, filter unmatched, export cashbook.
**Validation and exception states:** Running balance uses deterministic ordering; current/book balance labels differ from statement balance.
**Acceptance:** Opening + money in − money out equals closing under the selected filters.

### UI-27 · Transfers
**Routes:** `/o/[org]/banking/transfers; /transfers/new; /transfers/[id]`  
**Access:** banking.read/write  
**Structure:** From/to accounts, principal, optional fee and fee account, date/reference, preview of both legs.
**Primary actions:** Save, approve, post transfer.
**Validation and exception states:** Same account prohibited; prevent insufficient physical cash where configured; classify non-equivalent destinations correctly.
**Acceptance:** Either all legs/fee post or none do; no fake income is created.

### UI-28 · Bank statement import wizard
**Routes:** `/o/[org]/banking/import`  
**Access:** banking.write  
**Structure:** Choose account → upload CSV/XLSX → map date/description/debit/credit or signed amount → preview rows → warnings → confirm.
**Primary actions:** Save mapping, validate, import, go to reconciliation.
**Validation and exception states:** Exact file/provider IDs de-duplicate; fingerprint collisions prompt review; row numbers and raw values retained.
**Acceptance:** Importing a statement alone creates no GL journal and cannot inflate cash.

### UI-29 · Reconciliation workspace
**Routes:** `/o/[org]/banking/reconciliations; /reconciliations/[id]`  
**Access:** banking.read/write; separate finalization capability  
**Structure:** Statement balance header; left bank rows, right book entries; selected match amount and remaining capacities; suggestions; outstanding items; closing difference panel.
**Primary actions:** Match/unmatch in draft, split match, create reviewed missing fee/receipt, finalize, reopen with reason.
**Validation and exception states:** Zero unexplained difference; same account/direction; no reused capacity; finalized sessions immutable without audited reopen.
**Acceptance:** A matching action never duplicates an existing posting and cannot force zero by hiding unexplained bank movements.

### UI-30 · Approval inbox and review
**Routes:** `/o/[org]/approvals; /approvals/[id]`  
**Access:** approvals.read/decide  
**Structure:** Pending/approved/rejected tabs; request amount, creator and policy; full versioned document, evidence, journal preview and prior decisions.
**Primary actions:** Approve, reject with reason, open source.
**Validation and exception states:** No self approval in maker-checker; stale digest invalidates; server enforces eligible role and approval count.
**Acceptance:** Changing the document after approval requires a new review and cannot reuse the old decision.

### UI-31 · Chart of accounts
**Routes:** `/o/[org]/accounting/accounts`  
**Access:** accounting.read; controlled account management  
**Structure:** Tree/table toggles; account code, name, type, normal side, report group, control marker, active state; account detail ledger link.
**Primary actions:** Create child/account, edit allowed metadata, archive, manage mappings.
**Validation and exception states:** No post to group accounts; prevent cycles or used classification changes; no deleting ledger-linked accounts.
**Acceptance:** Accounts reconcile to reports and system controls cannot be remapped to incompatible types.

### UI-32 · Journal register
**Routes:** `/o/[org]/accounting/journals`  
**Access:** ledger.read  
**Structure:** Date, journal/source number, type, memo, debit/credit total, creator, posted/reversal label; filters by account/source/period.
**Primary actions:** Create manual journal, view, export, request reversal.
**Validation and exception states:** Journal list contains posted history; transaction-local building states never appear as successful records.
**Acceptance:** Original and reversal both remain available, with date-specific effects.

### UI-33 · Manual journal editor and detail
**Routes:** `/o/[org]/accounting/journals/new; /journals/[id]`  
**Access:** journal.write/post; ledger.read  
**Structure:** Date/memo/evidence; line grid account, party where controlled, cost center, debit, credit; live difference and cash classification; immutable detail after post.
**Primary actions:** Add/remove draft rows, save, submit/post, reverse.
**Validation and exception states:** Difference must equal 0.00; one side per line; forbid unmanaged control accounts; recent permission/period check.
**Acceptance:** The API rejects an unbalanced journal even when the UI checks are bypassed.

### UI-34 · General ledger
**Routes:** `/o/[org]/accounting/general-ledger`  
**Access:** ledger.read  
**Structure:** Account/date/cost-center filters; opening balance, dated rows, debit/credit, running balance, source links; totals footer.
**Primary actions:** Drilldown, change account, export.
**Validation and exception states:** Use stable ordering and consistent snapshot; no cross-company cached report.
**Acceptance:** Selected balance matches TB and source journal lines under the same cutoff.

### UI-35 · Trial balance
**Routes:** `/o/[org]/reports/trial-balance`  
**Access:** reports.read  
**Structure:** As-of date and optional movement range; code/name, opening, movement debit/credit, closing debit/credit; total difference.
**Primary actions:** Expand account, open ledger, export.
**Validation and exception states:** Nonzero total difference is a blocking exception, not hidden rounding. Show inclusion policy for opening/closing entries.
**Acceptance:** Total debits equal credits and each account is traceable to GL.

### UI-36 · Report hub
**Routes:** `/o/[org]/reports`  
**Access:** reports.read with report-specific capabilities  
**Structure:** Grouped Financial statements, Dues, Banking, Activity; descriptions, date semantics and provisional labels; recent export jobs.
**Primary actions:** Open report, choose date range/as-of, view export history.
**Validation and exception states:** Hide reports lacking capability; no unsupported future-report placeholders that appear functional.
**Acceptance:** User can identify P&L period reports versus balance-sheet as-of reports.

### UI-37 · Profit and loss
**Routes:** `/o/[org]/reports/profit-loss`  
**Access:** reports.read  
**Structure:** Range, comparison and optional cost center; revenue, direct costs, gross profit where mapped, operating costs, other items, net profit; drilldown.
**Primary actions:** Compare periods, expand accounts, export.
**Validation and exception states:** Exclude tax collections/capital/loan receipts; handle imported YTD and year-close mechanics exactly once.
**Acceptance:** A collection of an already-recorded invoice changes cash, not this report's revenue.

### UI-38 · Balance sheet
**Routes:** `/o/[org]/reports/balance-sheet`  
**Access:** reports.read  
**Structure:** As-of selector; assets, liabilities, equity with contra accounts; untransferred earnings separately labeled; balance check.
**Primary actions:** Drill down, compare dates, export.
**Validation and exception states:** No balancing plug; do not add closed-year profit twice. Management/statutory presentation distinction visible.
**Acceptance:** Assets equal liabilities + equity including only earnings not already transferred.

### UI-39 · Cash-flow management report
**Routes:** `/o/[org]/reports/cash-flow`  
**Access:** reports.read  
**Structure:** Range; opening cash equivalents; operating/investing/financing groups; internal transfer bridge; unclassified exceptions; closing cash reconciliation.
**Primary actions:** Inspect classification, export provisional, finalize when complete.
**Validation and exception states:** Unclassified cash blocks finalized label. Non-cash journals and opening migration mechanics are not current-period cash flows.
**Acceptance:** Classified net flow reconciles opening to closing cash; capital contributions are not operating revenue.

### UI-40 · AR/AP aging
**Routes:** `/o/[org]/reports/receivables; /reports/payables`  
**Access:** dues.read or scoped sales/purchase read  
**Structure:** As-of date; party/reference/due date; not due, 1–30, 31–60, 61–90, 91+; unallocated credits and control bridge.
**Primary actions:** Expand party, open item/source, export, start appropriate collection/payment draft.
**Validation and exception states:** Use dated allocations/reversals and ledger cutoff; do not apply future receipts to historic aging.
**Acceptance:** The test invoice is 10,000 before the receipt date and 4,000 afterward, not always its current balance.

### UI-41 · Customer/vendor statement report
**Routes:** `/o/[org]/reports/statements`  
**Access:** Scoped party financial read  
**Structure:** Party selector and AR/AP side; date range, opening, invoice/bill, receipts/payments, credits, allocations, closing; letter/PDF preview.
**Primary actions:** Export/send statement after explicit recipient review.
**Validation and exception states:** No accidental cross-party aggregation; statement sending is an external action with visible destination.
**Acceptance:** Opening plus movements equals closing and displayed allocations explain remaining items.

### UI-42 · Period close workspace
**Routes:** `/o/[org]/accounting/periods; /periods/[id]`  
**Access:** periods.lock/reopen  
**Structure:** Period calendar, open/locked status, checklist with TB/control/bank/tax/cash exceptions, pending approvals and report snapshots; lock history.
**Primary actions:** Run checks, resolve exceptions, lock, reopen with reason/reauthentication.
**Validation and exception states:** Posting-versus-lock race handled in DB; unresolved hard checks disable close; no invisible administrator bypass.
**Acceptance:** A locked month rejects backdated journal, allocation and allocation reversal through every entry path.

### UI-43 · Year-end close
**Routes:** `/o/[org]/accounting/year-close`  
**Access:** Privileged close capability  
**Structure:** Fiscal year selector; nominal balance preview; retained earnings transfer; prior close runs, snapshot evidence and reopen consequences.
**Primary actions:** Preview, approve, post close, request reopen/reclose.
**Validation and exception states:** One live close only; no double transfer; prior snapshots retained.
**Acceptance:** Historical P&L remains meaningful while balance-sheet retained earnings is updated once.

### UI-44 · Evidence/document library
**Routes:** `/o/[org]/documents`  
**Access:** Authorized source-document access  
**Structure:** Search linked attachments by filename/source/date/uploader; source links, scan state, preview and file metadata.
**Primary actions:** Upload to an eligible draft, preview, download authorized clean file, link evidence.
**Validation and exception states:** No public URLs; infected/pending files not downloadable as trusted evidence; prevent other module/company visibility.
**Acceptance:** Billing user cannot download supplier bill evidence by guessing an attachment ID.

### UI-45 · Audit trail
**Routes:** `/o/[org]/audit`  
**Access:** audit.read or narrowly scoped admin audit  
**Structure:** Time, actor, action, source/entity, request ID, reason; filters; detail drawer with redacted before/after financial changes and links.
**Primary actions:** Search, filter, export permitted history.
**Validation and exception states:** No edit/delete controls; redact secrets and unnecessary PII; support events distinguish platform actor.
**Acceptance:** Every post, reversal, close/reopen and privilege change has a traceable audit entry.

### UI-46 · Imports and export jobs
**Routes:** `/o/[org]/imports; /imports/[id]; /exports`  
**Access:** imports.read/run; exports.read  
**Structure:** Job list with type, state, row counts, errors, created by, timestamps; mapping/error grid; export filter/snapshot summary and expiry.
**Primary actions:** Upload/validate/retry safe rows, download row errors, request report export, download authorized completed file.
**Validation and exception states:** Opening financial batch is all-or-nothing; master-data import can use explicitly reported row-level progress. Download rechecks current permission.
**Acceptance:** Retry cannot duplicate imports and expired/revoked exports do not leak private data.

### UI-47 · Company settings
**Routes:** `/o/[org]/settings/company`  
**Access:** company.read/update  
**Structure:** Legal/display identity, address, timezone, fiscal setup, books-start restrictions, invoice appearance/logo and contact details.
**Primary actions:** Edit permitted settings, upload logo, review historic restrictions.
**Validation and exception states:** Core accounting calendar/currency changes after posting require controlled process; logo/name updates do not silently replace issued PDFs.
**Acceptance:** User sees a clear explanation when a historic setting is locked rather than an unexplained disabled field.

### UI-48 · Users, roles and invitations
**Routes:** `/o/[org]/settings/users; /settings/roles`  
**Access:** users.read/manage  
**Structure:** Members with roles/status; invitation status/expiry; permission matrix editor; ownership transfer flow.
**Primary actions:** Invite, deactivate, revoke invite, assign role, transfer ownership.
**Validation and exception states:** No self-escalation through client payload; final owner protected; authority to grant permission is checked; admin does not automatically get financial read.
**Acceptance:** Removing access blocks the next protected request even with an otherwise unexpired token.

### UI-49 · Tax, numbering, mappings and approval settings
**Routes:** `/o/[org]/settings/taxes; /settings/numbering; /settings/mappings; /settings/approvals`  
**Access:** Separate tax/accounting/approval administration permissions  
**Structure:** Effective-dated tax codes, sample tax calculation; document prefix/counter preview; required GL mappings; threshold/role/approval-count policies.
**Primary actions:** Create new tax version, archive, change permitted prefixes, configure policy.
**Validation and exception states:** Do not alter a used tax snapshot, reset a used number or remove required controls. Warn that generic tax settings are not filing certification.
**Acceptance:** Changing a tax rate affects new drafts only and approval changes do not rewrite prior policy evidence.

### UI-50 · SaaS subscription and billing
**Routes:** `/o/[org]/settings/subscription`  
**Access:** subscription.read/manage  
**Structure:** Current plan/period/state, entitlement usage, billing history/provider links, upgrade/downgrade effect, grace and export policy.
**Primary actions:** Choose approved plan, manage provider billing, cancel under policy, export own data.
**Validation and exception states:** Browser success redirect does not establish payment; only verified provider event changes entitlements. Do not confuse SaaS charges with the tenant's own sales ledger.
**Acceptance:** Downgrade or expiry never deletes books and cannot create an unbalanced posting.

### UI-51 · Personal profile and security
**Routes:** `/settings/profile; /settings/security`  
**Access:** Signed-in user  
**Structure:** Display name/locale/timezone, password/auth settings, MFA/session management supported by chosen provider.
**Primary actions:** Update profile, change credential, enroll MFA, revoke sessions.
**Validation and exception states:** Profile settings cannot assign roles; financial actor snapshots remain stable after display-name change.
**Acceptance:** Security changes do not affect another user and sensitive operations require the configured recent authentication.

### UI-52 · Notification center
**Routes:** `/o/[org]/notifications`  
**Access:** Authenticated authorized member  
**Structure:** Actionable approvals, due items, failed delivery/export and closing exceptions with source links; read/unread state may be implemented as user-level preference later.
**Primary actions:** Open authorized source, retry permitted failed delivery, dismiss presentation notice.
**Validation and exception states:** No confidential amounts in unauthenticated push/email previews; delivery failure never changes posting state.
**Acceptance:** A failed invoice email can be retried without posting the invoice again.

### UI-53 · Error, empty, offline and read-only states
**Routes:** `/not-found; /error; shared page states`  
**Access:** Context-dependent  
**Structure:** Permission-safe not found; error request ID/retry; empty next step; company-read-only banner; offline indicator; session expiry redirect with safe draft recovery.
**Primary actions:** Retry safe read/command with same key, reauthenticate, return to authorized company, export where policy permits.
**Validation and exception states:** Never show zero as a loading/error placeholder for financial totals; do not queue offline financial posting. No tenant existence leak in errors.
**Acceptance:** User can distinguish no transactions from failed loading and cannot accidentally double-submit after an uncertain response.

### UI-54 · Platform operations console
**Routes:** `/platform (separate privileged surface)`  
**Access:** Platform operator; not tenant owner role  
**Structure:** Tenant service state, plan/usage, job failures, health and support-access approvals; redacted operational metadata only by default.
**Primary actions:** Investigate queues, grant audited time-limited approved support session, manage service state via audited actions.
**Validation and exception states:** No universal tenant-ledger browser for routine support; strong MFA, separate authorization, no shared credentials.
**Acceptance:** Platform support cannot view financial details without a recorded approved access path.

## Later screens (not V1 navigation)

Project profitability, budget-versus-actual, employee expense claims, recurring templates, asset register, payroll, currency/FX, customer/vendor portals and AI insights need separate approved stories and schema extensions. Do not ship fake active controls for them in V1.

AI later: extracted receipts become reviewable drafts; cited report answers inherit tenant/role scope; low-confidence values are highlighted; model suggestions cannot approve or post. An AI result is not an accounting source of truth.

---

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
| POST O/exports | reports.export or scoped export | Create permission-bound export job |
| GET O/exports/{id}/download | Current report/source scope | Recheck access and issue short-lived private URL |
| POST O/periods/{id}/lock | periods.lock | Run checks, synchronize locks and save evidence |
| POST O/periods/{id}/reopen | periods.reopen | Reauthentication and reason; audit, invalidate affected caches |
| POST O/fiscal-years/{id}/close | Year-close capability | Close journal + close-run record; avoid duplicate retained earnings |
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


---

# Acceptance Tests, Delivery Order and Release Checklist
## AMS V1.0 · 29 September 2026

## 1. Verification boundary

The package includes a dependency-free Python reference calculation/ledger test model and static specification checks. These verify selected illustrative arithmetic and internal artifact consistency only. They do **not** execute PostgreSQL, Supabase RLS, browser flows, production migrations or the future application. Actual database/security/concurrency/integration tests below are mandatory implementation work.

## 2. Golden business scenario

Use a clean test company, BDT, no tax, one bank account, one AR and one AP control. All dates are illustrative test dates, not real company records.

| Sequence | Event | Expected impact |
|---|---|---|
| 1 | Owner contributes 100,000 into bank | Bank 100,000; capital 100,000; revenue 0 |
| 2 | Earned invoice to customer A, 10,000 | AR 10,000; revenue 10,000 |
| 3 | Receive 6,000 and allocate to that invoice | Bank 106,000; AR 4,000; revenue still 10,000 |
| 4 | Record expense bill from vendor A, 4,000 | Expense 4,000; AP 4,000 |
| 5 | Pay vendor A, 3,000 and allocate | Bank 103,000; AP 1,000; expense still 4,000 |
| 6 | Record paid rent, 1,000 | Bank 102,000; total expense 5,000 |
| Result | Financial statements | Revenue 10,000; expense 5,000; profit 5,000; bank 102,000; AR 4,000; AP 1,000 |
| Check | Balance sheet | Assets 106,000 = liabilities 1,000 + capital 100,000 + untransferred profit 5,000 |
| Check | Cash flows | Financing +100,000; operating +2,000; net cash +102,000 |

Every source must have exactly one balanced journal. Receipt/payment allocations explain outstanding balances without an extra income/expense journal. The same scenario must pass service, database and browser end-to-end suites before launch.

## 3. Functional and accounting acceptance matrix

| ID | Test | Expected result |
|---|---|---|
| T-01 | Draft invoice created/edited | No GL/revenue impact |
| T-02 | Post 10,000 earned invoice | Dr AR 10,000, Cr income 10,000, one control item |
| T-03 | Repeat post with same idempotency key | Same source/journal IDs, no duplicate |
| T-04 | Repeat same key with changed amount | Conflict, no new effect |
| T-05 | Repeat post with different key | Existing posted result or controlled conflict; never second journal |
| T-06 | Receive 6,000 against 10,000 invoice | Residual 4,000; revenue unchanged |
| T-07 | One receipt across three invoices | Sum applied ≤ receipt; each residual correct |
| T-08 | Receipt exceeds invoice total | Available trade credit visible; no extra revenue |
| T-09 | True customer advance | Bank debit/liability credit; revenue zero |
| T-10 | Apply customer advance | Reclassification plus two allocations; no second bank movement |
| T-11 | Supplier advance/application/refund | Correct asset, AP, bank and residual behavior |
| T-12 | Partial customer credit | Reverse approved revenue/deferred and tax components, not full invoice |
| T-13 | Refund greater than eligible credit | Reject |
| T-14 | Vendor bill then payment | Expense recognized once; payment reduces AP |
| T-15 | Paid equipment purchase | Asset increase, not forced expense |
| T-16 | Recoverable versus nonrecoverable input tax | Correct input-asset versus expense/asset-inclusive treatment |
| T-17 | Inclusive versus exclusive illustrative 10% | 11,000 inclusive = 10,000 net + 1,000 tax; correct line sums |
| T-18 | Fractional quantities and half-up rounding | Deterministic 2-decimal totals, no floating drift |
| T-19 | Zero, negative, NaN, infinity, excess-scale amounts | Rejected according to documented input rules |
| T-20 | Unbalanced/one-line/manual double-sided journal | Database rejects commit |
| T-21 | Manual direct AR/AP without party/item | Reject |
| T-22 | Posted source or GL line edit/delete | Reject even through alternate application path |
| T-23 | Reverse posted source | New exact opposite entry; original remains; dates respected |
| T-24 | Reverse same source twice | Reject second reversal |
| T-25 | Reverse reconciled payment | Block until authorized reconciliation reopen |
| T-26 | As-of aging before/after receipt and unapply dates | Correct historic residual, not today's residual |
| T-27 | Dual customer/vendor contact | AR and AP remain separate; no unauthorized netting |
| T-28 | Bank transfer with fee | Both bank legs atomic; fee explicit; internal principal not revenue |
| T-29 | Bank statement import only | No GL movement |
| T-30 | Exact file/provider transaction reimport | No duplicate observations |
| T-31 | Two legitimate equal-value bank rows | Warn/review fingerprint, do not silently delete real transaction |
| T-32 | Partial/many-to-one reconciliation | Capacity/direction/account checks; no duplicate journal |
| T-33 | Finalize nonzero unexplained bank difference | Reject |
| T-34 | Lock period then backdated posting/allocation/unapply | Reject all paths |
| T-35 | Reopen period | Reason, recent auth, privileged capability, audit; snapshots retained |
| T-36 | Change amount/date/bank/allocation after approval | Increment version; invalidate decision; new review required |
| T-37 | Maker attempts self approval | Reject unless explicitly enabled/logged sole-operator policy |
| T-38 | Opening balances with AR/AP details | Control tie-outs, no new historic revenue, zero suspense |
| T-39 | Mid-year cutover YTD summary | Included once in annual P&L, labeled summary detail |
| T-40 | Year close and report rerun | Profit transferred once; historic P&L not zeroed by close mechanics |
| T-41 | Year reopen/reclose | Preserve old run, one active close, no double retained earnings |
| T-42 | Unclassified cash-flow entry | Provisional report; finalization blocked |
| T-43 | Outbox email renderer failure | Posted journal unchanged; safe retry delivery only |
| T-44 | Export filters/cutoff | File totals match requested screen/report snapshot |
| T-45 | Duplicate billing webhook | One entitlement outcome; no tenant GL changes |
| T-46 | Subscription expires/downgrade | Policy-based read-only state; no data deletion or partial posting |
| T-47 | Journal/AR/AP/cashbook/P&L/BS golden scenario | All totals above agree |
| T-48 | Account archived or classification changed after use | Posting blocked to inactive/group account; historical classification protected |
| T-49 | Issued invoice after contact/tax configuration edit | Original snapshot/PDF preserved |
| T-50 | Foreign currency supplied | V1 validation rejects, rather than silently treats as BDT |
| T-51 | Reuse credit backdated before its earlier allocation reversal | Reject if any historic date would be over-allocated, even when today's residual is sufficient |
| T-52 | Credit-note line targets a line on a different original invoice | Reject original-parent mismatch; cumulative eligible quantity/basis enforced |

## 4. Security and concurrency matrix

| ID | Attack/race | Required result |
|---|---|---|
| S-01 | User from company A guesses company B source/account/file UUID | No data leak or write; permission-safe 404/denial |
| S-02 | Same user belongs to both companies; inject B account into A journal | Composite FK/command checks reject |
| S-03 | Billing role requests P&L, AP, private bank balance or vendor evidence | Denied, even though tenant membership is valid |
| S-04 | Change user-editable metadata to Owner | No authority change |
| S-05 | Invoke API/Server Action directly without visible button | Same permission enforcement |
| S-06 | Invoke private function anonymously or with forged actor/org | Denied |
| S-07 | Removed member uses still-unexpired access token | Next sensitive command denied by live membership check |
| S-08 | Two concurrent 6,000 allocations against 10,000 residual | At most one full 6,000 succeeds unless explicit smaller retry; residual never negative |
| S-09 | Concurrent posts to same document under different keys | Exactly one journal |
| S-10 | Posting races with period lock | Commit before lock or fail after it; no bypass |
| S-11 | Two cash spends exceed allowed physical cash | Balance rule holds under concurrency |
| S-12 | Two bank matches consume same remaining row capacity | No over-match |
| S-13 | Role escalation/last-owner removal race | No unauthorized grant; at least one active owner remains |
| S-14 | Guess export job or use link after membership revocation | New download request denied; bound lifetime of previously issued links documented |
| S-15 | Reuse previous company's cached dashboard on switch | No cross-tenant response/cache leak |
| S-16 | Malicious filename/path, content-type spoof or spreadsheet formula | Upload validation/scan and safe export escaping; no path traversal/formula execution |
| S-17 | Deadlock/serialization failure | Bounded whole-transaction retry, no partial financial writes |
| S-18 | Kill process after DB commit before response | Replay returns existing source/journal; outbox still deliverable |
| S-19 | Crash worker mid-delivery | Lease expiry/idempotent retry, no reposting |
| S-20 | Unapproved support operator requests tenant ledger | Denied; approved exceptional access time-bounded and audited |

Database tests run as anon, ordinary authenticated users, each role template and the worker role—not only as postgres/service_role. Include direct routine calls, alternate API paths and bulk imports. Run isolated multi-connection tests for races; a sequential unit test is not a concurrency test.

## 5. Delivery milestones (dependency-based, not time promises)

| Milestone | Deliverables | Exit gate |
|---|---|---|
| M0 Product/accounting agreement | V1 scope, tax assumptions, COA/report mappings, pilot data policy, acceptance fixture | Product owner + accounting reviewer approve assumptions |
| M1 Secure foundation | Repo/package boundaries; auth; tenant onboarding; roles; schema migrations; storage policy; CI | Cross-tenant and role-access tests pass; restore empty seeded environment |
| M2 Accounting engine | Decimal rules; period lock; posting/reversal; open items; allocation; idempotency; audit/outbox | Golden ledger and all critical cross-row guards pass in PostgreSQL, including races |
| M3 Daily finance flows | Customer/vendor/item UI; invoices; bills; expenses; receipts/payments; credits/refunds/advances; approvals | Representative end-to-end paths produce correct statements |
| M4 Reports and close | GL/TB/P&L/BS/aging/statements/cash flow; opening imports; bank reconciliation; period/year close | Accountant reconciles an entire pilot period and reopens/recloses safely |
| M5 SaaS operations | Plan entitlements; billing events; document/email/export workers; support console; backup/incident runbooks | Provider sandbox tests, export/restore drill, operational alerts verified |
| M6 Pilot release | Real restricted pilot use, usability fixes, accountant review, security review, launch documentation | Critical defects resolved; three pilot organizations complete a reconciled period |

Roles required: product owner; accounting/domain reviewer; full-stack/database engineering; QA/security review; operational owner. One person may cover several roles, but an implementer should not be the only reviewer of ledger correctness and tenant security.

## 6. Prioritized implementation backlog

| Epic | Priority | Representative stories | Dependencies |
|---|---|---|---|
| E01 Tenant/security | P0 | Onboard company; secure switch; role matrix; private objects | M0 |
| E02 Ledger core | P0 | Post source atomically; validate balance; block direct edits | E01 |
| E03 Control subledgers | P0 | Open-item creation; partial allocation; historical unapply | E02 |
| E04 Sales and purchases | P0 | Draft/review/post invoices and bills; receipts/payments | E02/E03 |
| E05 Corrections/advances | P0 | Credit, refund, reversal, advance reclassification | E03/E04 |
| E06 Period/report foundation | P0 | GL/TB, dates, locks, source drilldown | E02 |
| E07 Migration/reconciliation | P0 | Opening import, statement mapping, matching/finalization | E03/E06 |
| E08 Statements/year close | P0 | P&L, BS, aging, cash flow, closing earnings | E05/E06/E07 |
| E09 Evidence/approval | P0 | Versioned maker-checker, immutable evidence, audit | E01/E04 |
| E10 Jobs and delivery | P0 | Outbox, PDF/email/export/import worker retries | E02/E09 |
| E11 SaaS billing/operations | P0 before paid launch | Entitlements, webhook verification, restore and support controls | E01/E10 |
| E12 Product polish | P1 | Saved filters, search shortcuts, localized templates | Core flows proven |
| E13 Growth modules | P2 | Recurrence, budgets/projects, receipt AI drafts | Post-pilot separate PRD |

P0 does not imply simultaneous development. Build the ledger vertical slice before broad screens: company → account → earned invoice → collection → TB/BS/P&L → reversal. Then expand the same tested command contracts.

## 7. Definition of done per story

A story is done only when authorization, validation, error/empty/loading states, audit evidence, tests and documentation are included; monetary behavior has golden expectations; no browser-only safeguard is the sole control; migrations install on clean DB and upgrade the current version; UI is keyboard usable; logs avoid sensitive payloads; and relevant recovery/export paths are understood.

Do not mark “Bank reconciliation complete” merely because a page imports CSV, or “Accounting complete” merely because a dashboard adds income and subtracts expense.

## 8. Production checklist

Confirm selected provider/database versions; rerun schema/security advisors; verify least-privilege grants and public schemas; confirm secret-key hygiene; run all P0 test matrices; validate rate limits; configure private buckets/scanning; deploy queue consumers and failure alerts; verify payment signatures and duplicate handling; enable and test backups/object restoration; approve retention/data-residency terms; freeze default account/report/tax policies; record accountant sign-off and launch scope; create operational escalation and rollback plans.

Deployment rollback must account for database compatibility and queued events, not only a web-app version. Never undo committed customer books by rolling back to an old database backup as a routine application deployment rollback.


---

# Sources and Professional Review Boundaries
## Primary references checked for the 29 September 2026 specification

The requirements, schema, workflows and illustrative examples in this package are proposed product design. References below support the underlying accounting, database, security and accessibility principles; they are not endorsements or certification of this product. Bracketed source IDs used throughout the documents resolve here. URLs are provided for the implementation team's verification.

| ID | Primary source | Relevance and boundary |
|---|---|---|
| S1 | ACCA, *A matter of principle* | Accrual and double-entry foundations. Educational guidance; not a determination of a particular company's reporting obligations. |
| S2 | IFRS Foundation, *IFRS 15 Revenue from Contracts with Customers* | Recognition follows satisfaction of performance obligations; sending an invoice is not a sufficient universal recognition rule. V1 does not implement every IFRS 15 case. |
| S3 | IFRS Foundation, *IAS 7 Statement of Cash Flows* | Operating/investing/financing classification, non-cash exclusion and cash reconciliation. The proposed V1 report is a management report, not a certified IAS 7 statement. |
| S4 | PostgreSQL, *Constraints* | Composite foreign keys, uniqueness, and the limitations of row-local CHECK constraints for cross-row accounting invariants. |
| S5 | PostgreSQL, *Numeric Types* | Exact numeric storage and precision/scale behavior for monetary calculations, distinct from inexact floating point. |
| S6 | PostgreSQL, *Explicit Locking* | Row locks and transaction coordination supporting allocation, posting and closing commands. Real concurrent implementation tests remain required. |
| S7 | Supabase, *Row Level Security* | RLS policies and authorization boundaries; membership alone must not grant every financial capability. |
| S8 | Next.js, *Data Security* | Secure server-side access and explicit authorization of Server Actions; server execution is not a replacement for permission checks. |
| S9 | OWASP, *Authorization Cheat Sheet* | Deny-by-default, least privilege and authorization on protected requests. |
| S10 | W3C, *Web Content Accessibility Guidelines 2.2* | Proposed WCAG 2.2 AA usability/accessibility acceptance target; no conformance audit has been performed. |
| S11 | Bangladesh NBR, VAT compliance guidance and forms | VAT records/invoice requirements need local professional validation. No particular rate, registration threshold, filing requirement or retention period is hard-coded from this source. |
| S12 | Supabase, *Database Backups* | Database restoration is distinct from recovery of Storage object bytes; both require an operational plan. |
| S13 | Supabase, *Changelog* | Review relevant provider changes and pin supported dependencies during implementation. No unverified package version is mandated. |
| S14 | Supabase, *Database Functions* | Function execution/security configuration; deliberate restricted RPCs and hardened privileged helpers need implementation review. |
| S15 | Supabase, *Storage Access Control* | Private-object access policies complement database access policies. Bucket configuration and real download authorization are not implemented by the reference schema. |

## Reference locations

**S1 — ACCA:** `https://www.accaglobal.com/gb/en/student/exam-support-resources/foundation-level-study-resources/fa2/fa2-technical-articles/a-matter-of-principle.html`

**S2 — IFRS 15:** `https://www.ifrs.org/issued-standards/list-of-standards/ifrs-15-revenue-from-contracts-with-customers/`

**S3 — IAS 7:** `https://www.ifrs.org/issued-standards/list-of-standards/ias-7-statement-of-cash-flows/`

**S4 — PostgreSQL constraints:** `https://www.postgresql.org/docs/current/ddl-constraints.html`

**S5 — PostgreSQL numeric:** `https://www.postgresql.org/docs/current/datatype-numeric.html`

**S6 — PostgreSQL locks:** `https://www.postgresql.org/docs/current/explicit-locking.html`

**S7 — Supabase RLS:** `https://supabase.com/docs/guides/database/postgres/row-level-security`

**S8 — Next.js data security:** `https://nextjs.org/docs/app/guides/data-security`

**S9 — OWASP authorization:** `https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html`

**S10 — WCAG 2.2:** `https://www.w3.org/TR/WCAG22/`

**S11 — NBR guidance:** `https://nbr.gov.bd/taxtypes/vat-compliance-guides/details/8/eng`

**S11 — NBR forms index:** `https://nbr.gov.bd/form/vat/vat-2012/eng`

**S12 — Supabase backups:** `https://supabase.com/docs/guides/platform/backups`

**S13 — Supabase changelog:** `https://supabase.com/changelog`

**S14 — Supabase functions:** `https://supabase.com/docs/guides/database/functions`

**S15 — Supabase Storage:** `https://supabase.com/docs/guides/storage/security/access-control`

## Required review before launch

A qualified accounting reviewer must approve account/report mappings, recognition and correction policies, opening balances, advance treatment, tax configuration, year-end behavior and representative financial statements. A local tax adviser must determine actual Bangladesh compliance requirements for the target entities. Security review must cover tenant isolation, role scope, privileged functions, private objects, exports, billing webhooks, incident handling and data recovery.

Neither this specification, its illustrative 10% tax examples, nor its reference-model tests certify statutory compliance, audited financial statements, a functioning application or production readiness.


---

# Verification Report
## Specification package V1.0 · 29 September 2026

## Result

**35/35 Python reference-model tests passed. 24/24 static artifact-consistency checks passed.** These results concern this specification package and its illustrative calculation model only. They do not establish that a real accounting application works or that the SQL compiles.

## What was executed

```bash
python -m unittest discover -s tests -v
python verification/check_spec.py
```

The reference test suite uses Python's standard-library Decimal arithmetic and an in-memory ledger/allocation model. Cases include deterministic monetary rounding, input validation, balanced posting examples, capital versus income, invoice/receipt and bill/payment separation, illustrative inclusive/exclusive taxes, credits/refunds/advances, reversals, historical allocations and the golden financial-statement scenario. It is not the production accounting engine.

The static checker reads the SQL and JSON/Markdown artifacts. It verifies catalogue agreement, field/reference availability, unique-key declarations, tenant-key patterns, RLS-enable statements, absence of broad ordinary-user DML grants, helper-function privilege declarations, index names, screen coverage, source references and acceptance-case counts. These are text/catalogue checks, not a SQL grammar parser or a test of database enforcement.

| Artifact property checked | Result |
|---|---:|
| Tables in catalogue and SQL | 52 |
| Declared fields across tables | 525 |
| Tenant-owned tables with organization identity | 48 |
| Explicit composite foreign keys checked | 99 |
| Explicit indexes checked | 124 |
| Tables with RLS-enable declaration | 52 |
| UI screen/workflow groups | 54 |
| Functional-requirement groups | 19 |
| Proposed business/accounting acceptance cases | 52 |
| Proposed security/concurrency cases | 20 |
| Primary-reference groups | 15 |
| Reference-model tests executed | 35 passed |
| Static artifact checks executed | 24 passed |

The four non-tenant catalogue tables are profiles, organizations, the global permission catalogue and the platform plan catalogue. Organization-specific commercial records are tenant-scoped. A screen group can contain several routes or shared list/editor/detail views; “54” is not an independently tested browser-page count.

## Evidence

`verification/reference-tests.txt` contains the unittest output. `verification/static-checks.txt` contains human-readable consistency results. `verification/static-checks.json` contains the machine-readable results. The checker and reference tests are included for repeatability.

## Not executed or certified

No PostgreSQL server, SQL parser, Supabase project or live application was used to execute the schema. No migration was applied. No database posting routine, immutability trigger, cross-row guard, RLS adversarial test, multi-connection race test, browser flow, accessibility audit, performance test, payment-provider test or backup/restore drill was run.

The SQL contains a schema/read-policy reference, not the implementation of DB-G01–DB-G18. The 52 business cases and 20 security/concurrency cases are specifications for future implementation testing; their presence is not a passing test result. The reading HTML is a rendered document, not a product prototype or a visually verified application.

The package is not an audit opinion, NBR approval, IFRS compliance certificate or guarantee of production readiness. Tax rates and financial examples are illustrative. Production launch remains gated on the accounting, security, integration and recovery checks in `07-acceptance-and-delivery.md`.
