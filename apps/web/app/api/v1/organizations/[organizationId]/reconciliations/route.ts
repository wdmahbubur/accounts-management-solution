import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { commandErrorBody, CommandError, normalizeCommandError } from "../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../server/commands/request-context.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";
import { parseReconciliationStart, readReconciliationHistory } from "../../../../../../server/banking/reconciliations.ts";
import { parseReconciliationFilters } from "../../../../../../lib/reconciliation-history.ts";

export async function GET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const requestId = generateRequestId();
  try {
    const organizationId = parseOrganizationId((await context.params).organizationId);
    const runtime = await roleRuntime();
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => !["cash_account_id", "status", "page"].includes(key))) throw CommandError.validation({ filters: "Use account, status and page filters." });
    let filters;
    try { filters = parseReconciliationFilters(query); }
    catch { throw CommandError.validation({ filters: "Choose a valid account, status and page." }); }
    const data = await readReconciliationHistory(runtime.client, actor, filters);
    return Response.json({ data, meta: { request_id: requestId } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const normalized = normalizeCommandError(error);
    return Response.json(commandErrorBody(normalized, requestId), { status: normalized.status, headers: { "Cache-Control": "private, no-store" } });
  }
}

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const requestId = generateRequestId();
  try {
    const organizationId = parseOrganizationId((await context.params).organizationId);
    const runtime = await roleRuntime();
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    if (!actor.capabilities.includes("banking.write")) throw CommandError.forbidden();
    const body = parseReconciliationStart(await request.json());
    const args = { p_organization_id: organizationId, p_cash_account_id: body.cashAccountId, p_starts_on: body.startsOn, p_ends_on: body.endsOn, p_statement_opening: body.statementOpening, p_statement_closing: body.statementClosing, p_request_id: requestId };
    const result = await runtime.client.rpc("create_reconciliation", args);
    if (result.error) {
      if (result.error.code === "42501") throw CommandError.forbidden();
      if (result.error.code === "P0002") throw CommandError.notFound();
      if (result.error.code === "23P01") throw CommandError.conflict("RECONCILIATION_LOCKED");
      if (result.error.code === "22023") throw CommandError.validation({ form: "Check the statement dates and balances." });
      throw new Error("Reconciliation session could not be created.");
    }
    return Response.json({ data: { id: parseUuid(result.data) }, meta: { request_id: requestId } }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const normalized = normalizeCommandError(error);
    return Response.json(commandErrorBody(normalized, requestId), { status: normalized.status, headers: { "Cache-Control": "private, no-store" } });
  }
}
