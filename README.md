# Accounts Management Solution

Multi-tenant finance and accounting SaaS for companies.

## Project status

US-002 establishes the reproducible Next.js/TypeScript modular-monolith
scaffold and CI quality gate. Financial behavior, database migrations,
authentication, Supabase project changes and production deployment are not part
of this bootstrap.

## Local setup

Requirements:

- Node.js `24.x`
- npm `11.19.0`
- Python `3.10+` for the retained specification/reference checks

Setup:

```bash
cp .env.example .env.local
npm ci
npm run dev
```

The environment example contains browser-safe placeholders only. Never commit
Supabase service-role keys, provider secrets or real customer data.

## Quality and test commands

```bash
npm run lint
npm run typecheck
npm test                 # real application/service tests
npm run build
npm run check
```

The test layers are intentionally separate:

```bash
npm run test:application
npm run test:reference   # retained Python reference model; not app evidence
npm run test:spec        # static source/spec checks; not app evidence
npm run test:database    # requires local Supabase DB
npm run test:race        # requires local Supabase DB
npm run test:browser     # Playwright Chromium harness
```

See [US-005 test harness](docs/16-test-harness.md) and
[acceptance traceability](tests/acceptance-matrix.json).

## Local database migrations

US-003 uses Supabase CLI `2.118.0` and PostgreSQL 17. The committed `supabase/`
configuration keeps the `finance` and `finance_private` schemas outside the
Data API exposure list and keeps application seed data disabled.

```bash
supabase db start
supabase db reset
supabase test db
bash scripts/test-migration-upgrade.sh
```

`db reset` verifies a clean replay of all migrations. The upgrade script uses
a second isolated database in the local Supabase PostgreSQL instance to verify
the staged core-to-security migration path. See
[the US-003 migration review](docs/14-migration-review.md).

CI runs on pull requests and on pushes to `master`. It installs the committed
lockfile and fails on lint, typecheck, test or build failures. It contains no
production deployment job; deployment requires a separately reviewed and
authorized workflow/story.

## Modular boundaries

```text
apps/web/                 Next.js App Router shell
  app/                    route/layout boundary
  components/finance/     finance UI boundary
  server/                 auth/command/query/integration boundary

packages/accounting/      pure accounting-rule/calculation boundary
packages/contracts/       shared request/response/error DTO boundary
packages/permissions/     capability/authorization contract boundary
packages/reporting/       ledger-derived report contract boundary
```

The packages expose only bootstrap metadata in US-002. Business rules,
authorization enforcement, migrations and posting logic stay in their owning
stories.

## Start here

- [Developer handoff](docs/README.md)
- [Product requirements](docs/01-product-requirements.md)
- [Accounting rules](docs/02-accounting-rules.md)
- [Database design](docs/03-database-design.md)
- [Page-by-page UI specification](docs/05-ui-specification.md)
- [AI implementation instructions](AGENTS.md)
- [Implementation roadmap and issue index](docs/10-implementation-roadmap.md)
- [GitHub issues](https://github.com/wdmahbubur/accounts-management-solution/issues)

The source specification is version 1.0, dated 29 September 2026. Reference SQL
and reference-model tests are design aids, not a production-ready accounting
engine. Read the readiness limitations before implementation.
