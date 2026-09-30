-- US-003 migration 2/2: read-only security baseline.
-- Generated through Supabase CLI from docs/reference-schema.sql.
-- No ordinary API-user write grants are introduced.
BEGIN;
-- Hardened membership/permission lookup. Keep finance_private outside exposed schemas.
CREATE FUNCTION finance_private.has_permission(p_organization_id uuid, p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM finance.organization_members m
    JOIN finance.member_roles mr ON mr.organization_id = m.organization_id AND mr.member_id = m.id
    JOIN finance.role_permissions rp ON rp.organization_id = mr.organization_id AND rp.role_id = mr.role_id
    JOIN finance.permissions p ON p.id = rp.permission_id
    WHERE m.organization_id = p_organization_id
      AND m.user_id = auth.uid() AND m.status = 'active' AND p.code = p_permission
  );
$$;
CREATE FUNCTION finance_private.can_read_document(p_organization_id uuid, p_document_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM finance.business_documents d
    WHERE d.organization_id = p_organization_id AND d.id = p_document_id
      AND (
        finance_private.has_permission(d.organization_id, 'documents.read')
        OR (d.document_type IN ('invoice','customer_credit','receipt','customer_refund','customer_advance')
            AND finance_private.has_permission(d.organization_id, 'sales.read'))
        OR (d.document_type IN ('bill','vendor_credit','vendor_payment','vendor_refund','vendor_advance','paid_expense')
            AND finance_private.has_permission(d.organization_id, 'purchases.read'))
        OR (d.document_type = 'transfer' AND finance_private.has_permission(d.organization_id, 'banking.read'))
      )
  );
$$;
CREATE FUNCTION finance_private.can_read_attachment(p_organization_id uuid, p_attachment_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM finance.attachment_links l
      WHERE l.organization_id = p_organization_id AND l.attachment_id = p_attachment_id
        AND finance_private.can_read_document(l.organization_id, l.document_id)
    ) OR EXISTS (
      SELECT 1 FROM finance.attachments a
      JOIN finance.organization_members m ON m.organization_id = a.organization_id AND m.id = a.uploaded_by_member_id
      WHERE a.organization_id = p_organization_id AND a.id = p_attachment_id
        AND m.user_id = auth.uid() AND m.status = 'active'
        AND finance_private.has_permission(a.organization_id, 'attachments.write')
    )
  );
