import { createOrganizationRouteHandler } from "../../../../../../../../server/commands/route-adapter.ts";
import { submitAdvanceActionCommand } from "../../../../../../../../server/advances/service.ts";
import { roleRuntime } from "../../../../../../../../server/roles/runtime.ts";
export async function POST(request:Request,context:{params:Promise<{organizationId:string;documentId:string}>}){const {documentId}=await context.params;const runtime=await roleRuntime();return createOrganizationRouteHandler({definition:submitAdvanceActionCommand(runtime.client,documentId),dependencies:runtime.dependencies})(request,context);}
