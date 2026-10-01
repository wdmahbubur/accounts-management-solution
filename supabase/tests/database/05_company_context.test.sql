begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select has_function(
  'public',
  'list_active_memberships',
  ARRAY[]::text[],
  'active membership list RPC exists'
);

select ok(
  not has_function_privilege('anon', 'public.list_active_memberships()', 'EXECUTE'),
  'anonymous callers cannot list memberships'
);

insert into auth.users (id, email) values
  ('88111111-1111-4111-8111-111111111111', 'us008-a@example.invalid'),
  ('88222222-2222-4222-8222-222222222222', 'us008-b@example.invalid');

insert into finance.organizations
  (id, name, slug, legal_name, books_start_date, fiscal_year_start_month, status)
values
  ('88aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'US008 A', 'us008-a', 'US008 A Limited', '2026-01-01', 1, 'active'),
  ('88aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'US008 B', 'us008-b', 'US008 B Limited', '2026-01-01', 1, 'read_only'),
  ('88aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'US008 Inactive', 'us008-inactive', 'US008 Inactive Limited', '2026-01-01', 1, 'active'),
  ('88aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'US008 Other User', 'us008-other', 'US008 Other User Limited', '2026-01-01', 1, 'active');

insert into finance.organization_members
  (id, organization_id, user_id, display_name_snapshot, status)
values
  ('88bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbba1','88aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','88111111-1111-4111-8111-111111111111','User A','active'),
  ('88bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbba2','88aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','88111111-1111-4111-8111-111111111111','User A','active'),
  ('88bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbba3','88aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','88111111-1111-4111-8111-111111111111','User A','inactive'),
  ('88bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbba4','88aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','88222222-2222-4222-8222-222222222222','User B','active');

insert into finance.roles (id, organization_id, name, template_key, is_system)
values
  ('88cccccc-cccc-4ccc-8ccc-cccccccccca1','88aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Owner','owner',true),
  ('88cccccc-cccc-4ccc-8ccc-cccccccccca2','88aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','Billing','billing',true);

insert into finance.member_roles (organization_id, member_id, role_id)
values
  ('88aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','88bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbba1','88cccccc-cccc-4ccc-8ccc-cccccccccca1'),
  ('88aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','88bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbba2','88cccccc-cccc-4ccc-8ccc-cccccccccca2');

set local role authenticated;
set local request.jwt.claim.sub = '88111111-1111-4111-8111-111111111111';

select is(
  (select count(*)::bigint from public.list_active_memberships()),
  2::bigint,
  'only the verified users active memberships are listed'
);

select results_eq(
  $$select organization_name from public.list_active_memberships() order by organization_name$$,
  array['US008 A','US008 B']::text[],
  'inactive membership and another users tenant are hidden'
);

select results_eq(
  $$select organization_status from public.list_active_memberships() where organization_name='US008 B'$$,
  array['read_only']::text[],
  'organization service status is preserved for the switcher'
);

select results_eq(
  $$select array_to_string(role_names, ',') from public.list_active_memberships() where organization_name='US008 A'$$,
  array['Owner']::text[],
  'membership role names come from same-company role assignments'
);

reset role;

update finance.organization_members
set status='inactive'
where id='88bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbba2';

set local role authenticated;
set local request.jwt.claim.sub = '88111111-1111-4111-8111-111111111111';

select is(
  (select count(*)::bigint from public.list_active_memberships()),
  1::bigint,
  'membership removal is reflected immediately by the active-company list'
);

select is(
  (select count(*)::bigint
   from public.resolve_active_membership('88aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')),
  0::bigint,
  'inactive company context also fails the live membership resolver'
);

select * from finish();
rollback;
