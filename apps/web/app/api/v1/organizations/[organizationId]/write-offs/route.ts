import { createOrganizationRouteHandler } from "../../../../../../server/commands/route-adapter.ts";
import { saveWriteOffCommand } from "../../../../../../server/write-offs/service.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";

export async function POST(request:Request,context:{params:Promise<{organizationId:string}>}){
 const runtime=await roleRuntime();return createOrganizationRouteHandler({definition:saveWriteOffCommand(runtime.client),dependencies:runtime.dependencies})(request,context);
}
