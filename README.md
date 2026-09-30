# Accounts Management Solution

Multi-tenant finance and accounting SaaS for companies.

## Project status

US-002 establishes the reproducible Next.js/TypeScript modular-monolith
scaffold and CI quality gate. Financial behavior, database migrations,
authentication, Supabase project changes and production deployment are not part
of this bootstrap.

## Local setup

Requirements:

- Node.js `24.21.0`
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

## Quality commands

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run check
```

Retained source-reference checks:

```bash
cd docs
python -m unittest discover -s tests -v
python verification/check_spec.py
```

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
