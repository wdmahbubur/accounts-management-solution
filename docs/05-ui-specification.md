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