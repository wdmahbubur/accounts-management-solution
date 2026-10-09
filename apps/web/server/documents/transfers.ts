import { parseMoneyString, parseOrganizationId, parseUuid, type OrganizationId, type Uuid } from "@ams/contracts";
import type { RequestClient } from "../request-client.ts";
import { CommandError } from "../commands/errors.ts";
import type { ActorContext } from "../auth/types.ts";
import { record } from "./contracts.ts";

export interface TransferRow { id: Uuid; organizationId: OrganizationId; state: string; documentNumber: string | null; accountingDate: string; fromAccount: string; toAccount: string; amount: string; feeAmount: string; totalAmount: string; externalReference: string | null }
export interface TransferPage { items: TransferRow[]; nextCursor: Uuid | null }
export async function readTransferRegister(client: Pick<RequestClient, "rpc">, actor: ActorContext, input: { search: string | null; after: string | null; limit: number }): Promise<TransferPage> {
  if (!actor.capabilities.includes("banking.read")) throw CommandError.forbidden();
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100 || (input.search !== null && input.search.length > 100)) throw CommandError.validation({ search: "Use a search under 100 characters and a page size of 1–100." });
  const after = input.after ? parseUuid(input.after, "after") : null;
  const result = await client.rpc("read_transfer_register", { p_organization_id: actor.organizationId, p_search: input.search, p_after: after, p_limit: input.limit + 1 });
  if (result.error) {
    if (result.error.code === "42501") throw CommandError.forbidden();
    if (result.error.code === "P0002") throw CommandError.notFound();
    if (result.error.code === "22023") throw CommandError.validation({ query: "Transfer filters are invalid." });
    throw new Error("Transfer register could not be loaded.");
  }
  if (!Array.isArray(result.data) || result.data.length > input.limit + 1) throw new Error("Invalid transfer register response.");
  const rows = result.data.map((value: unknown): TransferRow => {
    const row = record(value, "transfer");
    if (row.organization_id !== actor.organizationId || typeof row.state !== "string" || (row.document_number !== null && typeof row.document_number !== "string") ||
      typeof row.accounting_date !== "string" || typeof row.from_account !== "string" || typeof row.to_account !== "string" ||
      typeof row.amount !== "string" || typeof row.fee_amount !== "string" || typeof row.total_amount !== "string" || (row.external_reference !== null && typeof row.external_reference !== "string")) throw new Error("Invalid transfer row.");
    return { id: parseUuid(row.id), organizationId: parseOrganizationId(row.organization_id), state: row.state, documentNumber: row.document_number,
      accountingDate: row.accounting_date, fromAccount: row.from_account, toAccount: row.to_account, amount: parseMoneyString(row.amount),
      feeAmount: parseMoneyString(row.fee_amount), totalAmount: parseMoneyString(row.total_amount), externalReference: row.external_reference };
  });
  const hasMore = rows.length > input.limit, items = hasMore ? rows.slice(0, input.limit) : rows;
  return { items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
}
