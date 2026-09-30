begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'us003-a@example.invalid')
on conflict (id) do nothing;

insert into finance.organizations
  (id, name, slug, legal_name, books_start_date, fiscal_year_start_month, status)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'US003 Org A', 'us003-org-a', 'US003 Org A', '2026-01-01', 1, 'active'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'US003 Org B', 'us003-org-b', 'US003 Org B', '2026-01-01', 1, 'active');

insert into finance.organization_members
  (id, organization_id, user_id, display_name_snapshot)
values
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'US003 User'),
  ('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', 'US003 User');

insert into finance.permissions (id, code, description)
values ('10000000-0000-4000-8000-000000000001', 'accounting.read', 'US003 accounting read');

insert into finance.roles (id, organization_id, name)
values ('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'US003 Accounting Reader');

insert into finance.role_permissions (organization_id, role_id, permission_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', '10000000-0000-4000-8000-000000000001');

insert into finance.member_roles (organization_id, member_id, role_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa');

insert into finance.accounts
  (id, organization_id, code, name, account_type, normal_side, report_group)
values
  ('aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A100', 'Org A Bank', 'asset', 'debit', 'cash'),
  ('bbbbbbbb-3333-4333-8333-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B100', 'Org B Bank', 'asset', 'debit', 'cash');

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select results_eq(
  $$select code from finance.accounts order by code$$,
  array['A100']::text[],
  'S-01: membership in Org B without accounting.read cannot leak Org B accounts'
);

select ok(
  not has_table_privilege('authenticated', 'finance.accounts', 'INSERT')
  and not has_table_privilege('authenticated', 'finance.accounts', 'UPDATE')
  and not has_table_privilege('authenticated', 'finance.accounts', 'DELETE'),
  'S-01: ordinary authenticated role cannot directly mutate accounts'
);

reset role;

insert into finance.fiscal_years
  (id, organization_id, label, starts_on, ends_on)
values
  ('aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'FY2026', '2026-01-01', '2026-12-31');

insert into finance.accounting_periods
  (id, organization_id, fiscal_year_id, label, starts_on, ends_on)
values
  ('aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa', '2026-09', '2026-09-01', '2026-09-30');

insert into finance.business_documents
  (id, organization_id, document_type, issue_date, accounting_date, created_by_member_id)
values
  ('aaaaaaaa-6666-4666-8666-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'manual_journal', '2026-09-30', '2026-09-30', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');

insert into finance.journal_entries
  (id, organization_id, source_document_id, period_id, accounting_date, posted_by_member_id)
values
  ('aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-6666-4666-8666-aaaaaaaaaaaa', 'aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa', '2026-09-30', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');

create or replace function pg_temp.us003_cross_tenant_account_rejected()
returns boolean
language plpgsql
as $$
begin
  insert into finance.journal_lines
    (organization_id, journal_entry_id, line_no, account_id, debit, credit)
  values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa', 1,
     'bbbbbbbb-3333-4333-8333-bbbbbbbbbbbb', 1.00, 0.00);
  return false;
exception
  when foreign_key_violation then return true;
end;
$$;

select ok(
  pg_temp.us003_cross_tenant_account_rejected(),
  'S-02: composite tenant FK rejects an Org B account inside an Org A journal line'
);

select is(
  (select count(*)::bigint from finance.journal_lines
   where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  0::bigint,
  'S-02: rejected cross-tenant injection leaves no journal line'
);

select * from finish();
rollback;
