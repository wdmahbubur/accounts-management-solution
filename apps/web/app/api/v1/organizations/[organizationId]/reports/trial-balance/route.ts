import { formatMoney, moneyUnits } from "@ams/accounting";
import { parseOrganizationId } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../../server/auth/resolve-actor.ts";
import { CommandError, commandErrorBody, normalizeCommandError } from "../../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../../server/commands/request-context.ts";
import { roleRuntime } from "../../../../../../../server/roles/runtime.ts";

const headers={"Cache-Control":"private, no-store"};const date=(v:string|null)=>{if(v===null||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const parsed=new Date(`${v}T00:00:00.000Z`);return Number.isFinite(parsed.valueOf())&&parsed.toISOString().slice(0,10)===v;};
export async function GET(request:Request,context:{params:Promise<{organizationId:string}>}){
 const requestId=generateRequestId();try{const organizationId=parseOrganizationId((await context.params).organizationId),q=new URL(request.url).searchParams,asOf=q.get("as_of"),from=q.get("from");if(asOf===null||!date(asOf)||from!==null&&(!date(from)||from>asOf))throw CommandError.validation({query:"Choose valid reporting dates."});
  const runtime=await roleRuntime();const actor=await resolveActorContext(organizationId,runtime.dependencies);if(!actor.capabilities.includes("reports.read"))throw CommandError.forbidden();const result=await runtime.client.rpc("read_trial_balance",{p_organization_id:organizationId,p_as_of:asOf,p_from:from});if(result.error){if(result.error.code==="42501")throw CommandError.forbidden();if(result.error.code==="22023")throw CommandError.validation({query:"Choose valid reporting dates."});throw new Error("Trial balance could not be loaded.");}if(!Array.isArray(result.data))throw new Error("Invalid trial balance response.");
  const rows=result.data as Record<string,string>[],debit=rows.reduce((sum,row)=>sum+moneyUnits(row.closing_debit),0n),credit=rows.reduce((sum,row)=>sum+moneyUnits(row.closing_credit),0n),difference=debit-credit;return Response.json({data:rows,meta:{request_id:requestId,replayed:false,as_of:asOf,movement_from:from,total_debit:formatMoney(debit),total_credit:formatMoney(credit),difference:formatMoney(difference),balanced:difference===0n}},{headers});
 }catch(error){const e=normalizeCommandError(error);return Response.json(commandErrorBody(e,requestId),{status:e.status,headers});}
}
