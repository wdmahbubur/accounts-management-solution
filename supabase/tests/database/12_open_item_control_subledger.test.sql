begin;
create extension if not exists pgtap with schema extensions;

insert into auth.users(id,email,email_confirmed_at,last_sign_in_at)
values ('19111111-1111-4111-8111-111111111111','us022@example.invalid',now(),now());
insert into finance.organizations(id,name,slug,legal_name,books_start_date,fiscal_year_start_month,status)
values
 ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','US022 Company A','us022-company-a','US022 Company A','2026-01-01',1,'active'),
 ('dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','US022 Company B','us022-company-b','US022 Company B','2026-01-01',1,'active');
insert into finance.organization_members(id,organization_id,user_id,display_name_snapshot)
values
 ('c1111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','19111111-1111-4111-8111-111111111111','US022 accountant A'),
 ('d1111111-bbbb-4bbb-8bbb-bbbbbbbbbbbb','dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','19111111-1111-4111-8111-111111111111','US022 accountant B');
insert into finance.permissions(code,description)
values ('dues.read','Read open items') on conflict (code) do nothing;
insert into finance.roles(id,organization_id,name)
values
 ('c2222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','US022 dues reader'),
 ('d2222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb','dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','US022 limited reader');
insert into finance.role_permissions(organization_id,role_id,permission_id)
select 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c2222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa',p.id
from finance.permissions p where p.code='dues.read';
insert into finance.member_roles(organization_id,member_id,role_id)
values
 ('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c2222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','d1111111-bbbb-4bbb-8bbb-bbbbbbbbbbbb','d2222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into finance.contacts(id,organization_id,display_name,is_customer,is_vendor)
values ('c3333333-aaaa-4aaa-8aaa-aaaaaaaaaaaa','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','US022 customer',true,false);
insert into finance.fiscal_years(id,organization_id,label,starts_on,ends_on)
values ('c4444444-aaaa-4aaa-8aaa-aaaaaaaaaaaa','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','FY2026','2026-01-01','2026-12-31');
insert into finance.accounting_periods(id,organization_id,fiscal_year_id,label,starts_on,ends_on)
values ('c5555555-aaaa-4aaa-8aaa-aaaaaaaaaaaa','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c4444444-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-09','2026-09-01','2026-09-30');
insert into finance.accounts(id,organization_id,code,name,account_type,normal_side,report_group,control_kind)
values
 ('c6666666-aaaa-4aaa-8aaa-aaaaaaaaaaaa','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','1100','Trade receivables','asset','debit','receivables','ar'),
 ('c7777777-aaaa-4aaa-8aaa-aaaaaaaaaaaa','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','1000','Bank','asset','debit','cash',null),
 ('c8888888-aaaa-4aaa-8aaa-aaaaaaaaaaaa','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','4000','Service revenue','income','credit','revenue',null),
 ('d6666666-bbbb-4bbb-8bbb-bbbbbbbbbbbb','dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','B100','Company B bank','asset','debit','cash',null);
insert into finance.business_documents
  (id,organization_id,document_type,state,document_number,fiscal_year_id,party_id,issue_date,accounting_date,due_date,
   net_amount,total_amount,created_by_member_id,posted_by_member_id,posted_at)
values
 ('c9999999-aaaa-4aaa-8aaa-aaaaaaaaaaaa','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','invoice','posted','INV-US022-1','c4444444-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c3333333-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-09-30','2026-09-30','2026-10-30',10000,10000,'c1111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-09-30T12:00:00Z'),
 ('caaaaaaa-bbbb-4bbb-8bbb-bbbbbbbbbbbb','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','receipt','posted','RCT-US022-1','c4444444-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c3333333-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-09-30','2026-09-30',null,6000,6000,'c1111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-09-30T12:01:00Z');
insert into finance.journal_entries(id,organization_id,source_document_id,period_id,accounting_date,state,posted_by_member_id)
values
 ('cbbbbbbb-aaaa-4aaa-8aaa-aaaaaaaaaaaa','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c9999999-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c5555555-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-09-30','building','c1111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','caaaaaaa-bbbb-4bbb-8bbb-bbbbbbbbbbbb','c5555555-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-09-30','building','c1111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into finance.journal_lines(id,organization_id,journal_entry_id,line_no,account_id,party_id,debit,credit,description)
values
 ('cddddddd-aaaa-4aaa-8aaa-aaaaaaaaaaaa','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cbbbbbbb-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,'c6666666-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c3333333-aaaa-4aaa-8aaa-aaaaaaaaaaaa',10000,0,'Invoice AR'),
 ('cddddddd-aaab-4aaa-8aaa-aaaaaaaaaaaa','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cbbbbbbb-aaaa-4aaa-8aaa-aaaaaaaaaaaa',2,'c8888888-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,0,10000,'Invoice revenue'),
 ('cddddddd-bbbb-4bbb-8bbb-bbbbbbbbbbbb','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,'c7777777-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,6000,0,'Receipt bank'),
 ('cddddddd-bbbc-4bbb-8bbb-bbbbbbbbbbbb','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',2,'c6666666-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c3333333-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0,6000,'Receipt AR');

select plan(22);

select ok(not has_function_privilege('authenticated','finance_private.create_open_item_for_control_line(uuid,uuid,text,date)','EXECUTE'),
  'Open-item builder is private to database routines');
select ok(has_function_privilege('authenticated','public.list_open_items(uuid,date,timestamptz,uuid,text,integer)','EXECUTE'),
  'Authenticated callers may use the capability-checked open-item read');
select set_config('test.us022_invoice_item',finance_private.create_open_item_for_control_line(
  'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cddddddd-aaaa-4aaa-8aaa-aaaaaaaaaaaa')::text,true);
select set_config('test.us022_receipt_item',finance_private.create_open_item_for_control_line(
  'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cddddddd-bbbc-4bbb-8bbb-bbbbbbbbbbbb','Receipt allocation')::text,true);
select is((select count(*)::integer from finance.open_items where journal_line_id='cddddddd-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),1,
  'A control journal line creates exactly one open item');
select is((select (account_id='c6666666-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and party_id='c3333333-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and control_kind='ar' and side='debit' and original_amount=10000 and issue_date='2026-09-30' and reference='INV-US022-1'
  and due_date='2026-10-30') from finance.open_items where id=current_setting('test.us022_invoice_item')::uuid),true,
  'Invoice item inherits account, party, amount, direction, source date, number and due date');
select is((select side from finance.open_items where id=current_setting('test.us022_receipt_item')::uuid),'credit'::text,
  'A customer receipt creates a credit-side control item');
select is((select original_amount from finance.open_items where id=current_setting('test.us022_receipt_item')::uuid),6000::finance.amount,
  'Receipt control item retains its exact original amount');
select throws_ok($$select finance_private.create_open_item_for_control_line('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cddddddd-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bad due','2026-09-29')$$,
  '22023','open-item reference or due date is invalid','A due date before the accounting date is rejected');
select throws_ok($$select finance_private.create_open_item_for_control_line('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cddddddd-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$$,
  '23514','journal line is not an active postable control account','A non-control journal line cannot create an open item');
select throws_ok($$insert into finance.open_items(organization_id,journal_line_id,account_id,party_id,control_kind,side,original_amount,reference,issue_date)
  values('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cddddddd-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c6666666-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'c3333333-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ar','debit',9999,'incorrect amount','2026-09-30')$$,
  '23514','open item does not agree with its source control line','A mismatched direct open-item insert is rejected');
select throws_ok($$insert into finance.journal_lines(organization_id,journal_entry_id,line_no,account_id,debit,credit)
  values('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cbbbbbbb-aaaa-4aaa-8aaa-aaaaaaaaaaaa',99,'d6666666-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,0)$$,
  '23503',null,'A company B account cannot be injected into a company A journal');
update finance.journal_entries set state='posted',posted_at='2026-09-30T12:00:01Z'
where organization_id='caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select lives_ok($set constraints all immediate$,
  'Deferred control-line validation accepts one matching item per posted control line');
select throws_ok($$update finance.open_items set reference='rewritten source' where id=current_setting('test.us022_invoice_item')::uuid$$,
  '23514','posted open items are immutable','Open-item source facts cannot be updated');
select throws_ok($$delete from finance.open_items where id=current_setting('test.us022_invoice_item')::uuid$$,
  '23514','posted open items are immutable','Open-item source facts cannot be deleted');
select is(finance_private.open_item_balance_at('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',current_setting('test.us022_invoice_item')::uuid,'2026-09-29',clock_timestamp()),0::finance.amount,
  'An item is not available before its issue date');
select is(finance_private.open_item_balance_at('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',current_setting('test.us022_invoice_item')::uuid,'2026-09-30',clock_timestamp()),10000::finance.amount,
  'Unallocated balance begins at the source issue date');
insert into finance.settlement_allocations(id,organization_id,debit_open_item_id,credit_open_item_id,amount,effective_date,created_by_member_id,created_at)
values ('c1111111-aaaa-4aaa-8aaa-000000000001','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  current_setting('test.us022_invoice_item')::uuid,current_setting('test.us022_receipt_item')::uuid,6000,'2026-10-01',
  'c1111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',clock_timestamp());
select is(finance_private.open_item_balance_at('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',current_setting('test.us022_invoice_item')::uuid,'2026-10-01',clock_timestamp()),4000::finance.amount,
  'Historical available balance reflects an effective allocation');
insert into finance.allocation_reversals(id,organization_id,allocation_id,effective_date,reason,created_by_member_id,created_at)
values ('c1111111-aaaa-4aaa-8aaa-000000000002','caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'c1111111-aaaa-4aaa-8aaa-000000000001','2026-10-02','Approved allocation reversal','c1111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',clock_timestamp());
select is(finance_private.open_item_balance_at('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',current_setting('test.us022_invoice_item')::uuid,'2026-10-02',clock_timestamp()),10000::finance.amount,
  'A dated reversal restores the available balance without changing the original item');
select is(finance_private.open_item_balance_at('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',current_setting('test.us022_invoice_item')::uuid,'2026-10-01',now()),10000::finance.amount,
  'A transaction-time cutoff excludes the later-created allocation');
select is(finance_private.open_item_balance_at('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',current_setting('test.us022_invoice_item')::uuid,'2026-10-02',now()-interval '1 microsecond'),0::finance.amount,
  'A cutoff before item creation returns no available balance');
set local role authenticated;
set local request.jwt.claim.sub='19111111-1111-4111-8111-111111111111';
select is((select count(*)::integer from public.list_open_items('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-10-02',clock_timestamp())),2,
  'dues.read returns the two scoped source items');
select is((select sum(available_amount)::finance.amount from public.list_open_items('caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-10-02',clock_timestamp())),16000::finance.amount,
  'Open-item read exposes current available amounts after reversal');
select throws_ok($$select * from public.list_open_items('dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','2026-10-02',clock_timestamp())$$,
  '42501','permission denied','A dual-company identity without dues.read in company B cannot read its open items');
select * from finish();
rollback;
