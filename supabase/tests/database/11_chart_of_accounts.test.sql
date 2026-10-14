begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

insert into auth.users (id, email, last_sign_in_at)
values ('cc000000-0000-4000-8000-000000000001', 'us014-owner@example.invalid', now());

insert into finance.organizations
  (id, name, slug, legal_name, books_start_date, fiscal_year_start_month, status)
values
  ('cc000000-0000-4000-8000-000000000002', 'US014 Company', 'us014-chart', 'US014 Company', '2026-01-01', 1, 'onboarding');

insert into finance.organization_members (id, organization_id, user_id, display_name_snapshot)
values
  ('cc000000-0000-4000-8000-000000000003', 'cc000000-0000-4000-8000-000000000002', 'cc000000-0000-4000-8000-000000000001', 'US014 Owner');

insert into finance.roles (id, organization_id, name)
values ('cc000000-0000-4000-8000-000000000004', 'cc000000-0000-4000-8000-000000000002', 'US014 Chart Writer');

insert into finance.role_permissions (organization_id, role_id, permission_id)
select 'cc000000-0000-4000-8000-000000000002', 'cc000000-0000-4000-8000-000000000004', p.id
from finance.permissions p
where p.code in ('accounting.read', 'journal.write');

insert into finance.member_roles (organization_id, member_id, role_id)
values ('cc000000-0000-4000-8000-000000000002', 'cc000000-0000-4000-8000-000000000003', 'cc000000-0000-4000-8000-000000000004');

insert into finance.accounts
  (id, organization_id, code, name, account_type, normal_side, report_group)
values
  ('cc000000-0000-4000-8000-000000000009', 'cc000000-0000-4000-8000-000000000002', 'US14-OFFSET', 'Offset liability', 'liability', 'credit', 'other-liabilities');

insert into finance.fiscal_years (id, organization_id, label, starts_on, ends_on)
values ('cc000000-0000-4000-8000-000000000005', 'cc000000-0000-4000-8000-000000000002', 'FY2026', '2026-01-01', '2026-12-31');

insert into finance.accounting_periods (id, organization_id, fiscal_year_id, label, starts_on, ends_on)
values ('cc000000-0000-4000-8000-000000000006', 'cc000000-0000-4000-8000-000000000002', 'cc000000-0000-4000-8000-000000000005', 'FY2026', '2026-01-01', '2026-12-31');

set local role authenticated;
set local request.jwt.claim.sub = 'cc000000-0000-4000-8000-000000000001';

select lives_ok(
  $$select * from public.save_account(
    'cc000000-0000-4000-8000-000000000002', 'us014_create_used', null::uuid, null::integer,
    'US14-USED', 'Used asset', null::uuid, 'asset', 'debit', 'other-assets', null::text, true, true
  )$$,
  'US-014 allows the owner to configure accounts during company onboarding'
);

reset role;

update finance.organizations set status='active'
where id='cc000000-0000-4000-8000-000000000002';

insert into finance.business_documents
  (id, organization_id, document_type, state, document_number, issue_date, accounting_date,
   created_by_member_id, posted_by_member_id, posted_at)
values
  ('cc000000-0000-4000-8000-000000000007', 'cc000000-0000-4000-8000-000000000002', 'manual_journal', 'posted', 'US14-JE-1',
   '2026-10-01', '2026-10-01', 'cc000000-0000-4000-8000-000000000003', 'cc000000-0000-4000-8000-000000000003', now());

insert into finance.journal_entries
  (id, organization_id, source_document_id, period_id, accounting_date, state, posted_at, posted_by_member_id)
values
  ('cc000000-0000-4000-8000-000000000008', 'cc000000-0000-4000-8000-000000000002', 'cc000000-0000-4000-8000-000000000007',
   'cc000000-0000-4000-8000-000000000006', '2026-10-01', 'posted', now(), 'cc000000-0000-4000-8000-000000000003');

insert into finance.journal_lines
  (organization_id, journal_entry_id, line_no, account_id, debit, credit)
select 'cc000000-0000-4000-8000-000000000002', 'cc000000-0000-4000-8000-000000000008', 1, a.id, 10.00, 0.00
from finance.accounts a
where a.organization_id = 'cc000000-0000-4000-8000-000000000002' and a.code = 'US14-USED';

insert into finance.journal_lines
  (organization_id, journal_entry_id, line_no, account_id, debit, credit)
values
  ('cc000000-0000-4000-8000-000000000002', 'cc000000-0000-4000-8000-000000000008', 2,
   'cc000000-0000-4000-8000-000000000009', 0.00, 10.00);

select is((select count(*)::integer from finance.journal_lines where organization_id='cc000000-0000-4000-8000-000000000002'), 2,
  'T-48 history fixture is a balanced posted journal with two lines');

set local role authenticated;
set local request.jwt.claim.sub = 'cc000000-0000-4000-8000-000000000001';

select throws_ok(
  $$select * from public.save_account(
    'cc000000-0000-4000-8000-000000000002', 'us014_change_used',
    (select id from finance.accounts where organization_id='cc000000-0000-4000-8000-000000000002' and code='US14-USED'),
    1, 'US14-USED', 'Used asset', null::uuid, 'liability', 'credit', 'other-liabilities', null::text, true, true
  )$$,
  '23514', 'account classification is locked after first ledger use',
  'T-48 protects historical classification through the account command'
);

select lives_ok(
  $$select * from public.save_account(
    'cc000000-0000-4000-8000-000000000002', 'us014_create_inactive', null::uuid, null::integer,
    'US14-INACTIVE', 'Inactive asset', null::uuid, 'asset', 'debit', 'other-assets', null::text, true, true
  )$$,
  'US-014 creates an account that can later be archived'
);

