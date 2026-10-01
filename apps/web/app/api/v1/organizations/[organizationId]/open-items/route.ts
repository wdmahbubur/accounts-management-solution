import { parseOrganizationId } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { commandErrorBody, normalizeCommandError } from "../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../server/commands/request-context.ts";
import { parseOpenItemFilters } from "../../../../../../server/open-items/contracts.ts";
import { readOpenItems } from "../../../../../../server/open-items/service.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";

const headers={"Cache-Control":"private, no-store"};
export async function GET(request:Request,context:{params:Promise<{organizationId:string}>}){
  const requestId=generateRequestId();
  try{const organizationId=parseOrganizationId((await context.params).organizationId);const filters=parseOpenItemFilters(new URL(request.url).searchParams);
    const runtime=await roleRuntime();const actor=await resolveActorContext(organizationId,runtime.dependencies);const data=await readOpenItems(runtime.client,actor,filters);
    return Response.json({data,meta:{request_id:requestId,replayed:false}},{headers});
  }catch(error){const e=normalizeCommandError(error);return Response.json(commandErrorBody(e,requestId),{status:e.status,headers});}
}
