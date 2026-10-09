# Balance Sheet expense sign regression

## Confirmed cause

Batch 3 browser verification exposed a pre-existing report defect after posting an ordinary supplier bill. Migration 0049, unchanged since commit `587c041`, signs income as `credit - debit` but expenses as `debit - credit`, then adds both into untransferred earnings. This treats a debit expense as an increase in equity. The reported difference is consequently minus twice net expense, even when every posted journal is balanced.

The dashboard warning is a faithful reflection of that incorrect report total, not evidence that the new supplier bill wrote an unbalanced journal. Migration 0057 reads the Balance Sheet's `difference` and adds the warning whenever it is nonzero. Supplier migrations 0092–0094 did not replace the report function.

An actual `ams_app_login` repeatable-read, read-only snapshot of the retained synthetic browser company `ed3456f2-2385-49b0-8783-b889bb569137`, as of `2026-10-09`, confirmed the defect after two supplier bills totaling `800.00`:

| Measure | Confirmed value |
|---|---:|
| Posted ledger debit / credit | `3695.98` / `3695.98` |
| Posted ledger difference | `0.00` |
| Assets / liabilities | `1625.63` / `800.00` |
| Correct nominal net earnings, also returned by P&L | `825.63` |
| Incorrect Balance Sheet earnings | `2425.63` |
| Incorrect Balance Sheet difference | `-1600.00` |

The first `500.00` bill (`d2e65119-90e1-445e-9296-197e37db794a`) has exactly direct-service-cost account `5000` debit `500.00` and trade-payables account `2000` credit `500.00`. No retained-company mutation was performed for this investigation. Existing-owner identity was selected with a privileged read; the report, trial-balance and ledger assertions used the restricted connection. Evidence is `accounts-batch3/validation/balance-sheet-bug-before.json`. An earlier literal-value assertion stopped when concurrent authorized browser work added the second bill; the final check derives its assertion from one stable snapshot rather than those stale figures.

## Bounded repair

Migration `0095_balance_sheet_expense_sign.sql` changes only the expense row's equity contribution to `credit - debit`. Both nominal account rows now sum directly into untransferred earnings: debit expenses are negative, and credits that reduce expenses increase earnings.

The patch reads the installed function definition and requires exactly one known expression before replacing it. It fails closed if that expression is missing or duplicated. Original migration 0049 remains unchanged. Source/tenant permissions, security-definer settings, existing grants, cumulative ledger joins, opening and year-close handling, reversal dates, comparison logic and response shape are preserved. No financial data or historical saved report snapshot is rewritten.

## Regression verification

Run against an explicitly selected isolated database after normal installation of 0095:

```bash
AMS_DATABASE_TESTS=isolated node tests/database/balance-sheet-earnings.mjs
```

The runner loads the existing local environment without printing it. Prefer `TEST_DATABASE_URL` / `TEST_DATABASE_RUNTIME_URL`; the normal isolated owner/runtime variables are supported as fallbacks. Both connections must identify the same target and the runtime username must be `ams_app_login`. Connection and statement timeouts are 30 seconds, with a 15-second lock timeout.

Each run creates fresh synthetic companies. Privileged SQL seeds only test identities, a contact and a limited-reader role. Company setup, below-threshold approval policies, saving, submission, posting and reversal use actual restricted-runtime commands. Existing browser companies are untouched.

Four grouped checks cover:

1. Restricted role properties and explicit fixture boundaries.
2. An invoice of `1625.63` plus a `500.00` supplier bill: `1125.63` earnings, a negative `5000` expense row, balanced trial balance, zero Balance Sheet difference and no dashboard balance warning. Earlier comparison excludes the bill.
3. A future `100.00` expense and a later reversal of the original `500.00` bill: current and comparison dates retain their own correct balances and earnings.
4. `reports.read`, membership and company boundaries, including a separate empty company and before/after no-write evidence for sources, complete journals/lines, sequence rows and side-effect counts.

## Verified result

Root applied 0095 through the ordinary migration runner, reaching 94 installed files. Its SHA-256 is `9e8e431feae1d348cb808ebeec6d31b767a5b025fbfc6f616f4ae6903a1e4d64`. On 2026-10-09, all **four grouped regression checks passed** under the actual restricted login. Syntax, scoped ESLint and diff checks passed; no migration or runner change was needed after installation.

Retained regression fixtures: company `1d24dde3-7a77-4ff2-8797-dced0ff1701c`, invoice `47b7b22a-8409-4877-a914-42ff9782e0f7`, original bill `ab772fb3-a53e-433f-9d7c-212fea4d2851`. The `1625.63` invoice and `500.00` bill report `1125.63` untransferred earnings and zero difference. Future expense and subsequent reversal assertions pass at both selected dates. Log: `accounts-batch3/validation/balance-sheet-database.log`.

A separate restricted-runtime, repeatable-read, read-only snapshot rechecked the retained browser company after the correction. Its newer legitimate business state had `700.00` net expense, assets `925.63`, liabilities `0.00` and nominal earnings `925.63`. Posted ledger debit and credit both totaled `4495.98`; trial balance and Balance Sheet differences were both zero. Profit & Loss, nominal ledger and Balance Sheet earnings agreed, and the dashboard response contained no balance-sheet warning. Evidence: `accounts-batch3/validation/balance-sheet-bug-after.json`.

The retained before/after snapshots reflect different business states because authorized browser work continued between them. They prove report agreement at each captured state; they are **not** a financial-preservation comparison. Root's separately captured migration table hashes own that evidence.

Opening imports, year-close and reopening are preserved in the function body but are not exercised by this bounded runner. The unrelated optional-comparison validation defect in the Balance Sheet page was reported separately; it is not changed by this migration. These results do not establish all report, export or canonical accounting acceptance criteria.
