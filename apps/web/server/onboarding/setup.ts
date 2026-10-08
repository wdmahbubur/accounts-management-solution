import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { capability } from "@ams/permissions";
import type { ActorContext } from "../auth/types.ts";
import { CommandError, retryableTransactionError } from "../commands/errors.ts";
import type { OrganizationCommandDefinition } from "../commands/types.ts";
import { record } from "../documents/contracts.ts";
import type { RequestClient } from "../request-client.ts";

export type OpeningMode = "zero_opening" | "import_opening";
export type SetupCheck = { code: string; required: boolean; ready: boolean; message: string };
export type OpeningDocument = {
  id: string; version: number; state: string; description: string;
  accountingDate: string; totalAmount: string; hasCutoverSummary: boolean;
};
export type CompanySetup = {
  organizationId: string; name: string; status: string; booksStartDate: string; cutoverDate: string;
  checks: SetupCheck[]; zeroOpeningAvailable: boolean; openingDocuments: OpeningDocument[];
  completion: { openingMode: OpeningMode; openingDocumentId: string | null; completedAt: string } | null;
};
export type CompleteSetupInput = {
  openingMode: OpeningMode; zeroOpeningConfirmed: boolean; openingDocumentId: string | null; expectedDocumentVersion: number | null;
};
export type CompleteSetupReceipt = {
  organizationId: string; status: "active"; openingMode: OpeningMode; completedAt: string;
  openingDocumentId: string | null; openingDocumentNumber: string | null;
};
type RpcClient = Pick<RequestClient, "rpc">;
const modes: readonly string[] = ["zero_opening", "import_opening"];
const checkCodes = ["company_profile", "account_mappings", "fiscal_calendar", "opening_period", "cash_account", "invoice_policy", "receipt_policy", "purchase_policies"];

function date(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function timestamp(value: unknown): value is string {
  return typeof value === "string" && value.includes("T") && Number.isFinite(Date.parse(value));
}
function responseObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Malformed company setup response.");
  return value as Record<string, unknown>;
}
export function parseCompanySetup(raw: unknown): CompanySetup {
  const value = responseObject(raw);
  if (typeof value.name !== "string" || !["onboarding", "active", "read_only", "archived"].includes(String(value.status)) ||
      !date(value.books_start_date) || !date(value.cutover_date) || !Array.isArray(value.checks) || !Array.isArray(value.opening_documents) ||
      typeof value.zero_opening_available !== "boolean") throw new Error("Malformed company setup response.");
  const seen = new Set<string>();
  const checks = value.checks.map(item => {
    const check = responseObject(item);
    if (typeof check.code !== "string" || !checkCodes.includes(check.code) || seen.has(check.code) || typeof check.required !== "boolean" ||
        typeof check.ready !== "boolean" || typeof check.message !== "string") throw new Error("Malformed company setup check.");
    seen.add(check.code);
    return { code: check.code, required: check.required, ready: check.ready, message: check.message };
  });
  if (checks.length !== checkCodes.length) throw new Error("Incomplete company setup checks.");
  const openingDocuments = value.opening_documents.map(item => {
    const document = responseObject(item);
    if (!Number.isSafeInteger(document.version) || Number(document.version) < 1 || typeof document.state !== "string" ||
        typeof document.description !== "string" || !date(document.accounting_date) || typeof document.total_amount !== "string" ||
        !/^(0|[1-9]\d*)\.\d{2}$/.test(document.total_amount) || typeof document.has_cutover_summary !== "boolean") throw new Error("Malformed opening document.");
    return { id: parseUuid(document.id), version: Number(document.version), state: document.state, description: document.description,
      accountingDate: document.accounting_date, totalAmount: document.total_amount, hasCutoverSummary: document.has_cutover_summary };
  });
  let completion: CompanySetup["completion"] = null;
  if (value.completion !== null) {
    const completed = responseObject(value.completion);
    if (!modes.includes(String(completed.opening_mode)) || !timestamp(completed.completed_at)) throw new Error("Malformed setup completion.");
    completion = { openingMode: completed.opening_mode as OpeningMode, completedAt: completed.completed_at,
      openingDocumentId: completed.opening_document_id === null ? null : parseUuid(completed.opening_document_id) };
  }
  return { organizationId: parseOrganizationId(value.organization_id), name: value.name, status: String(value.status), booksStartDate: value.books_start_date,
    cutoverDate: value.cutover_date, checks, zeroOpeningAvailable: value.zero_opening_available, openingDocuments, completion };
}

