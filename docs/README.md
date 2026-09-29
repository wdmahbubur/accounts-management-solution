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
