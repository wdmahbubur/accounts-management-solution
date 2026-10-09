import { parseMoneyString, parseOrganizationId, parseUuid, type OrganizationId, type Uuid } from "@ams/contracts";
import type { ActorContext } from "../auth/types.ts";
import { CommandError } from "../commands/errors.ts";
import type { RequestClient } from "../request-client.ts";
import { documentDatabaseError } from "./contracts.ts";

export type CreditNoteType = "customer_credit" | "vendor_credit";

export interface CreditSourceSummary {
  id: Uuid;
  documentNumber: string | null;
  partyId: Uuid;
  partyName: string;
  issueDate: string;
  accountingDate: string;
  supplierReference: string | null;
  totalAmount: string;
  eligible: boolean;
  blockedReason: string | null;
}

export interface CreditSourceLine {
  id: Uuid;
  lineNo: number;
  description: string;
  itemId: Uuid | null;
  accountId: Uuid;
  accountCode: string;
  accountName: string;
  costCenterId: Uuid | null;
  costCenterCode: string | null;
  costCenterName: string | null;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  netAmount: string;
  taxAmount: string;
  grossAmount: string;
  taxCodeId: Uuid | null;
  taxLabelSnapshot: string | null;
  taxRateSnapshot: string;
  taxMode: "inclusive" | "exclusive";
  taxRecoverabilitySnapshot: string;
  taxAccountId: Uuid | null;
  remainingQuantity: string;
  remainingNetAmount: string;
  remainingTaxAmount: string;
  remainingGrossAmount: string;
  eligible: boolean;
  blockedReason: string | null;
}

export interface CreditSource extends CreditSourceSummary {
  partySnapshot: Record<string, unknown>;
  recognitionMode: string;
  remainingTotalAmount: string;
  lines: CreditSourceLine[];
}

export interface CreditNoteOptions {
  organizationId: OrganizationId;
  documentType: CreditNoteType;
  accountingDate: string;
  sources: CreditSourceSummary[];
  selectedSource: CreditSource | null;
  hasMore: boolean;
}

export interface CreditNoteOptionFilters {
  documentType: CreditNoteType;
  accountingDate: string;
  partyId?: string | null;
  originalDocumentId?: string | null;
  search?: string | null;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid credit source response.");
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid credit source text.");
  return value;
}

function nullableText(value: unknown): string | null { return value === null ? null : text(value); }
function nullableId(value: unknown): Uuid | null { return value === null ? null : parseUuid(value); }
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid credit source eligibility.");
  return value;
}
function exactAmount(value: unknown): string {
  const amount = parseMoneyString(value);
  if (amount.startsWith("-")) throw new Error("Invalid credit source amount.");
  return amount;
}
function decimal(value: unknown): string {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,13})(?:\.\d{1,6})?$/.test(value)) throw new Error("Invalid credit source decimal.");
  return value;
}
function calendarDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid credit source date.");
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Invalid credit source date.");
  return value;
}

function parseSummary(value: unknown): CreditSourceSummary {
  const row = object(value);
  return {
    id: parseUuid(row.id), documentNumber: nullableText(row.document_number), partyId: parseUuid(row.party_id),
    partyName: text(row.party_name), issueDate: calendarDate(row.issue_date), accountingDate: calendarDate(row.accounting_date),
    supplierReference: nullableText(row.supplier_reference), totalAmount: exactAmount(row.total_amount),
    eligible: boolean(row.eligible), blockedReason: nullableText(row.blocked_reason)
  };
}

