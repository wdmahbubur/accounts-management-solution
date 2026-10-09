import { parseOrganizationId } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { CommandError, commandErrorBody, normalizeCommandError } from "../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../server/commands/request-context.ts";
import { readSupplierPaymentAllocationOptions } from "../../../../../../server/documents/supplier-payments.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";
const headers={"Cache-Control":"private, no-store"};
export async function GET(request:Request,context:{params:Promise<{organizationId:string}>}) {
  const requestId=generateRequestId();
  try {
    const organizationId=parseOrganizationId((await context.params).organizationId);
    const runtime=await roleRuntime(),actor=await resolveActorContext(organizationId,runtime.dependencies),query=new URL(request.url).searchParams;
    if([...query.keys()].some(key=>!["party_id","accounting_date"].includes(key))||query.getAll("party_id").length!==1||query.getAll("accounting_date").length!==1)
      throw CommandError.validation({query:"Supplier and accounting date are required once each."});
    const data=await readSupplierPaymentAllocationOptions(runtime.client,actor,query.get("party_id")!,query.get("accounting_date")!);
    return Response.json({data,meta:{request_id:requestId,replayed:false}},{headers});
  } catch(error) {const safe=normalizeCommandError(error);return Response.json(commandErrorBody(safe,requestId),{status:safe.status,headers});}
}
