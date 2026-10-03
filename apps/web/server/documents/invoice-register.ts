import { parseMoneyString, parseOrganizationId, parseUuid, type OrganizationId, type Uuid } from "@ams/contracts";
import type { RequestClient } from "../request-client.ts";
import { CommandError } from "../commands/errors.ts";
import type { ActorContext } from "../auth/types.ts";
import { record } from "./contracts.ts";

export type InvoiceTab = "all" | "drafts" | "awaiting_approval" | "posted";
export interface InvoiceRegisterRow {
  id: Uuid; organizationId: OrganizationId; state: string; documentNumber: string | null; customerName: string;
  issueDate: string; dueDate: string | null; totalAmount: string; residualAmount: string | null;
  settlementStatus: string; deliveryStatus: string; overdue: boolean;
}
export interface InvoiceRegisterPage { items: InvoiceRegisterRow[]; nextCursor: Uuid | null }
export async function readInvoiceRegister(client: Pick<RequestClient,"rpc">,actor:ActorContext,input:{status:InvoiceTab;search:string|null;after:string|null;limit:number}):Promise<InvoiceRegisterPage>{
  if(!actor.capabilities.includes("sales.read"))throw CommandError.forbidden();
  if(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>100||input.search!==null&&input.search.length>100)
    throw CommandError.validation({query:"Use a search under 100 characters and a page size of 1-100."});
  const after=input.after?parseUuid(input.after,"after"):null;
  const r=await client.rpc("read_invoice_register",{p_organization_id:actor.organizationId,p_status:input.status,p_search:input.search,p_after:after,p_limit:input.limit+1});
  if(r.error){if(r.error.code==="42501")throw CommandError.forbidden();if(r.error.code==="P0002")throw CommandError.notFound();if(r.error.code==="22023")throw CommandError.validation({query:"Invoice filters are invalid."});throw new Error("Invoice register could not be loaded.");}
  if(!Array.isArray(r.data)||r.data.length>input.limit+1)throw new Error("Invalid invoice register response.");
  const rows=r.data.map((value:unknown):InvoiceRegisterRow=>{const row=record(value,"invoice");
    if(row.organization_id!==actor.organizationId||typeof row.state!=="string"||(row.document_number!==null&&typeof row.document_number!=="string")||
      typeof row.customer_name!=="string"||typeof row.issue_date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(row.issue_date)||
      (row.due_date!==null&&(typeof row.due_date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(row.due_date)))||
      typeof row.total_amount!=="string"||typeof row.settlement_status!=="string"||typeof row.delivery_status!=="string"||typeof row.overdue!=="boolean")
      throw new Error("Invalid invoice register row.");
    return{id:parseUuid(row.id),organizationId:parseOrganizationId(row.organization_id),state:row.state,documentNumber:row.document_number,
      customerName:row.customer_name,issueDate:row.issue_date,dueDate:row.due_date,totalAmount:parseMoneyString(row.total_amount),
      residualAmount:row.residual_amount===null?null:parseMoneyString(row.residual_amount),settlementStatus:row.settlement_status,deliveryStatus:row.delivery_status,overdue:row.overdue};
  });
  const hasMore=rows.length>input.limit;const items=hasMore?rows.slice(0,input.limit):rows;
  return{items,nextCursor:hasMore?items.at(-1)?.id??null:null};
}
export async function readInvoiceLifecycle(client:Pick<RequestClient,"rpc">,actor:ActorContext,documentId:string){
  if(!actor.capabilities.includes("sales.read"))throw CommandError.forbidden();
  const r=await client.rpc("read_invoice_lifecycle",{p_organization_id:actor.organizationId,p_document_id:parseUuid(documentId,"document_id")});
  if(r.error){if(r.error.code==="42501")throw CommandError.forbidden();if(r.error.code==="P0002")throw CommandError.notFound();throw new Error("Invoice lifecycle could not be loaded.");}
  const lifecycle=record(r.data,"invoice_lifecycle");if(lifecycle.organization_id!==actor.organizationId||typeof lifecycle.state!=="string"||typeof lifecycle.overdue!=="boolean"||
    typeof lifecycle.settlement_status!=="string"||(lifecycle.residual_amount!==null&&typeof lifecycle.residual_amount!=="string")||
    !Array.isArray(lifecycle.allocations)||!Array.isArray(lifecycle.delivery_attempts)||!Array.isArray(lifecycle.approvals)||!Array.isArray(lifecycle.corrections)||
    !Array.isArray(lifecycle.attachments)||!Array.isArray(lifecycle.activity))throw new Error("Invalid invoice lifecycle response.");
  if(lifecycle.residual_amount!==null)parseMoneyString(lifecycle.residual_amount);
  return lifecycle;
}
