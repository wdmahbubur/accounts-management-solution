import { parseOrganizationId } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { commandErrorBody,normalizeCommandError,CommandError } from "../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../server/commands/request-context.ts";
import { findDuplicateSupplierBillReferences } from "../../../../../../server/documents/supplier-bills.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";
export async function GET(request:Request,context:{params:Promise<{organizationId:string}>}){
 const requestId=generateRequestId();try{const organizationId=parseOrganizationId((await context.params).organizationId);const runtime=await roleRuntime();
  const actor=await resolveActorContext(organizationId,runtime.dependencies);const q=new URL(request.url).searchParams;
  if([...q.keys()].some(k=>!(["party_id","reference","document_id"] as string[]).includes(k))||!q.get("party_id")||!q.get("reference"))
    throw CommandError.validation({query:"Supplier and invoice reference are required."});
  const data=await findDuplicateSupplierBillReferences(runtime.client,actor,{partyId:q.get("party_id")!,reference:q.get("reference")!,excludeDocumentId:q.get("document_id")??undefined});
  return Response.json({data,meta:{request_id:requestId,replayed:false}},{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){const e=normalizeCommandError(error);return Response.json(commandErrorBody(e,requestId),{status:e.status,headers:{"Cache-Control":"private, no-store"}});}
}
