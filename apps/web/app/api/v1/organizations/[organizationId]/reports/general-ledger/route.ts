import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../../server/auth/resolve-actor.ts";
import { commandErrorBody, normalizeCommandError, CommandError } from "../../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../../server/commands/request-context.ts";
import { decodeLedgerCursor, encodeLedgerCursor, readGeneralLedger } from "../../../../../../../server/reports/ledger.ts";
import { roleRuntime } from "../../../../../../../server/roles/runtime.ts";
export async function GET(request:Request,context:{params:Promise<{organizationId:string}>}) {
 const requestId=generateRequestId();try{const organizationId=parseOrganizationId((await context.params).organizationId),q=new URL(request.url).searchParams,allowed=["account","from","to","cost_center","source","cutoff","cursor"];
  if([...q.keys()].some(k=>!allowed.includes(k))||!q.get("account")||!q.get("from")||!q.get("to"))throw CommandError.validation({query:"Account and from/to dates are required; unknown filters are not accepted."});
  const runtime=await roleRuntime(),actor=await resolveActorContext(organizationId,runtime.dependencies),data=await readGeneralLedger(runtime.client,actor,{accountId:q.get("account")!,from:q.get("from")!,to:q.get("to")!,costCenterId:q.get("cost_center")??undefined,source:q.get("source")??undefined,cutoff:q.get("cutoff")??undefined,cursor:decodeLedgerCursor(q.get("cursor")??undefined)}),last=data.items.at(-1);
  const nextCursor=data.hasMore&&last?encodeLedgerCursor({accounting_date:String(last.accounting_date),posted_at:String(last.posted_at),journal_entry_id:parseUuid(last.journal_entry_id),line_no:Number(last.line_no)}):null;
  return Response.json({data:{...data,nextCursor},meta:{request_id:requestId,replayed:false}},{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){const e=normalizeCommandError(error);return Response.json(commandErrorBody(e,requestId),{status:e.status,headers:{"Cache-Control":"private, no-store"}});}
}
