import { createOrganizationRouteHandler } from '../../../../../../server/commands/route-adapter.ts';
import { saveLinkedSettlementCommand } from '../../../../../../server/documents/linked-settlements.ts';
import { roleRuntime } from '../../../../../../server/roles/runtime.ts';
export async function POST(request:Request,context:{params:Promise<{organizationId:string}>}) {
  const runtime=await roleRuntime();
  return createOrganizationRouteHandler({definition:saveLinkedSettlementCommand(runtime.client),dependencies:runtime.dependencies})(request,context);
}
