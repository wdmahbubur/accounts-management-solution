begin;
create extension if not exists pgtap with schema extensions;

insert into finance.organizations(id,name,slug,legal_name,books_start_date,fiscal_year_start_month,status)
values ('d1111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa','US020 outbox test','us020-outbox-test','US020 outbox test','2026-01-01',1,'active');
insert into finance.outbox_events(organization_id,event_type,deduplication_key,payload)
values ('d1111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa','invitation.send','us020-cancel-test',
  jsonb_build_object('invitation_id','d2222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'delivery',jsonb_build_object('version',1,'iv','aaaaaaaaaaaaaaaa','tag','bbbbbbbbbbbbbbbbbbbbbb','ciphertext','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccc')));

select plan(7);

select throws_ok($$update finance.outbox_events set payload=payload||'{"changed":true}'::jsonb
  where organization_id='d1111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and deduplication_key='us020-cancel-test'$$,
  '23514','outbox event identity and payload are immutable','Ordinary payload replacement is rejected');

select lives_ok($$select finance_private.cancel_invitation_delivery('d2222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$,
  'Invitation cancellation may retire its encrypted delivery envelope');

select is((select status from finance.outbox_events where deduplication_key='us020-cancel-test'),'failed',
  'Pending invitation delivery becomes failed when superseded');
select is((select last_error_code from finance.outbox_events where deduplication_key='us020-cancel-test'),'INVITATION_SUPERSEDED',
  'Superseded invitation records a bounded cancellation code');
select is((select payload ? 'delivery' from finance.outbox_events where deduplication_key='us020-cancel-test'),false,
  'Cancellation removes only the encrypted delivery envelope');
select is((select payload->>'invitation_id' from finance.outbox_events where deduplication_key='us020-cancel-test'),
  'd2222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Cancellation preserves event identity data');

select throws_ok($$update finance.outbox_events set payload=payload||'{"delivery":{"version":1}}'::jsonb
  where organization_id='d1111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and deduplication_key='us020-cancel-test'$$,
  '23514','outbox event identity and payload are immutable','A scrubbed invitation envelope cannot be restored');
select * from finish();
rollback;