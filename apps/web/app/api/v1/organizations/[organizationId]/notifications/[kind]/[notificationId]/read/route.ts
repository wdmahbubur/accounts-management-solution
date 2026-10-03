import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { assertMutationOrigin } from "../../../../../../../../../server/auth/mutation-origin.ts";
import { resolveActorContext } from "../../../../../../../../../server/auth/resolve-actor.ts";
import { CommandError, commandErrorBody, normalizeCommandError } from "../../../../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../../../../server/commands/request-context.ts";
import { roleRuntime } from "../../../../../../../../../server/roles/runtime.ts";

const noStore={"Cache-Control":"private, no-store"};
export async function POST(request:Request,{params}:{params:Promise<{organizationId:string;kind:string;notificationId:string}>}){
  const requestId=generateRequestId();
  try{
    assertMutationOrigin(request.headers);const {organizationId:rawOrg,kind,notificationId:rawId}=await params;
    const organizationId=parseOrganizationId(rawOrg);const id=parseUuid(rawId,"notification_id");
    if(!["approval","delivery_failure","export_failure","invoice_due","bill_due"].includes(kind))throw CommandError.notFound();
    const runtime=await roleRuntime();const actor=await resolveActorContext(organizationId,runtime.dependencies);
    if(!actor.memberId)throw CommandError.notFound();
    const result=await runtime.client.rpc("mark_notification_read",{p_organization_id:organizationId,p_item_kind:kind,p_source_id:id});
    if(result.error){if(result.error.code==="42501")throw CommandError.forbidden();if(result.error.code==="28000")throw CommandError.unauthenticated();
      if(result.error.code==="P0002")throw CommandError.notFound();if(result.error.code==="22023")throw CommandError.validation({kind:"Choose a supported notification."});throw new Error("Notification could not be updated.");}
    if(result.data!==true)throw new Error("Invalid notification update response.");
    return Response.json({data:{read:true},meta:{request_id:requestId}},{headers:noStore});
  }catch(error){const safe=normalizeCommandError(error);return Response.json(commandErrorBody(safe,requestId),{status:safe.status,headers:noStore});}
}
