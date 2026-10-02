import { parseUuid } from "@ams/contracts";
import { commandErrorBody, normalizeCommandError } from "../../../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../../../server/commands/request-context.ts";
import { createOrganizationRouteHandler } from "../../../../../../../../server/commands/route-adapter.ts";
import { submitFinancialDocumentCommand } from "../../../../../../../../server/approvals/service.ts";
import { roleRuntime } from "../../../../../../../../server/roles/runtime.ts";

export async function POST(request:Request,context:{params:Promise<{organizationId:string;documentId:string}>}){
  const params=await context.params;let documentId:string;
  try{documentId=parseUuid(params.documentId,"document_id");}
  catch(error){const requestId=generateRequestId();const e=normalizeCommandError(error);return Response.json(commandErrorBody(e,requestId),{status:e.status,headers:{"Cache-Control":"private, no-store"}});}
  const runtime=await roleRuntime();return createOrganizationRouteHandler({definition:submitFinancialDocumentCommand(runtime.client,documentId),dependencies:runtime.dependencies})(request,{params:Promise.resolve({organizationId:params.organizationId})});
}
