import { parseOrganizationId } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { commandErrorBody, normalizeCommandError, CommandError } from "../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../server/commands/request-context.ts";
import { readDocumentDirectory } from "../../../../../../server/documents/directory.ts";
import { createDraftCommand } from "../../../../../../server/documents/service.ts";
import { createOrganizationRouteHandler } from "../../../../../../server/commands/route-adapter.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const requestId = generateRequestId();
  try {
    const organizationId = parseOrganizationId((await context.params).organizationId);
    const runtime = await roleRuntime();
    await resolveActorContext(organizationId, runtime.dependencies);
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some((key) => !["after", "limit"].includes(key))) throw CommandError.validation({ query: "Unknown directory filter." });
    const limit = query.get("limit");
    if (limit !== null && !/^[1-9]\d{0,2}$/.test(limit)) throw CommandError.validation({ limit: "Use a page size of 1-100." });
    const data = await readDocumentDirectory(runtime.client, organizationId, limit === null ? 50 : Number(limit), query.get("after") ?? undefined);
    return Response.json({ data, meta: { request_id: requestId, replayed: false } }, { headers });
  } catch (error) {
    const safe = normalizeCommandError(error);
    return Response.json(commandErrorBody(safe, requestId), { status: safe.status, headers });
  }
}
export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const runtime = await roleRuntime();
  return createOrganizationRouteHandler({ definition: createDraftCommand(runtime.client), dependencies: runtime.dependencies })(request, context);
}
