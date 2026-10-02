import { parseOrganizationId } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { assertMutationOrigin } from "../../../../../../server/auth/mutation-origin.ts";
import { CommandError, commandErrorBody, normalizeCommandError } from "../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../server/commands/request-context.ts";
import { assertFreshCompanySubmission, StaleCompanyContextError } from "../../../../../../server/company-context.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";
import { readExportJobs, requestTrialBalanceExport } from "../../../../../../server/reports/exports.ts";

const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  const safe = error instanceof StaleCompanyContextError
    ? normalizeCommandError(new CommandError({ code: "STALE_VERSION", message: "Company context changed. Reload before requesting an export." }))
    : normalizeCommandError(error);
  return Response.json(commandErrorBody(safe, generateRequestId()), { status: safe.status, headers });
}
export async function GET(_request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const requestId = generateRequestId();
  try {
    const organizationId = parseOrganizationId((await context.params).organizationId);
    const runtime = await roleRuntime();
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    return Response.json({ data: await readExportJobs(runtime.client, actor), meta: { request_id: requestId, replayed: false } }, { headers });
  } catch (error) { const safe = normalizeCommandError(error); return Response.json(commandErrorBody(safe, requestId), { status: safe.status, headers }); }
}
export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const requestId = generateRequestId();
  try {
    assertMutationOrigin(request.headers);
    const organizationId = parseOrganizationId((await context.params).organizationId);
    const runtime = await roleRuntime();
    assertFreshCompanySubmission({ expectedOrganizationId: organizationId, expectedNonce: request.headers.get("x-company-context"), current: runtime.current });
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    let body: unknown; try { body = await request.json(); } catch { throw CommandError.validation({ body: "Expected a JSON export request." }); }
    const result = await requestTrialBalanceExport(runtime.client, actor, body, request.headers.get("idempotency-key"));
    return Response.json({ data: result, meta: { request_id: requestId, replayed: result.replayed } }, { status: result.replayed ? 200 : 202, headers });
  } catch (error) { return failure(error); }
}
