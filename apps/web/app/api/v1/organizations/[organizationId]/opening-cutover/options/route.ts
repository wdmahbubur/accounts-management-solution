import { parseOrganizationId } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../../server/auth/resolve-actor.ts";
import { CommandError, commandErrorBody, normalizeCommandError } from "../../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../../server/commands/request-context.ts";
import { roleRuntime } from "../../../../../../../server/roles/runtime.ts";

const headers={"Cache-Control":"private, no-store"};
export async function GET(_request:Request,context:{params:Promise<{organizationId:string}>}){
 const requestId=generateRequestId();
 try{
  const organizationId=parseOrganizationId((await context.params).organizationId);const runtime=await roleRuntime();
  const actor=await resolveActorContext(organizationId,runtime.dependencies);if(!actor.capabilities.includes("journal.write"))throw CommandError.forbidden();
  const result=await runtime.client.rpc("list_opening_cutover_options",{p_organization_id:organizationId});
  if(result.error){if(result.error.code==="42501")throw CommandError.forbidden();throw new Error("Opening cutover options could not be loaded.");}
  return Response.json({data:result.data,meta:{request_id:requestId}},{headers});
 }catch(error){const safe=normalizeCommandError(error);return Response.json(commandErrorBody(safe,requestId),{status:safe.status,headers});}
}
