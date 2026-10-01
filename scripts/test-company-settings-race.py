#!/usr/bin/env python3
"""Independent PostgreSQL sessions; uses only the fixed local CI stack."""
import os
import pathlib
import subprocess
import tempfile
import time

DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
ROOT = pathlib.Path(__file__).resolve().parents[1]
USER = "12009999-1111-4111-8111-111111111111"
PROCS = []
TEMP = tempfile.TemporaryDirectory()

def sql(statement):
    return subprocess.check_output(["psql", DB, "-v", "ON_ERROR_STOP=1", "-qAtc", statement], text=True, cwd=ROOT).strip()

def start(name, statement, hold=False):
    log = pathlib.Path(TEMP.name) / (name + ".log")
    stream = log.open("w")
    proc = subprocess.Popen(["psql", DB, "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-qAt"],
        stdin=subprocess.PIPE, stdout=stream, stderr=subprocess.STDOUT, text=True,
        env={**os.environ, "PGAPPNAME": name}, cwd=ROOT)
    stream.close(); PROCS.append(proc)
    proc.stdin.write(statement + "\n"); proc.stdin.flush()
    if not hold:
        proc.stdin.close()
    return proc, log

def wait_until(condition, message):
    until = time.monotonic() + 15
    while time.monotonic() < until:
        if condition():
            return
        time.sleep(.1)
    raise AssertionError(message)

def release(proc):
    proc.stdin.write("commit;\n\\q\n"); proc.stdin.flush(); proc.stdin.close()
    assert proc.wait(timeout=20) == 0

def blocked(names):
    values = ",".join("'" + n + "'" for n in names)
    return sql(f"select count(distinct pid) from pg_stat_activity where application_name in ({values}) and wait_event_type='Lock';") == str(len(names))

def setup(index):
    org = f"12009999-aaaa-4aaa-8aaa-{index:012d}"
    member = f"12009999-bbbb-4bbb-8bbb-{index:012d}"
    role = f"12009999-cccc-4ccc-8ccc-{index:012d}"
    sql(f"""insert into finance.organizations(id,name,slug,legal_name,books_start_date,fiscal_year_start_month,status)
        values('{org}','Settings race {index}','us012-race-{index}','Settings race','2026-04-01',1,'onboarding');
        insert into finance.organization_members(id,organization_id,user_id,display_name_snapshot) values('{member}','{org}','{USER}','Race Owner');
        insert into finance.roles(id,organization_id,name,template_key,is_system) values('{role}','{org}','Owner','owner',true);
        insert into finance.member_roles(organization_id,member_id,role_id) values('{org}','{member}','{role}');""")
    return org, member

def change(org, version, changes, request):
    return f"set role authenticated; set request.jwt.claim.sub='{USER}'; select public.update_company_settings('{org}',{version},'{changes}','Approved concurrent setup','{request}');"

def activity(org, member):
    return f"insert into finance.business_documents(organization_id,document_type,issue_date,accounting_date,total_amount,created_by_member_id) values('{org}','invoice','2026-07-01','2026-07-01',123.45,'{member}');"

try:
    sql(f"insert into auth.users(id,email,email_confirmed_at,last_sign_in_at) values('{USER}','us012-race@example.invalid',now(),now());")
    org, member = setup(1)
    holder, holder_log = start("us012-cas-holder", f"begin; select pg_advisory_xact_lock(hashtextextended('{org}',9009)); select 'READY';", True)
    wait_until(lambda: "READY" in holder_log.read_text(), "CAS holder never became ready")
    a, alog = start("us012-cas-a", change(org, 1, '{"legal_name":"Writer A"}', "req_us012_a"))
    b, blog = start("us012-cas-b", change(org, 1, '{"legal_name":"Writer B"}', "req_us012_b"))
    wait_until(lambda: blocked(["us012-cas-a", "us012-cas-b"]), "Two independent CAS writers did not overlap")
    release(holder)
    outcomes = [a.wait(timeout=20), b.wait(timeout=20)]
    assert outcomes.count(0) == 1 and "P0409" in (alog.read_text() + blog.read_text()), outcomes
    assert sql(f"select settings_version from finance.organizations where id='{org}';") == "2"
    assert sql(f"select count(*) from finance.audit_events where organization_id='{org}' and action='company.settings_updated';") == "1"
    print("US012 CAS race PASS: two observed lock waiters; one save, one stale denial, one audit.")

    org, member = setup(2)
    first, firstlog = start("us012-activity-first", "begin; " + activity(org, member) + " select 'READY';", True)
    wait_until(lambda: "READY" in firstlog.read_text(), "First activity did not acquire foundation lock")
    later, laterlog = start("us012-settings-after", change(org, 1, '{"books_start_date":"2026-07-01"}', "req_us012_after"))
    wait_until(lambda: blocked(["us012-settings-after"]), "Settings did not wait for first activity")
    release(first)
    assert later.wait(timeout=20) != 0 and "P0409" in laterlog.read_text()
    assert sql(f"select books_start_date::text||'|'||settings_version from finance.organizations where id='{org}';") == "2026-04-01|2"
    retry, retrylog = start("us012-fresh-locked", change(org, 2, '{"books_start_date":"2026-07-01"}', "req_us012_locked"))
    assert retry.wait(timeout=20) != 0 and "P0412" in retrylog.read_text()
    print("US012 activity-first race PASS: stale settings rejected, refreshed foundational mutation remains locked.")

    org, member = setup(3)
    first, firstlog = start("us012-settings-first", "begin; " + change(org, 1, '{"books_start_date":"2026-07-01"}', "req_us012_before") + " select 'READY';", True)
    wait_until(lambda: "READY" in firstlog.read_text(), "Settings did not complete before fixture activity")
    later, laterlog = start("us012-activity-after", activity(org, member))
    wait_until(lambda: blocked(["us012-activity-after"]), "First activity did not wait for settings")
    release(first)
    assert later.wait(timeout=20) == 0, laterlog.read_text()
    assert sql(f"select books_start_date::text||'|'||settings_version||'|'||(foundation_locked_at is not null) from finance.organizations where id='{org}';") == "2026-07-01|3|true"
    assert sql(f"select total_amount::text||'|'||accounting_date::text from finance.business_documents where organization_id='{org}';") == "123.45|2026-07-01"
    assert sql(f"select starts_on from finance.accounting_periods where organization_id='{org}' and kind='opening';") == "2026-06-30"
    print("US012 settings-first race PASS: first activity follows committed calendar, freezes it and retains accounting facts.")
finally:
    for proc in PROCS:
        if proc.poll() is None:
            proc.kill(); proc.wait()
    TEMP.cleanup()
