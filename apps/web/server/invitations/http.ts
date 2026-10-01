import { parseOrganizationId } from "@ams/contracts";
import { createClient } from "../../lib/supabase/server.ts";
import { assertMutationOrigin } from "../auth/mutation-origin.ts";
import { resolveActorContext } from "../auth/resolve-actor.ts";
import { commandErrorBody, CommandError, normalizeCommandError } from "../commands/errors.ts";
import { executeOrganizationCommand } from "../commands/execute.ts";
import { generateRequestId } from "../commands/request-context.ts";
import { assertFreshCompanySubmission, StaleCompanyContextError } from "../company-context.ts";
import { roleRuntime } from "../roles/runtime.ts";
import { record } from "../roles/contracts.ts";
import type { InvitationOperation } from "./contracts.ts";
import { invitationCommand, listInvitations, respondToInvitation } from "./service.ts";
const noStore = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
export function invitationFailure(error: unknown) {
  const safe = error instanceof StaleCompanyContextError ? new CommandError({ code: "STALE_VERSION", message: "Company context changed. Reload before submitting." }) : normalizeCommandError(error);
  return Response.json(commandErrorBody(safe, generateRequestId()), { status: safe.status, headers: noStore });
}
export async function invitationGet(organizationId: string) {
  try {
    const runtime = await roleRuntime();
    const actor = await resolveActorContext(parseOrganizationId(organizationId), runtime.dependencies);
    return Response.json({ data: await listInvitations(runtime.client, actor), meta: { request_id: generateRequestId(), replayed: false } }, { headers: noStore });
  } catch (error) { return invitationFailure(error); }
}
async function json(request: Request) {
  try { return record(await request.json()); } catch { throw CommandError.validation({ body: "Expected a JSON object." }); }
}
export async function invitationMutation(request: Request, organizationId: string, operation: InvitationOperation, invitationId?: string) {
  try {
    assertMutationOrigin(request.headers);
    const runtime = await roleRuntime();
    assertFreshCompanySubmission({ expectedOrganizationId: organizationId, expectedNonce: request.headers.get("x-company-context"), current: runtime.current });
    const body = await json(request);
    if ("invitation_id" in body) throw CommandError.validation({ body: "Use the URL invitation target." });
    const result = await executeOrganizationCommand({ definition: invitationCommand(operation, runtime.client), organizationId,
      rawInput: { ...body, ...(invitationId ? { invitation_id: invitationId } : {}) }, headers: request.headers, dependencies: runtime.dependencies });
    return Response.json(result.body, { status: result.status, headers: noStore });
  } catch (error) { return invitationFailure(error); }
}
export async function invitationResponse(request: Request) {
  try {
    assertMutationOrigin(request.headers);
    const data = await respondToInvitation(await createClient(), await json(request));
    return Response.json({ data, meta: { request_id: generateRequestId(), replayed: false } }, { headers: noStore });
  } catch (error) { return invitationFailure(error); }
}
