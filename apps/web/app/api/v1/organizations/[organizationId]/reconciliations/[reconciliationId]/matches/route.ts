import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../../../server/auth/resolve-actor.ts";
import { commandErrorBody, CommandError, normalizeCommandError } from "../../../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../../../server/commands/request-context.ts";
import { roleRuntime } from "../../../../../../../../server/roles/runtime.ts";

function dbError(code: string | undefined): never {
  if (code === "42501") throw CommandError.forbidden();
  if (code === "P0002") throw CommandError.notFound();
  if (code === "23514" || code === "22023") throw CommandError.validation({ match: "The selected rows or amount are incompatible with remaining statement and book capacity." });
  if (code === "55000" || code === "23P01") throw CommandError.conflict("RECONCILIATION_LOCKED");
  if (code === "23505") throw CommandError.conflict("RECONCILIATION_LOCKED");
  throw new Error("Reconciliation match could not be saved.");
}

async function contextData(context: { params: Promise<{ organizationId: string; reconciliationId: string }> }) {
  const params = await context.params;
  const organizationId = parseOrganizationId(params.organizationId);
  const reconciliationId = parseUuid(params.reconciliationId, "reconciliation_id");
  const runtime = await roleRuntime();
  const actor = await resolveActorContext(organizationId, runtime.dependencies);
  if (!actor.capabilities.includes("banking.write")) throw CommandError.forbidden();
  return { organizationId, reconciliationId, runtime };
}

export async function POST(request: Request, context: { params: Promise<{ organizationId: string; reconciliationId: string }> }) {
  const requestId = generateRequestId();
  try {
    const { organizationId, reconciliationId, runtime } = await contextData(context);
    const body = await request.json() as Record<string, unknown>;
    const statementLineId = parseUuid(body.statement_line_id, "statement_line_id");
    const journalLineId = parseUuid(body.journal_line_id, "journal_line_id");
    if (typeof body.amount !== "string" || !/^\d{1,12}\.\d{2}$/.test(body.amount)) throw CommandError.validation({ amount: "Enter a positive exact BDT amount with two decimals." });
    const result = await runtime.client.rpc("add_reconciliation_match", { p_organization_id: organizationId, p_reconciliation_id: reconciliationId, p_statement_line_id: statementLineId, p_journal_line_id: journalLineId, p_amount: body.amount, p_request_id: requestId });
    if (result.error) dbError(result.error.code);
    return Response.json({ data: { id: parseUuid(result.data) }, meta: { request_id: requestId } }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const normalized = normalizeCommandError(error);
    return Response.json(commandErrorBody(normalized, requestId), { status: normalized.status, headers: { "Cache-Control": "private, no-store" } });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ organizationId: string; reconciliationId: string }> }) {
  const requestId = generateRequestId();
  try {
    const { organizationId, reconciliationId, runtime } = await contextData(context);
    const body = await request.json() as Record<string, unknown>;
    const matchId = parseUuid(body.match_id, "match_id");
    if (typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 500) throw CommandError.validation({ reason: "Enter a reason up to 500 characters." });
    const result = await runtime.client.rpc("reverse_reconciliation_match", { p_organization_id: organizationId, p_reconciliation_id: reconciliationId, p_match_id: matchId, p_reason: body.reason.trim(), p_request_id: requestId });
    if (result.error) dbError(result.error.code);
    return Response.json({ data: { reversal_id: parseUuid(result.data) }, meta: { request_id: requestId } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const normalized = normalizeCommandError(error);
    return Response.json(commandErrorBody(normalized, requestId), { status: normalized.status, headers: { "Cache-Control": "private, no-store" } });
  }
}
