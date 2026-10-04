import { parseMoneyString, parseOrganizationId, parseUuid, type MoneyString, type OrganizationId, type Uuid } from "@ams/contracts";
import type { RequestClient } from "../request-client.ts";
import { CommandError } from "../commands/errors.ts";
export interface DirectoryRow {
  id: Uuid; organizationId: OrganizationId; documentType: string; state: string;
  documentNumber: string | null; accountingDate: string; totalAmount: MoneyString;
}
export async function readDocumentDirectory(client: Pick<RequestClient, "rpc">, organizationId: OrganizationId,
  limit = 50, after?: string): Promise<DirectoryRow[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw CommandError.validation({ limit: "Use a page size of 1-100." });
  const cursor = after === undefined ? null : parseUuid(after, "after");
  const result = await client.rpc("read_document_directory", { p_organization_id: organizationId, p_limit: limit, p_after: cursor });
  if (result.error) throw new CommandError({ code: "INTERNAL_ERROR" });
  if (!Array.isArray(result.data) || result.data.length > limit) throw new Error("Invalid directory response.");
  return result.data.map((raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid directory row.");
    const row = raw as Record<string, unknown>;
    if (row.organization_id !== organizationId || typeof row.document_type !== "string" || typeof row.state !== "string" ||
      (row.document_number !== null && typeof row.document_number !== "string") || typeof row.accounting_date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.accounting_date)) throw new Error("Invalid directory scope or row.");
    return { id: parseUuid(row.id), organizationId: parseOrganizationId(row.organization_id), documentType: row.document_type,
      state: row.state, documentNumber: row.document_number, accountingDate: row.accounting_date, totalAmount: parseMoneyString(row.total_amount) };
  });
}
