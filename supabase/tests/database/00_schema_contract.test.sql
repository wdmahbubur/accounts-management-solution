begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

select is(
  (select count(*)::bigint
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'finance' and c.relkind = 'r'),
  52::bigint,
  'all 52 finance tables exist'
);

select is(
  (select count(*)::bigint
   from pg_constraint c
   join pg_class r on r.oid = c.conrelid
   join pg_namespace n on n.oid = r.relnamespace
   where n.nspname = 'finance'
     and r.relname = any(array['organization_members','roles','role_permissions','member_roles','invitations','fiscal_years','accounting_periods','accounts','account_mappings','contacts','cost_centers','tax_codes','items','cash_accounts','document_sequences','business_documents','trade_documents','document_lines','money_movements','transfers','manual_journal_rows','journal_entries','journal_lines','open_items','document_allocation_plans','settlement_allocations','allocation_reversals','bank_imports','statement_lines','reconciliations','reconciliation_matches','approval_policies','approval_requests','approval_decisions','attachments','attachment_links','audit_events','period_events','import_jobs','import_rows','export_jobs','report_snapshots','idempotency_requests','outbox_events','notification_deliveries','subscriptions','billing_events','year_close_runs']::text[])
     and c.contype = 'u'
     and pg_get_constraintdef(c.oid) = 'UNIQUE (organization_id, id)'),
  48::bigint,
  'all tenant tables expose composite organization_id/id identity'
);

select is(
  (select count(*)::bigint
   from pg_constraint c
   join pg_class r on r.oid = c.conrelid
   join pg_namespace n on n.oid = r.relnamespace
   where n.nspname = 'finance'
     and c.contype = 'f'
     and array_length(c.conkey, 1) > 1),
  99::bigint,
  'all reviewed composite foreign keys exist'
);

select is(
  (select format_type(t.typbasetype, t.typtypmod)
   from pg_type t join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'finance' and t.typname = 'amount'),
  'numeric(20,2)',
  'amount is numeric(20,2)'
);

select is(
  (select format_type(t.typbasetype, t.typtypmod)
   from pg_type t join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'finance' and t.typname = 'quantity'),
  'numeric(20,6)',
  'quantity is numeric(20,6)'
);

select is(
  (select format_type(t.typbasetype, t.typtypmod)
   from pg_type t join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'finance' and t.typname = 'unit_price'),
  'numeric(20,6)',
  'unit_price is numeric(20,6)'
);

select is(
  (select format_type(t.typbasetype, t.typtypmod)
   from pg_type t join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'finance' and t.typname = 'rate'),
  'numeric(9,6)',
  'rate is numeric(9,6)'
);