export function validateCompleteSetup(raw: unknown): CompleteSetupInput {
  const value = record(raw);
  if (Object.keys(value).some(key => !["opening_mode", "zero_opening_confirmed", "opening_document_id", "expected_document_version"].includes(key)) ||
      !modes.includes(String(value.opening_mode)) || typeof value.zero_opening_confirmed !== "boolean") {
    throw CommandError.validation({ setup: "Choose how these books begin." });
  }
  if (value.opening_mode === "zero_opening") {
    if (value.zero_opening_confirmed !== true || value.opening_document_id !== null || value.expected_document_version !== null) {
      throw CommandError.validation({ setup: "Confirm that no balances or outstanding items precede books start." });
    }
    return { openingMode: "zero_opening", zeroOpeningConfirmed: true, openingDocumentId: null, expectedDocumentVersion: null };
  }
  if (value.zero_opening_confirmed || !Number.isSafeInteger(value.expected_document_version) || Number(value.expected_document_version) < 1) {
    throw CommandError.validation({ setup: "Select the current approved opening document." });
  }
  return { openingMode: "import_opening", zeroOpeningConfirmed: false, openingDocumentId: parseUuid(value.opening_document_id),
    expectedDocumentVersion: Number(value.expected_document_version) };
}

export function parseCompleteSetupReceipt(raw: unknown): CompleteSetupReceipt {
  const value = responseObject(raw);
  if (value.status !== "active" || !modes.includes(String(value.opening_mode)) || !timestamp(value.completed_at) ||
      (value.opening_document_number !== null && typeof value.opening_document_number !== "string")) throw new Error("Malformed setup completion receipt.");
  const openingDocumentId = value.opening_document_id === null ? null : parseUuid(value.opening_document_id);
  if ((value.opening_mode === "zero_opening" && (openingDocumentId !== null || value.opening_document_number !== null)) ||
      (value.opening_mode === "import_opening" && (!openingDocumentId || !value.opening_document_number))) throw new Error("Incomplete opening posting receipt.");
  return { organizationId: parseOrganizationId(value.organization_id), status: "active", openingMode: value.opening_mode as OpeningMode,
    completedAt: value.completed_at, openingDocumentId, openingDocumentNumber: value.opening_document_number as string | null };
}

export function setupDatabaseError(error: { code?: string; message?: string }): Error {
  const retryable = retryableTransactionError(error);
  if (retryable) return retryable;
  if (error.code === "28000") return CommandError.unauthenticated();
  if (error.code === "42501") return CommandError.forbidden();
  if (error.code === "P0002") return CommandError.notFound();
  if (error.code === "P0001") return CommandError.conflict("APPROVAL_REQUIRED");
  if (error.code === "40001") return CommandError.conflict("STALE_VERSION");
  if (error.code === "55P03") return CommandError.conflict("PERIOD_LOCKED");
  if (error.code === "23505") return CommandError.conflict("IDEMPOTENCY_CONFLICT");
  if (["22023", "23514", "23503", "22P02"].includes(error.code ?? "")) return CommandError.validation({ setup: error.message ?? "Review the company setup and opening evidence." });
  return new Error("Company setup could not be completed.");
}

export async function readCompanySetup(client: RpcClient, actor: ActorContext): Promise<CompanySetup> {
  if (!actor.capabilities.includes("company.update")) throw CommandError.forbidden();
  const result = await client.rpc("read_company_setup", { p_organization_id: actor.organizationId });
  if (result.error) throw setupDatabaseError(result.error);
  return parseCompanySetup(result.data);
}

export function completeCompanySetupCommand(client: RpcClient): OrganizationCommandDefinition<CompleteSetupInput, CompleteSetupReceipt> {
  return { operation: "company.setup.complete", capability: capability("company.update"), idempotency: "required", validate: validateCompleteSetup,
    async execute(context, input) {
      if (!context.idempotencyKey) throw CommandError.validation({ idempotency_key: "Retry with a stable request key." });
      if (input.openingMode === "import_opening" && !context.actor.capabilities.includes("journal.post")) throw CommandError.forbidden();
      const result = await client.rpc("complete_company_setup", {
        p_organization_id: context.actor.organizationId, p_request_id: context.requestId, p_idempotency_key: context.idempotencyKey, p_request_hash: context.requestHash,
        p_opening_mode: input.openingMode, p_zero_opening_confirmed: input.zeroOpeningConfirmed, p_opening_document_id: input.openingDocumentId,
        p_expected_document_version: input.expectedDocumentVersion
      });
      if (result.error) throw setupDatabaseError(result.error);
      return parseCompleteSetupReceipt(result.data);
    } };
}
