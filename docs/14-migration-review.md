# US-003 Migration Review

## Scope and source

Issue #17 converts the reviewed V1 physical reference into executable, versioned migrations without enabling the accounting write engine.

Source baseline:

- `docs/reference-schema.sql` — AMS V1.0, 29 September 2026
- `docs/schema-catalog.json` — 52 tables, including 48 tenant-scoped tables
- `docs/03-database-design.md` — DB-G01 through DB-G18
- Supabase CLI `2.118.0`

Versioned migrations:

1. `20260930111830_core_finance_schema.sql` — schemas, extension, exact numeric domains/enums, all 52 tables and reviewed indexes.
2. `20260930112000_read_only_security_baseline.sql` — private permission/read helpers, RLS enablement, read-only grants/policies and the final live-close index.

The files were created with `supabase migration new`. The split is a delivery-level change only.

## Deliberate field and constraint changes

**None.**

Every `CREATE TABLE finance.<name>` block is compared by an automated test against the corresponding block in `docs/reference-schema.sql`. The migration suite also compares all explicitly named indexes and all RLS table declarations/policies to the source reference.

The only deliberate changes are:

- wrapping the reviewed DDL into two ordered Supabase migration files;
- replacing the reference-only header warning with migration-specific safety wording;
- keeping local seed execution disabled until a later fixture/onboarding story owns application seed data.

## Clean install and upgrade verification

The CI database job uses PostgreSQL 17 through the pinned Supabase CLI/local stack.

Clean install:

```bash
supabase db start
supabase db reset
supabase test db
```

`db reset` rebuilds the local database from the committed migration history. pgTAP verifies the resulting physical schema and security baseline.

Upgrade path:

```bash
bash scripts/test-migration-upgrade.sh
```

The script creates a separate empty database in the isolated Supabase-local PostgreSQL instance, applies the core migration, writes sentinel data, then applies the security migration. It proves pre-security data remains intact and the second migration enables RLS without adding ordinary-user write privileges.

No hosted Supabase project or production database is mutated by these tests.

## Database evidence

Automated PostgreSQL checks cover:

- exactly 52 `finance` tables;
- composite `(organization_id, id)` identity on all 48 tenant tables;
- all 99 reviewed composite foreign keys;
- exact decimal domains:
  - `amount numeric(20,2)`
  - `quantity numeric(20,6)`
  - `unit_price numeric(20,6)`
  - `rate numeric(9,6)`
- all 124 explicitly named reviewed indexes;
- RLS enabled on all 52 tables;
- no INSERT/UPDATE/DELETE/TRUNCATE grant for `anon` or `authenticated`;
- private helper routines remain security-definer with fixed search path, and `anon` cannot use the private schema/functions.

Security cases implemented at the database boundary:

- **S-01:** one authenticated user can belong to two organizations while seeing accounts only for the organization where the required permission is actually granted. Direct ordinary-user account mutation is not granted.
- **S-02:** a cross-tenant account UUID injected into another organization's journal line is rejected by the composite foreign key and leaves no row.

A permission-safe application 404/error envelope belongs to later command/API authorization stories; US-003 proves the database boundary only.

## Cross-row guard status

US-003 intentionally does **not** claim the financial engine is ready. Row-local schema constraints and tenant foreign keys are installed, but the cross-row command guards in DB-G01..DB-G18 remain implementation work unless explicitly noted below.

- **DB-G05 — partial:** composite tenant foreign keys are active. The command/trigger checks for active/postable accounts, account hierarchy cycles, protected used classifications and control-account semantics remain unimplemented.
- **DB-G17 — partial:** organization/member/role tables and tenant relationships exist. Atomic onboarding, self-escalation prevention, last-active-owner protection and live authorization rechecks remain unimplemented.
- **DB-G01..DB-G04, DB-G06..DB-G16, DB-G18:** command/locking/trigger behavior remains unimplemented and must be delivered by their owning stories.

## Financial write gate

Financial writes remain disabled:

- ordinary `anon` and `authenticated` roles receive no DML grants on `finance`;
- `finance` and `finance_private` are not configured as Data API exposed schemas;
- no public mutation RPC or arbitrary journal-post endpoint is added by US-003.

Do not enable financial writes to make a future UI work. They remain gated until the transactional accounting engine and its guard tests are implemented and reviewed.
