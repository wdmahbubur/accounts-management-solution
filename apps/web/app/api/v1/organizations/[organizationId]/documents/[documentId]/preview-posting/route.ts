import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../../../server/auth/resolve-actor.ts";
import { CommandError, commandErrorBody, normalizeCommandError } from "../../../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../../../server/commands/request-context.ts";
import { previewFinancialDocument } from "../../../../../../../../server/documents/service.ts";
import { roleRuntime } from "../../../../../../../../server/roles/runtime.ts";

export async function POST(request:Request,context:{params:Promise<{organizationId:string;documentId:string}>}){const requestId=generateRequestId();try{
  const params=await context.params;const organizationId=parseOrganizationId(params.organizationId);const documentId=parseUuid(params.documentId);let body:unknown;
  try{body=await request.json();}catch{throw CommandError.validation({body:"Expected a JSON body."});}
  if(!body||typeof body!=="object"||Array.isArray(body))throw CommandError.validation({body:"Expected a JSON object."});const value=body as Record<string,unknown>;
  if(Object.keys(value).some((key)=>key!=="expected_version")||!Number.isSafeInteger(value.expected_version)||Number(value.expected_version)<1)throw CommandError.validation({expected_version:"Supply the current document version."});
  const runtime=await roleRuntime();const actor=await resolveActorContext(organizationId,runtime.dependencies);const data=await previewFinancialDocument(runtime.client,actor,documentId,Number(value.expected_version));
  return Response.json({data,meta:{request_id:requestId,replayed:false}},{headers:{"Cache-Control":"private, no-store"}});
}catch(error){const e=normalizeCommandError(error);return Response.json(commandErrorBody(e,requestId),{status:e.status,headers:{"Cache-Control":"private, no-store"}});}}
