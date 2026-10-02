import { parseOrganizationId } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { commandErrorBody, normalizeCommandError, CommandError } from "../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../server/commands/request-context.ts";
import { readApprovalInbox, type ApprovalInboxState } from "../../../../../../server/approvals/inbox-service.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";

const headers={"Cache-Control":"private, no-store"};
const states:ApprovalInboxState[]=["pending","approved","rejected","all"];
export async function GET(request:Request,context:{params:Promise<{organizationId:string}>}){
  const requestId=generateRequestId();try{const organizationId=parseOrganizationId((await context.params).organizationId);const state=new URL(request.url).searchParams.get("state")??"pending";
    if(!states.includes(state as ApprovalInboxState))throw CommandError.validation({state:"Choose pending, approved, rejected, or all."});
    const runtime=await roleRuntime();const actor=await resolveActorContext(organizationId,runtime.dependencies);const data=await readApprovalInbox(runtime.client,actor,state as ApprovalInboxState);
    return Response.json({data,meta:{request_id:requestId,replayed:false}},{headers});
  }catch(error){const e=normalizeCommandError(error);return Response.json(commandErrorBody(e,requestId),{status:e.status,headers});}
}
