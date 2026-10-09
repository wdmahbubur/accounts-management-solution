import { parseMoneyString, parseUuid } from "@ams/contracts";
import type { ActorContext } from "../auth/types.ts";
import { CommandError } from "../commands/errors.ts";
import type { RequestClient } from "../request-client.ts";
import { reconciliationDate, type ReconciliationFilters, type ReconciliationHistory, type ReconciliationSession } from "../../lib/reconciliation-history.ts";

type RpcClient = Pick<RequestClient, "rpc">;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid reconciliation response.");
  return value as Record<string, unknown>;
}
function text(value: unknown): string { if (typeof value !== "string" || !value) throw new Error("Invalid reconciliation text."); return value; }
function flag(value: unknown): boolean { if (typeof value !== "boolean") throw new Error("Invalid reconciliation flag."); return value; }
function count(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error("Invalid reconciliation count."); return Number(value); }
function date(value: unknown): string { if (!reconciliationDate(value)) throw new Error("Invalid reconciliation date."); return value; }
function timestamp(value: unknown): string { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Invalid reconciliation timestamp."); return value; }
function databaseError(error: { code?: string }): never {
  if (error.code === "42501") throw CommandError.forbidden();
  if (error.code === "P0002") throw CommandError.notFound();
  if (error.code === "22023") throw CommandError.validation({ filters: "Choose valid reconciliation filters." });
  throw new Error("Reconciliation history could not be loaded.");
}
export async function readReconciliationHistory(client: RpcClient, actor: ActorContext, filters: ReconciliationFilters): Promise<ReconciliationHistory> {
  if (!actor.capabilities.includes("banking.read")) throw CommandError.forbidden();
  const cashAccountId = filters.cashAccountId === null ? null : parseUuid(filters.cashAccountId);
  if (!Number.isInteger(filters.page) || filters.page < 1 || filters.page > 20001 || (filters.status !== null && !["draft", "reopened", "finalized"].includes(filters.status))) throw CommandError.validation({ filters: "Choose valid reconciliation filters." });
  const offset = (filters.page - 1) * 50;
  const result = await client.rpc("read_reconciliation_list", { p_organization_id: actor.organizationId, p_cash_account_id: cashAccountId, p_status: filters.status, p_offset: offset });
  if (result.error) databaseError(result.error);
  const response = record(result.data);
  if (response.organization_id !== actor.organizationId || response.cash_account_id !== cashAccountId || response.status !== filters.status || response.offset !== offset || response.page_size !== 50 || !Array.isArray(response.accounts) || !Array.isArray(response.sessions) || response.sessions.length > 50) throw new Error("Invalid reconciliation list scope.");
  const accountIds = new Set<string>();
  const accounts = response.accounts.map(value => {
    const row = record(value), id = parseUuid(row.id);
    if (accountIds.has(id)) throw new Error("Duplicate reconciliation account.");
    accountIds.add(id);
    return { id, name: text(row.name), kind: text(row.kind), isActive: flag(row.is_active) };
  });
  if (cashAccountId !== null && !accountIds.has(cashAccountId)) throw new Error("Invalid reconciliation account scope.");
  const ids = new Set<string>();
  const sessions = response.sessions.map(value => {
    const row = record(value), id = parseUuid(row.id), accountId = parseUuid(row.cash_account_id), account = accounts.find(item => item.id === accountId);
    const reopenCount = count(row.reopen_count), finalizedAt = row.finalized_at === null ? null : timestamp(row.finalized_at), lastReopenedAt = row.last_reopened_at === null ? null : timestamp(row.last_reopened_at);
    const state = row.state;
    if ((state !== "draft" && state !== "finalized") || (state === "finalized") !== (finalizedAt !== null) || (reopenCount > 0) !== (lastReopenedAt !== null)) throw new Error("Invalid reconciliation history state.");
    const status = state === "finalized" ? "finalized" : reopenCount > 0 ? "reopened" : "draft";
    const startsOn = date(row.starts_on), endsOn = date(row.ends_on);
    if (ids.has(id) || !account || (cashAccountId !== null && accountId !== cashAccountId) || (filters.status !== null && status !== filters.status) || row.status !== status || endsOn < startsOn || row.account_name !== account.name || row.account_kind !== account.kind || row.account_active !== account.isActive) throw new Error("Invalid reconciliation session scope.");
    ids.add(id);
    return { id, cashAccountId: accountId, accountName: account.name, accountKind: account.kind, accountActive: account.isActive,
      startsOn, endsOn, statementOpening: parseMoneyString(row.statement_opening), statementClosing: parseMoneyString(row.statement_closing), state, status,
      createdAt: timestamp(row.created_at), finalizedAt, reopenCount, lastReopenedAt, activeMatchCount: count(row.active_match_count) } satisfies ReconciliationSession;
  });
  return { accounts, sessions, page: filters.page, hasMore: flag(response.has_more), cashAccountId, status: filters.status };
}

export function parseReconciliationStart(value: unknown): { cashAccountId: string; startsOn: string; endsOn: string; statementOpening: string; statementClosing: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw CommandError.validation({ form: "Enter statement details." });
  const row = value as Record<string, unknown>;
  const errors: Record<string, string> = {};
  if (!reconciliationDate(row.starts_on)) errors.starts_on = "Choose a valid statement start date.";
  if (!reconciliationDate(row.ends_on)) errors.ends_on = "Choose a valid statement end date.";
  if (!errors.starts_on && !errors.ends_on) {
    const days = (Date.parse(`${row.ends_on}T00:00:00Z`) - Date.parse(`${row.starts_on}T00:00:00Z`)) / 86400000;
    if (days < 0) errors.ends_on = "The end date must be on or after the start date.";
    else if (days > 370) errors.ends_on = "A statement session can cover at most 370 days.";
  }
  for (const field of ["statement_opening", "statement_closing"]) if (typeof row[field] !== "string" || !/^-?\d{1,12}\.\d{2}$/.test(row[field])) errors[field] = "Use an exact BDT amount with two decimal places.";
  let cashAccountId = "";
  try { cashAccountId = parseUuid(row.cash_account_id, "cash_account_id"); } catch { errors.cash_account_id = "Choose a cash or bank account."; }
  if (Object.keys(errors).length) throw CommandError.validation(errors);
  return { cashAccountId, startsOn: row.starts_on as string, endsOn: row.ends_on as string, statementOpening: row.statement_opening as string, statementClosing: row.statement_closing as string };
}
