import {parseUuid} from "@ams/contracts";
import {createOrganizationRouteHandler} from "../../../../../../../../server/commands/route-adapter.ts";
import {periodCommand} from "../../../../../../../../server/periods/service.ts";
import {roleRuntime} from "../../../../../../../../server/roles/runtime.ts";
import {commandErrorBody,normalizeCommandError} from "../../../../../../../../server/commands/errors.ts";
import {generateRequestId} from "../../../../../../../../server/commands/request-context.ts";
export async function POST(request:Request,context:{params:Promise<{organizationId:string;periodId:string}>}){const {periodId}=await context.params;const requestId=generateRequestId();try{const runtime=await roleRuntime();const definition=periodCommand("reopen",parseUuid(periodId,"period_id"),runtime.client);return createOrganizationRouteHandler({definition,dependencies:runtime.dependencies})(request,context);}catch(error){const e=normalizeCommandError(error);return Response.json(commandErrorBody(e,requestId),{status:e.status,headers:{"Cache-Control":"private, no-store"}});}}
