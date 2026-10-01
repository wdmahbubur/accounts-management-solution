begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,last_sign_in_at) values
 ('12000000-1111-4111-8111-111111111111','settings-owner@example.invalid',now(),now()),
 ('12000000-2222-4222-8222-222222222222','settings-reader@example.invalid',now(),now());
insert into finance.organizations(id,name,slug,legal_name,books_start_date,fiscal_year_start_month,address,status) values
 ('12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Settings Company','us012-settings','Settings Legal','2026-01-01',1,'{"line1":"Old address","legacy_key":"preserve-but-do-not-serialize"}','onboarding'),
 ('12000000-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Other Settings','us012-other','Other Legal','2026-01-01',1,'{}','onboarding');
insert into finance.organization_members(id,organization_id,user_id,display_name_snapshot) values
 ('12000000-aaaa-4aaa-8aaa-000000000001','12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','12000000-1111-4111-8111-111111111111','Settings Owner'),
 ('12000000-aaaa-4aaa-8aaa-000000000002','12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','12000000-2222-4222-8222-222222222222','Settings Reader');
insert into finance.roles(id,organization_id,name,template_key,is_system) values
 ('12000000-aaaa-4aaa-8aaa-000000000003','12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Owner','owner',true),
 ('12000000-aaaa-4aaa-8aaa-000000000004','12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Billing','billing',true);
insert into finance.member_roles(organization_id,member_id,role_id) values
 ('12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','12000000-aaaa-4aaa-8aaa-000000000001','12000000-aaaa-4aaa-8aaa-000000000003'),
 ('12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','12000000-aaaa-4aaa-8aaa-000000000002','12000000-aaaa-4aaa-8aaa-000000000004');
insert into finance.fiscal_years(id,organization_id,label,starts_on,ends_on) values
 ('12000000-cccc-4ccc-8ccc-cccccccccccc','12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','FY 2026','2026-01-01','2026-12-31');
