import { bangladeshDate } from "../../../../../lib/date.ts";
import { parseUuid } from "@ams/contracts";

export function confirmedDraftReceipt(raw: unknown, expectedDocumentId?: string): { documentId: string; documentVersion: number } {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error();
    const data = raw as Record<string, unknown>;
    const documentId = parseUuid(data.documentId);
    if (!Number.isSafeInteger(data.documentVersion) || (data.documentVersion as number) < 1) throw new Error();
    if (expectedDocumentId !== undefined && documentId.toLowerCase() !== parseUuid(expectedDocumentId).toLowerCase()) throw new Error();
    return { documentId, documentVersion: data.documentVersion as number };
  } catch { throw new Error("The save result could not be confirmed. Retry the same save to check its result."); }
}

export function validDocumentDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function reversalDefaultDate(sourceDate: string, today = bangladeshDate()): string {
  if (!validDocumentDate(sourceDate) || !validDocumentDate(today)) throw new Error("A valid source and company date are required.");
  return sourceDate > today ? sourceDate : today;
}

export function reversalFieldErrors(input: { date: string; sourceDate: string; reason: string }): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!validDocumentDate(input.date)) errors.reversal_date = "Choose a valid reversal date.";
  else if (!validDocumentDate(input.sourceDate) || input.date < input.sourceDate) errors.reversal_date = `Choose ${input.sourceDate} or a later date.`;
  if (input.reason.trim().length < 10 || input.reason.trim().length > 800) errors.reason = "Explain the correction in 10–800 characters.";
  return errors;
}

export interface FormRequest { readonly key: string; readonly body: string; readonly revision: number }

/** Keep both the key AND exact submitted values until an uncertain outcome is resolved. */
export class RecoverableFormRequest {
  private key: string | null = null;
  private request: FormRequest | null = null;
  private pending = false;
  private keyFactory: () => string;

  constructor(keyFactory: () => string = () => crypto.randomUUID()) { this.keyFactory = keyFactory; }

  get needsRetry(): boolean { return this.request !== null && !this.pending; }

  begin(body: string, revision = 0): FormRequest | null {
    if (this.pending) return null;
    this.key ??= this.keyFactory();
    this.request ??= Object.freeze({ key: this.key, body, revision });
    this.pending = true;
    return this.request;
  }

  confirmed(): void { this.pending = false; this.request = null; this.key = null; }
  rejected(): void { this.pending = false; this.request = null; }
  uncertain(): void { this.pending = false; }
}

/** Only a structured application rejection establishes that entered values may be revised. */
export function isConfirmedFormRejection(status: number, body: unknown): boolean {
  if (status < 400 || status >= 500 || status === 408 || !body || typeof body !== "object") return false;
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && [
    "UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "VALIDATION_FAILED", "STALE_VERSION", "PERIOD_LOCKED",
    "DOCUMENT_ALREADY_POSTED", "APPROVAL_REQUIRED", "APPROVAL_STALE", "JOURNAL_UNBALANCED", "ACCOUNT_NOT_POSTABLE",
    "CONTROL_ITEM_REQUIRED", "ALLOCATION_EXCEEDED", "PARTY_MISMATCH", "RECONCILIATION_LOCKED", "REVERSAL_EXISTS",
    "PLAN_READ_ONLY", "RATE_LIMITED"
  ].includes(code);
}

export function documentActionError(body: unknown, fallback: string): { message: string; fields: Record<string, string>; code: string } {
  if (!body || typeof body !== "object") return { message: fallback, fields: {}, code: "" };
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") return { message: fallback, fields: {}, code: "" };
  const value = error as Record<string, unknown>;
  const fields: Record<string, string> = {};
  if (value.fields && typeof value.fields === "object" && !Array.isArray(value.fields)) {
    for (const [field, message] of Object.entries(value.fields)) if (typeof message === "string") fields[field] = message;
  }
  return { message: typeof value.message === "string" ? value.message : fallback, fields, code: typeof value.code === "string" ? value.code : "" };
}
