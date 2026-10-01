import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../../server/auth/resolve-actor.ts";
import { commandErrorBody, normalizeCommandError } from "../../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../../server/commands/request-context.ts";
import { readApprovalReview } from "../../../../../../../server/approvals/inbox-service.ts";
import { roleRuntime } from "../../../../../../../server/roles/runtime.ts";

export async function GET(_request:Request,context:{params:Promise<{organizationId:string;approvalRequestId:string}>}){
  const requestId=generateRequestId();const headers={"Cache-Control":"private, no-store"};try{const params=await context.params;
    const organizationId=parseOrganizationId(params.organizationId);const approvalRequestId=parseUuid(params.approvalRequestId,"approval_request_id");
    const runtime=await roleRuntime();const actor=await resolveActorContext(organizationId,runtime.dependencies);const data=await readApprovalReview(runtime.client,actor,approvalRequestId);
    return Response.json({data,meta:{request_id:requestId,replayed:false}},{headers});
  }catch(error){const e=normalizeCommandError(error);return Response.json(commandErrorBody(e,requestId),{status:e.status,headers});}
}
