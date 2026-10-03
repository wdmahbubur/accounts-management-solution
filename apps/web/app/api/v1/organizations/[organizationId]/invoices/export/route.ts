import { parseOrganizationId } from "@ams/contracts";
import { resolveActorContext } from "../../../../../../../server/auth/resolve-actor.ts";
import { CommandError, commandErrorBody, normalizeCommandError } from "../../../../../../../server/commands/errors.ts";
import { generateRequestId } from "../../../../../../../server/commands/request-context.ts";
import { readInvoiceRegister, type InvoiceTab } from "../../../../../../../server/documents/invoice-register.ts";
import { roleRuntime } from "../../../../../../../server/roles/runtime.ts";

const statuses:InvoiceTab[]=["all","drafts","awaiting_approval","posted"];
function field(value:string){const safe=/^[=+\-@\t\r]/.test(value)?`'${value}`:value;return `"${safe.replaceAll('"','""')}"`;}
export async function GET(request:Request,context:{params:Promise<{organizationId:string}>}){
 const requestId=generateRequestId();try{const organizationId=parseOrganizationId((await context.params).organizationId);const runtime=await roleRuntime();const actor=await resolveActorContext(organizationId,runtime.dependencies);const q=new URL(request.url).searchParams;
  if([...q.keys()].some(key=>!( ["tab","search"] as string[]).includes(key)))throw CommandError.validation({query:"Unknown invoice export filter."});
  const tab=q.get("tab")??"all";const search=q.get("search")?.trim()??"";if(!statuses.includes(tab as InvoiceTab)||search.length>100)throw CommandError.validation({query:"Choose a valid invoice filter."});
  const items=[];let after:string|null=null;for(let pageNo=0;pageNo<100;pageNo++){const page=await readInvoiceRegister(runtime.client,actor,{status:tab as InvoiceTab,search:search||null,after,limit:100});items.push(...page.items);if(!page.nextCursor){after=null;break;}after=page.nextCursor;}
  if(after)throw CommandError.validation({export:"This export exceeds 10,000 rows. Narrow the filters and export again."});
  const lines=[["Invoice number","Customer","Issue date","Due date","Total BDT","Residual BDT","Settlement","Delivery","Overdue"],...items.map(i=>[i.documentNumber??"Draft",i.customerName,i.issueDate,i.dueDate??"",i.totalAmount,i.residualAmount??"",i.settlementStatus,i.deliveryStatus,i.overdue?"Yes":"No"])];
  const csv="\uFEFF"+lines.map(line=>line.map(field).join(",")).join("\r\n");return new Response(csv,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename=invoice-register.csv","Cache-Control":"private, no-store"}});
 }catch(error){const e=normalizeCommandError(error);return Response.json(commandErrorBody(e,requestId),{status:e.status,headers:{"Cache-Control":"private, no-store"}});}
}
