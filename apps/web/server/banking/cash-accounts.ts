import { CommandError } from "../commands/errors.ts";
import { parseUuid } from "@ams/contracts";
import type { ActorContext } from "../auth/types.ts";
import type { RequestClient } from "../request-client.ts";
import { parseCashAccountInput } from "../../lib/cash-account-requests.ts";

/** Map only known save_cash_account failures; never disclose raw SQL details. */
export function cashAccountSaveError(error: { code?: string }): CommandError {
  if (error.code === "42501") return CommandError.forbidden();
  if (error.code === "23505") return CommandError.validation({ account_id: "This ledger account is already linked to a cash, bank or wallet account. Choose another ledger account or open the existing account." }, "This ledger account is already in use.");
  if (error.code === "23514" || error.code === "23503") return CommandError.validation({ account_id: "Choose an active, postable cash or bank asset account for this company." }, "The selected ledger account is unavailable.");
  if (error.code === "22023") return CommandError.validation({ body: "Review the account name, kind and settings." });
  return new CommandError({ code: "INTERNAL_ERROR" });
}

export async function readCashAccountMapping(client: Pick<RequestClient, "rpc">, actor: ActorContext, rawAccountId: string) {
  if (!actor.capabilities.includes("banking.read")) throw CommandError.forbidden();
  const accountId = parseUuid(rawAccountId, "account_id");
  const result = await client.rpc("read_cash_accounts", { p_organization_id: actor.organizationId });
  if (result.error) throw result.error.code === "42501" ? CommandError.forbidden() : new Error("Cash accounts could not be checked.");
  if (!Array.isArray(result.data)) throw new Error("Invalid cash account response.");
  const rows = result.data.map((raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid cash account response.");
    const row = raw as Record<string, unknown>;
    try { parseUuid(row.account_id); } catch { throw new Error("Invalid cash account mapping."); }
    return row;
  });
  const matches = rows.filter(row => String(row.account_id).toLowerCase() === accountId.toLowerCase());
  if (matches.length > 1) throw new Error("Cash account identity could not be confirmed.");
  if (!matches.length) return null;
  const row = matches[0] as Record<string, unknown>;
  try {
    if (typeof row.is_active !== "boolean") throw new Error();
    return { ...parseCashAccountInput({ name: row.name, kind: row.kind, account_id: row.account_id, institution: row.institution,
      masked_account_number: row.masked_account_number, is_cash_equivalent: row.is_cash_equivalent, allow_negative_balance: row.allow_negative_balance }), id: parseUuid(row.id), is_active: row.is_active };
  } catch { throw new Error("Cash account details could not be confirmed."); }
}
