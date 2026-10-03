import { parseOrganizationId } from "@ams/contracts";
import { assertMutationOrigin } from "../../../../../../../server/auth/mutation-origin.ts";
import { resolveActorContext } from "../../../../../../../server/auth/resolve-actor.ts";
import { CommandError, commandErrorBody, normalizeCommandError } from "../../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../../server/commands/request-context.ts";
import { roleRuntime } from "../../../../../../../server/roles/runtime.ts";

const noStore={"Cache-Control":"private, no-store"};
function failure(error:unknown,requestId:string){const safe=normalizeCommandError(error);return Response.json(commandErrorBody(safe,requestId),{status:safe.status,headers:noStore});}
function preferences(value:unknown){if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid notification preferences.");const p=value as Record<string,unknown>;
  if(typeof p.email_approvals!=="boolean"||typeof p.email_invoice_reminders!=="boolean"||typeof p.email_bill_reminders!=="boolean"||
    !(p.updated_at===null||typeof p.updated_at==="string"))throw new Error("Invalid notification preferences.");return p;}
export async function GET(_request:Request,{params}:{params:Promise<{organizationId:string}>}){
  const requestId=generateRequestId();try{const organizationId=parseOrganizationId((await params).organizationId),runtime=await roleRuntime();
    const actor=await resolveActorContext(organizationId,runtime.dependencies);const result=await runtime.client.rpc("read_notification_preferences",{p_organization_id:organizationId});
    if(result.error){if(result.error.code==="42501")throw CommandError.forbidden();if(result.error.code==="28000")throw CommandError.unauthenticated();if(result.error.code==="P0002")throw CommandError.notFound();throw new Error("Notification preferences could not be loaded.");}
    if(actor.organizationId!==organizationId)throw CommandError.notFound();return Response.json({data:preferences(result.data),meta:{request_id:requestId}},{headers:noStore});
  }catch(error){return failure(error,requestId);}
}
export async function PATCH(request:Request,{params}:{params:Promise<{organizationId:string}>}){
  const requestId=generateRequestId();try{assertMutationOrigin(request.headers);const organizationId=parseOrganizationId((await params).organizationId),runtime=await roleRuntime();
    const actor=await resolveActorContext(organizationId,runtime.dependencies);let body:unknown;try{body=await request.json();}catch{throw CommandError.validation({body:"Expected a JSON object."});}
    if(!body||typeof body!=="object"||Array.isArray(body))throw CommandError.validation({body:"Expected a JSON object."});const input=body as Record<string,unknown>;
    const keys=["email_approvals","email_invoice_reminders","email_bill_reminders"];
    if(Object.keys(input).length!==keys.length||keys.some(key=>typeof input[key]!=="boolean"))throw CommandError.validation({body:"Choose each supported email preference."});
    const result=await runtime.client.rpc("save_notification_preferences",{p_organization_id:organizationId,p_email_approvals:input.email_approvals,
      p_email_invoice_reminders:input.email_invoice_reminders,p_email_bill_reminders:input.email_bill_reminders});
    if(result.error){if(result.error.code==="42501")throw CommandError.forbidden();if(result.error.code==="28000")throw CommandError.unauthenticated();
      if(result.error.code==="P0002")throw CommandError.notFound();if(result.error.code==="22023")throw CommandError.validation({body:"Check the preference values."});throw new Error("Notification preferences could not be saved.");}
    if(actor.organizationId!==organizationId)throw CommandError.notFound();return Response.json({data:preferences(result.data),meta:{request_id:requestId}},{headers:noStore});
  }catch(error){return failure(error,requestId);}
}
