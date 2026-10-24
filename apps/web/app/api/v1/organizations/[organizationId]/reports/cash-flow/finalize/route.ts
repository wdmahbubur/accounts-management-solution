import { createOrganizationRouteHandler } from '../../../../../../../../server/commands/route-adapter.ts';
import { finalizeCashFlowCommand } from '../../../../../../../../server/reports/cash-flow-finalization.ts';
import { roleRuntime } from '../../../../../../../../server/roles/runtime.ts';
export async function POST(request:Request,context:{params:Promise<{organizationId:string}>}){
 const runtime=await roleRuntime();return createOrganizationRouteHandler({definition:finalizeCashFlowCommand(runtime.client),dependencies:runtime.dependencies})(request,context);
}
