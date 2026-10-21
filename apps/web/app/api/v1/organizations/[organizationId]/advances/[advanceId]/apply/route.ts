import { parseUuid } from '@ams/contracts';
import { createOrganizationRouteHandler } from '../../../../../../../../server/commands/route-adapter.ts';
import { applyAdvanceCommand } from '../../../../../../../../server/documents/linked-settlements.ts';
import { roleRuntime } from '../../../../../../../../server/roles/runtime.ts';
import { normalizeCommandError,commandErrorBody } from '../../../../../../../../server/commands/errors.ts';
import { generateRequestId } from '../../../../../../../../server/commands/request-context.ts';
export async function POST(request:Request,context:{params:Promise<{organizationId:string;advanceId:string}>}){
  try{
    const p=await context.params,id=parseUuid(p.advanceId),runtime=await roleRuntime();
    return createOrganizationRouteHandler({definition:applyAdvanceCommand(runtime.client,id),dependencies:runtime.dependencies})(request,{params:Promise.resolve({organizationId:p.organizationId})});
  }catch(e){const error=normalizeCommandError(e);return Response.json(commandErrorBody(error,generateRequestId()),{status:error.status,headers:{'Cache-Control':'private, no-store'}});}
}
