begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
\ir ../helpers/us005_two_company_fixture.psql
insert into auth.users(id,email,email_confirmed_at,last_sign_in_at) values
 ('11000000-1111-4111-8111-111111111111','us011-billing@example.invalid',now(),now()),
 ('11000000-2222-4222-8222-222222222222','us011-auditor@example.invalid',now(),now());
insert into finance.organization_members(id,organization_id,user_id,display_name_snapshot) values
 ('11000000-aaaa-4aaa-8aaa-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11000000-1111-4111-8111-111111111111','Billing'),
 ('11000000-aaaa-4aaa-8aaa-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11000000-2222-4222-8222-222222222222','Auditor');
insert into finance.roles(id,organization_id,name,template_key,is_system) values
 ('11000000-bbbb-4bbb-8bbb-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Billing','billing',true),
 ('11000000-bbbb-4bbb-8bbb-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Auditor','auditor',true);
insert into finance.member_roles(organization_id,member_id,role_id) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11000000-aaaa-4aaa-8aaa-000000000001','11000000-bbbb-4bbb-8bbb-000000000001'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11000000-aaaa-4aaa-8aaa-000000000002','11000000-bbbb-4bbb-8bbb-000000000002');
insert into finance.business_documents(id,organization_id,document_type,issue_date,accounting_date,created_by_member_id) values
 ('11000000-cccc-4ccc-8ccc-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','invoice','2026-09-30','2026-09-30','bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb');
insert into finance.attachments(id,organization_id,object_key,original_filename,content_type,byte_size,sha256,scan_status,uploaded_by_member_id) values
 ('11000000-dddd-4ddd-8ddd-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/attachments/11000000-dddd-4ddd-8ddd-000000000001','Vendor-sensitive-name.txt','text/plain',10,repeat('a',64),'clean','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');
insert into finance.attachment_links(organization_id,attachment_id,document_id,linked_by_member_id) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11000000-dddd-4ddd-8ddd-000000000001','aaaaaaaa-6002-4602-8602-aaaaaaaaaaaa','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');
insert into finance.report_snapshots(organization_id,period_id,report_type,parameters,ledger_cutoff_at,template_version,result_sha256,object_key,created_by_member_id) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa','profit_loss','{}',now(),'test',repeat('b',64),'synthetic/private/report','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');
insert into finance.export_jobs(organization_id,requested_by_member_id,export_type,parameters,ledger_cutoff_at,format) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','trial_balance','{}',now(),'csv'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11000000-aaaa-4aaa-8aaa-000000000002','trial_balance','{}',now(),'csv');

