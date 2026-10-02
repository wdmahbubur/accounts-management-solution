import {parseOrganizationId} from "@ams/contracts";import {resolveActorContext} from "../../../../../../server/auth/resolve-actor.ts";
import {commandErrorBody,normalizeCommandError,CommandError} from "../../../../../../server/commands/errors.ts";import {generateRequestId} from "../../../../../../server/commands/request-context.ts";
import {readCustomerCreditOptions} from "../../../../../../server/documents/customer-credits.ts";import {roleRuntime} from "../../../../../../server/roles/runtime.ts";
export async function GET(request:Request,context:{params:Promise<{organizationId:string}>}){const requestId=generateRequestId();try{
 const organizationId=parseOrganizationId((await context.params).organizationId);const runtime=await roleRuntime();const actor=await resolveActorContext(organizationId,runtime.dependencies);const q=new URL(request.url).searchParams;
 if([...q.keys()].some(k=>!(["invoice_id","accounting_date"] as string[]).includes(k))||!q.get("invoice_id")||!q.get("accounting_date"))throw CommandError.validation({query:"Invoice and accounting date are required."});
 const data=await readCustomerCreditOptions(runtime.client,actor,q.get("invoice_id")!,q.get("accounting_date")!);return Response.json({data,meta:{request_id:requestId,replayed:false}},{headers:{"Cache-Control":"private, no-store"}});
}catch(error){const e=normalizeCommandError(error);return Response.json(commandErrorBody(e,requestId),{status:e.status,headers:{"Cache-Control":"private, no-store"}});}}
