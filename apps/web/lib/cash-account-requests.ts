import { ContractValidationError, parseUuid } from "@ams/contracts";

export interface CashAccountInput {
  name: string; kind: string; account_id: string; institution: string | null; masked_account_number: string | null;
  is_cash_equivalent: boolean; allow_negative_balance: boolean;
}
const fields = ["name", "kind", "account_id", "institution", "masked_account_number", "is_cash_equivalent", "allow_negative_balance"] as const;

export function parseCashAccountInput(value: unknown): CashAccountInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ContractValidationError("Check the account fields.", { body: "Enter the account details." });
  const row = value as Record<string, unknown>, errors: Record<string, string> = {};
  if (Object.keys(row).some(key => !(fields as readonly string[]).includes(key))) errors.body = "Unexpected account field.";
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!name || name.length > 120) errors.name = "Enter an account name of 1–120 characters.";
  if (typeof row.kind !== "string" || !["cash", "bank", "mobile_wallet", "payment_clearing"].includes(row.kind)) errors.kind = "Choose an account kind.";
  let accountId = "";
  try { accountId = parseUuid(row.account_id).toLowerCase(); } catch { errors.account_id = "Choose a ledger account."; }
  for (const key of ["institution", "masked_account_number"] as const) {
    if (row[key] != null && (typeof row[key] !== "string" || row[key].length > (key === "institution" ? 120 : 80))) errors[key] = "This value is too long.";
  }
  for (const key of ["is_cash_equivalent", "allow_negative_balance"] as const) if (typeof row[key] !== "boolean") errors[key] = "Choose whether this setting applies.";
  if (Object.keys(errors).length) throw new ContractValidationError("Check the highlighted account fields.", errors);
  return { name, kind: row.kind as string, account_id: accountId,
    institution: typeof row.institution === "string" ? row.institution.trim() || null : null,
    masked_account_number: typeof row.masked_account_number === "string" ? row.masked_account_number.trim() || null : null,
    is_cash_equivalent: row.is_cash_equivalent as boolean, allow_negative_balance: row.allow_negative_balance as boolean };
}

export type CashAccountSaveOutcome =
  | { kind: "confirmed"; id: string }
  | { kind: "rejected"; message: string; fields: Record<string, string> }
  | { kind: "uncertain" };
export interface CashAccountAttempt { readonly body: string; readonly input: Readonly<CashAccountInput>; readonly recovering: boolean }

/** Freeze an unknown creation to its unique ledger mapping; never retry with edited details. */
export class CashAccountSaveGuard {
  private saved: { body: string; input: Readonly<CashAccountInput> } | null = null;
  private pending = false;
  get needsRecovery() { return this.saved !== null && !this.pending; }
  begin(input?: CashAccountInput): CashAccountAttempt | null {
    if (this.pending) return null;
    const recovering = this.saved !== null;
    if (!this.saved) {
      if (!input) throw new Error("Account details are required.");
      this.saved = { input: Object.freeze({ ...input }), body: JSON.stringify(input) };
    }
    this.pending = true;
    return { ...this.saved, recovering };
  }
  finish(outcome: CashAccountSaveOutcome) {
    this.pending = false;
    if (outcome.kind !== "uncertain") this.saved = null;
  }
}

function rejection(value: unknown, status: number): Extract<CashAccountSaveOutcome, {kind: "rejected"}> | null {
  if (!value || typeof value !== "object") return null;
  const body = value as { error?: {code?: unknown; message?: unknown; fields?: unknown}; meta?: {request_id?: unknown} };
  const expected: Record<string, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION_FAILED: 422, PLAN_READ_ONLY: 409, RATE_LIMITED: 429 };
  if (typeof body.error?.code !== "string" || !Object.hasOwn(expected, body.error.code) || expected[body.error.code] !== status ||
    typeof body.error.message !== "string" || !body.error.message.trim() || typeof body.meta?.request_id !== "string" || !body.meta.request_id.trim()) return null;
  return { kind: "rejected", message: body.error.message, fields: body.error.fields && typeof body.error.fields === "object" && !Array.isArray(body.error.fields)
    ? Object.fromEntries(Object.entries(body.error.fields).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {} };
}

export async function performCashAccountSave(organizationId: string, attempt: CashAccountAttempt, transport: typeof fetch = fetch): Promise<CashAccountSaveOutcome> {
  const url = `/api/v1/organizations/${organizationId}/cash-accounts`;
  try {
    if (attempt.recovering) {
      const check = await transport(`${url}?account_id=${encodeURIComponent(attempt.input.account_id)}`, { cache: "no-store" });
      const checked = await check.json();
      if (!check.ok || checked?.data?.organization_id !== organizationId || checked.data.account_id !== attempt.input.account_id || !("account" in checked.data)) return { kind: "uncertain" };
      const account = checked.data.account;
      if (account !== null) {
        if (!account || typeof account !== "object" || Array.isArray(account) || account.account_id !== attempt.input.account_id || typeof account.is_active !== "boolean") return { kind: "uncertain" };
        const id = parseUuid(account.id);
        const normalized = parseCashAccountInput(Object.fromEntries(fields.map(field => [field, account[field]])));
        if (account.is_active === true && fields.every(field => normalized[field] === attempt.input[field])) return { kind: "confirmed", id };
        return { kind: "rejected", message: "This ledger account is already linked to another or archived cash account. Your entered details are preserved.", fields: { account_id: "Review the account list or choose another ledger account." } };
      }
      // The first request may still be finishing. Retrying the exact ledger mapping is
      // protected by UNIQUE (organization_id, account_id), not an invented idempotency contract.
    }
    const response = await transport(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: attempt.body });
    const result = await response.json();
    if (response.ok) {
      const id = parseUuid(result?.data?.id);
      if (result.data.organization_id !== organizationId || result.data.account_id !== attempt.input.account_id) return { kind: "uncertain" };
      return { kind: "confirmed", id };
    }
    const failure = rejection(result, response.status);
    // Rejection of a later retry cannot establish the earlier request's outcome.
    // Keep checking the original mapping before releasing the frozen details.
    if (attempt.recovering) return { kind: "uncertain" };
    return failure ?? { kind: "uncertain" };
  } catch { return { kind: "uncertain" }; }
}
