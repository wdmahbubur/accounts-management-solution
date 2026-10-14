begin;
create extension if not exists pgtap with schema extensions;
\ir ../helpers/us005_two_company_fixture.psql

insert into finance.role_permissions(organization_id,role_id,permission_id)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',p.id
from finance.permissions p
where p.code in ('periods.lock','periods.reopen','audit.read');

insert into finance.accounting_periods(id,organization_id,label,kind,starts_on,ends_on)
values ('aaaaaaaa-5556-4555-8555-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'Opening 2025','opening','2025-12-31','2025-12-31');

select plan(35);

select ok(not has_function_privilege('authenticated','finance_private.lock_accounting_date(uuid,date,boolean)','EXECUTE'),
  'Financial date lock helper is not exposed to authenticated clients');
select ok(not has_function_privilege('authenticated','finance_private.require_period_action(uuid,text)','EXECUTE'),
  'Internal period authorization helper is not exposed to authenticated clients');
select ok(has_function_privilege('authenticated','public.lock_accounting_period(uuid,uuid,integer,text,text)','EXECUTE'),
  'Authenticated callers may use the guarded period lock command');
select ok(has_function_privilege('authenticated','public.reopen_accounting_period(uuid,uuid,integer,text,text)','EXECUTE'),
  'Authenticated callers may use the guarded period reopen command');

insert into auth.users(id,email,last_sign_in_at)
values ('11222222-2222-4222-8222-222222222222','us016-unprivileged@example.invalid',now());
insert into finance.organization_members(id,organization_id,user_id,display_name_snapshot)
values ('aaaaaaaa-1112-4111-8111-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '11222222-2222-4222-8222-222222222222','US016 Unprivileged');

select is(finance_private.lock_accounting_date(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-09-15'),
  'aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa'::uuid,
  'A valid in-book date resolves to its regular period');
select throws_ok($$select finance_private.lock_accounting_date('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2025-12-31')$$,
  '23514','accounting date precedes books start','A pre-books date cannot enter the regular ledger path');
select throws_ok($$select finance_private.lock_accounting_date('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-10-01')$$,
  '23514','accounting date has no fiscal period','A date outside the configured periods is rejected');
select throws_ok($$select finance_private.lock_accounting_date('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null)$$,
  '22023','accounting date required','A null accounting date is rejected');
select throws_ok($$select finance_private.lock_accounting_date('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2025-12-31',false)$$,
  '23514','accounting date precedes books start','Opening day is not accepted by default');
select is(finance_private.lock_accounting_date(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2025-12-31',true),
  'aaaaaaaa-5556-4555-8555-aaaaaaaaaaaa'::uuid,
  'Only the explicit opening-balance path can resolve books-start minus one');

set local role authenticated;
set local request.jwt.claim.sub='11222222-2222-4222-8222-222222222222';
select throws_ok($$select * from public.lock_accounting_period('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa',1,'req_period_no_capability','This reason is long enough')$$,
  '42501','permission denied','An active member without periods.lock cannot lock a period');
reset role;
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select throws_ok($$select * from public.lock_accounting_period('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa',1,'req_period_no_recent_auth','This reason is long enough')$$,
  '42501','recent authentication required','Lock requires recent authentication');
reset role;
update auth.users set last_sign_in_at=now()-interval '25 hours'
where id='11111111-1111-4111-8111-111111111111';
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select throws_ok($$select * from public.lock_accounting_period('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa',1,'req_period_old_auth','This reason is long enough')$$,
  '42501','recent authentication required','An expired authentication timestamp is rejected');
reset role;
update auth.users set last_sign_in_at=now()
where id='11111111-1111-4111-8111-111111111111';
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select throws_ok($$select * from public.lock_accounting_period('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa',1,'req_period_short_reason','short')$$,
  '22023','lock reason must be 10-1000 characters','A short lock reason is rejected');
select throws_ok($$select * from public.lock_accounting_period('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa',null,'req_period_null_version','This reason is long enough')$$,
  '40001','period is locked or version is stale','A null expected version is rejected');
select throws_ok($$select * from public.lock_accounting_period('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa',0,'req_period_zero_version','This reason is long enough')$$,
  '40001','period is locked or version is stale','A nonpositive expected version is rejected');
select lives_ok($$select * from public.lock_accounting_period('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa',1,'req_period_lock_ok','Month-end close reviewed')$$,
  'A caller with the capability and recent auth can lock a period');
select is((select row_version from finance.accounting_periods where id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa'),2,
  'Lock increments the optimistic row version');
select ok((select status='locked' and locked_by_member_id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
  and locked_at is not null from finance.accounting_periods where id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa'),
  'Lock records its state, actor and timestamp atomically');
reset role;
select ok((select checklist_snapshot->>'draft_documents'='0' and checklist_snapshot->>'posted_documents'='6'
  from finance.period_events where period_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa' and action='lock'),
  'Lock stores the current draft and posted document counts');
select ok((select reason='Month-end close reviewed' and actor_member_id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
  from finance.period_events where period_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa' and action='lock'),
  'Lock event preserves the trimmed reason and verified actor');
select is((select count(*)::integer from finance.audit_events where entity_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa'
  and action='period.lock' and request_id='req_period_lock_ok'),1,
  'Lock writes one correlated audit event');
select throws_ok($$select finance_private.lock_accounting_date('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-09-15')$$,
  '23514','accounting period is locked or unavailable','A locked period rejects the accounting-date helper');
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select throws_ok($$select * from public.lock_accounting_period('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa',1,'req_period_stale_lock','This reason is long enough')$$,
  '40001','period is locked or version is stale','A repeated lock with a stale version is rejected');
select throws_ok($$select * from public.reopen_accounting_period('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa',2,'req_period_short_reopen','short')$$,
  '22023','reopen reason must be 10-1000 characters','A short reopen reason is rejected');
reset role;
update auth.users set last_sign_in_at=now()-interval '25 hours'
where id='11111111-1111-4111-8111-111111111111';
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select throws_ok($$select * from public.reopen_accounting_period('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa',2,'req_period_old_reopen_auth','Correction approved today')$$,
  '42501','recent authentication required','Reopening also requires recent authentication');
reset role;
update auth.users set last_sign_in_at=now()
where id='11111111-1111-4111-8111-111111111111';
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select lives_ok($$select * from public.reopen_accounting_period('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa',2,'req_period_reopen_ok','Correction approved today')$$,
  'A caller with the reopen capability and recent auth can reopen a period');
select is((select row_version from finance.accounting_periods where id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa'),3,
  'Reopen increments the optimistic row version again');
select ok((select status='open' and locked_at is null and locked_by_member_id is null
  from finance.accounting_periods where id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa'),
  'Reopen clears live lock metadata');
reset role;
select is((select count(*)::integer from finance.period_events where period_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa'),2,
  'Reopen appends a second event and retains the original lock event');
select ok((select reopened.created_at>locked.created_at
  from finance.period_events locked cross join finance.period_events reopened
  where locked.period_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa' and locked.action='lock'
    and reopened.period_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa' and reopened.action='reopen'),
  'Reopen event timestamp remains after lock within one transaction');
select throws_ok($$update finance.period_events set reason='rewritten history' where period_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa'$$,
  '23514','period events are append-only','Period event history cannot be updated');
select throws_ok($$delete from finance.period_events where period_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa'$$,
  '23514','period events are append-only','Period event history cannot be deleted');
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select throws_ok($$select * from public.reopen_accounting_period('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa',2,'req_period_stale_reopen','This reason is long enough')$$,
  '40001','period is open or version is stale','A stale reopen is rejected after the event is appended');
select is((select last_action from public.list_accounting_periods('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  where id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa'),'reopen'::text,
  'The authorized period read returns the latest immutable action');
select * from finish();
rollback;
