-- US-005 deterministic test fixture.
-- Test-only data: fixed identities/dates, two companies, dual membership and a
-- directly seeded golden ledger. Direct fixture inserts do not prove posting guards.

insert into auth.users (id, email)
values ('11111111-1111-4111-8111-111111111111', 'us005-dual@example.invalid')
on conflict (id) do nothing;

insert into finance.organizations
  (id, name, slug, legal_name, books_start_date, fiscal_year_start_month, status)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'US005 Company A', 'us005-company-a', 'US005 Company A', '2026-01-01', 1, 'active'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'US005 Company B', 'us005-company-b', 'US005 Company B', '2026-01-01', 1, 'active');

insert into finance.organization_members
  (id, organization_id, user_id, display_name_snapshot)
values
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'US005 Dual User'),
  ('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', 'US005 Dual User');

insert into finance.permissions (id, code, description)
values
  ('10000000-0000-4000-8000-000000000001', 'accounting.read', 'US005 accounting read'),
  ('10000000-0000-4000-8000-000000000002', 'billing.read', 'US005 billing read');

insert into finance.roles (id, organization_id, name)
values
  ('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Accountant'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Billing');

insert into finance.role_permissions (organization_id, role_id, permission_id)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', '10000000-0000-4000-8000-000000000001'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', '10000000-0000-4000-8000-000000000002');

insert into finance.member_roles (organization_id, member_id, role_id)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb');

insert into finance.fiscal_years
  (id, organization_id, label, starts_on, ends_on)
