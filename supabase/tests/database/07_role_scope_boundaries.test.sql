begin;
create extension if not exists pgtap with schema extensions;
-- Direct fixture inserts establish records to deny; they do not prove posting.
\ir ../helpers/us005_two_company_fixture.psql
update auth.users set last_sign_in_at=now() where id='11111111-1111-4111-8111-111111111111';
insert into auth.users(id,email,last_sign_in_at) values
 ('95555555-5555-4555-8555-555555555555','us009-boundary-billing@example.invalid',now()),
 ('96666666-6666-4666-8666-666666666666','us009-unassigned@example.invalid',now());
insert into finance.organization_members(id,organization_id,user_id,display_name_snapshot) values
 ('95555555-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','95555555-5555-4555-8555-555555555555','Billing operator'),
 ('96666666-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','96666666-6666-4666-8666-666666666666','Unassigned member');
insert into finance.roles(id,organization_id,name,template_key,is_system) values
 ('aaaaaaaa-9900-4900-8900-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Owner','owner',true),
 ('aaaaaaaa-9901-4901-8901-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','System Billing','billing',true);
insert into finance.member_roles(organization_id,member_id,role_id) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','aaaaaaaa-9900-4900-8900-aaaaaaaaaaaa'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','95555555-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-9901-4901-8901-aaaaaaaaaaaa');
insert into finance.contacts(id,organization_id,display_name,is_customer,is_vendor) values
 ('aaaaaaaa-9902-4902-8902-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Customer allowed',true,false),
 ('aaaaaaaa-9903-4903-8903-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Private supplier',false,true);
insert into finance.cash_accounts(organization_id,name,account_id,kind,masked_account_number)
 values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Private bank','aaaaaaaa-0000-4000-8000-000000001001','bank','****1234');
insert into finance.open_items(organization_id,journal_line_id,account_id,party_id,
 control_kind,side,original_amount,reference,issue_date)
select l.organization_id,l.id,l.account_id,
 case when a.control_kind='ar' then 'aaaaaaaa-9902-4902-8902-aaaaaaaaaaaa'::uuid else 'aaaaaaaa-9903-4903-8903-aaaaaaaaaaaa'::uuid end,
 a.control_kind,a.normal_side,100.00,'Boundary-'||a.control_kind,'2026-09-30'
from finance.journal_lines l join finance.accounts a on a.id=l.account_id
join finance.journal_entries j on j.id=l.journal_entry_id
join finance.business_documents d on d.id=j.source_document_id
where l.organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and a.control_kind in ('ar','ap') and d.document_type in ('invoice','bill');
select plan(27);

select is((select count(*) from finance.open_items where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')::bigint, 2::bigint, 'S-03 fixture contains both AR and AP records');

select is((select count(*) from finance.cash_accounts where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')::bigint, 1::bigint, 'S-03 fixture contains a private bank account');

reset role; set local role authenticated; set local request.jwt.claim.sub='95555555-5555-4555-8555-555555555555';

select is((select count(*) from public.resolve_active_membership('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))::bigint, 1::bigint, 'Billing is genuinely an active member, not a vacuous deny');

select is((select count(*) from finance.open_items where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and control_kind='ar')::bigint, 1::bigint, 'Billing can read customer AR through sales.read');

select is((select count(*) from finance.open_items where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and control_kind='ap')::bigint, 0::bigint, 'S-03 Billing cannot read supplier AP through dues.read');

select is((select count(*) from finance.contacts where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and is_customer)::bigint, 1::bigint, 'Billing can read customer contacts through sales.read');

select is((select count(*) from finance.contacts where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and not is_customer and is_vendor)::bigint, 0::bigint, 'S-03 Billing cannot read vendor-only contacts');

select is((select count(*) from finance.cash_accounts where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')::bigint, 0::bigint, 'S-03 Billing cannot read private bank records');

select is((select count(*) from finance.journal_lines where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')::bigint, 0::bigint, 'S-03 Billing cannot read company-wide ledger lines');

select is((select count(*) from finance.business_documents where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and document_type='invoice')::bigint, 1::bigint, 'Billing retains invoice access');

select is((select count(*) from finance.business_documents where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and document_type='bill')::bigint, 0::bigint, 'S-03 Billing cannot read supplier bills');

select throws_ok($$select * from public.list_members_for_management('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$, '42501', 'permission denied', 'Billing cannot read the protected member directory');

select throws_ok($$select * from public.list_roles_for_management('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$$, '42501', 'permission denied', 'Forging a different company id is denied');

select throws_ok($$update finance.roles set name='Escalated' where id='aaaaaaaa-9901-4901-8901-aaaaaaaaaaaa'$$, '42501', null, 'Ordinary callers cannot directly edit roles');

select throws_ok($$select public.create_custom_role('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Forbidden',array['users.manage'],'req_billing_grant')$$, '42501', 'permission denied', 'Billing cannot grant user-management authority');

reset role; set local role authenticated; set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';

select is((select is_owner from public.list_members_for_management('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') where member_id='96666666-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),false,'Unassigned member returns an explicit false owner flag');

select throws_ok($$select public.set_member_roles('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',array[]::uuid[],'req_self_remove')$$, '42501', 'self role changes are not allowed', 'Self role removal is forbidden');

select throws_ok($$select public.set_member_roles('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','95555555-aaaa-4aaa-8aaa-aaaaaaaaaaaa',array['bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb']::uuid[],'req_foreign_role')$$, '22023', 'unknown role id', 'A role from another tenant cannot be assigned');

select throws_ok($$select public.create_custom_role('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Unknown permission',array['super.admin'],'req_unknown')$$, '22023', 'unknown permission code', 'Unknown permission vocabulary fails closed');

select lives_ok($$select public.create_custom_role('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Scoped reader',array['sales.read'],'req_scoped_reader')$$,'Owner can create a custom role with the real SQL grant checker');

reset role;

select throws_ok($$delete from finance.member_roles where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and member_id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' and role_id='aaaaaaaa-9900-4900-8900-aaaaaaaaaaaa'$$, '23514', 'cannot remove last active owner', 'S-13 database trigger protects the final owner role');

select throws_ok($$update finance.organization_members set status='inactive' where id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'$$, '23514', 'cannot remove last active owner', 'S-13 database trigger protects the final active Owner');

select is((select count(*) from finance.audit_events where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and request_id='req_scoped_reader' and actor_member_id='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')::bigint, 1::bigint, 'Custom role audit records the verified actor and request id');

reset role; set local role authenticated; set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';

select lives_ok($$select public.transfer_ownership('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','95555555-aaaa-4aaa-8aaa-aaaaaaaaaaaa','req_boundary_transfer')$$,'Ownership is granted before the prior Owner is removed');

select throws_ok($$select public.create_custom_role('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Revoked owner',array['sales.read'],'req_revoked')$$, '42501', 'permission denied', 'Former Owner loses management authority on the next command');

reset role; update auth.users set last_sign_in_at=now()-interval '25 hours' where id='95555555-5555-4555-8555-555555555555';

reset role; set local role authenticated; set local request.jwt.claim.sub='95555555-5555-4555-8555-555555555555';

select throws_ok($$select public.create_custom_role('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Old session',array['sales.read'],'req_recent')$$, '42501', 'recent authentication required', 'Ownership changes and role grants require recent authentication');

reset role; set local role authenticated; set local request.jwt.claim.sub='';

select throws_ok($$select * from public.list_roles_for_management('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$, '28000', 'authentication required', 'Unauthenticated role reads fail closed');

reset role; select * from finish(); rollback;
