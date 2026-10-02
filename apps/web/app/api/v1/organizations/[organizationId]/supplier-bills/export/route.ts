import {parseOrganizationId} from "@ams/contracts";
import {resolveActorContext} from "../../../../../../../server/auth/resolve-actor.ts";
import {commandErrorBody,normalizeCommandError} from "../../../../../../../server/commands/errors.ts";
import {generateRequestId} from "../../../../../../../server/commands/request-context.ts";
import {readSupplierBillRegister,type BillTab} from "../../../../../../../server/documents/supplier-bills.ts";
import {roleRuntime} from "../../../../../../../server/roles/runtime.ts";
const tabs:BillTab[]=["all","drafts","awaiting_approval","posted"];
function cell(value:string|null){const safe=value??"";const guarded=/^[=+\-@\t\r]/.test(safe)?`'${safe}`:safe;return `"${guarded.replaceAll('"','""')}"`;}
export async function GET(request:Request,context:{params:Promise<{organizationId:string}>}){
 const requestId=generateRequestId();try{const organizationId=parseOrganizationId((await context.params).organizationId);const runtime=await roleRuntime();const actor=await resolveActorContext(organizationId,runtime.dependencies);
  const q=new URL(request.url).searchParams;if([...q.keys()].some(k=>!(["tab","search"] as string[]).includes(k)))throw new Error("Invalid export query.");
  const tab=tabs.includes(q.get("tab") as BillTab)?q.get("tab") as BillTab:"all";const search=(q.get("search")??"").trim().slice(0,100)||null;
  const rows=[];let after:string|null=null;for(let pageNo=0;pageNo<100;pageNo++){const page=await readSupplierBillRegister(runtime.client,actor,{status:tab,search,after,limit:100});rows.push(...page.items);after=page.nextCursor;if(!after)break;}
  if(after)throw new Error("Export exceeds the 10,000 row limit. Narrow the filters and try again.");
  const header=["Bill number","Supplier","Supplier invoice reference","Supplier invoice date","Bill date","Accounting date","Due date","Total BDT","AP residual BDT","Settlement","Duplicate reference","Overdue","State"];
  const lines=[header,...rows.map(row=>[row.documentNumber,row.vendorName,row.invoiceReference,row.invoiceDate,row.issueDate,row.accountingDate,row.dueDate,row.totalAmount,row.residualAmount,row.settlementStatus,row.duplicateReference?"yes":"no",row.overdue?"yes":"no",row.state])].map(line=>line.map(value=>cell(value===null?null:String(value))).join(","));
  return new Response(`\uFEFF${lines.join("\r\n")}`,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename=\"supplier-bills.csv\"","Cache-Control":"private, no-store"}});
 }catch(error){const e=normalizeCommandError(error);return Response.json(commandErrorBody(e,requestId),{status:e.status,headers:{"Cache-Control":"private, no-store"}});}
}
