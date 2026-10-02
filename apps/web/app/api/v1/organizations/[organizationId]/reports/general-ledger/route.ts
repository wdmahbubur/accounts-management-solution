import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../../server/auth/resolve-actor.ts";
import { CommandError, commandErrorBody, normalizeCommandError } from "../../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../../server/commands/request-context.ts";
import { roleRuntime } from "../../../../../../../server/roles/runtime.ts";

const headers={"Cache-Control":"private, no-store"};const date=(v:string|null)=>{if(v===null||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const parsed=new Date(`${v}T00:00:00.000Z`);return Number.isFinite(parsed.valueOf())&&parsed.toISOString().slice(0,10)===v;};
export async function GET(request:Request,context:{params:Promise<{organizationId:string}>}){
 const requestId=generateRequestId();try{const organizationId=parseOrganizationId((await context.params).organizationId),q=new URL(request.url).searchParams;
  const accountId=parseUuid(q.get("account")??"","account"),from=q.get("from"),to=q.get("to"),source=q.get("source"),center=q.get("cost_center"),afterDate=q.get("after_date"),afterJournal=q.get("after_journal"),afterLine=q.get("after_line"),limitText=q.get("limit");
  const limit=limitText===null?500:Number(limitText);if(from===null||to===null||!date(from)||!date(to)||from>to||source&&source.length>100||!Number.isSafeInteger(limit)||limit<1||limit>500||Boolean(afterDate)!==Boolean(afterJournal)||Boolean(afterDate)!==Boolean(afterLine)||(afterDate&&!date(afterDate))||(afterJournal&&!parseUuid(afterJournal))||(afterLine&&(!/^\d+$/.test(afterLine)||Number(afterLine)<1)))throw CommandError.validation({query:"Choose valid account, date, search and cursor filters."});
  const runtime=await roleRuntime();const actor=await resolveActorContext(organizationId,runtime.dependencies);if(!actor.capabilities.includes("ledger.read"))throw CommandError.forbidden();
  const [opening,result]=await Promise.all([runtime.client.rpc("read_general_ledger_opening",{p_organization_id:organizationId,p_account_id:accountId,p_from:from,p_source:source,p_cost_center_id:center?parseUuid(center):null}),runtime.client.rpc("read_general_ledger",{p_organization_id:organizationId,p_account_id:accountId,p_from:from,p_to:to,p_source:source,p_cost_center_id:center?parseUuid(center):null,p_after_date:afterDate,p_after_journal_id:afterJournal,p_after_line_no:afterLine?Number(afterLine):null,p_limit:limit+1})]);
  if(opening.error||result.error){const code=opening.error?.code??result.error?.code;if(code==="42501")throw CommandError.forbidden();if(code==="22023"||code==="P0002")throw CommandError.validation({query:"Choose valid ledger filters and an account in this company."});throw new Error("General ledger could not be loaded.");}
  if(!Array.isArray(result.data)||result.data.length>limit+1||typeof opening.data!=="string")throw new Error("Invalid general ledger response.");return Response.json({data:result.data.slice(0,limit),meta:{request_id:requestId,replayed:false,opening_balance:opening.data,has_more:result.data.length>limit}},{headers});
 }catch(error){const e=normalizeCommandError(error);return Response.json(commandErrorBody(e,requestId),{status:e.status,headers});}
}
