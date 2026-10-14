begin;

create extension if not exists pgtap with schema extensions;
\ir ../helpers/us005_two_company_fixture.psql

insert into finance.permissions(code,description)
values ('documents.read','Read financial source documents'),('sales.write','Create and edit sales drafts')
on conflict(code) do nothing;
insert into finance.role_permissions(organization_id,role_id,permission_id)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',p.id
from finance.permissions p where p.code in ('documents.read','sales.write')
on conflict do nothing;
insert into finance.contacts(id,organization_id,display_name,is_customer,is_vendor)
values ('aaaaaaaa-8881-4881-8881-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','US017 draft customer',true,false);

create temporary table us017_payloads as
select '{
  "document_type":"invoice","party_id":"aaaaaaaa-8881-4881-8881-aaaaaaaaaaaa",
  "issue_date":"2026-09-15","accounting_date":"2026-09-15","due_date":"2026-10-15",
  "external_reference":"US017-DRAFT-1","description":"Synthetic draft invoice","currency":"BDT",
  "rounding_adjustment":"0.00","rounding_reason":null,"rounding_account_id":null,
  "trade":{"recognition_mode":"earned_or_incurred","performance_confirmed":false},
  "movement":null,"transfer":null,
  "lines":[{"id":null,"item_id":null,"original_line_id":null,"description":"Service line",
    "quantity":"1.000000","unit_price":"10000.000000","discount_amount":"0.00",
    "account_id":"aaaaaaaa-0000-4000-8000-000000001004","cost_center_id":null,"tax_code_id":null,
    "tax_mode":"exclusive","cash_flow_class":"operating"}],
  "journal_rows":[],"allocation_plan":[]
}'::jsonb as create_payload;
grant select on us017_payloads to authenticated;

select plan(15);

select has_function(
  'public','save_financial_document',
  array['uuid','uuid','integer','text','text','text','jsonb'],
  'typed draft save command exists'
);

set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';

select is(
  (select document_version from public.save_financial_document(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,null,'req_us017_create',repeat('a1',32),repeat('a',64),
    (select create_payload from pg_temp.us017_payloads)
  )),
  1,
  'invoice draft creates at version one'
);

select set_config('test.us017_document_id',(
  select id::text from finance.business_documents where external_reference='US017-DRAFT-1'
),true);

select ok(
  (select state='draft' and version=1 and net_amount=10000 and tax_amount=0 and total_amount=10000
   from finance.business_documents where id=current_setting('test.us017_document_id')::uuid),
  'draft invoice stores server-derived totals and has no posted state'
);

reset role;
select is(
  (select count(*)::bigint from finance.journal_entries
   where source_document_id=current_setting('test.us017_document_id')::uuid),
  0::bigint,
  'T-01 draft invoice creates no journal entry'
);

select is(
  (select coalesce(sum(l.credit-l.debit),0)::finance.amount from finance.journal_lines l
   where l.organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and l.account_id='aaaaaaaa-0000-4000-8000-000000001004'),
  10000::finance.amount,
  'T-01 draft save leaves posted revenue unchanged'
);
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';

select is(
  (select document_version from public.save_financial_document(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',current_setting('test.us017_document_id')::uuid,1,
    'req_us017_update',repeat('b2',32),repeat('b',64),
    jsonb_set((select create_payload from pg_temp.us017_payloads),'{lines,0,unit_price}','"12000.000000"'::jsonb,true)
  )),
  2,
  'editing the draft advances its optimistic version'
);

select is(
  (select total_amount from finance.business_documents where id=current_setting('test.us017_document_id')::uuid),
  12000::finance.amount,
  'draft edit recalculates its server-owned total'
);

reset role;
select is(
  (select count(*)::bigint from finance.journal_entries
   where source_document_id=current_setting('test.us017_document_id')::uuid),
  0::bigint,
  'editing a draft still creates no journal entry'
);

select is(
  (select coalesce(sum(l.credit-l.debit),0)::finance.amount from finance.journal_lines l
   where l.organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and l.account_id='aaaaaaaa-0000-4000-8000-000000001004'),
  10000::finance.amount,
  'draft update leaves posted revenue unchanged'
);
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';

select throws_ok(
  $$select * from public.save_financial_document(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',current_setting('test.us017_document_id')::uuid,1,
    'req_us017_stale',repeat('c3',32),repeat('c',64),(select create_payload from pg_temp.us017_payloads)
  )$$,
  '40001','document version is stale','stale expected version cannot overwrite the newer draft'
);

select is(
  (select document_version from public.save_financial_document(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,null,'req_us017_create',repeat('a1',32),repeat('a',64),
    (select create_payload from pg_temp.us017_payloads)
  )),
  1,
  'idempotent create retry returns its original receipt'
);

select is(
  (select count(*)::bigint from finance.business_documents where external_reference='US017-DRAFT-1'),
  1::bigint,
  'idempotent retry does not create a second source document'
);

select is(
  (select count(*)::bigint from finance.document_lines
   where document_id=current_setting('test.us017_document_id')::uuid),
  1::bigint,
  'saving a draft leaves one authoritative current line'
);

reset role;
select is(
  (select count(*)::bigint from finance.audit_events
   where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and entity_id=current_setting('test.us017_document_id')::uuid
     and action in ('document.draft.create','document.draft.update')),
  2::bigint,
  'draft create and update each write audit evidence'
);
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';

select is(
  (select state::text from finance.business_documents where id=current_setting('test.us017_document_id')::uuid),
  'draft'::text,
  'draft lifecycle remains distinct from posting'
);

select * from finish();
rollback;
