import {parseUuid} from "@ams/contracts";
import {commandErrorBody,normalizeCommandError} from "../../../../../../../server/commands/errors.ts";
import {generateRequestId} from "../../../../../../../server/commands/request-context.ts";
import {createOrganizationRouteHandler} from "../../../../../../../server/commands/route-adapter.ts";
import {saveContactCommand} from "../../../../../../../server/contacts/service.ts";
import {roleRuntime} from "../../../../../../../server/roles/runtime.ts";
export async function PATCH(request:Request,context:{params:Promise<{organizationId:string;contactId:string}>}){const p=await context.params;let id:string;try{id=parseUuid(p.contactId,"contact_id");}catch(error){const requestId=generateRequestId();const e=normalizeCommandError(error);return Response.json(commandErrorBody(e,requestId),{status:e.status});}
 const runtime=await roleRuntime();return createOrganizationRouteHandler({definition:saveContactCommand(runtime.client,id),dependencies:runtime.dependencies})(request,{params:Promise.resolve({organizationId:p.organizationId})});}
