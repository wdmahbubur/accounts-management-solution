#!/usr/bin/env bash
set -euo pipefail

DB_URL="${SUPABASE_LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
ORG="99999999-aaaa-4aaa-8aaa-aaaaaaaaaaa9"
USER_A="99999999-1111-4111-8111-111111111111"
USER_B="99999999-2222-4222-8222-222222222222"
MEMBER_A="99999999-bbbb-4bbb-8bbb-bbbbbbbbbba1"
MEMBER_B="99999999-bbbb-4bbb-8bbb-bbbbbbbbbba2"
ROLE_OWNER="99999999-cccc-4ccc-8ccc-cccccccccca1"
LOG_A="$(mktemp)"
LOG_B="$(mktemp)"
trap 'rm -f "$LOG_A" "$LOG_B"' EXIT

psql "$DB_URL" -v ON_ERROR_STOP=1 <<SQL
insert into auth.users(id,email,last_sign_in_at) values
  ('$USER_A','us009-race-a@example.invalid',now()),
  ('$USER_B','us009-race-b@example.invalid',now())
on conflict (id) do update set last_sign_in_at=excluded.last_sign_in_at;

insert into finance.organizations
  (id,name,slug,legal_name,books_start_date,fiscal_year_start_month,status)
values
  ('$ORG','US009 Race','us009-race','US009 Race Limited','2026-01-01',1,'active')
on conflict (id) do nothing;

insert into finance.organization_members
  (id,organization_id,user_id,display_name_snapshot,status)
values
  ('$MEMBER_A','$ORG','$USER_A','Race Owner A','active'),
  ('$MEMBER_B','$ORG','$USER_B','Race Owner B','active')
on conflict (organization_id,user_id) do update set status='active';

insert into finance.roles
  (id,organization_id,name,template_key,is_system)
values
  ('$ROLE_OWNER','$ORG','Owner','owner',true)
on conflict (organization_id,name) do nothing;

insert into finance.member_roles(organization_id,member_id,role_id)
values
  ('$ORG','$MEMBER_A','$ROLE_OWNER'),
  ('$ORG','$MEMBER_B','$ROLE_OWNER')
on conflict (organization_id,member_id,role_id) do nothing;
SQL

call_a="set role authenticated;
set request.jwt.claim.sub='$USER_A';
select public.set_member_roles('$ORG','$MEMBER_B',array[]::uuid[],'req_us009_race_a');"

call_b="set role authenticated;
set request.jwt.claim.sub='$USER_B';
select public.set_member_roles('$ORG','$MEMBER_A',array[]::uuid[],'req_us009_race_b');"

set +e
psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$call_a" >"$LOG_A" 2>&1 &
pid_a=$!
psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$call_b" >"$LOG_B" 2>&1 &
pid_b=$!
wait "$pid_a"; status_a=$?
wait "$pid_b"; status_b=$?
set -e

if [ "$status_a" -eq 0 ] && [ "$status_b" -eq 0 ]; then
  echo "Both concurrent owner removals succeeded; owner floor violated."
  cat "$LOG_A"
  cat "$LOG_B"
  exit 1
fi

if [ "$status_a" -ne 0 ] && [ "$status_b" -ne 0 ]; then
  echo "Both concurrent owner removals failed; expected one safe mutation."
  cat "$LOG_A"
  cat "$LOG_B"
  exit 1
fi

owner_count="$(psql "$DB_URL" -Atqc "
  select count(*)
  from finance.organization_members m
  join finance.member_roles mr
    on mr.organization_id=m.organization_id and mr.member_id=m.id
  join finance.roles r
    on r.organization_id=mr.organization_id and r.id=mr.role_id
  where m.organization_id='$ORG'
    and m.status='active'
    and r.is_system
    and r.template_key='owner';
")"

test "$owner_count" = "1"

echo "US-009 last-owner concurrent removal race PASS (status_a=$status_a status_b=$status_b)"
