# US-005 Test Harness and Deterministic Fixtures

## Test boundaries

The repository now separates evidence by layer:

| Layer | Command | What it proves |
|---|---|---|
| Application/service | `npm test` / `npm run test:application` | TypeScript/Node contracts, service boundaries and repository application tests |
| Reference model | `npm run test:reference` | Retained Python arithmetic/ledger examples only; not application evidence |
| Static specification | `npm run test:spec` | Source/artifact consistency only |
| Real database | `npm run test:database` | PostgreSQL/RLS/tenant/schema behavior in the isolated local Supabase stack |
| Race harness | `npm run test:race` | Two independent PostgreSQL sessions can exercise real lock contention |
| Browser | `npm run test:browser` | Chromium can boot and exercise the actual Next.js app surface |

Reference/static suites remain useful baselines, but they are never counted as a real application acceptance pass.

## Deterministic fixtures

`packages/test-fixtures` is the shared fixture contract. It fixes:

- two company UUIDs;
- one user with memberships in both companies;
- Accountant capability in company A and Billing-only capability in company B;
- fixed BDT dates for 2026;
- fixed account identities;
- the golden six-event accounting scenario from `docs/07-acceptance-and-delivery.md`;
- exact decimal-string expected balances.

The PostgreSQL counterpart lives at
`supabase/tests/helpers/us005_two_company_fixture.sql`. It directly inserts
synthetic fixture observations for testing. Direct test-fixture insertion does **not**
prove DB-G01/DB-G02 posting guards and must never be confused with an application post command.

## T-47 status

The fixture and database queries deterministically reproduce the golden expected
bank/AR/AP/revenue/expense/trial-balance numbers. T-47 remains
`fixture_ready`, not `covered`, because the real posting, open-item, report and
browser flows do not exist yet. Later stories must execute the scenario through
the actual application before changing T-47 to `covered`.

## S-01 / S-02

S-01 and S-02 continue to have real PostgreSQL evidence in
`supabase/tests/database/01_tenant_isolation.test.sql`. The reusable US-005
fixture adds a second dual-membership/scoped-read check without weakening the
existing security tests.

## Acceptance traceability

`tests/acceptance-matrix.json` contains every source case T-01..T-52 and
S-01..S-20. Allowed statuses are:

- `covered` — real implementation evidence exists;
- `fixture_ready` — deterministic fixture/harness exists but the application case is not proven;
- `pending` — no implementation evidence yet.

The matrix validator fails if cases are missing/duplicated or a covered case has
no evidence. Pending and fixture-ready cases are never counted as passes.

Current coverage at US-005:

- covered: S-01, S-02, S-05, S-06;
- fixture-ready: T-47;
- pending: all remaining cases.

## Browser harness

Playwright is pinned to `1.63.0` and Chromium is installed in CI with
`npx playwright install --with-deps chromium`. The current browser test is a
harness smoke test only; it does not claim accounting behavior.

## Race harness

`scripts/test-race-harness.sh` opens distinct PostgreSQL backend sessions and
proves actual advisory-lock contention/release. Future concurrency stories can
reuse the same isolated Supabase database and independent-connection pattern
instead of faking races sequentially.
