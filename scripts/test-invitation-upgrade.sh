#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# This intentionally resets only the dedicated local CI stack, after other DB
# suites. Never use --linked, a project ref, or an externally supplied DB URL.
DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
node --input-type=module <<'JS'
import { execFileSync } from 'node:child_process';
const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], {encoding:'utf8'}));
const url = new URL(status.DB_URL ?? status.db_url);
if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.port !== '54322') {
  throw new Error('Invitation upgrade test requires the fixed local CI database.');
}
JS
supabase db reset --local --version 20261001061115 --yes
psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
insert into auth.users(id,email,email_confirmed_at,last_sign_in_at) values
('10108888-1111-4111-8111-111111111111','us010-upgrade-owner@example.invalid',now(),now()),
('10108888-2222-4222-8222-222222222222','us010-upgrade-member@example.invalid',now(),now());
insert into finance.organizations(id,name,slug,legal_name,books_start_date,fiscal_year_start_month,status)
values ('10108888-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Invitation upgrade','us010-invite-upgrade','Upgrade sentinel','2026-01-01',1,'active');
insert into finance.organization_members(id,organization_id,user_id,display_name_snapshot) values
('10108888-3333-4333-8333-333333333333','10108888-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10108888-1111-4111-8111-111111111111','Historical Owner'),
('10108888-4444-4444-8444-444444444444','10108888-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10108888-2222-4222-8222-222222222222','Historical Member');
insert into finance.roles(id,organization_id,name,template_key,is_system) values
('10108888-5555-4555-8555-555555555555','10108888-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Owner','owner',true);
insert into finance.member_roles(organization_id,member_id,role_id) values
('10108888-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10108888-3333-4333-8333-333333333333','10108888-5555-4555-8555-555555555555');
insert into finance.invitations(id,organization_id,email_normalized,role_id,token_hash,expires_at,invited_by_member_id,accepted_by_member_id,status) values
('10108888-6666-4666-8666-666666666666','10108888-aaaa-4aaa-8aaa-aaaaaaaaaaaa','pending@example.invalid','10108888-5555-4555-8555-555555555555',repeat('a',64),now()+interval '1 day','10108888-3333-4333-8333-333333333333',null,'pending'),
('10108888-7777-4777-8777-777777777777','10108888-aaaa-4aaa-8aaa-aaaaaaaaaaaa','us010-upgrade-member@example.invalid','10108888-5555-4555-8555-555555555555',repeat('b',64),now()+interval '1 day','10108888-3333-4333-8333-333333333333','10108888-4444-4444-8444-444444444444','accepted');
SQL
supabase migration up --local --yes
result="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "select
 (select count(*) from finance.invitations where id='10108888-6666-4666-8666-666666666666' and status='revoked'),
 (select count(*) from finance.audit_events where entity_id='10108888-6666-4666-8666-666666666666' and action='invitations.invalidated' and actor_kind='system'),
 (select count(*) from finance.invitations where id='10108888-7777-4777-8777-777777777777' and status='accepted' and accepted_by_member_id='10108888-4444-4444-8444-444444444444'),
 (select count(*) from finance.organization_members where organization_id='10108888-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and status='active'),
 (select count(*) from finance.role_permissions where role_id='10108888-5555-4555-8555-555555555555'),
 (select count(*) from storage.buckets where id='ams-private-artifacts' and not public),
 has_column_privilege('authenticated','finance.invitations','token_hash','SELECT');")"
test "$result" = '1|1|1|2|39|1|f'
echo 'US-010 real-stack upgrade PASS: pending legacy token retired/audited; accepted membership, historical identity and Owner grants retained; private bucket and token-hash restrictions active.'
