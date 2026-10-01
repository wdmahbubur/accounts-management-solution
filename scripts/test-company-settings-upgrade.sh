#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Fixed local, disposable CI database only; never accepts a project ref or URL.
DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
supabase db reset --local --version 20261001090257 --yes
psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
insert into auth.users(id,email,email_confirmed_at,last_sign_in_at) values
('12008888-1111-4111-8111-111111111111','settings-upgrade@example.invalid',now(),now());
insert into finance.organizations(id,name,slug,legal_name,books_start_date,fiscal_year_start_month,status,address) values
('12008888-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Used settings','us012-used-upgrade','Used settings','2026-01-01',1,'onboarding','{"line1":"Legacy address","legacy_key":"retained"}'),
('12008888-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Unused settings','us012-unused-upgrade','Unused settings','2026-01-01',1,'onboarding','{}');
insert into finance.organization_members(id,organization_id,user_id,display_name_snapshot) values
('12008888-2222-4222-8222-222222222222','12008888-aaaa-4aaa-8aaa-aaaaaaaaaaaa','12008888-1111-4111-8111-111111111111','Historic actor');
insert into finance.business_documents(id,organization_id,document_type,issue_date,accounting_date,total_amount,created_by_member_id)
values('12008888-3333-4333-8333-333333333333','12008888-aaaa-4aaa-8aaa-aaaaaaaaaaaa','invoice','2026-01-01','2026-01-01',456.78,'12008888-2222-4222-8222-222222222222');
SQL
supabase migration up --local --yes
result="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "select
  (select count(*) from finance.organizations where id='12008888-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and foundation_locked_at is not null and settings_version=1 and address->>'legacy_key'='retained'),
  (select count(*) from finance.organizations where id='12008888-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and foundation_locked_at is null and settings_version=1),
  (select total_amount::text||'/'||accounting_date::text from finance.business_documents where id='12008888-3333-4333-8333-333333333333'),
  (select display_name_snapshot from finance.organization_members where id='12008888-2222-4222-8222-222222222222');")"
test "$result" = '1|1|456.78/2026-01-01|Historic actor'
echo 'US012 upgrade PASS: used foundation frozen, unused setup editable, original amounts/dates/actor/address retained.'
