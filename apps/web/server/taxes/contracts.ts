import { parseUuid } from "@ams/contracts";
import { CommandError } from "../commands/errors.ts";

export const taxKinds = ["standard", "zero_rated", "exempt", "out_of_scope"] as const;
export type TaxKind = typeof taxKinds[number];
export type Recoverability = "full" | "none";
export interface TaxCode {
  id: string; code: string; versionNo: number; rowVersion: number; label: string; ratePercent: string;
  taxKind: TaxKind; outputAccountId: string | null; outputAccountLabel: string | null;
  inputAccountId: string | null; inputAccountLabel: string | null; recoverability: Recoverability;
  effectiveFrom: string; effectiveTo: string | null; isActive: boolean;
}
export interface TaxAccount { id: string; code: string; name: string; accountType: string; normalSide: string; mappingKey: string | null }
export interface TaxCatalog { codes: TaxCode[]; accounts: TaxAccount[] }
export interface TaxVersionInput {
  code: string; label: string; ratePercent: string; taxKind: TaxKind; outputAccountId: string | null;
  inputAccountId: string | null; recoverability: Recoverability; effectiveFrom: string; effectiveTo: string | null;
  expectedLatestRowVersion: number; reason: string;
}
export interface ArchiveTaxInput { taxCodeId: string; expectedRowVersion: number; reason: string }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw CommandError.validation({ body: "Expected an object." });
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw CommandError.validation({ [field]: `Use 1-${max} characters.` });
  return value.trim();
}
function date(value: unknown, field: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw CommandError.validation({ [field]: "Use a valid calendar date." });
  }
  return value;
}
function uuidOrNull(value: unknown, field: string): string | null { return value === null ? null : parseUuid(value, field); }
export function validateTaxVersion(raw: unknown): TaxVersionInput {
  const v = object(raw); const allowed = ["code", "label", "rate_percent", "tax_kind", "output_account_id", "input_account_id", "recoverability", "effective_from", "effective_to", "expected_latest_row_version", "reason"];
  if (Object.keys(v).some((key) => !allowed.includes(key))) throw CommandError.validation({ body: "Unexpected request field." });
  if (typeof v.rate_percent !== "string" || !/^(?:0|[1-9]\d{0,2})(?:\.\d{1,6})?$/.test(v.rate_percent) || Number(v.rate_percent) > 100) throw CommandError.validation({ rate_percent: "Enter a percentage from 0 to 100 with up to six decimal places." });
  if (typeof v.tax_kind !== "string" || !(taxKinds as readonly string[]).includes(v.tax_kind)) throw CommandError.validation({ tax_kind: "Choose a supported tax treatment." });
  if (v.recoverability !== "full" && v.recoverability !== "none") throw CommandError.validation({ recoverability: "Choose full or none." });
  if (!Number.isSafeInteger(v.expected_latest_row_version) || Number(v.expected_latest_row_version) < 0) throw CommandError.validation({ expected_latest_row_version: "Refresh the latest tax version." });
  const code = text(v.code, "code", 32).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(code)) throw CommandError.validation({ code: "Use letters, numbers, hyphen, or underscore." });
  const effectiveFrom = date(v.effective_from, "effective_from")!; const effectiveTo = date(v.effective_to, "effective_to", true);
  if (effectiveTo && effectiveTo < effectiveFrom) throw CommandError.validation({ effective_to: "End date must not precede the start date." });
  const reason = text(v.reason, "reason", 1000);
  if (reason.length < 10) throw CommandError.validation({ reason: "Give a reason of at least 10 characters." });
  return { code, label: text(v.label, "label", 160), ratePercent: v.rate_percent, taxKind: v.tax_kind as TaxKind,
    outputAccountId: uuidOrNull(v.output_account_id, "output_account_id"), inputAccountId: uuidOrNull(v.input_account_id, "input_account_id"),
    recoverability: v.recoverability, effectiveFrom, effectiveTo, expectedLatestRowVersion: Number(v.expected_latest_row_version), reason };
}
export function validateArchiveTax(raw: unknown): ArchiveTaxInput {
  const v = object(raw); if (Object.keys(v).some((key) => !["tax_code_id", "expected_row_version", "reason"].includes(key))) throw CommandError.validation({ body: "Unexpected request field." });
  if (!Number.isSafeInteger(v.expected_row_version) || Number(v.expected_row_version) < 1) throw CommandError.validation({ expected_row_version: "Refresh the selected version." });
  return { taxCodeId: parseUuid(v.tax_code_id, "tax_code_id"), expectedRowVersion: Number(v.expected_row_version), reason: text(v.reason, "reason", 1000) };
}
export function parseTaxCatalog(codes: unknown, accounts: unknown): TaxCatalog {
  if (!Array.isArray(codes) || !Array.isArray(accounts)) throw new Error("Invalid tax catalog.");
  const parsedCodes = codes.map((raw) => {
    const r = object(raw);
    if (typeof r.code !== "string" || typeof r.label !== "string" || typeof r.rate_percent !== "string" ||
      typeof r.version_no !== "number" || !Number.isSafeInteger(r.version_no) || typeof r.row_version !== "number" || !Number.isSafeInteger(r.row_version) ||
      typeof r.tax_kind !== "string" || !(taxKinds as readonly string[]).includes(r.tax_kind) || (r.recoverability !== "full" && r.recoverability !== "none") ||
      typeof r.effective_from !== "string" || (r.effective_to !== null && typeof r.effective_to !== "string") || typeof r.is_active !== "boolean") throw new Error("Invalid tax version.");
    return { id: parseUuid(r.id), code: r.code, versionNo: r.version_no, rowVersion: r.row_version, label: r.label, ratePercent: r.rate_percent,
      taxKind: r.tax_kind as TaxKind, outputAccountId: r.output_account_id === null ? null : parseUuid(r.output_account_id), outputAccountLabel: typeof r.output_account_label === "string" ? r.output_account_label : null,
      inputAccountId: r.input_account_id === null ? null : parseUuid(r.input_account_id), inputAccountLabel: typeof r.input_account_label === "string" ? r.input_account_label : null,
      recoverability: r.recoverability, effectiveFrom: r.effective_from, effectiveTo: r.effective_to, isActive: r.is_active } satisfies TaxCode;
  });
  const parsedAccounts = accounts.map((raw) => { const r = object(raw); return { id: parseUuid(r.id), code: String(r.code), name: String(r.name), accountType: String(r.account_type), normalSide: String(r.normal_side), mappingKey: typeof r.mapping_key === "string" ? r.mapping_key : null } satisfies TaxAccount; });
  return { codes: parsedCodes, accounts: parsedAccounts };
}
export function taxDatabaseError(error: { code?: string }): CommandError {
  if (error.code === "28000") return CommandError.unauthenticated();
  if (error.code === "42501") return CommandError.forbidden();
  if (error.code === "P0002") return CommandError.notFound();
  if (error.code === "40001") return CommandError.conflict("STALE_VERSION");
  if (error.code === "22023" || error.code === "23514" || error.code === "23P01") return CommandError.validation({ tax: "The tax version conflicts with a date, account, or treatment rule." });
  return new CommandError({ code: "INTERNAL_ERROR" });
}
