# Batch 3: supplier payments and credit workflows

Verified on 2026-10-09 in the isolated preview environment. This batch builds on `fix/customer-invoice-experience` (PR 170) and is reviewed in PR 171. It does not establish production, accountant or tax acceptance.

## What changed

- Supplier-payment drafts display eligible bills by number, supplier reference, date, total, outstanding balance and available allocation. Selections and entered amounts survive save/reload, validation failures and balance refreshes. Known bill labels remain visible while balances load; stale allocation controls are disabled.
- Supplier-payment details separate the payment total, amount applied to bills and unused supplier trade debit. Bill details show their dated settlement history and remaining due.
- Customer and supplier credits start from a readable posted original. The editor copies the original line's account, price, tax and cost-centre basis, supports partial quantity/amounts, and preserves issued details. The server rechecks source eligibility and capacity when saving and posting.
- Credit capacity accounts for posted credits, effective reversal dates, future usage, rounding and concurrent posting. Drafts do not reserve capacity. A competing post cannot exceed the original line or document capacity.
- Posted credits can be explicitly applied to their original invoice/bill. The form shows dated available balances, blocks excessive applications, preserves an uncertain request for safe retry and confirms the recorded result. It uses the existing allocation command; applying credit does not move cash or add another journal.
- Unapplying an allocation refreshes the credit form from the new server response. Dated reversal history remains visible alongside any subsequent application.
- Migration 0095 corrects the pre-existing Balance Sheet expense sign. The page also accepts an omitted/blank optional comparison date while rejecting invalid provided dates. Settlement-history captions omit an unavailable date instead of displaying `status as of —`.

## Browser acceptance

The supplier and credit flows below were exercised through the live preview UI on commit `f11cc842090bead6af70bb245be3bf3d989a2b54`, against the retained **Workflow Repair QA** company (`ed3456f2-2385-49b0-8783-b889bb569137`). The final publication adds the bounded loading/caption/date-filter refinements and report regression evidence. Its exact deployment SHA, CI result and final display checks are recorded in PR 171 and the accompanying verification report.

Only newly created synthetic contacts, documents and allocations were used. No existing fixture was deleted or reset. Saved drafts were submitted through the configured below-threshold approval policy and then explicitly posted; this is not a human approval signoff.

| Flow | Observed result |
|---|---|
| Supplier bill A, `BILL-FY 2026-000001` | Posted `500.00`; payment allocation `400.00`; `100.00` remains due. |
| Supplier bill B, `BILL-FY 2026-000002` | Posted three units at `100.00` (`300.00`); payment allocation `200.00`; supplier credit settles the remaining `100.00`. Original quantity and total are preserved. |
| Supplier payment, `PAY-FY 2026-000001` | Saved, reloaded, previewed, approved and posted `700.00`; applied `600.00` across the two named bills; unused supplier trade debit `100.00`. Preview has Bank credit `700.00` and Trade Payables debit `700.00`, without another expense. |
| Payment validation | A `301.00` allocation against the `300.00` bill and combined allocations above the `700.00` payment were blocked. Both selected bills and entered values remained visible for correction. |
| Supplier credit, `VCN-FY 2026-000001` | Original bill preselected. Four units against three were blocked; one unit at `100.00` saved, previewed, approved and posted. Original account and tax basis were retained. |
| Supplier credit application | `101.00` was rejected against `100.00` available. Applying `100.00` reduced unused credit and original bill due to zero. |
| Unapply and reapply | A normal dated unapply restored both balances to `100.00` and re-enabled Apply without pressing Refresh or reloading. Reapplying `100.00` returned both to zero. History retains the reversed original allocation and the new active allocation. |
| Customer invoice, `INV-FY 2026-000005` | Two units at `125.50`, total `251.00`, saved, previewed, approved and posted. |
| Customer credit, `CN-FY 2026-000001` | One original unit at `125.50` saved, previewed, approved, posted and applied. Credit unused balance is zero. Reopening the original invoice shows its issued total `251.00`, original two units and remaining due `125.50`. Its history names the credit. |

The screenshot evidence is named `02-supplier-payment-form.jpg`, `03-supplier-payment-posted.jpg`, `04-customer-credit-applied.jpg` and `05-supplier-credit-history.jpg` in the batch verification artifacts. Screenshots contain synthetic QA data only.

## Automated and restricted-database evidence

The final local `npm run check` passed on code commit `7694c9f`: ESLint with zero warnings, TypeScript, **265 application tests with zero failures/skips**, and the optimized production build. Log: `accounts-batch3/validation/publication-check.log`. The caption refinement is included in that run. Final remote CI and deployment results are recorded with the exact published head in PR 171; only this QA record was added after the passing check.

Actual database verification used the restricted `ams_app_login` connection and fresh isolated synthetic companies. Privileged setup was limited to documented fixture/bootstrap work. These are **29 grouped checks**, not 29 completed canonical stories:

| Suite | Passing groups | Evidence |
|---|---:|---|
| Supplier payment | 7 | [Supplier payment workflow](supplier-payment-workflow.md); `tests/database/supplier-payment-workflow.mjs` |
| Credit source and capacity | 12 | [Credit source verification](credit-note-source-verification.md); `tests/database/credit-note-sources.mjs` |
| Credit application | 6 | [Credit application workflow](credit-application-workflow.md); `tests/database/credit-application-workflow.mjs` |
| Balance Sheet earnings | 4 | [Balance Sheet expense sign](balance-sheet-expense-sign.md); `tests/database/balance-sheet-earnings.mjs` |

Coverage includes company/permission boundaries, dated balances, future allocations and reversals, exact monetary limits, immutable issued line basis, idempotent requests, genuine two-connection posting/allocation races and failure atomicity. The credit-application suite checks that applying a credit creates the expected allocation/audit/receipt without adding journals or cash facts.

## Forward migration and preservation

The ordinary migration runner installed 0092–0094 (`90 → 93` files), then 0095 (`93 → 94` files). Each upgrade had an independently captured before/after baseline while retained-company financial writes were paused. Both passed with no changed rows in the 12 checked financial tables for the retained browser company:

`business_documents`, `document_lines`, `trade_documents`, `money_movements`, `transfers`, `manual_journal_rows`, `journal_entries`, `journal_lines`, `open_items`, `settlement_allocations`, `document_allocation_plans`, `approval_requests`.

Evidence: `accounts-batch3/validation/forward-upgrade.json` and `accounts-batch3/validation/report-migration/forward-upgrade.json`. This is scoped preservation evidence for those tables/company; it does not claim every database table or tenant was compared. Original installed migration 0049 and historical issued documents/journals remain unchanged.

The report's retained diagnostic snapshots reflect different legitimate business states because authorized browser work continued between them. They prove report/P&L/trial-balance agreement at their captured state, not before/after data preservation; the separate migration hashes provide that evidence.

## Boundaries

- Preview and draft PR only; no production rollout or merge is established by this record.
- Supplier-payment submission still requires at least one positive bill allocation under the existing approval contract. Excess payment may remain unused; fully unallocated submission was not added.
- Existing deferred customer-credit restrictions remain. Cash-refund/provider workflows and invoice-email delivery were not exercised by this batch.
- Opening imports and year-close/reopen logic are preserved by the report patch but are not exercised by its bounded regression. Full reporting/export acceptance and independent accounting/tax review remain separate work.
- Browser screenshots verify desktop views. This record does not claim a full mobile or assistive-technology audit.
- Related supplier/credit stories remain open. These fixes do not silently close their broader acceptance criteria.
