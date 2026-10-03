import {parseOrganizationId,parseUuid} from "@ams/contracts";
import {resolveActorContext} from "../../../../../../../../server/auth/resolve-actor.ts";
import {commandErrorBody,normalizeCommandError,CommandError} from "../../../../../../../../server/commands/errors.ts";
import {generateRequestId} from "../../../../../../../../server/commands/request-context.ts";
import {roleRuntime} from "../../../../../../../../server/roles/runtime.ts";
const headers={"Cache-Control":"private, no-store"};
export async function GET(_request:Request,context:{params:Promise<{organizationId:string;periodId:string}>}){
  const requestId=generateRequestId();
  try{
    const params=await context.params,organizationId=parseOrganizationId(params.organizationId),periodId=parseUuid(params.periodId);
    const runtime=await roleRuntime(),actor=await resolveActorContext(organizationId,runtime.dependencies);
    if(!actor.capabilities.includes("audit.read"))throw CommandError.forbidden();
    const result=await runtime.client.rpc("list_period_close_events",{p_organization_id:organizationId,p_period_id:periodId});
    if(result.error){if(result.error.code==="P0002")throw CommandError.notFound();if(result.error.code==="42501")throw CommandError.forbidden();throw new Error("Period history could not be loaded.");}
    return Response.json({data:result.data,meta:{request_id:requestId,replayed:false}},{headers});
  }catch(error){const e=normalizeCommandError(error);return Response.json(commandErrorBody(e,requestId),{status:e.status,headers});}
}
