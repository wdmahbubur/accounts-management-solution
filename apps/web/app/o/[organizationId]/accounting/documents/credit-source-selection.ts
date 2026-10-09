import { calculateLine, decimal6, moneyUnits } from "@ams/accounting";
import { parseMoneyString, parseUuid } from "@ams/contracts";
import type { CreditNoteOptions, CreditSource, CreditSourceLine } from "../../../../../server/documents/credit-notes.ts";
import { canonicalAmountInput, type DraftFieldIssue, type TradeLineInput } from "./draft-calculations.ts";

export interface CreditSelectionScope { organizationId: string; documentType: string; accountingDate: string; partyId: string; sourceId: string }
type CreditSelectionLine = TradeLineInput & { account_id: string; cost_center_id: string | null };

/** Keep an unresolved original available for retry; only a known party mismatch excludes it. */
export function creditSourceIdForLookup(originalDocumentId: string, originalPartyId: string | null | undefined, selectedPartyId: string): string {
  return originalPartyId && selectedPartyId && originalPartyId !== selectedPartyId ? "" : originalDocumentId;
}

/** Validate the scoped data used by the picker before it can replace source metadata. */
export function parseCreditOptions(value: unknown, scope: CreditSelectionScope): CreditNoteOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Original documents could not be loaded.");
  const data = value as CreditNoteOptions;
  if (data.organizationId !== scope.organizationId || data.documentType !== scope.documentType || data.accountingDate !== scope.accountingDate ||
    !Array.isArray(data.sources) || typeof data.hasMore !== "boolean") throw new Error("The original document list does not match this credit.");
  const summary = (source: CreditNoteOptions["sources"][number]) => {
    parseUuid(source.id); parseUuid(source.partyId); parseMoneyString(source.totalAmount);
    if (typeof source.partyName !== "string" || typeof source.eligible !== "boolean" ||
      (source.documentNumber !== null && typeof source.documentNumber !== "string") ||
      (source.supplierReference !== null && typeof source.supplierReference !== "string") ||
      (source.blockedReason !== null && typeof source.blockedReason !== "string") ||
      typeof source.issueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(source.issueDate) ||
      typeof source.accountingDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(source.accountingDate) ||
      (scope.partyId && source.partyId !== scope.partyId)) throw new Error("An original document does not match the selected party.");
  };
  data.sources.forEach(summary);
  if (data.selectedSource !== null) {
    const source = data.selectedSource;
    summary(source);
    parseMoneyString(source.remainingTotalAmount);
    if (source.id !== scope.sourceId || !Array.isArray(source.lines)) throw new Error("The selected original document is unavailable.");
    const seen = new Set<string>();
    for (const line of source.lines) {
      parseUuid(line.id); parseUuid(line.accountId);
      for (const nullable of [line.itemId, line.costCenterId, line.taxCodeId, line.taxAccountId]) if (nullable !== null) parseUuid(nullable);
      if (seen.has(line.id) || !Number.isSafeInteger(line.lineNo) || line.lineNo < 1 || typeof line.description !== "string" ||
        typeof line.accountCode !== "string" || typeof line.accountName !== "string" || typeof line.eligible !== "boolean" ||
        !["inclusive", "exclusive"].includes(line.taxMode)) throw new Error("An original line is unavailable.");
      seen.add(line.id);
      for (const amount of [line.discountAmount, line.netAmount, line.taxAmount, line.grossAmount, line.remainingNetAmount, line.remainingTaxAmount, line.remainingGrossAmount]) parseMoneyString(amount);
      for (const amount of [line.quantity, line.unitPrice, line.taxRateSnapshot, line.remainingQuantity]) decimal6(amount);
    }
  }
  return data;
}

