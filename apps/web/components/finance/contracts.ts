import { parseMoneyString } from "@ams/contracts";

/** Presentation only: preserves every digit; never computes a ledger balance. */
export function displayMoney(raw: unknown): string {
  const value = parseMoneyString(raw);
  const [integer, fraction] = value.split(".");
  return `৳${integer!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}
export function moneyInputError(raw: string, allowNegative = false): string | undefined {
  try { parseMoneyString(raw); if ((!allowNegative && raw.startsWith("-")) || raw === "-0.00") throw new Error(); }
  catch { return "Enter a valid amount with exactly two decimal places."; }
}
export interface PickerOption { id: string; label: string }
export interface ScopedOptions { organizationId: string; options: PickerOption[] }
/** Run on the server BEFORE serializing props. Supply only rows returned by an
 * authorized scoped query, never an all-tenant cache. This is not authorization.
 */
export function pickerData(organizationId: string, allowed: boolean,
  rows: readonly { id: string; organizationId: string; label: string; selectable?: boolean }[]): ScopedOptions {
  return { organizationId, options: allowed ? rows.filter((row) => row.organizationId === organizationId && row.selectable !== false)
    .map(({ id, label }) => ({ id, label })) : [] };
}
export type FeedbackKind = "loading" | "empty" | "error" | "forbidden" | "conflict" | "offline" | "read_only";
export const feedback: Record<FeedbackKind, { title: string; description: string }> = {
  loading: { title: "Loading records", description: "Amounts are unavailable until loading finishes." },
  empty: { title: "No records yet", description: "There are no records in this authorized view." },
  error: { title: "Records could not be loaded", description: "Retry a safe read. Do not resubmit an uncertain financial change with a new key." },
  forbidden: { title: "This view is unavailable", description: "Return to an authorized company or contact your administrator." },
  conflict: { title: "The record or company changed", description: "Reload and review the current version before submitting again." },
  offline: { title: "You are offline", description: "Reconnect before making changes. Financial posting is never queued offline." },
  read_only: { title: "This company is read-only", description: "Financial changes are disabled. Authorized records remain available." }
};
