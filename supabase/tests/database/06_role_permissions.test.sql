begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

select is(
  (select count(*)::bigint from finance.permissions),
  39::bigint,
  'all 39 documented permission-family capabilities are seeded'
);

insert into auth.users (id, email, last_sign_in_at) values
  ('99111111-1111-4111-8111-111111111111', 'us009-owner@example.invalid', now()),
  ('99222222-2222-4222-8222-222222222222', 'us009-admin@example.invalid', now()),
  ('99333333-3333-4333-8333-333333333333', 'us009-worker@example.invalid', now()),
  ('99444444-4444-4444-8444-444444444444', 'us009-billing@example.invalid', now());

set local role authenticated;
set local request.jwt.claim.sub = '99111111-1111-4111-8111-111111111111';

select lives_ok(
  $$select * from public.create_company_atomic(
    'US009 Company',
    'US009 Company Limited',
    'BD',
    'BDT',
    'Asia/Dhaka',
    1::smallint,
    '2026-04-01'::date,
    'us009_company_key_0123456789'
  )$$,
  'US-009 fixture company is created with future-seeded role templates'
);

reset role;

select is(
  (select count(*)::bigint
   from finance.role_permissions rp
   join finance.roles r
     on r.organization_id=rp.organization_id and r.id=rp.role_id
   join finance.organizations o on o.id=r.organization_id
   where o.name='US009 Company' and r.template_key='owner'),
  39::bigint,
  'Owner template receives every documented capability'
);

select results_eq(
  $$select string_agg(p.code, ',' order by p.code)
    from finance.role_permissions rp
    join finance.roles r
      on r.organization_id=rp.organization_id and r.id=rp.role_id
    join finance.permissions p on p.id=rp.permission_id
    join finance.organizations o on o.id=r.organization_id
    where o.name='US009 Company' and r.template_key='admin'$$,
  array['company.read,company.update,users.manage,users.read']::text[],
  'Admin defaults to company/user administration only'
);

select results_eq(
  $$select string_agg(p.code, ',' order by p.code)
    from finance.role_permissions rp
    join finance.roles r
      on r.organization_id=rp.organization_id and r.id=rp.role_id
    join finance.permissions p on p.id=rp.permission_id
    join finance.organizations o on o.id=r.organization_id
    where o.name='US009 Company' and r.template_key='billing'$$,
  array['catalog.read,contacts.read,contacts.write,dues.allocate,dues.read,sales.post,sales.read,sales.write']::text[],
  'Billing defaults to explicit sales scope only'
);

select is(
  (select count(*)::bigint
   from finance.role_permissions rp
   join finance.roles r
     on r.organization_id=rp.organization_id and r.id=rp.role_id
   join finance.permissions p on p.id=rp.permission_id
   join finance.organizations o on o.id=r.organization_id
   where o.name='US009 Company'
     and r.template_key='billing'
     and p.code in ('documents.read','banking.read','accounting.read','ledger.read','reports.read','reports.export','purchases.read')),
  0::bigint,
  'S-03 Billing receives no broad P&L/AP/bank/document capabilities'
);

select is(
  (select count(*)::bigint
   from finance.role_permissions rp
   join finance.roles r
     on r.organization_id=rp.organization_id and r.id=rp.role_id
   join finance.permissions p on p.id=rp.permission_id
   join finance.organizations o on o.id=r.organization_id
   where o.name='US009 Company'
     and r.template_key='auditor'
     and (p.code like '%.write' or p.code like '%.manage' or p.code like '%.post' or p.code='approvals.decide')),
  0::bigint,
  'Auditor template stays read-only'
);

select is(
  (select count(*)::bigint
   from finance.role_permissions rp
   join finance.roles r
     on r.organization_id=rp.organization_id and r.id=rp.role_id
   join finance.permissions p on p.id=rp.permission_id
   join finance.organizations o on o.id=r.organization_id
   where o.name='US009 Company'
     and r.template_key='finance_manager'
     and p.code in ('approvals.decide','periods.reopen','reports.read','reports.export','banking.read','journal.post')),
  6::bigint,
  'approval, reopen, report/export, bank-read and journal-post are distinct Finance capabilities'
);

