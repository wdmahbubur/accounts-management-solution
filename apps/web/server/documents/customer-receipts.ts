import { parseMoneyString, parseOrganizationId, parseUuid, type OrganizationId, type Uuid } from "@ams/contracts";
import type { RequestClient } from "../request-client.ts";
import { CommandError } from "../commands/errors.ts";
import type { ActorContext } from "../auth/types.ts";
import { record } from "./contracts.ts";

type RpcClient=Pick<RequestClient,"rpc">;
export interface ReceiptInvoiceTarget { openItemId:Uuid;documentId:Uuid;documentNumber:string|null;issueDate:string;dueDate:string|null;totalAmount:string;residualAmount:string }
export interface ReceiptRegisterRow { id:Uuid;organizationId:OrganizationId;state:string;documentNumber:string|null;customerName:string;issueDate:string;totalAmount:string;appliedAmount:string;unusedCredit:string;settlementStatus:string }
export async function readReceiptAllocationOptions(client:RpcClient,actor:ActorContext,partyId:string,accountingDate:string):Promise<ReceiptInvoiceTarget[]>{
 if(!actor.capabilities.includes("sales.write"))throw CommandError.forbidden();const party=parseUuid(partyId,"party_id");
 if(!/^\d{4}-\d{2}-\d{2}$/.test(accountingDate))throw CommandError.validation({accounting_date:"Choose a valid accounting date."});
 const r=await client.rpc("read_receipt_allocation_options",{p_organization_id:actor.organizationId,p_party_id:party,p_accounting_date:accountingDate});
 if(r.error){if(r.error.code==="42501")throw CommandError.forbidden();if(r.error.code==="P0002")throw CommandError.notFound();if(r.error.code==="22023")throw CommandError.validation({party_id:"Choose an active customer and valid accounting date."});throw new Error("Eligible invoices could not be loaded.");}
 if(!Array.isArray(r.data)||r.data.length>1000)throw new Error("Invalid eligible invoice response.");
 return r.data.map((value:unknown)=>{const row=record(value,"invoice");if(typeof row.issue_date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(row.issue_date)||
   row.due_date!==null&&(typeof row.due_date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(row.due_date))||
   (row.document_number!==null&&typeof row.document_number!=="string")||typeof row.total_amount!=="string"||typeof row.residual_amount!=="string")throw new Error("Invalid eligible invoice row.");
   return{openItemId:parseUuid(row.open_item_id),documentId:parseUuid(row.document_id),documentNumber:row.document_number,issueDate:row.issue_date,dueDate:row.due_date,
     totalAmount:parseMoneyString(row.total_amount),residualAmount:parseMoneyString(row.residual_amount)};});
}
export async function readReceiptRegister(client:RpcClient,actor:ActorContext,input:{status:"all"|"drafts"|"awaiting_approval"|"posted";search:string|null;after:string|null;limit:number}){
 if(!actor.capabilities.includes("sales.read"))throw CommandError.forbidden();if(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>100||input.search!==null&&input.search.length>100)throw CommandError.validation({query:"Use a search under 100 characters and a page size of 1-100."});
 const after=input.after?parseUuid(input.after,"after"):null;const r=await client.rpc("read_receipt_register",{p_organization_id:actor.organizationId,p_status:input.status,p_search:input.search,p_after:after,p_limit:input.limit+1});
 if(r.error){if(r.error.code==="42501")throw CommandError.forbidden();if(r.error.code==="P0002")throw CommandError.notFound();if(r.error.code==="22023")throw CommandError.validation({query:"Receipt filters are invalid."});throw new Error("Receipt register could not be loaded.");}
 if(!Array.isArray(r.data)||r.data.length>input.limit+1)throw new Error("Invalid receipt register response.");
 const items=r.data.map((value:unknown):ReceiptRegisterRow=>{const row=record(value,"receipt");if(row.organization_id!==actor.organizationId||typeof row.state!=="string"||
   (row.document_number!==null&&typeof row.document_number!=="string")||typeof row.customer_name!=="string"||typeof row.issue_date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(row.issue_date)||
   typeof row.total_amount!=="string"||typeof row.applied_amount!=="string"||typeof row.unused_credit!=="string"||typeof row.settlement_status!=="string")throw new Error("Invalid receipt row.");
  return{id:parseUuid(row.id),organizationId:parseOrganizationId(row.organization_id),state:row.state,documentNumber:row.document_number,customerName:row.customer_name,issueDate:row.issue_date,
    totalAmount:parseMoneyString(row.total_amount),appliedAmount:parseMoneyString(row.applied_amount),unusedCredit:parseMoneyString(row.unused_credit),settlementStatus:row.settlement_status};});
 const hasMore=items.length>input.limit;const page=hasMore?items.slice(0,input.limit):items;return{items:page,nextCursor:hasMore?page.at(-1)?.id??null:null};
}
export async function readReceiptLifecycle(client:RpcClient,actor:ActorContext,documentId:string){if(!actor.capabilities.includes("sales.read"))throw CommandError.forbidden();
 const r=await client.rpc("read_receipt_lifecycle",{p_organization_id:actor.organizationId,p_document_id:parseUuid(documentId,"document_id")});if(r.error){if(r.error.code==="42501")throw CommandError.forbidden();if(r.error.code==="P0002")throw CommandError.notFound();throw new Error("Receipt lifecycle could not be loaded.");}
 const row=record(r.data,"receipt_lifecycle");if(row.organization_id!==actor.organizationId||typeof row.state!=="string"||!Array.isArray(row.allocations)||!Array.isArray(row.corrections)||
   (row.residual_amount!==null&&typeof row.residual_amount!=="string")||typeof row.applied_amount!=="string")throw new Error("Invalid receipt lifecycle response.");
 if(row.residual_amount!==null)parseMoneyString(row.residual_amount);parseMoneyString(row.applied_amount);return row;
}
