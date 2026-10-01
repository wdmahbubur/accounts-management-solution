begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

select has_function('public', 'get_own_profile', ARRAY[]::text[], 'own profile read RPC exists');
select has_function('public', 'update_own_profile', ARRAY['text','text','text'], 'own profile update RPC exists');
select has_function('public', 'resolve_active_membership', ARRAY['uuid'], 'live membership RPC exists');

select ok(
  not has_function_privilege('anon', 'public.update_own_profile(text,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.resolve_active_membership(uuid)', 'EXECUTE'),
  'anon cannot execute profile or membership RPCs'
);

insert into auth.users (id, email) values
  ('66111111-1111-4111-8111-111111111111', 'us006-a@example.invalid'),
  ('66222222-2222-4222-8222-222222222222', 'us006-b@example.invalid');

insert into finance.profiles (user_id, display_name, locale, timezone)
values
  ('66222222-2222-4222-8222-222222222222', 'User B', 'en-BD', 'Asia/Dhaka');

insert into finance.organizations
  (id, name, slug, legal_name, books_start_date, fiscal_year_start_month, status)
values
  ('66aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'US006 Company', 'us006-company', 'US006 Company', '2026-01-01', 1, 'active');

insert into finance.organization_members
  (id, organization_id, user_id, display_name_snapshot, status)
values
  ('66bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '66aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '66111111-1111-4111-8111-111111111111', 'User A', 'active');

set local role authenticated;
set local request.jwt.claim.sub = '66111111-1111-4111-8111-111111111111';

select lives_ok(
  $$select * from public.update_own_profile('User A Updated','bn-BD','UTC')$$,
  'authenticated user can update only their own profile'
);

select results_eq(
  $$select display_name || '|' || locale || '|' || timezone from public.get_own_profile()$$,
  array['User A Updated|bn-BD|UTC']::text[],
  'own profile read returns persisted values'
);

select results_eq(
  $$select member_id::text || '|' || organization_id::text || '|' || cardinality(capabilities)::text
    from public.resolve_active_membership('66aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$,
  array['66bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb|66aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|0']::text[],
  'live membership resolver ignores editable metadata and returns DB capabilities'
);

reset role;

select is(
  (select display_name from finance.profiles where user_id='66222222-2222-4222-8222-222222222222'),
  'User B',
  'updating own profile does not change another user'
);

update finance.organization_members
set status='inactive'
where id='66bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

set local role authenticated;
set local request.jwt.claim.sub = '66111111-1111-4111-8111-111111111111';

select is(
  (select count(*)::bigint from public.resolve_active_membership('66aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')),
  0::bigint,
  'S-07 inactive member disappears from live membership resolution'
);

select * from finish();
rollback;
