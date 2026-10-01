# US-013 — Exact shared calculations

`@ams/accounting` exports `calculateLine`, `calculateDocument`, strict decimal and
money parsers, signed half-up rational rounding and canonical money formatting.
Quantity/price support numeric(20,6); rates are 0..100 with six fractional digits;
amounts are canonical numeric(20,2) strings. No binary floating-point arithmetic
is used for money. Quantity is positive; zero price/full discount is allowed in a
preview, not permission to post a zero-valued journal. Negative, non-finite,
exponential, whitespace, leading-zero, excess-scale and overflow input is rejected.

The line rules follow accounting specification section 2: round quantity times
price first; apply exactly one explicit or percentage line discount; then apply
inclusive/exclusive tax. Sum rounded line values. Never recalculate tax on a
header subtotal or add a header discount. V1 is BDT-only. Supplied tax rates are
mathematical inputs, not validated tax policy or statutory defaults. Tax labels,
recoverability, original-credit limits and approved rates remain the source/tax
story's responsibility and must not be inferred from a zero tax amount.

Document input: `{currency:'BDT', lines:[{quantity:'1',unit_price:'10000',
tax_rate:'10',tax_mode:'exclusive'}]}`. A line may additionally contain exactly
one `discount_amount` (two decimals) or `discount_percent` (up to six decimals).
Output contains canonical base/discount/net/tax/gross values for each line and
their sums, explicit rounding adjustment and final total. Unknown client totals
or authority fields are rejected. Previews are bounded to 1000 lines.

Optional `rounding:{amount,reason,account_id}` is limited to signed 0.05 BDT,
with an explicit nonempty reason and UUID. The calculator validates only the
arithmetic contract. The future posting command must restrict adjustment usage
to the specification's eligible supplier-bill case and verify that the account
belongs to the company, is postable, and is the dedicated rounding account.
This library neither selects an account nor posts a balancing difference.

`public.calculate_document_preview(jsonb)` independently implements the same
rules using PostgreSQL numeric arithmetic. It is SECURITY INVOKER, reads/writes
no table, and is unavailable to anonymous roles. Its private decimal decoder is
pure and explicitly granted only for invocation by the ordinary authenticated
caller. It does not need a company identity because it has no company data and
performs no authorized operation. It cannot replace a posting command.

The parity script runs both implementations on 10 hand-calculated goldens and
120 deterministic fractional/rate/discount examples; it also requires both to
reject the same 43 invalid inputs. Actual ordinary-role PostgreSQL execution is
required in CI, separately from the original Python specification examples.
T-17/T-18/T-19/T-50 are addressed by these calculation boundary checks. No ledger
posting, credit cap, tax configuration or full DB-G12 source/header enforcement
is claimed here; owning stories must reuse this calculation contract.

The additive migration was created by pinned Supabase CLI 2.118.0. It changes no
stored amounts. A rollback can stop using preview without rewriting any books.
Execution evidence is recorded in the PR against the tested head commit.
