import { formatMoney, moneyUnits } from "@ams/accounting";
import { parseMoneyString } from "@ams/contracts";
import { formatContactDetails } from "../../lib/contact-details.ts";

export type DetailRecord = Record<string, unknown>;

export function detailRecord(value: unknown): DetailRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as DetailRecord : {};
}

/** Keep every financial row, and fail explicitly instead of silently dropping malformed evidence. */
export function detailRows(value: unknown): DetailRecord[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some(row => row === null || typeof row !== "object" || Array.isArray(row))) {
    throw new Error("Document rows could not be read completely.");
  }
  return value as DetailRecord[];
}

export function detailText(value: unknown, fallback = "—"): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

const sourceNames: Record<string, string> = {
  invoice: "Invoice", customer_credit: "Customer credit", bill: "Supplier bill", vendor_credit: "Supplier credit",
  paid_expense: "Paid expense", receipt: "Customer receipt", vendor_payment: "Supplier payment",
  customer_refund: "Customer refund", vendor_refund: "Supplier refund", customer_advance: "Customer advance",
  vendor_advance: "Supplier advance", transfer: "Account transfer", manual_journal: "Manual journal",
  controlled_adjustment: "Controlled adjustment", opening_balance: "Opening balance", write_off: "Write-off",
  reversal: "Reversal", year_close: "Year close"
};

export function sourceName(type: unknown): string {
  return sourceNames[detailText(type, "")] ?? "Financial document";
}

export function humanLabel(value: unknown, fallback = "—"): string {
  const text = detailText(value, "");
  return text ? text.replaceAll("_", " ").replace(/^\w/, letter => letter.toUpperCase()) : fallback;
}

export function documentHeading(document: DetailRecord): string {
  return detailText(document.document_number, sourceName(document.document_type));
}

export function sourceStateLabel(document: DetailRecord): string {
  return document.state === "pending_approval" ? "Awaiting approval" : humanLabel(document.state, "State unavailable");
}

export function sourceStateExplanation(document: DetailRecord): string {
  if (document.reversed_by_document_id) return "A linked reversal preserves the original document and its accounting history.";
  switch (document.state) {
    case "draft": return "Saved draft. It has no effect on the ledger.";
    case "pending_approval": return "This saved version is waiting for approval before it can be posted.";
    case "approved": return "Approved and ready for an authorized user to post. A permanent number is assigned at posting.";
    case "posted": return "Posted to the ledger. Financial details are preserved as issued.";
    case "void": return "Voided before posting. This document has no effect on the ledger.";
    default: return "";
  }
}

/** Issued customer content must never fall back to a mutable directory record. */
export function issuedPartyDetails(document: DetailRecord) {
  return formatContactDetails(document.party_snapshot);
}

export function documentList(organizationId: string, type: unknown, capabilities: readonly string[]) {
  const base = `/o/${organizationId}`;
  if (type === "invoice" && capabilities.includes("sales.read")) return { href: `${base}/sales/invoices`, label: "Invoices" };
  if (type === "receipt" && capabilities.includes("sales.read")) return { href: `${base}/sales/receipts`, label: "Receipts" };
  if (type === "bill" && capabilities.includes("purchases.read")) return { href: `${base}/purchases/bills`, label: "Supplier bills" };
  if (type === "transfer" && capabilities.includes("banking.read")) return { href: `${base}/banking/transfers`, label: "Transfers" };
  if (["manual_journal", "controlled_adjustment", "opening_balance", "reversal", "year_close"].includes(String(type)) && capabilities.includes("ledger.read")) {
    return { href: `${base}/accounting/journals`, label: "Journals" };
  }
  return { href: `${base}/accounting/documents`, label: "Financial documents" };
}

export function invoiceDetailActions(document: DetailRecord, capabilities: readonly string[]) {
  const posted = document.document_type === "invoice" && document.state === "posted";
  const active = posted && !document.reversed_by_document_id;
  const has = (...codes: string[]) => codes.every(code => capabilities.includes(code));
  return {
    downloadPdf: posted && has("sales.read"),
    sendEmail: active && has("sales.read", "sales.write"),
    recordReceipt: active && typeof document.party_id === "string" && has("sales.write", "documents.read", "dues.read"),
    issueCredit: active && typeof document.party_id === "string" && has("sales.read", "sales.write", "documents.read")
  };
}

export function supplierDetailActions(document: DetailRecord, capabilities: readonly string[]) {
  const active = document.document_type === "bill" && document.state === "posted" && !document.reversed_by_document_id;
  const has = (...codes: string[]) => codes.every(code => capabilities.includes(code));
  const hasSupplier = typeof document.party_id === "string";
  return {
    recordPayment: active && hasSupplier && has("purchases.write", "documents.read", "dues.read"),
    issueCredit: active && hasSupplier && has("purchases.read", "purchases.write", "documents.read")
  };
}

export function detailDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "—";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

export function settlementStateLabel(allocation: DetailRecord, asOfDate: unknown): string {
  const effectiveDate = detailText(allocation.effective_date, "");
  const reversedOn = detailText(allocation.reversed_on, "");
  const asOf = detailText(asOfDate, "");
  if (reversedOn && (!asOf || reversedOn <= asOf)) return `Reversed effective ${detailDate(reversedOn)}`;
  if (asOf && effectiveDate > asOf) return `Scheduled for ${detailDate(effectiveDate)}${reversedOn ? `; reverses ${detailDate(reversedOn)}` : ""}`;
  return reversedOn ? `Active; reverses ${detailDate(reversedOn)}` : "Active";
}

export function detailTimestamp(value: unknown): string {
  if (typeof value !== "string") return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka", timeZoneName: "short"
  }).format(date);
}

/** Display six-place quantities/rates without rounding away saved precision or converting to a float. */
export function detailDecimal(value: unknown, money = false): string {
  if (typeof value !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) throw new Error("Saved decimal value is invalid.");
  const [whole, fraction = ""] = value.split(".");
  const digits = fraction.replace(/0+$/, "");
  return `${money ? "৳" : ""}${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${digits ? `.${money ? digits.padEnd(2, "0") : digits}` : money ? ".00" : ""}`;
}

export function exactJournalTotals(rows: readonly DetailRecord[]) {
  let debit = 0n, credit = 0n;
  for (const row of rows) {
    debit += moneyUnits(parseMoneyString(row.debit));
    credit += moneyUnits(parseMoneyString(row.credit));
  }
  return { debit: formatMoney(debit), credit: formatMoney(credit), balanced: rows.length > 0 && debit === credit };
}

export function accountLabel(row: DetailRecord, prefix = "account"): string {
  const code = detailText(row[`${prefix}_code`], ""), name = detailText(row[`${prefix}_name`], "");
  return [code, name].filter(Boolean).join(" · ") || "Account name unavailable";
}
