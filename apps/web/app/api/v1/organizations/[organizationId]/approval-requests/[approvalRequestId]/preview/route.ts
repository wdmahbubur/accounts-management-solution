import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../../../server/auth/resolve-actor.ts";
import { CommandError, commandErrorBody, normalizeCommandError } from "../../../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../../../server/commands/request-context.ts";
import { previewApprovalDocument } from "../../../../../../../../server/documents/service.ts";
import { roleRuntime } from "../../../../../../../../server/roles/runtime.ts";

export async function POST(request:Request,context:{params:Promise<{organizationId:string;approvalRequestId:string}>}){
  const requestId=generateRequestId();const headers={"Cache-Control":"private, no-store"};try{const params=await context.params;
    const organizationId=parseOrganizationId(params.organizationId);const approvalRequestId=parseUuid(params.approvalRequestId,"approval_request_id");let body:unknown;
    try{body=await request.json();}catch{throw CommandError.validation({body:"Expected a JSON object."});}
    if(!body||typeof body!=="object"||Array.isArray(body))throw CommandError.validation({body:"Expected a JSON object."});const value=body as Record<string,unknown>;
    if(Object.keys(value).some((key)=>key!=="expected_version")||!Number.isSafeInteger(value.expected_version)||Number(value.expected_version)<1)throw CommandError.validation({expected_version:"Supply the submitted document version."});
    const runtime=await roleRuntime();const actor=await resolveActorContext(organizationId,runtime.dependencies);
    const data=await previewApprovalDocument(runtime.client,actor,approvalRequestId,Number(value.expected_version));return Response.json({data,meta:{request_id:requestId,replayed:false}},{headers});
  }catch(error){const e=normalizeCommandError(error);return Response.json(commandErrorBody(e,requestId),{status:e.status,headers});}
}
