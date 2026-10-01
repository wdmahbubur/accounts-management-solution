import { parseUuid } from "@ams/contracts";
import { commandErrorBody, normalizeCommandError } from "../../../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../../../server/commands/request-context.ts";
import { createOrganizationRouteHandler } from "../../../../../../../../server/commands/route-adapter.ts";
import { decideFinancialApprovalCommand } from "../../../../../../../../server/approvals/service.ts";
import { roleRuntime } from "../../../../../../../../server/roles/runtime.ts";

export async function POST(request:Request,context:{params:Promise<{organizationId:string;approvalRequestId:string}>}){
  const params=await context.params;let approvalRequestId:string;
  try{approvalRequestId=parseUuid(params.approvalRequestId,"approval_request_id");}
  catch(error){const requestId=generateRequestId();const e=normalizeCommandError(error);return Response.json(commandErrorBody(e,requestId),{status:e.status,headers:{"Cache-Control":"private, no-store"}});}
  const runtime=await roleRuntime();return createOrganizationRouteHandler({definition:decideFinancialApprovalCommand(runtime.client,approvalRequestId),dependencies:runtime.dependencies})(request,{params:Promise.resolve({organizationId:params.organizationId})});
}