values
  ('aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'FY2026', '2026-01-01', '2026-12-31');

insert into finance.accounting_periods
  (id, organization_id, fiscal_year_id, label, starts_on, ends_on)
values
  ('aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa', '2026-09', '2026-09-01', '2026-09-30');

insert into finance.accounts
  (id, organization_id, code, name, account_type, normal_side, report_group, control_kind)
values
  ('aaaaaaaa-0000-4000-8000-000000001001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A100', 'Bank', 'asset', 'debit', 'cash', null),
  ('aaaaaaaa-0000-4000-8000-000000001002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A110', 'Accounts Receivable', 'asset', 'debit', 'receivables', 'ar'),
  ('aaaaaaaa-0000-4000-8000-000000001003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'L200', 'Accounts Payable', 'liability', 'credit', 'payables', 'ap'),
  ('aaaaaaaa-0000-4000-8000-000000001004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'I400', 'Service Revenue', 'income', 'credit', 'revenue', null),
  ('aaaaaaaa-0000-4000-8000-000000001005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'E500', 'Operating Expense', 'expense', 'debit', 'expense', null),
  ('aaaaaaaa-0000-4000-8000-000000001006', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Q300', 'Owner Capital', 'equity', 'credit', 'equity', null),
  ('bbbbbbbb-0000-4000-8000-000000001001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B100', 'Company B Bank', 'asset', 'debit', 'cash', null);

insert into finance.business_documents
  (id, organization_id, document_type, state, document_number, fiscal_year_id, issue_date, accounting_date,
   total_amount, description, created_by_member_id, posted_by_member_id, posted_at)
values
  ('aaaaaaaa-6001-4601-8601-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'manual_journal', 'posted', 'MJ-2026-000001', 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa', '2026-09-30', '2026-09-30', 100000.00, 'Owner contribution', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', '2026-09-30T12:00:00Z'),
  ('aaaaaaaa-6002-4602-8602-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'invoice', 'posted', 'INV-2026-000001', 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa', '2026-09-30', '2026-09-30', 10000.00, 'Earned invoice', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', '2026-09-30T12:01:00Z'),
  ('aaaaaaaa-6003-4603-8603-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'receipt', 'posted', 'RCT-2026-000001', 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa', '2026-09-30', '2026-09-30', 6000.00, 'Customer receipt', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', '2026-09-30T12:02:00Z'),
  ('aaaaaaaa-6004-4604-8604-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bill', 'posted', 'BILL-2026-000001', 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa', '2026-09-30', '2026-09-30', 4000.00, 'Vendor bill', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', '2026-09-30T12:03:00Z'),
  ('aaaaaaaa-6005-4605-8605-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'vendor_payment', 'posted', 'PAY-2026-000001', 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa', '2026-09-30', '2026-09-30', 3000.00, 'Vendor payment', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', '2026-09-30T12:04:00Z'),
  ('aaaaaaaa-6006-4606-8606-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'paid_expense', 'posted', 'EXP-2026-000001', 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa', '2026-09-30', '2026-09-30', 1000.00, 'Paid rent', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', '2026-09-30T12:05:00Z');

insert into finance.journal_entries
  (id, organization_id, source_document_id, period_id, accounting_date, state, posted_at, posted_by_member_id)
values
  ('aaaaaaaa-7001-4701-8701-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-6001-4601-8601-aaaaaaaaaaaa', 'aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa', '2026-09-30', 'posted', '2026-09-30T12:00:00Z', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'),
  ('aaaaaaaa-7002-4702-8702-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-6002-4602-8602-aaaaaaaaaaaa', 'aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa', '2026-09-30', 'posted', '2026-09-30T12:01:00Z', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'),
  ('aaaaaaaa-7003-4703-8703-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-6003-4603-8603-aaaaaaaaaaaa', 'aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa', '2026-09-30', 'posted', '2026-09-30T12:02:00Z', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'),
  ('aaaaaaaa-7004-4704-8704-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-6004-4604-8604-aaaaaaaaaaaa', 'aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa', '2026-09-30', 'posted', '2026-09-30T12:03:00Z', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'),
  ('aaaaaaaa-7005-4705-8705-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-6005-4605-8605-aaaaaaaaaaaa', 'aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa', '2026-09-30', 'posted', '2026-09-30T12:04:00Z', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'),
  ('aaaaaaaa-7006-4706-8706-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-6006-4606-8606-aaaaaaaaaaaa', 'aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa', '2026-09-30', 'posted', '2026-09-30T12:05:00Z', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');

insert into finance.journal_lines
  (organization_id, journal_entry_id, line_no, account_id, debit, credit, description)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-7001-4701-8701-aaaaaaaaaaaa',1,'aaaaaaaa-0000-4000-8000-000000001001',100000.00,0.00,'Owner contribution bank'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-7001-4701-8701-aaaaaaaaaaaa',2,'aaaaaaaa-0000-4000-8000-000000001006',0.00,100000.00,'Owner capital'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-7002-4702-8702-aaaaaaaaaaaa',1,'aaaaaaaa-0000-4000-8000-000000001002',10000.00,0.00,'Invoice AR'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-7002-4702-8702-aaaaaaaaaaaa',2,'aaaaaaaa-0000-4000-8000-000000001004',0.00,10000.00,'Invoice revenue'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-7003-4703-8703-aaaaaaaaaaaa',1,'aaaaaaaa-0000-4000-8000-000000001001',6000.00,0.00,'Receipt bank'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-7003-4703-8703-aaaaaaaaaaaa',2,'aaaaaaaa-0000-4000-8000-000000001002',0.00,6000.00,'Receipt AR'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-7004-4704-8704-aaaaaaaaaaaa',1,'aaaaaaaa-0000-4000-8000-000000001005',4000.00,0.00,'Bill expense'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-7004-4704-8704-aaaaaaaaaaaa',2,'aaaaaaaa-0000-4000-8000-000000001003',0.00,4000.00,'Bill AP'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-7005-4705-8705-aaaaaaaaaaaa',1,'aaaaaaaa-0000-4000-8000-000000001003',3000.00,0.00,'Payment AP'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-7005-4705-8705-aaaaaaaaaaaa',2,'aaaaaaaa-0000-4000-8000-000000001001',0.00,3000.00,'Payment bank'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-7006-4706-8706-aaaaaaaaaaaa',1,'aaaaaaaa-0000-4000-8000-000000001005',1000.00,0.00,'Rent expense'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-7006-4706-8706-aaaaaaaaaaaa',2,'aaaaaaaa-0000-4000-8000-000000001001',0.00,1000.00,'Rent bank');
