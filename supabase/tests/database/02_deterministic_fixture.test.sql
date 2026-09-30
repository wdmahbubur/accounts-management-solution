begin;

create extension if not exists pgtap with schema extensions;
\ir ../helpers/us005_two_company_fixture.sql

select plan(12);

select is(
  (select count(*)::bigint from finance.organizations
   where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')),
  2::bigint,
  'US-005 fixture creates exactly two deterministic companies'
);

select is(
  (select count(*)::bigint from finance.organization_members
   where user_id = '11111111-1111-4111-8111-111111111111'),
  2::bigint,
  'US-005 user has deterministic dual membership'
);

select is(
  (select count(*)::bigint from finance.journal_entries
   where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and state = 'posted'),
  6::bigint,
  'T-47 fixture contains six posted journal observations'
);

select is(
  (select coalesce(sum(l.debit-l.credit),0)::numeric(20,2)
   from finance.journal_lines l
   where l.organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and l.account_id='aaaaaaaa-0000-4000-8000-000000001001'),
  102000.00::numeric(20,2),
  'T-47 fixture bank balance is 102000.00'
);

select is(
  (select coalesce(sum(l.debit-l.credit),0)::numeric(20,2)
   from finance.journal_lines l
   where l.organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and l.account_id='aaaaaaaa-0000-4000-8000-000000001002'),
  4000.00::numeric(20,2),
  'T-47 fixture AR balance is 4000.00'
);

select is(
  (select coalesce(sum(l.credit-l.debit),0)::numeric(20,2)
   from finance.journal_lines l
   where l.organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and l.account_id='aaaaaaaa-0000-4000-8000-000000001003'),
  1000.00::numeric(20,2),
  'T-47 fixture AP balance is 1000.00'
);

select is(
  (select coalesce(sum(l.credit-l.debit),0)::numeric(20,2)
   from finance.journal_lines l
   where l.organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and l.account_id='aaaaaaaa-0000-4000-8000-000000001004'),
  10000.00::numeric(20,2),
  'T-47 fixture revenue is 10000.00'
);

select is(
  (select coalesce(sum(l.debit-l.credit),0)::numeric(20,2)
   from finance.journal_lines l
   where l.organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and l.account_id='aaaaaaaa-0000-4000-8000-000000001005'),
  5000.00::numeric(20,2),
  'T-47 fixture expense is 5000.00'
);

select is(
  (select coalesce(sum(debit),0)::numeric(20,2) from finance.journal_lines
   where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  124000.00::numeric(20,2),
  'fixture total debits are deterministic'
);

select is(
  (select coalesce(sum(credit),0)::numeric(20,2) from finance.journal_lines
   where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  124000.00::numeric(20,2),
  'fixture total credits equal total debits'
);

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select results_eq(
  $$select code from finance.accounts order by code$$,
  array['A100','A110','E500','I400','L200','Q300']::text[],
  'S-01 fixture: dual member sees only the company with accounting.read'
);

reset role;

select ok(
  exists (
    select 1 from finance.accounts
    where organization_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      and code='B100'
  ),
  'Company B fixture exists even though it was hidden from the scoped read'
);

select * from finish();
rollback;