select is(
  (select count(*)::bigint
   from pg_indexes
   where schemaname = 'finance'
     and indexname = any(array['organization_members_user_id_idx','role_permissions_role_id_idx','role_permissions_permission_id_idx','member_roles_member_id_idx','member_roles_role_id_idx','invitations_role_id_idx','invitations_invited_by_member_id_idx','invitations_accepted_by_member_id_idx','accounting_periods_fiscal_year_id_idx','accounting_periods_locked_by_member_id_idx','accounts_parent_id_idx','account_mappings_account_id_idx','tax_codes_output_account_id_idx','tax_codes_input_account_id_idx','items_sales_account_id_idx','items_purchase_account_id_idx','items_tax_code_id_idx','cash_accounts_account_id_idx','document_sequences_fiscal_year_id_idx','documents_date_idx','documents_party_idx','documents_state_idx','business_documents_fiscal_year_id_idx','business_documents_party_id_idx','business_documents_created_by_member_id_idx','business_documents_posted_by_member_id_idx','business_documents_reversal_of_document_id_idx','trade_documents_document_id_idx','trade_documents_original_document_id_idx','document_lines_document_id_idx','document_lines_item_id_idx','document_lines_original_line_id_idx','document_lines_account_id_idx','document_lines_cost_center_id_idx','document_lines_tax_code_id_idx','document_lines_tax_account_id_idx','money_movements_document_id_idx','money_movements_cash_account_id_idx','transfers_document_id_idx','transfers_from_cash_account_id_idx','transfers_to_cash_account_id_idx','transfers_fee_account_id_idx','manual_journal_rows_document_id_idx','manual_journal_rows_account_id_idx','manual_journal_rows_party_id_idx','manual_journal_rows_cost_center_id_idx','journal_period_idx','journal_entries_source_document_id_idx','journal_entries_period_id_idx','journal_entries_posted_by_member_id_idx','ledger_account_idx','ledger_party_idx','journal_lines_journal_entry_id_idx','journal_lines_account_id_idx','journal_lines_party_id_idx','journal_lines_cost_center_id_idx','open_items_party_idx','open_items_journal_line_id_idx','open_items_account_id_idx','open_items_party_id_idx','document_allocation_plans_document_id_idx','document_allocation_plans_target_open_item_id_idx','alloc_debit_idx','alloc_credit_idx','settlement_allocations_debit_open_item_id_idx','settlement_allocations_credit_open_item_id_idx','settlement_allocations_created_by_member_id_idx','settlement_allocations_source_document_id_idx','allocation_reversals_allocation_id_idx','allocation_reversals_created_by_member_id_idx','bank_imports_cash_account_id_idx','bank_imports_created_by_member_id_idx','statement_date_idx','statement_fingerprint_idx','statement_lines_import_id_idx','statement_lines_cash_account_id_idx','statement_lines_source_transaction_id_idx','reconciliations_cash_account_id_idx','reconciliations_finalized_by_member_id_idx','reconciliation_matches_reconciliation_id_idx','reconciliation_matches_statement_line_id_idx','reconciliation_matches_journal_line_id_idx','reconciliation_matches_created_by_member_id_idx','approval_policies_approver_role_id_idx','approval_requests_document_id_idx','approval_requests_requested_by_member_id_idx','approval_decisions_request_id_idx','approval_decisions_decided_by_member_id_idx','attachments_uploaded_by_member_id_idx','attachment_links_attachment_id_idx','attachment_links_document_id_idx','attachment_links_linked_by_member_id_idx','audit_time_idx','audit_entity_idx','audit_events_actor_member_id_idx','audit_events_entity_id_idx','audit_events_document_id_idx','audit_events_request_id_idx','period_events_period_id_idx','period_events_actor_member_id_idx','import_jobs_created_by_member_id_idx','import_rows_job_id_idx','import_rows_result_document_id_idx','import_rows_result_contact_id_idx','import_rows_result_item_id_idx','export_jobs_requested_by_member_id_idx','report_snapshots_period_id_idx','report_snapshots_created_by_member_id_idx','idempotency_requests_actor_member_id_idx','idempotency_requests_resource_document_id_idx','outbox_queue_idx','outbox_events_document_id_idx','notification_deliveries_outbox_event_id_idx','notification_deliveries_document_id_idx','notification_deliveries_provider_message_id_idx','subscriptions_plan_id_idx','subscriptions_provider_customer_id_idx','subscriptions_provider_subscription_id_idx','billing_events_provider_event_id_idx','year_close_runs_fiscal_year_id_idx','year_close_runs_close_document_id_idx','year_close_runs_reopen_document_id_idx','year_close_runs_created_by_member_id_idx','year_one_live_close_idx']::text[])),
  124::bigint,
  'all 124 explicitly reviewed indexes exist'
);

select is(
  (select count(*)::bigint
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'finance' and c.relkind = 'r' and c.relrowsecurity),
  52::bigint,
  'RLS is enabled on all finance tables'
);

select ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'finance'
      and grantee = 'anon'
      and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
  ),
  'anon has no finance DML grants'
);

select ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'finance'
      and grantee = 'authenticated'
      and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
  ),
  'authenticated has no finance DML grants'
);

select is(
  (select count(*)::bigint
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'finance_private'
     and p.proname in ('has_permission','can_read_document','can_read_attachment')
     and p.prosecdef
     and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'),
  3::bigint,
  'all three private read helpers are security-definer with fixed search_path'
);

select ok(
  not has_schema_privilege('anon', 'finance_private', 'USAGE')
  and not has_function_privilege('anon', 'finance_private.has_permission(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'finance_private.can_read_document(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'finance_private.can_read_attachment(uuid,uuid)', 'EXECUTE'),
  'anon cannot use private helper schema or execute helper functions'
);

select * from finish();
rollback;