$$;
REVOKE ALL ON FUNCTION finance_private.can_read_document(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance_private.can_read_attachment(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance_private.can_read_document(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION finance_private.can_read_attachment(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION finance_private.has_permission(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA finance, finance_private TO authenticated;
GRANT EXECUTE ON FUNCTION finance_private.has_permission(uuid,text) TO authenticated;
-- Read grants below are module-scoped. They do not authorize a financial mutation.
-- At deployment expose only the deliberate API surface, not finance_private.

ALTER TABLE finance.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.profiles TO authenticated;
CREATE POLICY profiles_read ON finance.profiles FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
ALTER TABLE finance.organizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.organizations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.organizations TO authenticated;
CREATE POLICY organizations_read ON finance.organizations FOR SELECT TO authenticated USING (finance_private.has_permission(id, 'company.read'));
ALTER TABLE finance.organization_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.organization_members FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.organization_members TO authenticated;
CREATE POLICY organization_members_read ON finance.organization_members FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) OR finance_private.has_permission(organization_id, 'users.read'));
ALTER TABLE finance.permissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.permissions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.permissions TO authenticated;
CREATE POLICY permissions_read ON finance.permissions FOR SELECT TO authenticated USING ((SELECT auth.uid()) IS NOT NULL);
ALTER TABLE finance.roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.roles TO authenticated;
CREATE POLICY roles_read ON finance.roles FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'users.read'));
ALTER TABLE finance.role_permissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.role_permissions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.role_permissions TO authenticated;
CREATE POLICY role_permissions_read ON finance.role_permissions FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'users.read'));
ALTER TABLE finance.member_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.member_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.member_roles TO authenticated;
CREATE POLICY member_roles_read ON finance.member_roles FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'users.read'));
ALTER TABLE finance.invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.invitations TO authenticated;
CREATE POLICY invitations_read ON finance.invitations FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'users.read'));
ALTER TABLE finance.fiscal_years ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.fiscal_years FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.fiscal_years TO authenticated;
CREATE POLICY fiscal_years_read ON finance.fiscal_years FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'accounting.read'));
ALTER TABLE finance.accounting_periods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.accounting_periods FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.accounting_periods TO authenticated;
CREATE POLICY accounting_periods_read ON finance.accounting_periods FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'accounting.read'));
ALTER TABLE finance.accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.accounts TO authenticated;
CREATE POLICY accounts_read ON finance.accounts FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'accounting.read'));
ALTER TABLE finance.account_mappings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.account_mappings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.account_mappings TO authenticated;
CREATE POLICY account_mappings_read ON finance.account_mappings FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'accounting.read'));
ALTER TABLE finance.contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.contacts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.contacts TO authenticated;
CREATE POLICY contacts_read ON finance.contacts FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'contacts.read') OR (is_customer AND finance_private.has_permission(organization_id, 'sales.read')) OR (is_vendor AND finance_private.has_permission(organization_id, 'purchases.read')));
ALTER TABLE finance.cost_centers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.cost_centers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.cost_centers TO authenticated;
CREATE POLICY cost_centers_read ON finance.cost_centers FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'accounting.read'));
ALTER TABLE finance.tax_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.tax_codes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.tax_codes TO authenticated;
CREATE POLICY tax_codes_read ON finance.tax_codes FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'tax.read'));
ALTER TABLE finance.items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.items TO authenticated;
CREATE POLICY items_read ON finance.items FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'catalog.read'));
ALTER TABLE finance.cash_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.cash_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.cash_accounts TO authenticated;
CREATE POLICY cash_accounts_read ON finance.cash_accounts FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'banking.read'));
ALTER TABLE finance.document_sequences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.document_sequences FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.document_sequences TO authenticated;
CREATE POLICY document_sequences_read ON finance.document_sequences FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'accounting.read'));
ALTER TABLE finance.business_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.business_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.business_documents TO authenticated;
CREATE POLICY business_documents_read ON finance.business_documents FOR SELECT TO authenticated USING (finance_private.can_read_document(organization_id, id));
ALTER TABLE finance.trade_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.trade_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.trade_documents TO authenticated;
CREATE POLICY trade_documents_read ON finance.trade_documents FOR SELECT TO authenticated USING (finance_private.can_read_document(organization_id, document_id));
ALTER TABLE finance.document_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.document_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.document_lines TO authenticated;
CREATE POLICY document_lines_read ON finance.document_lines FOR SELECT TO authenticated USING (finance_private.can_read_document(organization_id, document_id));
ALTER TABLE finance.money_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.money_movements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.money_movements TO authenticated;
CREATE POLICY money_movements_read ON finance.money_movements FOR SELECT TO authenticated USING (finance_private.can_read_document(organization_id, document_id));
ALTER TABLE finance.transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.transfers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.transfers TO authenticated;
CREATE POLICY transfers_read ON finance.transfers FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'banking.read'));
ALTER TABLE finance.manual_journal_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.manual_journal_rows FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.manual_journal_rows TO authenticated;
CREATE POLICY manual_journal_rows_read ON finance.manual_journal_rows FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'accounting.read'));
ALTER TABLE finance.journal_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.journal_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.journal_entries TO authenticated;
CREATE POLICY journal_entries_read ON finance.journal_entries FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'ledger.read'));
ALTER TABLE finance.journal_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.journal_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.journal_lines TO authenticated;
CREATE POLICY journal_lines_read ON finance.journal_lines FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'ledger.read'));
ALTER TABLE finance.open_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.open_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.open_items TO authenticated;
CREATE POLICY open_items_read ON finance.open_items FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'dues.read') OR (control_kind IN ('ar','customer_advance') AND finance_private.has_permission(organization_id, 'sales.read')) OR (control_kind IN ('ap','vendor_advance') AND finance_private.has_permission(organization_id, 'purchases.read')));
ALTER TABLE finance.document_allocation_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.document_allocation_plans FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.document_allocation_plans TO authenticated;
CREATE POLICY document_allocation_plans_read ON finance.document_allocation_plans FOR SELECT TO authenticated USING (finance_private.can_read_document(organization_id, document_id));
ALTER TABLE finance.settlement_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.settlement_allocations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.settlement_allocations TO authenticated;
CREATE POLICY settlement_allocations_read ON finance.settlement_allocations FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'dues.read'));
ALTER TABLE finance.allocation_reversals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.allocation_reversals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.allocation_reversals TO authenticated;
CREATE POLICY allocation_reversals_read ON finance.allocation_reversals FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'dues.read'));
ALTER TABLE finance.bank_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.bank_imports FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.bank_imports TO authenticated;
CREATE POLICY bank_imports_read ON finance.bank_imports FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'banking.read'));
ALTER TABLE finance.statement_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.statement_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.statement_lines TO authenticated;
CREATE POLICY statement_lines_read ON finance.statement_lines FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'banking.read'));
ALTER TABLE finance.reconciliations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.reconciliations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.reconciliations TO authenticated;
CREATE POLICY reconciliations_read ON finance.reconciliations FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'banking.read'));
ALTER TABLE finance.reconciliation_matches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.reconciliation_matches FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.reconciliation_matches TO authenticated;
CREATE POLICY reconciliation_matches_read ON finance.reconciliation_matches FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'banking.read'));
ALTER TABLE finance.approval_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.approval_policies FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.approval_policies TO authenticated;
CREATE POLICY approval_policies_read ON finance.approval_policies FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'approvals.read'));
ALTER TABLE finance.approval_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.approval_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.approval_requests TO authenticated;
CREATE POLICY approval_requests_read ON finance.approval_requests FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'approvals.read'));
ALTER TABLE finance.approval_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.approval_decisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.approval_decisions TO authenticated;
CREATE POLICY approval_decisions_read ON finance.approval_decisions FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'approvals.read'));
ALTER TABLE finance.attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.attachments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.attachments TO authenticated;
CREATE POLICY attachments_read ON finance.attachments FOR SELECT TO authenticated USING (finance_private.can_read_attachment(organization_id, id));
ALTER TABLE finance.attachment_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.attachment_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.attachment_links TO authenticated;
CREATE POLICY attachment_links_read ON finance.attachment_links FOR SELECT TO authenticated USING (finance_private.can_read_document(organization_id, document_id));
ALTER TABLE finance.audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.audit_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.audit_events TO authenticated;
CREATE POLICY audit_events_read ON finance.audit_events FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'audit.read'));
ALTER TABLE finance.period_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.period_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.period_events TO authenticated;
CREATE POLICY period_events_read ON finance.period_events FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'audit.read'));
ALTER TABLE finance.import_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.import_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.import_jobs TO authenticated;
CREATE POLICY import_jobs_read ON finance.import_jobs FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'imports.read'));
ALTER TABLE finance.import_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.import_rows FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.import_rows TO authenticated;
CREATE POLICY import_rows_read ON finance.import_rows FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'imports.read'));
ALTER TABLE finance.export_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.export_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.export_jobs TO authenticated;
CREATE POLICY export_jobs_read ON finance.export_jobs FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'exports.read'));
ALTER TABLE finance.report_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.report_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.report_snapshots TO authenticated;
CREATE POLICY report_snapshots_read ON finance.report_snapshots FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'reports.read'));
ALTER TABLE finance.idempotency_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.idempotency_requests FROM PUBLIC, anon, authenticated;
ALTER TABLE finance.outbox_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.outbox_events FROM PUBLIC, anon, authenticated;
ALTER TABLE finance.notification_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.notification_deliveries FROM PUBLIC, anon, authenticated;
ALTER TABLE finance.plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.plans FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.plans TO authenticated;
CREATE POLICY plans_read ON finance.plans FOR SELECT TO authenticated USING ((SELECT auth.uid()) IS NOT NULL);
ALTER TABLE finance.subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.subscriptions TO authenticated;
CREATE POLICY subscriptions_read ON finance.subscriptions FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'subscription.read'));
ALTER TABLE finance.billing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.billing_events FROM PUBLIC, anon, authenticated;
ALTER TABLE finance.year_close_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.year_close_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.year_close_runs TO authenticated;
CREATE POLICY year_close_runs_read ON finance.year_close_runs FOR SELECT TO authenticated USING (finance_private.has_permission(organization_id, 'accounting.read'));
CREATE UNIQUE INDEX year_one_live_close_idx ON finance.year_close_runs (organization_id, fiscal_year_id) WHERE reopen_document_id IS NULL;

-- No INSERT, UPDATE, DELETE, or TRUNCATE grant is issued to authenticated or anon.
-- Seed role templates through a trusted onboarding command; granting catalog reads
-- must not be confused with allowing users to grant themselves permissions.
-- IMPORTANT: row-local CHECKs do NOT enforce journal balance, posted immutability,
-- allocation capacities, period locks, or complete subledgers. See DB-G01..DB-G18.
-- Security-definer mutation routines require: auth.uid() verification, live membership,
-- exact action permission, explicit search_path, same-tenant references, actor derivation,
-- period/source/open-item locks, idempotency, audit/outbox and restricted EXECUTE.
COMMIT;
