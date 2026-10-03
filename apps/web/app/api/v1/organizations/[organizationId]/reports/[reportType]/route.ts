import { parseOrganizationId } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../../server/auth/resolve-actor.ts";
import { CommandError, commandErrorBody, normalizeCommandError } from "../../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../../server/commands/request-context.ts";
import { roleRuntime } from "../../../../../../../server/roles/runtime.ts";

const headers={"Cache-Control":"private, no-store"};
const reportCapabilities:Record<string,string>={trial_balance:"reports.read",profit_loss:"reports.read",balance_sheet:"reports.read",general_ledger:"ledger.read",journal_register:"ledger.read",cashbook:"banking.read"};
export async function GET(request:Request,context:{params:Promise<{organizationId:string;reportType:string}>}){
 const requestId=generateRequestId();
 try{const params=await context.params;const organizationId=parseOrganizationId(params.organizationId);const required=reportCapabilities[params.reportType];if(!required)throw CommandError.notFound();
  const query=new URL(request.url).searchParams;const filters:Record<string,string>={};let format:string|null=null;for(const [key,value] of query){if(key==="format"){if(format!==null)throw CommandError.validation({query:"Use each report filter once."});format=value;continue;}if(Object.hasOwn(filters,key))throw CommandError.validation({query:"Use each report filter once."});filters[key]=value;}
  if(format!==null&&(!["profit_loss","balance_sheet"].includes(params.reportType)||format!=="json"))throw CommandError.validation({format:"Only JSON export is supported for this report."});
  const allowed:Record<string,string[]>={trial_balance:["as_of","from"],profit_loss:["from","to","cost_center","comparison_from","comparison_to"],balance_sheet:["as_of","comparison_as_of"],general_ledger:["account","from","to","source","cost_center","after_date","after_journal","after_line","limit"],journal_register:["search","from","to","limit"],cashbook:["cash_account_id","from","to","limit"]};
  if(Object.keys(filters).some(key=>!allowed[params.reportType].includes(key)))throw CommandError.validation({query:"Unknown report filter."});
  const runtime=await roleRuntime();const actor=await resolveActorContext(organizationId,runtime.dependencies);if(!actor.capabilities.includes(required)||(format!==null&&!actor.capabilities.includes("reports.export")))throw CommandError.forbidden();
  const result=params.reportType==="profit_loss"
    ? await runtime.client.rpc("read_profit_loss_snapshot",{p_organization_id:organizationId,p_from:filters.from,p_to:filters.to,p_cost_center_id:filters.cost_center??null,p_comparison_from:filters.comparison_from??null,p_comparison_to:filters.comparison_to??null})
    : params.reportType==="balance_sheet"
      ? await runtime.client.rpc("read_balance_sheet_snapshot",{p_organization_id:organizationId,p_as_of:filters.as_of,p_comparison_as_of:filters.comparison_as_of??null})
    : await runtime.client.rpc("read_report_snapshot",{p_organization_id:organizationId,p_report_type:params.reportType,p_filters:filters});if(result.error){if(result.error.code==="42501")throw CommandError.forbidden();if(result.error.code==="P0002")throw CommandError.notFound();if(["22023","22008","22P02","23503"].includes(result.error.code??""))throw CommandError.validation({query:"Choose valid filters for this report."});throw new Error("Report could not be generated.");}
  if(!result.data||typeof result.data!=="object"||Array.isArray(result.data))throw new Error("Invalid report snapshot response.");const snapshot=result.data as Record<string,unknown>;
  if(format!==null)return new Response(JSON.stringify({data:snapshot.data,meta:{request_id:requestId,...Object.fromEntries(Object.entries(snapshot).filter(([key])=>key!=="data"))}},null,2),{headers:{...headers,"Content-Type":"application/json; charset=utf-8","Content-Disposition":`attachment; filename=\"${params.reportType.replaceAll("_","-")}-report.json\"`}});
  return Response.json({data:snapshot.data,meta:{request_id:requestId,...Object.fromEntries(Object.entries(snapshot).filter(([key])=>key!=="data"))}},{headers});
 }catch(error){const safe=normalizeCommandError(error);return Response.json(commandErrorBody(safe,requestId),{status:safe.status,headers});}
}
