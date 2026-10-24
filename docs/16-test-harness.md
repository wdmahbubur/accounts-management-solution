# US-005 Test Harness and Deterministic Fixtures

## Test boundaries

The repository now separates evidence by layer:

| Layer | Command | What it proves |
|---|---|---|
| Application/service | `npm test` / `npm run test:application` | TypeScript/Node contracts, service boundaries and repository application tests |
| Reference model | `npm run test:reference` | Retained Python arithmetic/ledger examples only; not application evidence |
| Static specification | `npm run test:spec` | Source/artifact consistency only |
| Real accounting database | `npm run test:database:accounting` | Actual restricted-login Neon accounting, authorization, period/year and race commands |
| Private files/exports | `npm run test:database:exports` | Real private S3 files, issued snapshots and permission-checked downloads |
| Worker recovery | `npm run test:database:worker-recovery` | Actual worker crash, lease expiry and loopback SMTP recovery; no external mail |
| Authenticated HTTP | `npm run test:database:http-security` | Password-authenticated local application API boundaries; requires `AMS_TEST_APP_URL` |
| Recovery/invitations | `npm run test:database:recovery` / `npm run test:database:invitations` | Restored synthetic file and live invitation/revocation commands |
| Browser | Connected Edge session | Actual UI flows; not replaced by HTTP/database tests |

Reference/static suites remain useful baselines, but they are never counted as a real application acceptance pass.

Current database tests require an explicitly enabled isolated target (`AMS_DATABASE_TESTS=isolated`, `AMS_TEST_DATABASE_HOST`) with owner fixtures and a separate restricted runtime login. Object/worker tests additionally require private test storage and the restricted worker login. Never load a production profile. See [the 21 October execution report](qa/full-acceptance-2026-10-21.md) for exact environment, commands, results and remaining gates. The older Supabase fixture/browser/race descriptions below are retained historical US-005 context, not current runnable commands.

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
`supabase/tests/helpers/us005_two_company_fixture.psql`. It directly inserts
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

- `covered` — the full source acceptance case has real implementation evidence;
- `partial` — meaningful real evidence exists, but the full source case is not yet proven and is not counted as a pass;
- `fixture_ready` — deterministic fixture/harness exists but the application case is not proven;
- `pending` — no implementation evidence yet.
- `blocked` — an identified prerequisite/implementation is absent; not a pass;
- `failed` — executed acceptance still fails; not a pass.

The matrix validator fails if cases are missing/duplicated or a covered case has
no evidence. Pending and fixture-ready cases are never counted as passes.

Current coverage at US-005:

- covered: S-02, S-05, S-06;
- partial: S-01;
- fixture-ready: T-47;
- pending: all remaining cases.

That is the historical US-005 snapshot. The current 72-case matrix and [execution report](qa/full-acceptance-2026-10-21.md) supersede those initial counts. The validator now checks IDs, evidence paths, result labels and limitation notes instead of hard-coding the old two-pass count. A matrix label is traceability, not a substitute for retained execution output.

## Browser harness

Playwright is pinned to `1.63.0` and Chromium is installed in CI with
`npx playwright install --with-deps chromium`. The current browser test is a
harness smoke test only; it does not claim accounting behavior.

## Race harness

`scripts/test-race-harness.sh` opens distinct PostgreSQL backend sessions and
proves actual advisory-lock contention/release. Future concurrency stories can
reuse the same isolated Supabase database and independent-connection pattern
instead of faking races sequentially.
