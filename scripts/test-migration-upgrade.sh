#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE="$ROOT/supabase/migrations/20260930111830_core_finance_schema.sql"
SECURITY="$ROOT/supabase/migrations/20260930112000_read_only_security_baseline.sql"
ADMIN_URL="${SUPABASE_LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
UPGRADE_DB="us003_upgrade"
UPGRADE_URL="postgresql://postgres:postgres@127.0.0.1:54322/${UPGRADE_DB}"

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "drop database if exists ${UPGRADE_DB} with (force);"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "create database ${UPGRADE_DB};"

psql "$UPGRADE_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end
$$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create table public.us003_upgrade_marker (
  id integer primary key,
  note text not null
);
insert into public.us003_upgrade_marker values (1, 'preserve me');
SQL

psql "$UPGRADE_URL" -v ON_ERROR_STOP=1 -f "$CORE"

psql "$UPGRADE_URL" -v ON_ERROR_STOP=1 <<'SQL'
insert into finance.organizations
  (id, name, slug, legal_name, books_start_date, fiscal_year_start_month, status)
values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Upgrade Sentinel', 'upgrade-sentinel', 'Upgrade Sentinel', '2026-01-01', 1, 'active');
SQL

psql "$UPGRADE_URL" -v ON_ERROR_STOP=1 -f "$SECURITY"

test "$(psql "$UPGRADE_URL" -Atqc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='finance' and c.relkind='r'")" = "52"
test "$(psql "$UPGRADE_URL" -Atqc "select count(*) from public.us003_upgrade_marker where id=1 and note='preserve me'")" = "1"
test "$(psql "$UPGRADE_URL" -Atqc "select count(*) from finance.organizations where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'")" = "1"
test "$(psql "$UPGRADE_URL" -Atqc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='finance' and c.relkind='r' and c.relrowsecurity")" = "52"
test "$(psql "$UPGRADE_URL" -Atqc "select count(*) from information_schema.role_table_grants where table_schema='finance' and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')")" = "0"

echo "US-003 staged core -> security migration upgrade PASS"
