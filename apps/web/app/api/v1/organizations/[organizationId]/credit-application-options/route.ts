import { parseOrganizationId } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { CommandError, commandErrorBody, normalizeCommandError } from "../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../server/commands/request-context.ts";
import { readCreditApplicationOptions } from "../../../../../../server/documents/credit-application.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";

export async function GET(request:Request,context:{params:Promise<{organizationId:string}>}) {
  const requestId=generateRequestId();
  const headers={"Cache-Control":"private, no-store"};
  try {
    const organizationId=parseOrganizationId((await context.params).organizationId);
    const runtime=await roleRuntime();
    const actor=await resolveActorContext(organizationId,runtime.dependencies);
    const query=new URL(request.url).searchParams;
    if([...query.keys()].some(key=>!["document_id","effective_date"].includes(key))||!query.get("document_id")||!query.get("effective_date")) {
      throw CommandError.validation({query:"Credit document and effective date are required."});
    }
    const data=await readCreditApplicationOptions(runtime.client,actor,query.get("document_id")!,query.get("effective_date")!);
    return Response.json({data,meta:{request_id:requestId,replayed:false}},{headers});
  } catch(error) {
    const failure=normalizeCommandError(error);
    return Response.json(commandErrorBody(failure,requestId),{status:failure.status,headers});
  }
}
