import { createOrganizationRouteHandler } from "../../../../../../../server/commands/route-adapter.ts";
import { saveAdvanceActionCommand } from "../../../../../../../server/advances/service.ts";
import { roleRuntime } from "../../../../../../../server/roles/runtime.ts";
export async function POST(request:Request,context:{params:Promise<{organizationId:string}>}){const runtime=await roleRuntime();return createOrganizationRouteHandler({definition:saveAdvanceActionCommand(runtime.client),dependencies:runtime.dependencies})(request,context);}
