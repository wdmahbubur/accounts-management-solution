import { parseUuid, type Uuid } from "@ams/contracts";

export type ReconciliationStatus = "draft" | "reopened" | "finalized";
export type ReconciliationAccount = { id: Uuid; name: string; kind: string; isActive: boolean };
export type ReconciliationSession = {
  id: Uuid; cashAccountId: Uuid; accountName: string; accountKind: string; accountActive: boolean;
  startsOn: string; endsOn: string; statementOpening: string; statementClosing: string;
  state: "draft" | "finalized"; status: ReconciliationStatus; createdAt: string;
  finalizedAt: string | null; reopenCount: number; lastReopenedAt: string | null; activeMatchCount: number;
};
export type ReconciliationHistory = {
  accounts: ReconciliationAccount[]; sessions: ReconciliationSession[]; page: number; hasMore: boolean;
  cashAccountId: Uuid | null; status: ReconciliationStatus | null;
};
export type ReconciliationFilters = { cashAccountId: string | null; status: ReconciliationStatus | null; page: number };
export const reconciliationStatusLabels: Record<ReconciliationStatus, string> = { draft: "Draft", reopened: "Reopened", finalized: "Finalized" };
export function reconciliationLinkLabel(session: Pick<ReconciliationSession, "state">, canWrite: boolean): string {
  return session.state === "finalized" ? "View finalized session" : canWrite ? "Resume matching" : "View session";
}
export function reconciliationDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
export function parseReconciliationFilters(query: URLSearchParams): ReconciliationFilters {
  for (const key of ["cash_account_id", "status", "page"]) if (query.getAll(key).length > 1) throw new Error("Choose one account, status and page.");
  const account = query.get("cash_account_id") || null, status = query.get("status") || null, page = query.get("page") ?? "1";
  if (status !== null && !["draft", "reopened", "finalized"].includes(status)) throw new Error("Choose a valid reconciliation status.");
  if (!/^[1-9]\d{0,4}$/.test(page) || Number(page) > 20001) throw new Error("Choose a valid reconciliation page.");
  return { cashAccountId: account === null ? null : parseUuid(account, "cash_account_id"), status: status as ReconciliationStatus | null, page: Number(page) };
}
export function reconciliationHistoryQuery(filters: ReconciliationFilters, page = filters.page): string {
  const query = new URLSearchParams();
  if (filters.cashAccountId) query.set("cash_account_id", filters.cashAccountId);
  if (filters.status) query.set("status", filters.status);
  if (page > 1) query.set("page", String(page));
  return query.toString();
}
