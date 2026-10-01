import { parseOrganizationId } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../../server/auth/resolve-actor.ts";
import { commandErrorBody, normalizeCommandError, CommandError } from "../../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../../server/commands/request-context.ts";
import { readDraftOptions } from "../../../../../../../server/documents/service.ts";
import { roleRuntime } from "../../../../../../../server/roles/runtime.ts";

export async function GET(request:Request,context:{params:Promise<{organizationId:string}>}){const requestId=generateRequestId();try{
  const organizationId=parseOrganizationId((await context.params).organizationId);const query=new URL(request.url).searchParams;
  if([...query.keys()].some((key)=>!["type","accounting_date"].includes(key)))throw CommandError.validation({query:"Unknown draft option filter."});
  const type=query.get("type");const accountingDate=query.get("accounting_date");
  if(!type||!accountingDate||!/^\d{4}-\d{2}-\d{2}$/.test(accountingDate))throw CommandError.validation({query:"Document type and accounting date are required."});
  const runtime=await roleRuntime();const actor=await resolveActorContext(organizationId,runtime.dependencies);const data=await readDraftOptions(runtime.client,actor,type,accountingDate);
  return Response.json({data,meta:{request_id:requestId,replayed:false}},{headers:{"Cache-Control":"private, no-store"}});
}catch(error){const e=normalizeCommandError(error);return Response.json(commandErrorBody(e,requestId),{status:e.status,headers:{"Cache-Control":"private, no-store"}});}}
