begin;

create extension if not exists pgtap with schema extensions;
\ir ../helpers/us005_two_company_fixture.psql

select plan(29);

select has_function(
  'public', 'create_tax_code_version',
  array['uuid','text','text','text','text','finance.rate','text','uuid','uuid','text','date','date','integer'],
  'effective-dated tax-version command exists'
);

insert into finance.permissions(code,description)
values ('tax.read','Read tax configuration'),('tax.manage','Manage tax configuration')
on conflict(code) do nothing;
insert into finance.role_permissions(organization_id,role_id,permission_id)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',p.id
from finance.permissions p where p.code in ('tax.read','tax.manage')
on conflict do nothing;
update auth.users set last_sign_in_at=now()
where id='11111111-1111-4111-8111-111111111111';
insert into finance.accounts(id,organization_id,code,name,account_type,normal_side,report_group)
values
  ('aaaaaaaa-0000-4000-8000-000000001007','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','L210','Output tax','liability','credit','tax'),
  ('aaaaaaaa-0000-4000-8000-000000001008','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','A120','Input tax','asset','debit','tax');

set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';

select is(
  (select count(*)::bigint from public.list_tax_codes('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')),
  0::bigint,
  'company tax catalog starts without a hardcoded statutory rate'
);

select is(
  (select version_no from public.create_tax_code_version(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','req_tax_v1','Company-approved test configuration',
    'TAX10','Illustrative ten percent',10,'standard',
    'aaaaaaaa-0000-4000-8000-000000001007','aaaaaaaa-0000-4000-8000-000000001008',
    'full','2026-01-01',null,0
  )),
  1,
  'first company-defined version is created'
);

select throws_ok(
  $$select * from public.create_tax_code_version(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','req_tax_stale','Stale expected version',
    'TAX10','Stale ten percent',9,'standard',
    'aaaaaaaa-0000-4000-8000-000000001007','aaaaaaaa-0000-4000-8000-000000001008',
    'full','2026-04-01',null,0
  )$$,
  '40001',null,'stale latest-version token is rejected'
);

select is(
  (select version_no from public.create_tax_code_version(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','req_tax_v2','Company-approved future version',
    'TAX10','Illustrative eight percent',8,'standard',
    'aaaaaaaa-0000-4000-8000-000000001007','aaaaaaaa-0000-4000-8000-000000001008',
    'full','2026-04-01',null,1
  )),
  2,
  'a later effective date creates the next immutable version'
);