select lives_ok(
  $$select * from public.save_account(
    'cc000000-0000-4000-8000-000000000002', 'us014_archive',
    (select id from finance.accounts where organization_id='cc000000-0000-4000-8000-000000000002' and code='US14-INACTIVE'),
    1, 'US14-INACTIVE', 'Inactive asset', null::uuid, 'asset', 'debit', 'other-assets', null::text, true, false
  )$$,
  'US-014 archives the account through the authenticated command'
);

reset role;

select throws_ok(
  $$insert into finance.journal_lines(organization_id,journal_entry_id,line_no,account_id,debit,credit)
    select 'cc000000-0000-4000-8000-000000000002','cc000000-0000-4000-8000-000000000008',2,a.id,5.00,0.00
    from finance.accounts a where a.organization_id='cc000000-0000-4000-8000-000000000002' and a.code='US14-INACTIVE'$$,
  '23514', 'journal lines require an active postable account in the same company',
  'T-48 blocks posting to an archived account'
);

set local role authenticated;
set local request.jwt.claim.sub = 'cc000000-0000-4000-8000-000000000001';

select lives_ok(
  $$select * from public.save_account(
    'cc000000-0000-4000-8000-000000000002', 'us014_create_group_a', null::uuid, null::integer,
    'US14-GROUP-A', 'Group A', null::uuid, 'asset', 'debit', 'other-assets', null::text, false, true
  )$$,
  'US-014 creates a non-postable account group'
);

select lives_ok(
  $$select * from public.save_account(
    'cc000000-0000-4000-8000-000000000002', 'us014_create_group_b', null::uuid, null::integer,
    'US14-GROUP-B', 'Group B', (select id from finance.accounts where organization_id='cc000000-0000-4000-8000-000000000002' and code='US14-GROUP-A'),
    'asset', 'debit', 'other-assets', null::text, false, true
  )$$,
  'US-014 creates a child group under a valid parent'
);

select throws_ok(
  $$select * from public.save_account(
    'cc000000-0000-4000-8000-000000000002', 'us014_cycle',
    (select id from finance.accounts where organization_id='cc000000-0000-4000-8000-000000000002' and code='US14-GROUP-A'),
    1, 'US14-GROUP-A', 'Group A', (select id from finance.accounts where organization_id='cc000000-0000-4000-8000-000000000002' and code='US14-GROUP-B'),
    'asset', 'debit', 'other-assets', null::text, false, true
  )$$,
  '23514', 'account cycle',
  'US-014 rejects an account hierarchy cycle'
);

reset role;

select throws_ok(
  $$insert into finance.journal_lines(organization_id,journal_entry_id,line_no,account_id,debit,credit)
    select 'cc000000-0000-4000-8000-000000000002','cc000000-0000-4000-8000-000000000008',3,a.id,5.00,0.00
    from finance.accounts a where a.organization_id='cc000000-0000-4000-8000-000000000002' and a.code='US14-GROUP-A'$$,
  '23514', 'journal lines require an active postable account in the same company',
  'T-48 blocks posting to a group account'
);

select throws_ok(
  $$delete from finance.accounts where organization_id='cc000000-0000-4000-8000-000000000002' and code='US14-USED'$$,
  '23503', null,
  'A ledger-used account cannot be deleted'
);

set local role authenticated;
set local request.jwt.claim.sub = 'cc000000-0000-4000-8000-000000000001';

select lives_ok(
  $$select * from public.save_account(
    'cc000000-0000-4000-8000-000000000002', 'us014_create_liability', null::uuid, null::integer,
    'US14-LIABILITY', 'Liability account', null::uuid, 'liability', 'credit', 'other-liabilities', null::text, true, true
  )$$,
  'US-014 creates a liability account for mapping validation'
);

reset role;

insert into finance.account_mappings (organization_id, mapping_key, account_id)
select 'cc000000-0000-4000-8000-000000000002', 'cash', id
from finance.accounts
where organization_id='cc000000-0000-4000-8000-000000000002' and code='US14-USED';

set local role authenticated;
set local request.jwt.claim.sub = 'cc000000-0000-4000-8000-000000000001';

select throws_ok(
  $$select * from public.set_account_mapping(
    'cc000000-0000-4000-8000-000000000002', 'us014_bad_mapping', 'cash',
    (select id from finance.accounts where organization_id='cc000000-0000-4000-8000-000000000002' and code='US14-LIABILITY'), 1
  )$$,
  '23514', 'incompatible account mapping',
  'US-014 rejects a mapping to an incompatible account type'
);

reset role;
update finance.organizations set status='read_only'
where id='cc000000-0000-4000-8000-000000000002';

set local role authenticated;
set local request.jwt.claim.sub = 'cc000000-0000-4000-8000-000000000001';

select throws_ok(
  $$select * from public.save_account(
    'cc000000-0000-4000-8000-000000000002', 'us014_read_only', null::uuid, null::integer,
    'US14-READONLY', 'Read-only account', null::uuid, 'asset', 'debit', 'other-assets', null::text, true, true
  )$$,
  '42501', 'organization is not writable',
  'US-014 blocks chart writes for read-only companies'
);

reset role;
update finance.organizations set status='archived'
where id='cc000000-0000-4000-8000-000000000002';

set local role authenticated;
set local request.jwt.claim.sub = 'cc000000-0000-4000-8000-000000000001';

select throws_ok(
  $$select * from public.save_account(
    'cc000000-0000-4000-8000-000000000002', 'us014_archived', null::uuid, null::integer,
    'US14-ARCHIVED', 'Archived account', null::uuid, 'asset', 'debit', 'other-assets', null::text, true, true
  )$$,
  '42501', null,
  'US-014 blocks chart writes for archived companies'
);

reset role;
select * from finish();
rollback;
