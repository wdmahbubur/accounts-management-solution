#!/usr/bin/env bash
set -euo pipefail
DB_URL="${SUPABASE_LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
node -e 'if (!["localhost","127.0.0.1","[::1]"].includes(new URL(process.argv[1]).hostname)) throw Error("Invitation races require a loopback test database");' "$DB_URL"
ORG='10109999-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
OWNER='10109999-1111-4111-8111-111111111111'
RECIPIENT='10109999-2222-4222-8222-222222222222'
MEMBER='10109999-3333-4333-8333-333333333333'
ROLE='10109999-4444-4444-8444-444444444444'
INVITE='10109999-5555-4555-8555-555555555555'
# Fixed data is confined to the isolated fixture; real tokens are crypto-random.
psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
insert into auth.users(id,email,email_confirmed_at,last_sign_in_at) values
('$OWNER','us010-race-owner@example.invalid',now(),now()),
('$RECIPIENT','us010-race-recipient@example.invalid',now(),now());
insert into finance.organizations(id,name,slug,legal_name,books_start_date,fiscal_year_start_month,status)
values ('$ORG','US010 Race','us010-race','US010 Race','2026-01-01',1,'active');
insert into finance.organization_members(id,organization_id,user_id,display_name_snapshot)
values ('$MEMBER','$ORG','$OWNER','US010 Race Owner');
insert into finance.roles(id,organization_id,name,template_key,is_system)
values ('$ROLE','$ORG','Owner','owner',true);
insert into finance.member_roles(organization_id,member_id,role_id) values('$ORG','$MEMBER','$ROLE');
set role authenticated; set request.jwt.claim.sub='$OWNER';
select public.issue_company_invitation('$ORG','$INVITE','us010-race-recipient@example.invalid','$ROLE',
encode(sha256(convert_to(repeat('r',43),'UTF8')),'hex'),
jsonb_build_object('version',1,'iv',repeat('a',16),'tag',repeat('b',22),'ciphertext',repeat('c',58)),'req_race_issue');
SQL
DIR="$(mktemp -d)"; blocker=''; pid_a=''; pid_b=''
cleanup() { for pid in "$blocker" "$pid_a" "$pid_b"; do if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; fi; done; rm -rf "$DIR"; }
trap cleanup EXIT
mkfifo "$DIR/gate"; exec 9<>"$DIR/gate"
PGAPPNAME=us010-invite-blocker psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt <"$DIR/gate" >"$DIR/gate.log" 2>&1 & blocker=$!
printf "begin; select pg_advisory_xact_lock(hashtextextended('%s',9009)); select 'LOCK_READY';\n" "$ORG" >&9
ready=false
for _ in $(seq 1 100); do if grep -q LOCK_READY "$DIR/gate.log"; then ready=true; break; fi; sleep 0.1; done
if [ "$ready" != true ]; then cat "$DIR/gate.log"; exit 1; fi
for name in a b; do
  PGAPPNAME="us010-invite-race-$name" psql "$DB_URL" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -qAtc \
    "set role authenticated; set request.jwt.claim.sub='$RECIPIENT'; select * from public.respond_company_invitation(repeat('r',43),'accept','req_race_$name');" >"$DIR/$name.log" 2>&1 &
  if [ "$name" = a ]; then pid_a=$!; else pid_b=$!; fi
done
waiting=0
for _ in $(seq 1 100); do
  waiting="$(psql "$DB_URL" -qAtc "select count(distinct pid) from pg_stat_activity where application_name in ('us010-invite-race-a','us010-invite-race-b') and wait_event_type='Lock' and wait_event='advisory';")"
  if [ "$waiting" = 2 ]; then break; fi; sleep 0.1
done
if [ "$waiting" != 2 ]; then echo 'Invitation acceptance did not overlap on independent sessions'; cat "$DIR/a.log" "$DIR/b.log"; exit 1; fi
printf 'commit;\n\\q\n' >&9
wait "$blocker"; blocker=''; exec 9>&-
set +e
wait "$pid_a"; a=$?; wait "$pid_b"; b=$?
set -e
pid_a=''; pid_b=''
if [ "$a" = 0 ] && [ "$b" != 0 ]; then loser="$DIR/b.log"
elif [ "$b" = 0 ] && [ "$a" != 0 ]; then loser="$DIR/a.log"
else echo 'Expected exactly one successful invitation acceptance'; cat "$DIR/a.log" "$DIR/b.log"; exit 1; fi
grep -q P0002 "$loser"
counts="$(psql "$DB_URL" -qAtc "select
  (select count(*) from finance.organization_members where organization_id='$ORG' and user_id='$RECIPIENT'),
  (select count(*) from finance.member_roles mr join finance.organization_members m on m.organization_id=mr.organization_id and m.id=mr.member_id where m.organization_id='$ORG' and m.user_id='$RECIPIENT'),
  (select count(*) from finance.audit_events where entity_id='$INVITE' and action='invitations.accepted'),
  (select count(*) from finance.invitations where id='$INVITE' and status='accepted');")"
test "$counts" = '1|1|1|1'
echo 'US-010 acceptance race PASS: two observed lock waiters, one success, one consumed-token denial, one membership, one role, one audit.'
