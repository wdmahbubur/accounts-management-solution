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
