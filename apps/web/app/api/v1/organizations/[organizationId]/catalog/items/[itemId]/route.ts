import {parseUuid} from "@ams/contracts";
import {commandErrorBody,normalizeCommandError} from "../../../../../../../../server/commands/errors.ts";
import {generateRequestId} from "../../../../../../../../server/commands/request-context.ts";
import {createOrganizationRouteHandler} from "../../../../../../../../server/commands/route-adapter.ts";
import {saveItemCommand} from "../../../../../../../../server/catalog/service.ts";
import {roleRuntime} from "../../../../../../../../server/roles/runtime.ts";
export async function PATCH(request:Request,context:{params:Promise<{organizationId:string;itemId:string}>}){const p=await context.params;let id:string;try{id=parseUuid(p.itemId,"item_id");}catch(error){const requestId=generateRequestId();const e=normalizeCommandError(error);return Response.json(commandErrorBody(e,requestId),{status:e.status});}const runtime=await roleRuntime();return createOrganizationRouteHandler({definition:saveItemCommand(runtime.client,id),dependencies:runtime.dependencies})(request,{params:Promise.resolve({organizationId:p.organizationId})});}
