#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE="$ROOT/supabase/migrations/20260930111830_core_finance_schema.sql"
SECURITY="$ROOT/supabase/migrations/20260930112000_read_only_security_baseline.sql"
ROLES="$ROOT/supabase/migrations/20261001061115_capability_roles.sql"
ADMIN_URL="${SUPABASE_LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
DB="us009_upgrade"
URL="postgresql://postgres:postgres@127.0.0.1:54322/${DB}"

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "drop database if exists ${DB} with (force);"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "create database ${DB};"

psql "$URL" -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end
$$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  last_sign_in_at timestamptz
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
SQL

psql "$URL" -v ON_ERROR_STOP=1 -f "$CORE"
psql "$URL" -v ON_ERROR_STOP=1 -f "$SECURITY"

psql "$URL" -v ON_ERROR_STOP=1 <<'SQL'
insert into finance.organizations
  (id,name,slug,legal_name,books_start_date,fiscal_year_start_month,status)
values
  ('99999999-dddd-4ddd-8ddd-dddddddddddd','US009 Upgrade','us009-upgrade','US009 Upgrade Limited','2026-01-01',1,'active');

insert into finance.roles
  (id,organization_id,name,template_key,is_system)
values
  ('99999999-eeee-4eee-8eee-eeeeeeeeeee1','99999999-dddd-4ddd-8ddd-dddddddddddd','Owner','owner',true),
  ('99999999-eeee-4eee-8eee-eeeeeeeeeee2','99999999-dddd-4ddd-8ddd-dddddddddddd','Admin','admin',true),
  ('99999999-eeee-4eee-8eee-eeeeeeeeeee3','99999999-dddd-4ddd-8ddd-dddddddddddd','Billing','billing',true);
SQL

psql "$URL" -v ON_ERROR_STOP=1 -f "$ROLES"

test "$(psql "$URL" -Atqc "select count(*) from finance.permissions")" = "39"
test "$(psql "$URL" -Atqc "select count(*) from finance.role_permissions where organization_id='99999999-dddd-4ddd-8ddd-dddddddddddd' and role_id='99999999-eeee-4eee-8eee-eeeeeeeeeee1'")" = "39"
test "$(psql "$URL" -Atqc "select count(*) from finance.role_permissions rp join finance.permissions p on p.id=rp.permission_id where rp.organization_id='99999999-dddd-4ddd-8ddd-dddddddddddd' and rp.role_id='99999999-eeee-4eee-8eee-eeeeeeeeeee2' and p.code='reports.read'")" = "0"
test "$(psql "$URL" -Atqc "select count(*) from finance.role_permissions rp join finance.permissions p on p.id=rp.permission_id where rp.organization_id='99999999-dddd-4ddd-8ddd-dddddddddddd' and rp.role_id='99999999-eeee-4eee-8eee-eeeeeeeeeee3' and p.code='sales.read'")" = "1"

echo "US-009 pre-existing role-template backfill upgrade PASS"