-- Catalog checks execute for every protected relation, not a handpicked subset.
select ok(c.relrowsecurity,'RLS enabled: '||c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='finance' and c.relkind in ('r','p') order by c.relname;
select ok(not has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
 'No ordinary raw write: '||c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='finance' and c.relkind in ('r','p','v') order by c.relname;
select ok(not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),
 'No anonymous table/view access: '||c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='finance' and c.relkind in ('r','p','v') order by c.relname;
select ok(not has_table_privilege('ams_job_worker',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),
 'Unscoped worker default deny: '||c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='finance' and c.relkind in ('r','p','v') order by c.relname;
select ok(coalesce(c.reloptions,'{}') @> array['security_invoker=true'], 'Invoker security view: '||c.relname)
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='finance' and c.relkind='v';
select ok(not has_function_privilege('anon',p.oid,'EXECUTE'),'No anonymous routine access: '||p.oid::regprocedure::text)
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','finance_private')
 and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e');
select ok(coalesce(array_to_string(p.proconfig,','),'') in ('search_path=""','search_path='),'Empty privileged search_path: '||p.oid::regprocedure::text)
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','finance_private') and p.prosecdef
 and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e');
select ok(not has_schema_privilege('authenticated',n,'CREATE'),'Cannot inject objects into '||n) from unnest(array['public','finance','finance_private']) n;
select ok(not rolcanlogin and not rolinherit and not rolbypassrls and not rolsuper,'Worker has no login, inheritance or RLS bypass') from pg_roles where rolname='ams_job_worker';

set local role authenticated; set local request.jwt.claim.sub='11000000-1111-4111-8111-111111111111';
select is((select count(*)::integer from public.read_document_directory('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')),2,'Billing has positive invoice/receipt directory access');
select is((select count(*)::integer from finance.document_directory where document_type='bill'),0,'Invoker view cannot disclose AP');
select is((select count(*)::integer from public.read_document_directory('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')),0,'Guessed foreign company has no directory data');
select is((select count(*)::integer from finance.accounts),0,'Billing cannot read private account records');
select is((select count(*)::integer from finance.journal_lines),0,'Billing cannot read broad ledger amounts');
select is((select count(*)::integer from finance.report_snapshots),0,'P&L cache metadata cannot bypass reports permission');
select is((select count(*)::integer from finance.attachments),0,'Sales access alone does not disclose evidence names');
select is((select count(*)::integer from finance.export_jobs),0,'Billing cannot read export metadata');
select throws_ok($$select * from public.read_document_directory('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',101)$$,'22023',NULL,'Directory limit is bounded');
select throws_ok($$select finance_private.require_capability('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','users.manage')$$,'42501',NULL,'Private actor lookup is not callable directly');
select throws_ok($$update finance.member_roles set role_id='11000000-bbbb-4bbb-8bbb-000000000002'$$,'42501',NULL,'Direct role escalation has no DML grant');
reset role;
-- Grant attachments.read only, creating an explicit positive control before the
-- mixed-document denial. No system-template mutation is used.
insert into finance.roles(id,organization_id,name) values('11000000-bbbb-4bbb-8bbb-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Evidence read only');
insert into finance.role_permissions(organization_id,role_id,permission_id) select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11000000-bbbb-4bbb-8bbb-000000000003',id from finance.permissions where code='attachments.read';
insert into finance.member_roles(organization_id,member_id,role_id) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11000000-aaaa-4aaa-8aaa-000000000001','11000000-bbbb-4bbb-8bbb-000000000003');
set local role authenticated; set local request.jwt.claim.sub='11000000-1111-4111-8111-111111111111';
select is((select count(*)::integer from finance.attachments),1,'Explicit evidence capability and readable AR source allow metadata');
reset role;
insert into finance.attachment_links(organization_id,attachment_id,document_id,linked_by_member_id) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11000000-dddd-4ddd-8ddd-000000000001','aaaaaaaa-6004-4604-8604-aaaaaaaaaaaa','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');
set local role authenticated; set local request.jwt.claim.sub='11000000-1111-4111-8111-111111111111';
select is((select count(*)::integer from finance.attachments),0,'Mixed AR/AP evidence name is no longer leaked through AR link');
reset role;
update auth.users set raw_user_meta_data='{"role":"Owner","capabilities":["*"]}' where id='11000000-1111-4111-8111-111111111111';
set local role authenticated; set local request.jwt.claim.sub='11000000-1111-4111-8111-111111111111';
select is((select count(*)::integer from finance.report_snapshots),0,'User-editable Owner metadata changes no authority');
reset role; set local role authenticated; set local request.jwt.claim.sub='11000000-2222-4222-8222-222222222222';
select is((select count(*)::integer from public.read_document_directory('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')),6,'Auditor can read all authorized source types');
select is((select count(*)::integer from finance.attachments),1,'Auditor can read evidence when all linked sources are authorized');
select is((select count(*)::integer from finance.report_snapshots),1,'Auditor has positive report-cache access');
select is((select count(*)::integer from finance.export_jobs),1,'Auditor sees only their own export request, not another requester');
select throws_ok($$select public.create_custom_role('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Escalated',array['users.manage'],'req_auditor_escalation')$$,'42501',NULL,'Read-only Auditor cannot invoke mutation directly');
reset role;
-- Adversarial future permissive policy demonstrates the separate tenant fence.
create policy test_overbroad_read on finance.business_documents for select to authenticated using(true);
set local role authenticated; set local request.jwt.claim.sub='11000000-2222-4222-8222-222222222222';
select is((select count(*)::integer from finance.document_directory where organization_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),0,'Restrictive tenant fence survives an overbroad permissive read policy');
reset role; drop policy test_overbroad_read on finance.business_documents;
update finance.organization_members set status='inactive' where id='11000000-aaaa-4aaa-8aaa-000000000002';
set local role authenticated; set local request.jwt.claim.sub='11000000-2222-4222-8222-222222222222';
select is((select count(*)::integer from public.read_document_directory('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')),0,'Revocation blocks next directory call with the same identity');
select is((select count(*)::integer from finance.report_snapshots),0,'Revocation blocks cached report metadata too');
reset role;
update finance.organizations set status='archived' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated; set local request.jwt.claim.sub='11000000-1111-4111-8111-111111111111';
select is((select count(*)::integer from public.read_document_directory('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')),0,'Archived tenant cannot leak through a scoped read');
reset role; set local role anon;
select throws_ok($$select * from public.read_document_directory('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$,'42501',NULL,'Anonymous direct RPC denied');
reset role; grant usage on schema extensions to ams_job_worker; set local role ams_job_worker;
select throws_ok($$select * from finance.business_documents$$,'42501',NULL,'Unscoped worker cannot read company facts');
select throws_ok($$select * from public.read_document_directory('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$,'42501',NULL,'Worker cannot reuse human read RPC');
reset role;
select * from finish(); rollback;