insert into finance.organization_members
  (id, organization_id, user_id, display_name_snapshot, status)
select
  '99222222-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  o.id,
  '99222222-2222-4222-8222-222222222222',
  'US009 Admin',
  'active'
from finance.organizations o where o.name='US009 Company';

insert into finance.organization_members
  (id, organization_id, user_id, display_name_snapshot, status)
select
  '99333333-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  o.id,
  '99333333-3333-4333-8333-333333333333',
  'US009 Worker',
  'active'
from finance.organizations o where o.name='US009 Company';

insert into finance.organization_members
  (id, organization_id, user_id, display_name_snapshot, status)
select
  '99444444-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
  o.id,
  '99444444-4444-4444-8444-444444444444',
  'US009 Billing',
  'active'
from finance.organizations o where o.name='US009 Company';

set local role authenticated;
set local request.jwt.claim.sub = '99111111-1111-4111-8111-111111111111';

select lives_ok(
  $$select public.set_member_roles(
    (select id from finance.organizations where name='US009 Company'),
    '99222222-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    array[(select id from finance.roles r
      where r.organization_id=(select id from finance.organizations where name='US009 Company')
        and r.template_key='admin')]::uuid[],
    'req_us009_admin_assign'
  )$$,
  'Owner can assign the bounded Admin template to another member'
);

select lives_ok(
  $$select public.set_member_roles(
    (select id from finance.organizations where name='US009 Company'),
    '99444444-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
    array[(select id from finance.roles r
      where r.organization_id=(select id from finance.organizations where name='US009 Company')
        and r.template_key='billing')]::uuid[],
    'req_us009_billing_assign'
  )$$,
  'Owner can assign Billing to another member'
);

select lives_ok(
  $$select public.create_custom_role(
    (select id from finance.organizations where name='US009 Company'),
    'Sales reviewer',
    array['sales.read','contacts.read']::text[],
    'req_us009_custom_create'
  )$$,
  'Owner can create a bounded custom role'
);

select results_eq(
  $$select string_agg(p.code, ',' order by p.code)
    from finance.role_permissions rp
    join finance.roles r
      on r.organization_id=rp.organization_id and r.id=rp.role_id
    join finance.permissions p on p.id=rp.permission_id
    where r.organization_id=(select id from finance.organizations where name='US009 Company')
      and r.name='Sales reviewer'$$,
  array['contacts.read,sales.read']::text[],
  'custom role stores only requested valid permissions'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '99222222-2222-4222-8222-222222222222';

select throws_ok(
  $$select public.set_member_roles(
    (select id from finance.organizations where name='US009 Company'),
    '99222222-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    array[(select id from finance.roles r
      where r.organization_id=(select id from finance.organizations where name='US009 Company')
        and r.template_key='finance_manager')]::uuid[],
    'req_us009_self_escalate'
  )$$,
  '42501',
  'self role changes are not allowed',
  'S-13 Admin cannot self-escalate by direct RPC'
);

select throws_ok(
  $$select public.set_member_roles(
    (select id from finance.organizations where name='US009 Company'),
    '99333333-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    array[(select id from finance.roles r
      where r.organization_id=(select id from finance.organizations where name='US009 Company')
        and r.template_key='accountant')]::uuid[],
    'req_us009_overgrant'
  )$$,
  '42501',
  'role grant exceeds actor authority',
  'Admin cannot grant a financial role whose permissions exceed Admin authority'
);

