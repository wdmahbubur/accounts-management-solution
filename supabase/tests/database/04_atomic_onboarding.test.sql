begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

insert into auth.users (id, email)
values ('77111111-1111-4111-8111-111111111111', 'us007-owner@example.invalid');

insert into finance.profiles (user_id, display_name, locale, timezone)
values ('77111111-1111-4111-8111-111111111111', 'US007 Owner', 'en-BD', 'Asia/Dhaka');

set local role authenticated;
set local request.jwt.claim.sub = '77111111-1111-4111-8111-111111111111';

select lives_ok(
  $$select * from public.create_company_atomic(
    'US007 Company',
    'US007 Company Limited',
    'BD',
    'BDT',
    'Asia/Dhaka',
    1::smallint,
    '2026-04-01'::date,
    'us007_atomic_key_0123456789'
  )$$,
  'atomic onboarding succeeds for supported V1 inputs'
);

reset role;

select is(
  (select count(*)::bigint from finance.organizations where name='US007 Company'),
  1::bigint,
  'one organization is created'
);

select is(
  (select count(*)::bigint
   from finance.organization_members m
   join finance.organizations o on o.id=m.organization_id
   where o.name='US007 Company'
     and m.user_id='77111111-1111-4111-8111-111111111111'
     and m.status='active'),
  1::bigint,
  'creator becomes one active owner membership'
);

select is(
  (select count(*)::bigint
   from finance.roles r
   join finance.organizations o on o.id=r.organization_id
   where o.name='US007 Company' and r.is_system),
  6::bigint,
  'six sourced system role templates are created'
);

select is(
  (select count(*)::bigint
   from finance.member_roles mr
   join finance.organization_members m
     on m.organization_id=mr.organization_id and m.id=mr.member_id
   join finance.roles r
     on r.organization_id=mr.organization_id and r.id=mr.role_id
   join finance.organizations o on o.id=mr.organization_id
   where o.name='US007 Company'
     and m.user_id='77111111-1111-4111-8111-111111111111'
     and r.template_key='owner'),
  1::bigint,
  'creator is assigned exactly one Owner role'
);

select is(
  (select count(*)::bigint
   from finance.accounts a
   join finance.organizations o on o.id=a.organization_id
   where o.name='US007 Company'),
  29::bigint,
  'approved 29-account starter COA is seeded'
);

select results_eq(
  $$select string_agg(a.code, ',' order by a.code)
    from finance.accounts a
    join finance.organizations o on o.id=a.organization_id
    where o.name='US007 Company'$$,
  array['1000,1010,1020,1030,1100,1150,1200,1300,1500,1590,2000,2100,2200,2250,2300,3000,3100,3200,3900,4000,4090,5000,6000,6100,6200,6300,6400,6500,6600']::text[],
  'starter COA codes match the approved accounting-rules baseline'
);

select is(
  (select count(*)::bigint
   from finance.account_mappings m
   join finance.organizations o on o.id=m.organization_id
   where o.name='US007 Company'),
  11::bigint,
  'reviewed system mappings are seeded'
);

select results_eq(
  $$select string_agg(m.mapping_key || ':' || a.code, ',' order by m.mapping_key)
    from finance.account_mappings m
    join finance.accounts a
      on a.organization_id=m.organization_id and a.id=m.account_id
    join finance.organizations o on o.id=m.organization_id
    where o.name='US007 Company'$$,
  array['ap:2000,ar:1100,bank:1010,cash:1000,customer_advance:2200,input_tax:1200,opening_suspense:3900,output_tax:2100,retained_earnings:3100,rounding_difference:6600,vendor_advance:1150']::text[],
  'system mappings point to same-company starter accounts'
);

select is(
  (select count(*)::bigint
   from finance.fiscal_years fy
   join finance.organizations o on o.id=fy.organization_id
   where o.name='US007 Company'
     and fy.starts_on='2026-01-01'
     and fy.ends_on='2026-12-31'),
  1::bigint,
  'fiscal year containing books-start date is created'
);

select is(
  (select count(*)::bigint
   from finance.accounting_periods p
   join finance.organizations o on o.id=p.organization_id
   where o.name='US007 Company'),
  10::bigint,
  'opening period plus Apr-Dec regular periods are created'
);

set local role authenticated;
set local request.jwt.claim.sub = '77111111-1111-4111-8111-111111111111';

select results_eq(
  $$select replayed::text from public.create_company_atomic(
    'US007 Company',
    'US007 Company Limited',
    'BD',
    'BDT',
    'Asia/Dhaka',
    1::smallint,
    '2026-04-01'::date,
    'us007_atomic_key_0123456789'
  )$$,
  array['true']::text[],
  'identical retry returns replay instead of creating another company'
);

select throws_ok(
  $$select * from public.create_company_atomic(
    'Changed Company',
    'US007 Company Limited',
    'BD',
    'BDT',
    'Asia/Dhaka',
    1::smallint,
    '2026-04-01'::date,
    'us007_atomic_key_0123456789'
  )$$,
  '23505',
  'onboarding idempotency key reused with different request',
  'same onboarding key with different payload conflicts'
);

select throws_ok(
  $$select * from public.create_company_atomic(
    'Unsupported Currency Company',
    'Unsupported Currency Company',
    'BD',
    'USD',
    'Asia/Dhaka',
    1::smallint,
    '2026-04-01'::date,
    'us007_currency_key_0123456789'
  )$$,
  '22023',
  'V1 supports BDT only',
  'unsupported currency is rejected'
);

reset role;

select is(
  (select count(*)::bigint from finance.organizations where name='US007 Company'),
  1::bigint,
  'retry and conflict paths do not duplicate the company'
);

select is(
  (select count(*)::bigint from finance.organizations where name='Unsupported Currency Company'),
  0::bigint,
  'rejected unsupported currency leaves no organization'
);

create or replace function pg_temp.us007_force_account_failure()
returns trigger
language plpgsql
as $$
begin
  if new.code = '3100' then
    raise exception 'forced starter COA failure';
  end if;
  return new;
end
$$;

create trigger us007_force_account_failure
before insert on finance.accounts
for each row execute function pg_temp.us007_force_account_failure();

set local role authenticated;
set local request.jwt.claim.sub = '77111111-1111-4111-8111-111111111111';

select throws_ok(
  $$select * from public.create_company_atomic(
    'Rollback Company',
    'Rollback Company Limited',
    'BD',
    'BDT',
    'Asia/Dhaka',
    1::smallint,
    '2026-04-01'::date,
    'us007_rollback_key_0123456789'
  )$$,
  'P0001',
  'forced starter COA failure',
  'failure after organization creation rolls back the whole onboarding transaction'
);

reset role;
drop trigger us007_force_account_failure on finance.accounts;

select is(
  (select count(*)::bigint from finance.organizations where name='Rollback Company'),
  0::bigint,
  'forced mid-onboarding failure leaves no half-company'
);

select ok(
  not has_function_privilege('anon', 'public.create_company_atomic(text,text,text,text,text,smallint,date,text)', 'EXECUTE'),
  'anonymous callers cannot execute onboarding'
);

select * from finish();
rollback;
