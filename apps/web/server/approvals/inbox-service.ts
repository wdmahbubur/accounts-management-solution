import type { RequestClient } from "../request-client.ts";
import { CommandError } from "../commands/errors.ts";
import type { ActorContext } from "../auth/types.ts";
import { record } from "../documents/contracts.ts";

type RpcClient=Pick<RequestClient,"rpc">;
export type ApprovalInboxState="pending"|"approved"|"rejected"|"all";
function error(value:{code?:string}){if(value.code==="42501")throw CommandError.forbidden();if(value.code==="28000")throw CommandError.unauthenticated();if(value.code==="P0002")throw CommandError.notFound();if(value.code==="22023")throw CommandError.validation({state:"Choose a supported approval filter."});throw new Error("Approval inbox is unavailable.");}
export async function readApprovalInbox(client:RpcClient,actor:ActorContext,state:ApprovalInboxState){
  if(!actor.capabilities.includes("approvals.read"))throw CommandError.forbidden();
  const result=await client.rpc("list_approval_inbox",{p_organization_id:actor.organizationId,p_state:state});if(result.error)error(result.error);
  if(!Array.isArray(result.data))throw new Error("Invalid approval inbox response.");return result.data.map((row)=>record(row,"approval request"));
}
export async function readApprovalReview(client:RpcClient,actor:ActorContext,requestId:string){
  if(!actor.capabilities.includes("approvals.read"))throw CommandError.forbidden();
  const result=await client.rpc("read_approval_review",{p_organization_id:actor.organizationId,p_approval_request_id:requestId});if(result.error)error(result.error);
  return record(result.data,"approval review");
}
