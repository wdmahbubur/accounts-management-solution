import { parseOrganizationId } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../../server/auth/resolve-actor.ts";
import { commandErrorBody, normalizeCommandError, CommandError } from "../../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../../server/commands/request-context.ts";
import { readTrialBalance } from "../../../../../../../server/reports/ledger.ts";
import { roleRuntime } from "../../../../../../../server/roles/runtime.ts";
export async function GET(request:Request,context:{params:Promise<{organizationId:string}>}) {
 const requestId=generateRequestId();try{const organizationId=parseOrganizationId((await context.params).organizationId),q=new URL(request.url).searchParams;
  if([...q.keys()].some(k=>!["as_of","from","cutoff"].includes(k))||!q.get("as_of"))throw CommandError.validation({query:"As-of date is required; unknown filters are not accepted."});
  const runtime=await roleRuntime(),actor=await resolveActorContext(organizationId,runtime.dependencies),data=await readTrialBalance(runtime.client,actor,{asOf:q.get("as_of")!,from:q.get("from")??undefined,cutoff:q.get("cutoff")??undefined});
  return Response.json({data,meta:{request_id:requestId,replayed:false}},{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){const e=normalizeCommandError(error);return Response.json(commandErrorBody(e,requestId),{status:e.status,headers:{"Cache-Control":"private, no-store"}});}
}
