# Cash posting preview repair

## Scope

Receipts, supplier payments, refunds, advances and transfers now obtain their preview lines from the same private SQL planner consumed by `post_financial_document`. The draft and approval endpoints preserve separate permission checks. The approval preview binds the approval request, source version, material digest and allowed states in the database.

The shared preview table shows account names/codes, debit and credit amounts, party/description, totals and proposed allocations. Trade documents retain their existing exact line/tax calculation; manual journals retain their stored debit/credit calculations. Empty journals and unsupported source types no longer appear as a valid zero-value posting plan.

Saved receipt detail loads invoice choices for its saved customer and accounting date. Refreshing the list preserves selected amounts. A selected target which is no longer eligible remains visible for explicit removal. Read-only source viewers skip write-only draft options and optional lifecycle data for which they lack the module capability.

## Accounting boundary

- `database/migrations/0087_authoritative_cash_posting_previews.sql` adds the private planner and two public permission-scoped read RPCs.
- Only the cash-line construction branches of the existing posting routine delegate to the planner. Posting still owns organization/period locks, approval and authorization rechecks, sequence allocation, line insertion, control open items, settlement locks/capacity checks, idempotency, audit and outbox.
- The planner preserves line order and transfer fee classification. Money remains PostgreSQL `finance.amount` and canonical decimal strings at the API boundary.
- Preview uses the existing historical allocation-capacity helper. It does not reserve balances or authorize a later posting.
- Transfer fee account eligibility remains the existing active/postable non-control requirement. This repair does not introduce a new expense-type policy.
- Existing submission rules require an allocation plan for receipts and supplier payments. An unallocated draft can be previewed; changing its submission policy is outside this repair.

## Integration dependency discovered during testing

The first real-database run successfully previewed an unallocated receipt, then exposed a pre-existing `jsonb_object_length(jsonb)` call in both allocation save routines. PostgreSQL has no such function. The separate allocation-plan update also contained ambiguous output-column references.

The complete allocated-flow verification requires the separately delivered `0089_fix_allocation_plan_validation.sql`, which corrects these baseline routines. Migration 0087 itself does not depend on the company-setup completion migration 0086.

## Reproduce

Run the ordinary application checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

For the database scenarios, explicitly select an isolated database already migrated through the integrated corrections. Supply `TEST_DATABASE_URL` for fixture setup and evidence reads, and `TEST_DATABASE_RUNTIME_URL` for the actual restricted `ams_app_login` on that same database. No production connection fallback is used.

```bash
node --env-file=.env.local tests/database/cash-posting-preview.mjs
```

The script creates a uniquely named synthetic company and uses actual restricted-login connections for save, preview, approval submission and posting. It retains that isolated fixture and prints its IDs for subsequent browser/ledger verification. It never sends provider messages.

The scenarios cover:

- Preview/posting equality for receipts, supplier payments, transfers with and without fees, and all four refund/advance types.
- Exact decimal scale, one-paisa values, null due dates, and draft/approval preview equality.
- `BEGIN READ ONLY` previews with unchanged source/version/number, sequence, journal, open-item, settlement, idempotency, audit and outbox records.
- Separate allocation-plan save/update, version advancement, and missing/extra/scalar/non-string row rejection in both save paths.
- Actual source-reader, writer and approval-reader capabilities, direct private-function denial and cross-company/source denial.
- Pending approval preview without source-write permission, blocked posting before approval, and material edits invalidating the prior review.
- Stale versions, posted-source/stale-approval rejection, archived accounts, same-account transfers and missing fee accounts.
- Physical-cash-floor failure with complete posting rollback, changed settlement capacity after approval, and future-boundary conflict for a backdated receipt.
- A retained saved receipt whose target is returned by the detail page's invoice-choice loader.

## Verification status

- Integrated `npm run check` passed: lint, type checking, all 184 application tests (zero failed or skipped), and the Next.js 16.3.7 production build.
- A clean installation of all 88 committed migrations through 0089 passed on the isolated Neon PostgreSQL database, including the final company-setup permission correction. Migration history checksums were not bypassed.
- The cash verifier was rerun from integrated code `f361c99` after that clean installation: **passed, 15 grouped checks**, using the real restricted `ams_app_login`. All seven cash source types matched their committed journal lines; exact decimal scale and null due dates, draft/approval equality, read-only no-effects checks, both allocation-save paths, permission failures, pending approval and material-edit checks, atomic rollback and historical allocation conflicts passed.
- The final-install run retained synthetic company `aa9645d7-0022-4d8d-a1dd-8082f2079e15`, saved receipt `3459e133-9678-40c9-990d-f7944b73182b` and posted receipt `8ba989f5-7d20-43f0-ae7e-f33036d272f1` for follow-up verification. The distinct evidence log is `cash-posting-preview-final-install-2026-10-08.jsonl` in the task's validation artifacts.
- Browser verification remains with the integrating task. Application and database checks do not establish browser behavior.
