import { parseMoneyString, parseUuid } from "@ams/contracts";
import { capability } from "@ams/permissions";
import { CommandError } from "../commands/errors.ts";
import type { OrganizationCommandDefinition } from "../commands/types.ts";
import { record, validateDraftDocument, type DraftDocument } from "../documents/contracts.ts";
import type { RequestClient } from "../request-client.ts";
import { setupDatabaseError } from "./setup.ts";

type BalanceRow = { account_id: string; debit: string; credit: string };
export type OpeningDraftInput = {
  documentId: string | null; expectedVersion: number | null; draft: DraftDocument;
  priorTrialBalance: BalanceRow[]; ytdSummary: BalanceRow[]; evidenceReference: string;
};
export type OpeningDraftReceipt = { documentId: string; documentVersion: number; state: string };

function rows(raw: unknown, field: string): BalanceRow[] {
  if (!Array.isArray(raw) || raw.length > 500) throw CommandError.validation({ [field]: "Use up to 500 exact trial-balance rows." });
  return raw.map(item => {
    const value = record(item, field);
    if (Object.keys(value).length !== 3 || Object.keys(value).some(key => !["account_id", "debit", "credit"].includes(key))) throw CommandError.validation({ [field]: "Provide account, debit and credit only." });
    return { account_id: parseUuid(value.account_id), debit: parseMoneyString(value.debit), credit: parseMoneyString(value.credit) };
  });
}
export function validateOpeningDraft(raw: unknown): OpeningDraftInput {
  const value = record(raw);
  if (Object.keys(value).some(key => !["document_id", "expected_version", "draft", "prior_trial_balance", "ytd_summary", "evidence_reference"].includes(key))) throw CommandError.validation({ body: "Unexpected field." });
  const documentId = value.document_id === null ? null : parseUuid(value.document_id);
  if ((documentId === null && value.expected_version !== null) ||
      (documentId !== null && (!Number.isSafeInteger(value.expected_version) || Number(value.expected_version) < 1))) throw CommandError.validation({ expected_version: "Refresh the opening draft before saving." });
  const draft = validateDraftDocument(value.draft);
  if (draft.documentType !== "opening_balance" || draft.journalRows.length < 2 || draft.roundingAdjustment !== "0.00") throw CommandError.validation({ draft: "Provide an opening-balance journal with at least two rows and no rounding adjustment." });
  if (typeof value.evidence_reference !== "string" || value.evidence_reference.trim().length < 1 || value.evidence_reference.trim().length > 500) throw CommandError.validation({ evidence_reference: "Enter the prior trial-balance source reference." });
  const priorTrialBalance = rows(value.prior_trial_balance, "prior_trial_balance");
  if (!priorTrialBalance.length) throw CommandError.validation({ prior_trial_balance: "Enter the prior trial balance." });
  return { documentId, expectedVersion: documentId === null ? null : Number(value.expected_version), draft, priorTrialBalance,
    ytdSummary: rows(value.ytd_summary, "ytd_summary"), evidenceReference: value.evidence_reference.trim() };
}
export function openingDraftPayload(draft: DraftDocument): Record<string, unknown> {
  return { document_type: "opening_balance", party_id: null, issue_date: draft.issueDate, accounting_date: draft.accountingDate,
    due_date: null, external_reference: draft.externalReference, description: draft.description, currency: "BDT",
    rounding_adjustment: "0.00", rounding_reason: null, rounding_account_id: null, trade: null, movement: null, transfer: null,
    lines: [], journal_rows: draft.journalRows, allocation_plan: [] };
}
export function saveOpeningDraftCommand(client: Pick<RequestClient, "rpc">): OrganizationCommandDefinition<OpeningDraftInput, OpeningDraftReceipt> {
  return { operation: "opening-cutover.save", capability: capability("journal.write"), idempotency: "required", validate: validateOpeningDraft,
    async execute(context, input) {
      if (!context.actor.capabilities.includes("documents.read") || !context.actor.capabilities.includes("accounting.read")) throw CommandError.forbidden();
      if (!context.idempotencyKey) throw CommandError.validation({ idempotency_key: "Retry with a stable request key." });
      const result = await client.rpc("save_opening_cutover_draft", {
        p_organization_id: context.actor.organizationId, p_document_id: input.documentId, p_expected_version: input.expectedVersion,
        p_request_id: context.requestId, p_idempotency_key: context.idempotencyKey, p_request_hash: context.requestHash,
        p_payload: openingDraftPayload(input.draft), p_prior_trial_balance: input.priorTrialBalance, p_ytd_summary: input.ytdSummary,
        p_evidence_reference: input.evidenceReference
      });
      if (result.error) throw setupDatabaseError(result.error);
      const value = record(result.data);
      if (!Number.isSafeInteger(value.document_version) || Number(value.document_version) < 1 || typeof value.state !== "string") throw new Error("Malformed opening-draft receipt.");
      return { documentId: parseUuid(value.document_id), documentVersion: Number(value.document_version), state: value.state };
    } };
}
