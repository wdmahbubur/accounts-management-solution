import { parseOrganizationId } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { commandErrorBody, normalizeCommandError } from "../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../server/commands/request-context.ts";
import { createOrganizationRouteHandler } from "../../../../../../server/commands/route-adapter.ts";
import { readApprovalPolicyCatalog, saveApprovalPolicyCommand } from "../../../../../../server/approvals/policy-service.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";

const headers={"Cache-Control":"private, no-store"};
export async function GET(request:Request,context:{params:Promise<{organizationId:string}>}){
  const requestId=generateRequestId();try{const organizationId=parseOrganizationId((await context.params).organizationId);const runtime=await roleRuntime();
    const actor=await resolveActorContext(organizationId,runtime.dependencies);const data=await readApprovalPolicyCatalog(runtime.client,actor);
    return Response.json({data,meta:{request_id:requestId,replayed:false}},{headers});
  }catch(error){const e=normalizeCommandError(error);return Response.json(commandErrorBody(e,requestId),{status:e.status,headers});}
}
export async function POST(request:Request,context:{params:Promise<{organizationId:string}>}){
  const runtime=await roleRuntime();return createOrganizationRouteHandler({definition:saveApprovalPolicyCommand(runtime.client),dependencies:runtime.dependencies})(request,context);
}