select throws_ok(
  $$select public.create_custom_role(
    (select id from finance.organizations where name='US009 Company'),
    'Escalated custom',
    array['reports.read']::text[],
    'req_us009_custom_overgrant'
  )$$,
  '42501',
  'permission grant exceeds actor authority',
  'Admin cannot create a custom role with financial permissions it does not hold'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '99444444-4444-4444-8444-444444444444';

select throws_ok(
  $$select * from public.list_roles_for_management(
    (select id from finance.organizations where name='US009 Company')
  )$$,
  '42501',
  'permission denied',
  'Billing cannot invoke protected role-management reads'
);

select is(
  (select count(*)::bigint
   from unnest(
     (select capabilities from public.resolve_active_membership(
       (select id from finance.organizations where name='US009 Company')
     ))
   ) code
   where code in ('documents.read','banking.read','accounting.read','ledger.read','reports.read','purchases.read')),
  0::bigint,
  'S-03 live Billing membership lacks P&L/AP/private-bank/document read capabilities'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '99111111-1111-4111-8111-111111111111';

select lives_ok(
  $select public.set_member_roles(
    (select id from finance.organizations where name='US009 Company'),
    '99333333-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    array[
      (select id from finance.roles r
       where r.organization_id=(select id from finance.organizations where name='US009 Company')
         and r.template_key='accountant'),
      (select id from finance.roles r
       where r.organization_id=(select id from finance.organizations where name='US009 Company')
         and r.template_key='owner')
    ]::uuid[],
    'req_us009_accountant_owner_assign'
  )$,
  'Owner can explicitly add another Owner together with Accountant'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '99222222-2222-4222-8222-222222222222';

select throws_ok(
  $select public.set_member_roles(
    (select id from finance.organizations where name='US009 Company'),
    (select id from finance.organization_members
      where organization_id=(select id from finance.organizations where name='US009 Company')
        and user_id='99111111-1111-4111-8111-111111111111'),
    array[]::uuid[],
    'req_us009_admin_remove_owner'
  )$,
  '42501',
  'only an active owner may remove Owner',
  'Admin cannot demote an Owner even when another active Owner exists'
);

select throws_ok(
  $select public.deactivate_member(
    (select id from finance.organizations where name='US009 Company'),
    (select id from finance.organization_members
      where organization_id=(select id from finance.organizations where name='US009 Company')
        and user_id='99111111-1111-4111-8111-111111111111'),
    'req_us009_admin_deactivate_owner'
  )$,
  '42501',
  'only an active owner may deactivate an Owner',
  'Admin cannot deactivate an Owner even when another active Owner exists'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '99111111-1111-4111-8111-111111111111';

select lives_ok(
  $select public.transfer_ownership(
    (select id from finance.organizations where name='US009 Company'),
    '99333333-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    'req_us009_transfer_owner'
  )$$,
  'Owner can transfer ownership atomically to another active member'
);

select is(
  (select count(*)::bigint
   from finance.member_roles mr
   join finance.roles r
     on r.organization_id=mr.organization_id and r.id=mr.role_id
   where mr.organization_id=(select id from finance.organizations where name='US009 Company')
     and mr.member_id=(select id from finance.organization_members m
       where m.organization_id=mr.organization_id
         and m.user_id='99111111-1111-4111-8111-111111111111')
     and r.template_key='owner'),
  0::bigint,
  'former Owner loses the Owner role after transfer'
);

select is(
  (select count(*)::bigint
   from finance.member_roles mr
   join finance.roles r
     on r.organization_id=mr.organization_id and r.id=mr.role_id
   where mr.organization_id=(select id from finance.organizations where name='US009 Company')
     and mr.member_id='99333333-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
     and r.template_key='owner'),
  1::bigint,
  'target member becomes Owner'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '99222222-2222-4222-8222-222222222222';

select throws_ok(
  $$select public.deactivate_member(
    (select id from finance.organizations where name='US009 Company'),
    '99333333-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    'req_us009_last_owner_block'
  )$$,
  '23514',
  'cannot remove last active owner',
  'last active Owner cannot be deactivated'
);

reset role;

select ok(
  (select count(*) from finance.audit_events a
   where a.organization_id=(select id from finance.organizations where name='US009 Company')
     and a.action in ('member.roles.set','role.custom.create','ownership.transfer')) >= 5,
  'role and ownership mutations append audit evidence'
);

select is(
  (select count(*)::bigint
   from finance.organization_members m
   join finance.member_roles mr
     on mr.organization_id=m.organization_id and mr.member_id=m.id
   join finance.roles r
     on r.organization_id=mr.organization_id and r.id=mr.role_id
   where m.organization_id=(select id from finance.organizations where name='US009 Company')
     and m.status='active'
     and r.is_system
     and r.template_key='owner'),
  1::bigint,
  'owner floor remains exactly one after protected operations'
);

select * from finish();
rollback;