insert into finance.accounting_periods(id,organization_id,fiscal_year_id,label,kind,starts_on,ends_on) values
 ('12000000-dddd-4ddd-8ddd-000000000001','12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,'Opening','opening','2025-12-31','2025-12-31'),
 ('12000000-dddd-4ddd-8ddd-000000000002','12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','12000000-cccc-4ccc-8ccc-cccccccccccc','2026-01','regular','2026-01-01','2026-01-31');
create function pg_temp.change(v integer, changes jsonb) returns integer language sql as $$
 select public.update_company_settings('12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa',v,changes,'Approved setup correction','req_us012_test');
$$;
set local role authenticated; set local request.jwt.claim.sub='12000000-1111-4111-8111-111111111111';
select is(public.read_company_settings('12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->>'foundation_locked','false','Unused onboarding calendar is editable');
select ok(not (public.read_company_settings('12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->'address' ? 'legacy_key'),'Read DTO strips non-public legacy address keys');
select is(pg_temp.change(1,'{"name":"  বাংলা সেবা  ","contact_email":"BOSS@EXAMPLE.INVALID","address":{"city":"ঢাকা"}}'),2,'Legal/contact profile update increments expected version');
select throws_ok($$select pg_temp.change(1,'{"name":"Stale"}')$$,'P0409',NULL,'Old version cannot overwrite a newer setting');
select throws_ok($$select pg_temp.change(2,'{"base_currency":"USD"}')$$,'22023',NULL,'T-50 foreign currency rejected');
select throws_ok($$select pg_temp.change(2,'{"books_start_date":"2026-02-30"}')$$,'22023',NULL,'Impossible books date rejected');
select throws_ok($$select pg_temp.change(2,'{"books_start_date":"infinity"}')$$,'22023',NULL,'Nonfinite books date rejected');
select throws_ok($$select pg_temp.change(2,'{"fiscal_year_start_month":13}')$$,'22023',NULL,'Invalid fiscal month rejected');
select throws_ok($$select pg_temp.change(2,'{"fiscal_year_start_month":"1"}')$$,'22023',NULL,'Wrong month type rejected');
select throws_ok($$select pg_temp.change(2,'{"timezone":"Imaginary/Zone"}')$$,'22023',NULL,'Unknown timezone rejected');
select throws_ok($$select pg_temp.change(2,'{"actor_id":"12000000-2222-4222-8222-222222222222"}')$$,'22023',NULL,'Forged actor field rejected');
select throws_ok($$select pg_temp.change(2,'{"address":{"arbitrary_secret":"not permitted"}}')$$,'22023',NULL,'Unknown new address field rejected');
select throws_ok($$select pg_temp.change(2,'{"contact_email":"not-an-email"}')$$,'22023',NULL,'Invalid contact email rejected');
select throws_ok($$select public.update_company_settings('12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa',2,'{}','', 'req_reason')$$,'22023',NULL,'Material configuration requires a reason');
select throws_ok($$select public.read_company_settings('12000000-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$$,'42501',NULL,'Foreign company settings cannot be read');
select throws_ok($$select public.update_company_settings('12000000-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,'{"name":"Injected"}','Bad edit','req_foreign')$$,'42501',NULL,'Foreign company settings cannot be mutated');
reset role;
select is((select name from finance.organizations where id='12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'বাংলা সেবা','Stored Unicode name is normalized');
select is((select address->>'line1' from finance.organizations where id='12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'Old address','Partial address update retains omitted fields');
select is((select address->>'legacy_key' from finance.organizations where id='12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'preserve-but-do-not-serialize','Legacy address field is preserved rather than rewritten');
select is((select contact_email from finance.organizations where id='12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'boss@example.invalid','Email normalized before persistence');
select ok(not exists(select 1 from finance.audit_events where action='company.settings_updated' and redacted_change::text like '%boss@example.invalid%'),'Audit redacts contact values');
select is((select count(*)::integer from finance.audit_events where action='company.settings_updated' and actor_member_id='12000000-aaaa-4aaa-8aaa-000000000001' and reason='Approved setup correction' and created_at is not null),1,'Material audit includes live actor, reason and timestamp');
set local role authenticated; set local request.jwt.claim.sub='12000000-1111-4111-8111-111111111111';
select is(pg_temp.change(2,'{"books_start_date":"2026-04-15","fiscal_year_start_month":7}'),3,'Unused onboarding calendar can be rebuilt atomically');
select is(pg_temp.change(3,'{"books_start_date":"2026-04-15","fiscal_year_start_month":7}'),3,'Identical settings are a no-op without another version');
reset role;
select is((select starts_on::text from finance.accounting_periods where organization_id='12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and kind='opening'),'2026-04-14','Opening cutover remains exactly books start minus one day');
select is((select starts_on::text||'/'||ends_on::text from finance.fiscal_years where organization_id='12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'2025-07-01/2026-06-30','Fiscal year spans books start with configured fiscal month');
select is((select count(*)::integer from finance.accounting_periods where organization_id='12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),4,'Partial first month followed by full remaining months and one opening day');
select is((select min(starts_on)::text from finance.accounting_periods where organization_id='12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and kind='regular'),'2026-04-15','Regular periods never precede books start');
select throws_ok($$insert into finance.accounting_periods(organization_id,fiscal_year_id,label,kind,starts_on,ends_on) select organization_id,id,'Overlap','regular','2026-04-20','2026-04-25' from finance.fiscal_years where organization_id='12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,'23P01',NULL,'Existing exclusion constraint rejects overlapping fiscal periods');
select throws_ok($$insert into finance.accounting_periods(organization_id,label,kind,starts_on,ends_on) values('12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Invalid opening','opening','2026-01-01','2026-01-01')$$,'22023',NULL,'Invalid opening cutover rejected before insert');
select throws_ok($$insert into finance.accounting_periods(organization_id,fiscal_year_id,label,kind,starts_on,ends_on) select organization_id,id,'Outside','regular','2026-04-01','2026-04-02' from finance.fiscal_years where organization_id='12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,'22023',NULL,'Regular period outside books-start policy rejected');
update finance.accounting_periods set status='locked',locked_at=now(),locked_by_member_id='12000000-aaaa-4aaa-8aaa-000000000001' where organization_id='12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and kind='opening';
set local role authenticated; set local request.jwt.claim.sub='12000000-1111-4111-8111-111111111111';
select throws_ok($$select pg_temp.change(3,'{"books_start_date":"2026-05-01"}')$$,'P0412',NULL,'T-34 configuration cannot rebuild away a locked period');
reset role;
-- Fixture-only unlock; actual lock/reopen command and audit belong to US-016.
update finance.accounting_periods set status='open',locked_at=null,locked_by_member_id=null where organization_id='12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and kind='opening';
insert into finance.business_documents(id,organization_id,document_type,issue_date,accounting_date,total_amount,created_by_member_id) values
 ('12000000-eeee-4eee-8eee-eeeeeeeeeeee','12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa','invoice','2026-04-15','2026-04-15',123.45,'12000000-aaaa-4aaa-8aaa-000000000001');
select is((select settings_version from finance.organizations where id='12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),4,'First financial draft freezes foundation and changes settings version');
set local role authenticated; set local request.jwt.claim.sub='12000000-1111-4111-8111-111111111111';
select throws_ok($$select pg_temp.change(4,'{"books_start_date":"2026-05-01"}')$$,'P0412',NULL,'Foundation dates cannot change after financial activity');
select throws_ok($$select pg_temp.change(4,'{"fiscal_year_start_month":1}')$$,'P0412',NULL,'Fiscal policy cannot change after activity');
select is(pg_temp.change(4,'{"legal_name":"New Legal Name","timezone":"Asia/Kuala_Lumpur"}'),5,'Legal name and timezone remain editable without date-policy rewriting');
reset role;
select is((select total_amount::text||'/'||accounting_date::text from finance.business_documents where id='12000000-eeee-4eee-8eee-eeeeeeeeeeee'),'123.45/2026-04-15','Historical document amount and accounting date were not rewritten');
select throws_ok($$update finance.organizations set foundation_locked_at=null where id='12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,'P0412',NULL,'Permanent lock cannot be cleared through raw administrative update');
delete from finance.business_documents where id='12000000-eeee-4eee-8eee-eeeeeeeeeeee';
set local role authenticated; set local request.jwt.claim.sub='12000000-1111-4111-8111-111111111111';
select throws_ok($$select pg_temp.change(5,'{"books_start_date":"2026-05-01"}')$$,'P0412',NULL,'Removing last draft never reopens historical date policy');
set local request.jwt.claim.sub='12000000-2222-4222-8222-222222222222';
select lives_ok($$select public.read_company_settings('12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$,'Billing company.read has safe profile/calendar read');
select throws_ok($$select pg_temp.change(5,'{"name":"Unauthorized"}')$$,'42501',NULL,'Billing cannot change settings without company.update');
select throws_ok($$update finance.organizations set name='Unauthorized'$$,'42501',NULL,'Direct raw organization DML is denied');
reset role;
update auth.users set last_sign_in_at=now()-interval '2 days' where id='12000000-1111-4111-8111-111111111111';
set local role authenticated; set local request.jwt.claim.sub='12000000-1111-4111-8111-111111111111';
select throws_ok($$select pg_temp.change(5,'{"name":"Expired auth"}')$$,'42501',NULL,'Sensitive settings require recent authentication');
reset role; set local role anon;
select throws_ok($$select public.read_company_settings('12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$,'42501',NULL,'Anonymous settings RPC denied');
reset role; select * from finish(); rollback;