export function creditSelectionIssues(scope: CreditSelectionScope, options: CreditNoteOptions | null, lines: readonly CreditSelectionLine[], roundingAmount = "0.00"): DraftFieldIssue[] {
  const issues: DraftFieldIssue[] = [];
  const source = options?.selectedSource;
  if (!scope.sourceId || !source || source.id !== scope.sourceId || source.partyId !== scope.partyId ||
    options?.organizationId !== scope.organizationId || options.documentType !== scope.documentType || options.accountingDate !== scope.accountingDate) {
    return [{ field: "original_document_id", message: "Choose and refresh the original posted invoice or bill for this party and accounting date. Your credit lines are preserved." }];
  }
  if (!source.eligible) return [{ field: "original_document_id", message: source.blockedReason ?? "This original document is not eligible for a new credit." }];
  const originals = new Map<string, CreditSourceLine>(source.lines.map(line => [line.id, line]));
  const used = new Map<string, { quantity: bigint; net: bigint; tax: bigint; gross: bigint }>();
  lines.forEach((line, index) => {
    const prefix = `lines.${index + 1}`;
    const original = line.original_line_id ? originals.get(line.original_line_id) : undefined;
    if (!original || !original.eligible) {
      issues.push({ field: `${prefix}.original_line_id`, message: original?.blockedReason ?? "Choose an eligible line from the selected original document." }); return;
    }
    if (line.account_id !== original.accountId || line.cost_center_id !== original.costCenterId) {
      issues.push({ field: `${prefix}.original_line_id`, message: "Restore this line’s original account and cost center before saving. Your entered amounts can stay unchanged." });
    }
    try {
      const amounts = calculateLine({ quantity: line.quantity, unit_price: line.unit_price,
        discount_amount: canonicalAmountInput(line.discount_amount), tax_rate: original.taxRateSnapshot, tax_mode: original.taxMode });
      const prior = used.get(original.id) ?? { quantity: 0n, net: 0n, tax: 0n, gross: 0n };
      const next = { quantity: prior.quantity + decimal6(line.quantity), net: prior.net + moneyUnits(amounts.net),
        tax: prior.tax + moneyUnits(amounts.tax), gross: prior.gross + moneyUnits(amounts.gross) };
      used.set(original.id, next);
      if (next.quantity > decimal6(original.remainingQuantity)) issues.push({ field: `${prefix}.quantity`, message: `Only ${original.remainingQuantity} remains available to credit on this original line.` });
      if (next.net > moneyUnits(original.remainingNetAmount) || next.tax > moneyUnits(original.remainingTaxAmount) || next.gross > moneyUnits(original.remainingGrossAmount)) {
        issues.push({ field: `${prefix}.unit_price`, message: `The credit exceeds the remaining original amounts: net ${original.remainingNetAmount}, tax ${original.remainingTaxAmount}, total ${original.remainingGrossAmount} BDT. Adjust the quantity, unit price or discount.` });
      }
    } catch { issues.push({ field: `${prefix}.quantity`, message: "Check this line’s quantity, unit price and discount before saving." }); }
  });
  if (!lines.length) issues.push({ field: "lines", message: "Select at least one original line to credit." });
  try {
    const total = [...used.values()].reduce((sum, line) => sum + line.gross, 0n) + moneyUnits(canonicalAmountInput(roundingAmount, true));
    if (total > moneyUnits(source.remainingTotalAmount)) issues.push({ field: "rounding_adjustment", message: `The total credit, including rounding, cannot exceed the original document’s remaining ${source.remainingTotalAmount} BDT.` });
  } catch { issues.push({ field: "rounding_adjustment", message: "Enter a valid rounding adjustment." }); }
  return issues;
}

/** A new draft line inherits posted business values, never a posted line's identity. */
export function creditLineValues(line: CreditSourceLine) {
  return { id: null, original_line_id: line.id, item_id: line.itemId, item_snapshot: null,
    description: line.description, quantity: line.quantity, unit_price: line.unitPrice, discount_amount: line.discountAmount,
    account_id: line.accountId, cost_center_id: line.costCenterId,
    cost_center_snapshot: line.costCenterId ? { id: line.costCenterId, code: line.costCenterCode, name: line.costCenterName } : null,
    tax_code_id: line.taxCodeId, tax_mode: line.taxMode };
}

export function originalCreditTaxes(source: CreditSource | null) {
  return source?.lines.map(line => ({ original_line_id: line.id, tax_rate_snapshot: line.taxRateSnapshot, tax_mode: line.taxMode })) ?? [];
}