function parseLine(value: unknown): CreditSourceLine {
  const row = object(value);
  if (!Number.isSafeInteger(row.line_no) || Number(row.line_no) < 1 || !["exclusive", "inclusive"].includes(String(row.tax_mode))) {
    throw new Error("Invalid original credit line.");
  }
  return {
    id: parseUuid(row.id), lineNo: Number(row.line_no), description: text(row.description), itemId: nullableId(row.item_id),
    accountId: parseUuid(row.account_id), accountCode: text(row.account_code), accountName: text(row.account_name),
    costCenterId: nullableId(row.cost_center_id), costCenterCode: nullableText(row.cost_center_code), costCenterName: nullableText(row.cost_center_name),
    quantity: decimal(row.quantity), unitPrice: decimal(row.unit_price), discountAmount: exactAmount(row.discount_amount),
    netAmount: exactAmount(row.net_amount), taxAmount: exactAmount(row.tax_amount), grossAmount: exactAmount(row.gross_amount),
    taxCodeId: nullableId(row.tax_code_id), taxLabelSnapshot: nullableText(row.tax_label_snapshot), taxRateSnapshot: decimal(row.tax_rate_snapshot),
    taxMode: row.tax_mode as CreditSourceLine["taxMode"], taxRecoverabilitySnapshot: text(row.tax_recoverability_snapshot), taxAccountId: nullableId(row.tax_account_id),
    remainingQuantity: decimal(row.remaining_quantity), remainingNetAmount: exactAmount(row.remaining_net_amount),
    remainingTaxAmount: exactAmount(row.remaining_tax_amount), remainingGrossAmount: exactAmount(row.remaining_gross_amount),
    eligible: boolean(row.eligible), blockedReason: nullableText(row.blocked_reason)
  };
}

/** Read immutable issued source data. Drafts and approvals never reserve credit capacity. */
export async function readCreditNoteOptions(
  client: Pick<RequestClient, "rpc">, actor: ActorContext, input: CreditNoteOptionFilters
): Promise<CreditNoteOptions> {
  if (!["customer_credit", "vendor_credit"].includes(input.documentType)) {
    throw CommandError.validation({ document_type: "Choose a customer or supplier credit note." });
  }
  const permission = input.documentType === "customer_credit" ? "sales.read" : "purchases.read";
  if (!actor.capabilities.includes(permission)) throw CommandError.forbidden();
  let accountingDate: string;
  try { accountingDate = calendarDate(input.accountingDate); }
  catch { throw CommandError.validation({ accounting_date: "Choose a valid accounting date." }); }
  const partyId = input.partyId ? parseUuid(input.partyId, "party_id") : null;
  const originalDocumentId = input.originalDocumentId ? parseUuid(input.originalDocumentId, "original_document_id") : null;
  if (input.search !== undefined && input.search !== null && (typeof input.search !== "string" || input.search.length > 100)) {
    throw CommandError.validation({ search: "Use up to 100 characters to find an original invoice or bill." });
  }
  const result = await client.rpc("read_credit_note_options", {
    p_organization_id: actor.organizationId, p_document_type: input.documentType, p_accounting_date: accountingDate,
    p_party_id: partyId, p_original_document_id: originalDocumentId, p_search: input.search?.trim() || null
  });
  if (result.error) throw documentDatabaseError(result.error);
  const data = object(result.data);
  if (data.organization_id !== actor.organizationId || data.document_type !== input.documentType || data.accounting_date !== accountingDate
    || !Array.isArray(data.sources) || data.sources.length > 100) throw new Error("Invalid credit options response.");
  const sources = data.sources.map(parseSummary);
  if (new Set(sources.map(source => source.id)).size !== sources.length || partyId && sources.some(source => source.partyId !== partyId)) {
    throw new Error("Invalid credit source selection.");
  }
  let selectedSource: CreditSource | null = null;
  if (data.selected_source !== null) {
    const selected = object(data.selected_source);
    if (!Array.isArray(selected.lines) || selected.lines.length > 500) throw new Error("Invalid original credit lines.");
    const lines = selected.lines.map(parseLine);
    selectedSource = { ...parseSummary(selected), partySnapshot: object(selected.party_snapshot), recognitionMode: text(selected.recognition_mode),
      remainingTotalAmount: exactAmount(selected.remaining_total_amount), lines };
    if (selectedSource.id !== originalDocumentId || partyId && selectedSource.partyId !== partyId
      || new Set(lines.map(line => line.id)).size !== lines.length) throw new Error("Invalid selected credit source.");
  } else if (originalDocumentId) throw new Error("The requested original credit source was not returned.");
  return { organizationId: parseOrganizationId(data.organization_id), documentType: input.documentType, accountingDate,
    sources, selectedSource, hasMore: boolean(data.has_more) };
}
