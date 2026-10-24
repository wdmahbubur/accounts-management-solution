import {createOrganizationRouteHandler} from '../../../../../../../server/commands/route-adapter.ts';
import {roleRuntime} from '../../../../../../../server/roles/runtime.ts';
import {deferredCheckoutCommand} from '../../../../../../../server/billing/checkout.ts';
export async function POST(request:Request,context:{params:Promise<{organizationId:string}>}){
 const runtime=await roleRuntime();return createOrganizationRouteHandler({definition:deferredCheckoutCommand(),dependencies:runtime.dependencies})(request,context);
}
