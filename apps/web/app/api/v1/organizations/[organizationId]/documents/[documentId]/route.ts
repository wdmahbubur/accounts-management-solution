import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../../server/auth/resolve-actor.ts";
import { commandErrorBody, normalizeCommandError } from "../../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../../server/commands/request-context.ts";
import { createOrganizationRouteHandler } from "../../../../../../../server/commands/route-adapter.ts";
import { readFinancialDocument, updateDraftCommand } from "../../../../../../../server/documents/service.ts";
import { roleRuntime } from "../../../../../../../server/roles/runtime.ts";

const headers={"Cache-Control":"private, no-store"};
type Context={params:Promise<{organizationId:string;documentId:string}>};
export async function GET(_request:Request,context:Context){const requestId=generateRequestId();try{
  const params=await context.params;const organizationId=parseOrganizationId(params.organizationId);const documentId=parseUuid(params.documentId);
  const runtime=await roleRuntime();const actor=await resolveActorContext(organizationId,runtime.dependencies);const data=await readFinancialDocument(runtime.client,actor,documentId);
  return Response.json({data,meta:{request_id:requestId,replayed:false}},{headers});
}catch(error){const e=normalizeCommandError(error);return Response.json(commandErrorBody(e,requestId),{status:e.status,headers});}}
export async function PATCH(request:Request,context:Context){const params=await context.params;let documentId:string;
  try{documentId=parseUuid(params.documentId);}catch(error){const requestId=generateRequestId();const e=normalizeCommandError(error);return Response.json(commandErrorBody(e,requestId),{status:e.status,headers});}
  const runtime=await roleRuntime();return createOrganizationRouteHandler({definition:updateDraftCommand(runtime.client,documentId),dependencies:runtime.dependencies})(request,{params:Promise.resolve({organizationId:params.organizationId})});
}
