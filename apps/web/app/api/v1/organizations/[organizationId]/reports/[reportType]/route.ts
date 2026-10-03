import { parseOrganizationId } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../../server/auth/resolve-actor.ts";
import { CommandError, commandErrorBody, normalizeCommandError } from "../../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../../server/commands/request-context.ts";
import { roleRuntime } from "../../../../../../../server/roles/runtime.ts";

const headers={"Cache-Control":"private, no-store"};
const reportCapabilities:Record<string,string>={trial_balance:"reports.read",general_ledger:"ledger.read",journal_register:"ledger.read",cashbook:"banking.read"};
export async function GET(request:Request,context:{params:Promise<{organizationId:string;reportType:string}>}){
 const requestId=generateRequestId();
 try{const params=await context.params;const organizationId=parseOrganizationId(params.organizationId);const required=reportCapabilities[params.reportType];if(!required)throw CommandError.notFound();
  const query=new URL(request.url).searchParams;const filters:Record<string,string>={};for(const [key,value] of query){if(Object.hasOwn(filters,key)||key==="format")throw CommandError.validation({query:"Use each report filter once."});filters[key]=value;}
  const allowed:Record<string,string[]>={trial_balance:["as_of","from"],general_ledger:["account","from","to","source","cost_center","after_date","after_journal","after_line","limit"],journal_register:["search","from","to","limit"],cashbook:["cash_account_id","from","to","limit"]};
  if(Object.keys(filters).some(key=>!allowed[params.reportType].includes(key)))throw CommandError.validation({query:"Unknown report filter."});
  const runtime=await roleRuntime();const actor=await resolveActorContext(organizationId,runtime.dependencies);if(!actor.capabilities.includes(required))throw CommandError.forbidden();
  const result=await runtime.client.rpc("read_report_snapshot",{p_organization_id:organizationId,p_report_type:params.reportType,p_filters:filters});if(result.error){if(result.error.code==="42501")throw CommandError.forbidden();if(result.error.code==="P0002")throw CommandError.notFound();if(["22023","22008","22P02","23503"].includes(result.error.code??""))throw CommandError.validation({query:"Choose valid filters for this report."});throw new Error("Report could not be generated.");}
  if(!result.data||typeof result.data!=="object"||Array.isArray(result.data))throw new Error("Invalid report snapshot response.");const snapshot=result.data as Record<string,unknown>;
  return Response.json({data:snapshot.data,meta:{request_id:requestId,...Object.fromEntries(Object.entries(snapshot).filter(([key])=>key!=="data"))}},{headers});
 }catch(error){const safe=normalizeCommandError(error);return Response.json(commandErrorBody(safe,requestId),{status:safe.status,headers});}
}
