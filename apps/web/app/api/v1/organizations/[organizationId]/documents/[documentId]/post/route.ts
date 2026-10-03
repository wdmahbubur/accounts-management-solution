import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { commandErrorBody, normalizeCommandError } from "../../../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../../../server/commands/request-context.ts";
import { createOrganizationRouteHandler } from "../../../../../../../../server/commands/route-adapter.ts";
import { postFinancialDocumentCommand } from "../../../../../../../../server/documents/posting.ts";
import { readFinancialDocument } from "../../../../../../../../server/documents/service.ts";
import { resolveActorContext } from "../../../../../../../../server/auth/resolve-actor.ts";
import { roleRuntime } from "../../../../../../../../server/roles/runtime.ts";

export async function POST(request:Request,context:{params:Promise<{organizationId:string;documentId:string}>}){
  const params=await context.params;let documentId:string;let organizationId:ReturnType<typeof parseOrganizationId>;try{documentId=parseUuid(params.documentId,"document_id");organizationId=parseOrganizationId(params.organizationId);}
  catch(error){const requestId=generateRequestId();const e=normalizeCommandError(error);return Response.json(commandErrorBody(e,requestId),{status:e.status,headers:{"Cache-Control":"private, no-store"}});}
  const runtime=await roleRuntime();try{const actor=await resolveActorContext(organizationId,runtime.dependencies);const document=await readFinancialDocument(runtime.client,actor,documentId);
    return createOrganizationRouteHandler({definition:postFinancialDocumentCommand(runtime.client,documentId,String(document.document_type)),dependencies:runtime.dependencies})(request,
      {params:Promise.resolve({organizationId})});
  }catch(error){const requestId=generateRequestId();const e=normalizeCommandError(error);return Response.json(commandErrorBody(e,requestId),{status:e.status,headers:{"Cache-Control":"private, no-store"}});}
}
