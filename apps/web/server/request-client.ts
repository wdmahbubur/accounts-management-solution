import "server-only";

import { auth } from "../../../auth.ts";
import { withActorTransaction } from "./database.ts";

const procedures = new Set([
  "authorize_artifact_download",
  "create_attachment_upload_intent",
  "complete_attachment_upload",
  "create_company_atomic",
  "save_financial_document",
  "save_document_allocation_plan",
  "read_financial_document",
  "list_document_draft_options",
  "create_custom_role",
  "deactivate_member",
  "get_own_profile",
  "issue_company_invitation",
  "list_active_memberships",
  "list_accounts_for_management",
  "list_company_invitations",
  "list_tax_codes",
  "list_tax_mapping_accounts",
  "list_open_items",
  "allocate_open_items",
  "reverse_open_item_allocation",
  "list_approval_policies",
  "list_approval_policy_roles",
  "save_approval_policy",
  "submit_financial_document",
  "decide_financial_approval",
  "list_approval_inbox",
  "read_approval_review",
  "post_financial_document",
  "post_write_off_document",
  "save_write_off_draft",
  "list_write_off_options",
  "reverse_posted_document",
  "read_contact_directory",
  "read_contact_profile",
  "save_contact",
  "list_service_catalog",
  "save_service_item",
  "save_cost_center",
  "read_invoice_register",
  "read_invoice_lifecycle",
  "read_invoice_pdf_version",
  "register_invoice_pdf_version",
  "read_receipt_allocation_options",
  "read_receipt_register",
  "read_receipt_lifecycle",
  "read_bill_register",
  "list_cash_account_options",
  "read_cash_accounts",
  "save_cash_account",
  "archive_cash_account",
  "read_cash_account_ledger",
  "read_transfer_register",
  "read_journal_register",
  "list_report_accounts",
  "list_ledger_cost_centers",
  "read_general_ledger",
  "read_general_ledger_opening",
  "read_trial_balance",
  "list_members_for_management",
  "list_roles_for_management",
  "read_document_directory",
  "resolve_active_membership",
  "respond_company_invitation",
  "reopen_accounting_period",
  "resend_company_invitation",
  "revoke_company_invitation",
  "set_member_roles",
  "save_account",
  "set_account_mapping",
  "create_tax_code_version",
  "archive_tax_code_version",
  "transfer_ownership",
  "update_custom_role",
  "update_own_profile",
  "list_accounting_periods",
  "read_period_close_checklist",
  "list_period_close_events",
  "lock_accounting_period",
  "import_bank_statement_rows",
  "count_statement_fingerprint_matches",
  "create_reconciliation",
  "read_reconciliation_workspace",
  "add_reconciliation_match",
  "reverse_reconciliation_match",
  "list_operational_cash_accounts",
  "finalize_reconciliation",
  "reopen_reconciliation",
  "list_opening_cutover_options",
  "save_opening_cutover_summary",
  "read_opening_cutover_summary",
  "read_report_snapshot",
  "list_profit_loss_options",
  "read_profit_loss_snapshot",
  "read_balance_sheet_snapshot",
  "read_aging_snapshot",
  "list_statement_parties",
  "read_party_statement_snapshot",
  "read_cash_flow_snapshot",
  "read_finance_dashboard",
  "request_trial_balance_export",
  "list_own_export_jobs",
  "search_audit_events",
  "read_year_close_preview",
  "list_year_close_workspace",
  "close_fiscal_year",
  "reopen_fiscal_year"
]);

export type DatabaseError = { code?: string; message?: string };
export type RpcResult = { data: unknown; error: DatabaseError | null };
export type RequestUser = { id: string; email?: string | null; last_sign_in_at?: string | null };

export interface RequestClient {
  auth: {
    // PromiseLike keeps provider-independent service adapters easy to mock while Auth.js remains the implementation.
    getUser(): PromiseLike<{ data: { user: RequestUser | null }; error: DatabaseError | null }>;
  };
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<RpcResult>;
}

function quoteArgumentName(name: string): string {
  if (!/^p_[a-z][a-z0-9_]*$/.test(name)) throw new Error("Unsupported database command argument.");
  return `"${name}"`;
}

export function createRequestClient(): RequestClient {
  return {
    auth: {
      async getUser() {
        const session = await auth();
        if (!session?.user?.id) return { data: { user: null }, error: null };
        return {
          data: {
            user: {
              id: session.user.id,
              email: session.user.email ?? null,
              last_sign_in_at: session.user.signedInAt || null
            }
          },
          error: null
        };
      }
    },
    async rpc(name, args = {}) {
      if (!procedures.has(name)) return { data: null, error: { code: "42883", message: "Unknown database command." } };
      const session = await auth();
      if (!session?.user?.id) return { data: null, error: { code: "28000", message: "Authentication required." } };

      try {
        return await withActorTransaction(session.user.id, async (client) => {
          const names = Object.keys(args);
          const signature = await client.query<{
            returns_set: boolean;
            argument_names: string[] | null;
          }>(
            `SELECT p.proretset AS returns_set,
                    p.proargnames[1:p.pronargs] AS argument_names
             FROM pg_catalog.pg_proc p
             JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = $1 AND p.prokind = 'f'`,
            [name]
          );
          const match = signature.rows.find((row) => {
            const expected = row.argument_names ?? [];
            return expected.length === names.length && expected.every((item) => names.includes(item));
          });
          if (!match) return { data: null, error: { code: "42883", message: "Database command signature not found." } };

          const ordered = names.map((key) => [key, args[key]] as const);
          const call = `public."${name}"(${ordered.map(([key], index) => `${quoteArgumentName(key)} => $${index + 1}`).join(", ")})`;
          const values = ordered.map(([, value]) => value);
          if (match.returns_set) {
            const result = await client.query(`SELECT * FROM ${call}`, values);
            return { data: result.rows, error: null };
          }

          const result = await client.query(`SELECT ${call} AS value`, values);
          return { data: result.rows[0]?.value ?? null, error: null };
        });
      } catch (error) {
        const databaseError = error as { code?: unknown; message?: unknown };
        return {
          data: null,
          error: {
            ...(typeof databaseError.code === "string" ? { code: databaseError.code } : {}),
            ...(typeof databaseError.message === "string" ? { message: databaseError.message } : {})
          }
        };
      }
    }
  };
}
