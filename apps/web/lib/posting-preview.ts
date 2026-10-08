import { parseMoneyString, parseUuid, type MoneyString } from "@ams/contracts";
import type { DocumentPreview } from "@ams/accounting";

export const cashPreviewTypes = ["receipt", "vendor_payment", "customer_refund", "vendor_refund", "customer_advance", "vendor_advance", "transfer"] as const;
export type CashPreviewType = typeof cashPreviewTypes[number];
export interface PostingPreviewLine {
  lineNo: number; accountId: string; accountCode: string | null; accountName: string | null;
  partyName: string | null; description: string; debit: MoneyString; credit: MoneyString;
}
export interface AllocationPreview {
  targetOpenItemId: string; documentNumber: string | null; amount: MoneyString; availableAmount: MoneyString;
}
export interface JournalPostingPreview {
  kind: "journal"; currency: "BDT"; debit: MoneyString; credit: MoneyString; balanced: boolean; lines: PostingPreviewLine[];
}
export interface CashPostingPreview extends Omit<JournalPostingPreview, "kind"> {
  kind: "cash"; sourceType: CashPreviewType; allocations: AllocationPreview[];
  allocatedAmount: MoneyString; unallocatedAmount: MoneyString | null;
}
export interface TradePostingPreview extends DocumentPreview { kind: "trade"; descriptions: string[] }
export interface PostingPreviewResult {
  documentId: string; documentVersion: number;
  preview: CashPostingPreview | JournalPostingPreview | TradePostingPreview;
  warnings: string[];
}

function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid posting preview response.");
  return raw as Record<string, unknown>;
}
function text(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("Invalid posting preview text.");
  return raw;
}
function nullableText(raw: unknown): string | null { return raw === null ? null : text(raw); }
function integer(raw: unknown): number {
  if (!Number.isSafeInteger(raw) || Number(raw) < 1) throw new Error("Invalid posting preview version or row.");
  return Number(raw);
}
function array(raw: unknown, limit = 1000): unknown[] {
  if (!Array.isArray(raw) || raw.length > limit) throw new Error("Invalid posting preview rows.");
  return raw;
}
function amount(raw: unknown): MoneyString {
  const value = parseMoneyString(raw);
  if (value === "-0.00") throw new Error("Invalid posting preview amount.");
  return value;
}
function positiveSide(raw: unknown): MoneyString {
  const value = amount(raw);
  if (value.startsWith("-")) throw new Error("Invalid posting preview debit or credit.");
  return value;
}
function line(raw: unknown): PostingPreviewLine {
  const row = object(raw);
  const debit = positiveSide(row.debit), credit = positiveSide(row.credit);
  if ((debit === "0.00") === (credit === "0.00")) throw new Error("Invalid posting preview line sides.");
  return {
    lineNo: integer(row.lineNo), accountId: parseUuid(row.accountId), accountCode: nullableText(row.accountCode),
    accountName: nullableText(row.accountName), partyName: nullableText(row.partyName), description: text(row.description), debit, credit
  };
}

/** Parse the same public DTO on the server and browser. Money remains canonical text. */
export function parsePostingPreviewResult(raw: unknown): PostingPreviewResult {
  const result = object(raw), preview = object(result.preview);
  if (preview.currency !== "BDT") throw new Error("Invalid posting preview currency.");
  const common = {
    documentId: parseUuid(result.documentId), documentVersion: integer(result.documentVersion),
    warnings: array(result.warnings, 100).map(text)
  };
  if (preview.kind === "trade") {
    const lines = array(preview.lines).map(value => {
      const row = object(value);
      return { base: amount(row.base), discount: amount(row.discount), net: amount(row.net), tax: amount(row.tax), gross: amount(row.gross) };
    });
    const descriptions = array(preview.descriptions).map(text);
    if (!lines.length || descriptions.length !== lines.length) throw new Error("Invalid trade preview lines.");
    return { ...common, preview: { kind: "trade", currency: "BDT", lines, descriptions,
      base: amount(preview.base), discount: amount(preview.discount), net: amount(preview.net), tax: amount(preview.tax),
      gross: amount(preview.gross), rounding_adjustment: amount(preview.rounding_adjustment), total: amount(preview.total) } };
  }
  if (preview.kind !== "cash" && preview.kind !== "journal" || typeof preview.balanced !== "boolean") {
    throw new Error("Unsupported posting preview response.");
  }
  const ledger = { currency: "BDT" as const, debit: positiveSide(preview.debit), credit: positiveSide(preview.credit),
    balanced: preview.balanced, lines: array(preview.lines).map(line) };
  if (preview.kind === "journal") return { ...common, preview: { kind: "journal", ...ledger } };
  if (!(cashPreviewTypes as readonly unknown[]).includes(preview.sourceType) || ledger.lines.length < 2 || ledger.lines.length > 3
    || ledger.debit === "0.00" || ledger.debit !== ledger.credit || !ledger.balanced) throw new Error("Invalid cash posting preview.");
  const allocations = array(preview.allocations, 100).map(value => {
    const row = object(value);
    return { targetOpenItemId: parseUuid(row.targetOpenItemId), documentNumber: nullableText(row.documentNumber),
      amount: positiveSide(row.amount), availableAmount: positiveSide(row.availableAmount) };
  });
  return { ...common, preview: { kind: "cash", ...ledger, sourceType: preview.sourceType as CashPreviewType, allocations,
    allocatedAmount: positiveSide(preview.allocatedAmount), unallocatedAmount: preview.unallocatedAmount === null ? null : positiveSide(preview.unallocatedAmount) } };
}

export function parseCashPreviewDatabaseResult(raw: unknown, documentId: string, documentVersion: number): PostingPreviewResult {
  const row = object(raw);
  if (row.document_id !== documentId || row.document_version !== documentVersion) throw new Error("Posting preview source changed.");
  return parsePostingPreviewResult({ documentId, documentVersion, preview: {
    kind: "cash", sourceType: row.document_type, currency: row.currency, debit: row.debit, credit: row.credit, balanced: row.balanced,
    lines: array(row.lines, 3).map(value => {
      const entry = object(value);
      return { lineNo: entry.line_no, accountId: entry.account_id, accountCode: entry.account_code, accountName: entry.account_name,
        partyName: entry.party_name, description: entry.description, debit: entry.debit, credit: entry.credit };
    }),
    allocations: array(row.allocations, 100).map(value => {
      const entry = object(value);
      return { targetOpenItemId: entry.target_open_item_id, documentNumber: entry.document_number,
        amount: entry.amount, availableAmount: entry.available_amount };
    }),
    allocatedAmount: row.allocated_amount, unallocatedAmount: row.unallocated_amount
  }, warnings: ["Preview only. Posting rechecks permissions, approval, accounting period and available settlement amounts."] });
}