select is(
  (select effective_to from public.list_tax_codes('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
   where code='TAX10' and version_no=1),
  '2026-03-31'::date,
  'new version closes the prior effective range without overlap'
);

select is(
  (select version_no from public.create_tax_code_version(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','req_tax_v3','Approved historical correction',
    'TAX10','Illustrative twelve percent',12,'standard',
    'aaaaaaaa-0000-4000-8000-000000001007','aaaaaaaa-0000-4000-8000-000000001008',
    'full','2026-02-15',null,1
  )),
  3,
  'backdated version is appended with a new sequence number'
);

select is(
  (select effective_to from public.list_tax_codes('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
   where code='TAX10' and version_no=1),
  '2026-02-14'::date,
  'backdated version shortens the prior range safely'
);

select throws_ok(
  $$select public.archive_tax_code_version(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select id from public.list_tax_codes('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') where code='TAX10' and version_no=3),
    0,'req_tax_archive_stale','Stale archive attempt'
  )$$,
  '40001',null,'archive command rejects a stale row version'
);

select throws_ok(
  $$select * from public.list_tax_codes('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$$,
  '42501','permission denied','tax catalog cannot be read through another tenant id'
);

select throws_ok(
  $$select * from public.create_tax_code_version(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','req_tax_other','Cross-tenant attempt',
    'OTHER','Other tenant',10,'standard',null,null,'none','2026-01-01',null,0
  )$$,
  '42501','permission denied','tax version cannot be written through another tenant id'
);

select throws_ok(
  $$update finance.tax_codes set label='Forged' where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  '42501',null,'ordinary caller has no direct tax-table update grant'
);

select is(
  (select version_no from public.create_tax_code_version(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','req_tax_nr','Company-approved nonrecoverable test',
    'TAXNR','Illustrative nonrecoverable ten percent',10,'standard',
    'aaaaaaaa-0000-4000-8000-000000001007',null,'none','2026-01-01',null,0
  )),
  1,
  'nonrecoverable purchase treatment needs no input-tax account'
);

reset role;

insert into finance.business_documents(id,organization_id,document_type,state,issue_date,accounting_date,created_by_member_id)
values
 ('aaaaaaaa-6101-4601-8601-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','invoice','draft','2026-02-01','2026-02-01','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'),
 ('aaaaaaaa-6102-4602-8602-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bill','draft','2026-02-01','2026-02-01','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'),
 ('aaaaaaaa-6103-4603-8603-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bill','draft','2026-02-01','2026-02-01','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'),
 ('aaaaaaaa-6104-4604-8604-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bill','draft','2026-02-20','2026-02-20','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');

insert into finance.document_lines(
  id,organization_id,document_id,line_no,description,quantity,unit_price,account_id,tax_code_id,tax_mode,net_amount,tax_amount,gross_amount
)
values
 ('aaaaaaaa-6201-4601-8601-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-6101-4601-8601-aaaaaaaaaaaa',1,'Taxed invoice',1,10000,'aaaaaaaa-0000-4000-8000-000000001004',(select id from finance.tax_codes where code='TAX10' and version_no=1),'exclusive',0,0,0),
 ('aaaaaaaa-6202-4602-8602-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-6102-4602-8602-aaaaaaaaaaaa',1,'Recoverable inclusive bill',1,11000,'aaaaaaaa-0000-4000-8000-000000001005',(select id from finance.tax_codes where code='TAX10' and version_no=1),'inclusive',0,0,0),
 ('aaaaaaaa-6203-4603-8603-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-6103-4603-8603-aaaaaaaaaaaa',1,'Nonrecoverable inclusive bill',1,1100,'aaaaaaaa-0000-4000-8000-000000001005',(select id from finance.tax_codes where code='TAXNR' and version_no=1),'inclusive',0,0,0),
 ('aaaaaaaa-6204-4604-8604-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-6104-4604-8604-aaaaaaaaaaaa',1,'Backdated-version bill',1,1120,'aaaaaaaa-0000-4000-8000-000000001005',(select id from finance.tax_codes where code='TAX10' and version_no=3),'inclusive',0,0,0);

select is((select net_amount::numeric from finance.document_lines where id='aaaaaaaa-6201-4601-8601-aaaaaaaaaaaa'),10000::numeric,'exclusive invoice net is recomputed from the entered amount');
select is((select tax_amount::numeric from finance.document_lines where id='aaaaaaaa-6201-4601-8601-aaaaaaaaaaaa'),1000::numeric,'exclusive invoice tax is recomputed using the selected version');
select is((select gross_amount::numeric from finance.document_lines where id='aaaaaaaa-6201-4601-8601-aaaaaaaaaaaa'),11000::numeric,'exclusive invoice gross is the exact net plus tax');
select is((select tax_recoverability_snapshot from finance.document_lines where id='aaaaaaaa-6201-4601-8601-aaaaaaaaaaaa'),'none','sales tax line snapshots nonrecoverable treatment');
select is((select tax_account_id from finance.document_lines where id='aaaaaaaa-6201-4601-8601-aaaaaaaaaaaa'),'aaaaaaaa-0000-4000-8000-000000001007'::uuid,'invoice line snapshots its output-tax account');
select is((select net_amount::numeric from finance.document_lines where id='aaaaaaaa-6202-4602-8602-aaaaaaaaaaaa'),10000::numeric,'T-17 inclusive bill net is recomputed to 10000');
select is((select tax_amount::numeric from finance.document_lines where id='aaaaaaaa-6202-4602-8602-aaaaaaaaaaaa'),1000::numeric,'T-17 inclusive bill tax is recomputed to 1000');
select is((select tax_recoverability_snapshot from finance.document_lines where id='aaaaaaaa-6202-4602-8602-aaaaaaaaaaaa'),'full','recoverable purchase tax is snapshotted');
select is((select tax_account_id from finance.document_lines where id='aaaaaaaa-6202-4602-8602-aaaaaaaaaaaa'),'aaaaaaaa-0000-4000-8000-000000001008'::uuid,'recoverable bill snapshots the input-tax account');
select is((select total_amount::numeric from finance.business_documents where id='aaaaaaaa-6102-4602-8602-aaaaaaaaaaaa'),11000::numeric,'line insert recomputes the draft document gross total');
select is((select tax_recoverability_snapshot from finance.document_lines where id='aaaaaaaa-6203-4603-8603-aaaaaaaaaaaa'),'none','nonrecoverable purchase tax is snapshotted');
select is((select tax_account_id from finance.document_lines where id='aaaaaaaa-6203-4603-8603-aaaaaaaaaaaa'),null::uuid,'nonrecoverable purchase tax has no input-tax asset account');
select is((select tax_rate_snapshot::numeric from finance.document_lines where id='aaaaaaaa-6201-4601-8601-aaaaaaaaaaaa'),10::numeric,'older draft line retains the rate from its selected historical version');
select is((select tax_rate_snapshot::numeric from finance.document_lines where id='aaaaaaaa-6204-4604-8604-aaaaaaaaaaaa'),12::numeric,'a later draft date resolves to the backdated effective version');
select is((select tax_amount::numeric from finance.document_lines where id='aaaaaaaa-6204-4604-8604-aaaaaaaaaaaa'),120::numeric,'backdated inclusive version computes exact tax from gross');

select throws_ok(
  $$update finance.tax_codes set label='Mutated historical version' where code='TAX10' and version_no=1$$,
  '23514','tax versions are immutable; create a new effective-dated version','historical tax terms cannot be overwritten'
);

select * from finish();
rollback;
