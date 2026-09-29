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
