#!/usr/bin/env bash
set -euo pipefail

DB_URL="${SUPABASE_LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
USER_ID="77999999-9999-4999-8999-999999999999"
KEY="us007_concurrent_key_0123456789"
LOG_A="$(mktemp)"
LOG_B="$(mktemp)"
trap 'rm -f "$LOG_A" "$LOG_B"' EXIT

psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
  insert into auth.users(id,email)
  values ('$USER_ID','us007-race@example.invalid')
  on conflict (id) do nothing;
"

call_sql="set role authenticated;
set request.jwt.claim.sub='$USER_ID';
select organization_id::text
from public.create_company_atomic(
  'US007 Race Company',
  'US007 Race Company Limited',
  'BD',
  'BDT',
  'Asia/Dhaka',
  1::smallint,
  '2026-04-01'::date,
  '$KEY'
);"

psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$call_sql" >"$LOG_A" &
pid_a=$!
psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$call_sql" >"$LOG_B" &
pid_b=$!

wait "$pid_a"
wait "$pid_b"

org_a="$(tail -n 1 "$LOG_A")"
org_b="$(tail -n 1 "$LOG_B")"

if [ -z "$org_a" ] || [ "$org_a" != "$org_b" ]; then
  echo "Concurrent onboarding did not converge on one organization."
  exit 1
fi

test "$(psql "$DB_URL" -Atqc "select count(*) from finance.organizations where name='US007 Race Company'")" = "1"
test "$(psql "$DB_URL" -Atqc "select count(*) from finance.accounts where organization_id='$org_a'")" = "29"
test "$(psql "$DB_URL" -Atqc "select count(*) from finance.roles where organization_id='$org_a'")" = "6"
test "$(psql "$DB_URL" -Atqc "select count(*) from finance_private.onboarding_requests where user_id='$USER_ID' and idempotency_key='$KEY'")" = "1"

echo "US-007 concurrent onboarding replay PASS (organization=$org_a)"
