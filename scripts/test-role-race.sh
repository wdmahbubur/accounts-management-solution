#!/usr/bin/env bash
set -euo pipefail

DB_URL="${SUPABASE_LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
ORG="99999999-aaaa-4aaa-8aaa-aaaaaaaaaaa9"
USER_A="99999999-1111-4111-8111-111111111111"
USER_B="99999999-2222-4222-8222-222222222222"
MEMBER_A="99999999-bbbb-4bbb-8bbb-bbbbbbbbbba1"
MEMBER_B="99999999-bbbb-4bbb-8bbb-bbbbbbbbbba2"
ROLE_OWNER="99999999-cccc-4ccc-8ccc-cccccccccca1"
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


DIR="$(mktemp -d)"
blocker=""; pid_a=""; pid_b=""
cleanup() {
  for pid in "$blocker" "$pid_a" "$pid_b"; do
    if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; fi
  done
  rm -rf "$DIR"
}
trap cleanup EXIT

for mode in role-removal deactivation; do
  # Restore two Owners between the independent races without bypassing triggers.
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
    update finance.organization_members set status='active' where organization_id='$ORG';
    insert into finance.member_roles(organization_id,member_id,role_id) values
      ('$ORG','$MEMBER_A','$ROLE_OWNER'),('$ORG','$MEMBER_B','$ROLE_OWNER')
    on conflict (organization_id,member_id,role_id) do nothing;"
  pipe="$DIR/$mode.pipe"; mkfifo "$pipe"; exec 9<>"$pipe"
  PGAPPNAME="us009-owner-blocker" psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt <"$pipe" >"$DIR/blocker.log" 2>&1 & blocker=$!
  printf "begin; select pg_advisory_xact_lock(hashtextextended('%s',9009)); select 'LOCK_READY';\n" "$ORG" >&9
  ready=false
  for _ in $(seq 1 100); do
    if grep -q LOCK_READY "$DIR/blocker.log"; then ready=true; break; fi
    sleep 0.1
  done
  if [ "$ready" != true ]; then cat "$DIR/blocker.log"; exit 1; fi

  if [ "$mode" = role-removal ]; then
    statement_a="select public.set_member_roles('$ORG','$MEMBER_B',array[]::uuid[],'req_us009_race_a');"
    statement_b="select public.set_member_roles('$ORG','$MEMBER_A',array[]::uuid[],'req_us009_race_b');"
  else
    statement_a="select public.deactivate_member('$ORG','$MEMBER_B','req_us009_deactivate_a');"
    statement_b="select public.deactivate_member('$ORG','$MEMBER_A','req_us009_deactivate_b');"
  fi
  PGAPPNAME=us009-owner-race-a psql "$DB_URL" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -qAtc     "set role authenticated; set request.jwt.claim.sub='$USER_A'; $statement_a" >"$DIR/a.log" 2>&1 & pid_a=$!
  PGAPPNAME=us009-owner-race-b psql "$DB_URL" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -qAtc     "set role authenticated; set request.jwt.claim.sub='$USER_B'; $statement_b" >"$DIR/b.log" 2>&1 & pid_b=$!
  # A real third connection observes two distinct blocked DB sessions before release.
  waiting=0
  for _ in $(seq 1 100); do
    waiting="$(psql "$DB_URL" -qAtc "select count(distinct pid) from pg_stat_activity
      where application_name in ('us009-owner-race-a','us009-owner-race-b')
        and wait_event_type='Lock' and wait_event='advisory';")"
    if [ "$waiting" = 2 ]; then break; fi
    sleep 0.1
  done
  if [ "$waiting" != 2 ]; then
    echo "Race did not overlap on two independent database connections."; cat "$DIR/a.log" "$DIR/b.log"; exit 1
  fi
  printf 'commit;\n\\q\n' >&9
  wait "$blocker"; blocker=""; exec 9>&-
  set +e
  wait "$pid_a"; status_a=$?
  wait "$pid_b"; status_b=$?
  set -e
  pid_a=""; pid_b=""
  if [ "$status_a" = 0 ] && [ "$status_b" != 0 ]; then loser="$DIR/b.log"
  elif [ "$status_b" = 0 ] && [ "$status_a" != 0 ]; then loser="$DIR/a.log"
  else echo "Expected exactly one successful owner mutation."; cat "$DIR/a.log" "$DIR/b.log"; exit 1; fi
  grep -q '42501' "$loser" # The losing caller fails live authorization, not a syntax/timeout error.
  count="$(psql "$DB_URL" -qAtc "select count(distinct m.id) from finance.organization_members m
    join finance.member_roles mr on mr.organization_id=m.organization_id and mr.member_id=m.id
    join finance.roles r on r.organization_id=mr.organization_id and r.id=mr.role_id
    where m.organization_id='$ORG' and m.status='active' and r.is_system and r.template_key='owner';")"
  test "$count" = 1
  echo "US-009 $mode PASS: two observed advisory-lock waiters, one success, one 42501, one active Owner."
done
