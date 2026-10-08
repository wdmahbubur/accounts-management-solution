# Accounts Management Solution

Multi-tenant finance and accounting SaaS for companies.

## Project status

The approved V1 is a Bangladesh-focused, BDT-only accrual accounting SaaS for
service and non-stock SMEs. A provider migration to Auth.js and Neon PostgreSQL
is in progress. The Neon target currently has the complete 52-table finance
schema and 97 row-level security policies applied through 11 checksum-tracked
migrations. Auth.js credentials/session foundations are present. Existing web
routes and storage still have transitional provider dependencies, so the
application is not yet fully migrated or ready for financial use.

## Local setup

Requirements:

- Node.js `24.x`
- npm `11.19.0`
- Python `3.10+` for the retained specification/reference checks

Copy the template, install dependencies, and fill in the private local database
connections before running database setup:

```bash
cp .env.example .env.local
npm ci
```

Then generate independent local secrets and check the configuration:

```bash
npm run dev:secrets
npm run env:check -- --local
npm run db:migrate
npm run dev
```

The environment example contains placeholders only. Never commit database
URLs, Auth.js secrets, mail/provider credentials or real customer data. Use
`DATABASE_URL` only for migrations/demo provisioning and a separate restricted
`DATABASE_RUNTIME_URL` for server-side app access.
For a synthetic demo identity in the isolated local database, run
`npm run demo:provision` after migrations. Both setup commands prefer
`MIGRATION_DATABASE_URL` over `DATABASE_URL`; an empty explicit override fails.

For Preview, inject its independent configuration and run
`npm run env:check -- --preview`. This mode never loads local environment files.
The check validates configuration only and runs separately from the build;
it does not test database access, email, redirects or cookies. Follow the
[local and preview environment guide](docs/environment-readiness.md) for the
canonical origin, isolated database and browser acceptance steps.

Internal outbox, reminder and export workers use the separately restricted
`DATABASE_WORKER_URL`, whose login inherits only the reviewed `ams_job_worker`
function grants. After applying migrations, configure a local worker login with
`npm run db:worker-credential`; production environments must provision an
equivalent credential through their secret manager.

Private attachment uploads remain quarantined until `/api/internal/attachments/scan`
records a digest-matched clean result. Configure `ATTACHMENT_SCAN_WORKER_SECRET`,
`CLAMAV_HOST`, and `CLAMAV_PORT` on the server, and
schedule authenticated POST requests to that endpoint. Keep the ClamAV daemon
on a private network because clamd's TCP protocol has no built-in authentication
or encryption. Scanner outages retry with backoff; infected and exhausted files
remain rejected and cannot be downloaded. Each completed scan records the
engine and loaded signature database revision reported by clamd. A running ClamAV service, signature
updates, scheduler, monitoring, and production scan evidence are deployment
responsibilities and are not provisioned by this repo.

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
```

See [US-005 test harness](docs/16-test-harness.md) and
[acceptance traceability](tests/acceptance-matrix.json).

## PostgreSQL migrations

Ordered plain-PostgreSQL migrations live under `database/migrations/`. They are
applied in transactions under a transaction-scoped advisory lock, and the
runner rejects edits to already-applied migration checksums. It reads
`DATABASE_URL` from `.env.local` by default; `MIGRATION_DATABASE_URL` can
override it. Demo provisioning uses the same owner-target precedence.
Application requests use `DATABASE_RUNTIME_URL` and never the migration
credential.

```bash
npm run db:migrate
```

The Neon target was empty before migration. The 11 migrations now create
application identity, company/accounting schema and security policies; no
existing financial rows or objects were transferred. Fresh-install and
upgrade verification on a disposable database remains part of this migration.

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
