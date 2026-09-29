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
