import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { commandErrorBody, CommandError, normalizeCommandError } from "../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../server/commands/request-context.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";

function date(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) throw CommandError.validation({ [field]: "Use a valid YYYY-MM-DD date." });
  return value;
}
function money(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^-?\d{1,12}\.\d{2}$/.test(value)) throw CommandError.validation({ [field]: "Use an exact BDT amount with two decimal places." });
  return value;
}

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const requestId = generateRequestId();
  try {
    const organizationId = parseOrganizationId((await context.params).organizationId);
    const runtime = await roleRuntime();
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    if (!actor.capabilities.includes("banking.write")) throw CommandError.forbidden();
    const body = await request.json() as Record<string, unknown>;
    const cashAccountId = parseUuid(body.cash_account_id, "cash_account_id");
    const args = { p_organization_id: organizationId, p_cash_account_id: cashAccountId, p_starts_on: date(body.starts_on, "starts_on"), p_ends_on: date(body.ends_on, "ends_on"), p_statement_opening: money(body.statement_opening, "statement_opening"), p_statement_closing: money(body.statement_closing, "statement_closing"), p_request_id: requestId };
    const result = await runtime.client.rpc("create_reconciliation", args);
    if (result.error) {
      if (result.error.code === "42501") throw CommandError.forbidden();
      if (result.error.code === "P0002") throw CommandError.notFound();
      if (result.error.code === "23P01") throw CommandError.conflict("RECONCILIATION_LOCKED");
      throw new Error("Reconciliation session could not be created.");
    }
    return Response.json({ data: { id: parseUuid(result.data) }, meta: { request_id: requestId } }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const normalized = normalizeCommandError(error);
    return Response.json(commandErrorBody(normalized, requestId), { status: normalized.status, headers: { "Cache-Control": "private, no-store" } });
  }
}
