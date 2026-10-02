import { parseMoneyString, parseOrganizationId, parseUuid, type OrganizationId, type Uuid } from "@ams/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CommandError } from "../commands/errors.ts";
import type { ActorContext } from "../auth/types.ts";
import { record } from "./contracts.ts";

type RpcClient=Pick<SupabaseClient,"rpc">;
export type BillTab="all"|"drafts"|"awaiting_approval"|"posted";
export interface SupplierBillRow {
  id:Uuid;organizationId:OrganizationId;state:string;documentNumber:string|null;vendorName:string;invoiceReference:string|null;
  invoiceDate:string|null;issueDate:string;accountingDate:string;dueDate:string|null;totalAmount:string;residualAmount:string|null;
  settlementStatus:string;overdue:boolean;duplicateReference:boolean;
}
export interface DuplicateBillReference { documentId:Uuid;documentNumber:string|null;state:string;supplierInvoiceDate:string|null }
export async function readSupplierBillRegister(client:RpcClient,actor:ActorContext,input:{status:BillTab;search:string|null;after:string|null;limit:number}){
  if(!actor.capabilities.includes("purchases.read"))throw CommandError.forbidden();
  if(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>100||input.search!==null&&input.search.length>100)
    throw CommandError.validation({query:"Use a search under 100 characters and a page size of 1-100."});
  const after=input.after?parseUuid(input.after,"after"):null;
  const r=await client.rpc("read_supplier_bill_register",{p_organization_id:actor.organizationId,p_status:input.status,p_search:input.search,p_after:after,p_limit:input.limit+1});
  if(r.error){if(r.error.code==="42501")throw CommandError.forbidden();if(r.error.code==="P0002")throw CommandError.notFound();if(r.error.code==="22023")throw CommandError.validation({query:"Bill filters are invalid."});throw new Error("Supplier bill register could not be loaded.");}
  if(!Array.isArray(r.data)||r.data.length>input.limit+1)throw new Error("Invalid supplier bill register response.");
  const rows=r.data.map((value:unknown):SupplierBillRow=>{const row=record(value,"bill");
    if(row.organization_id!==actor.organizationId||typeof row.state!=="string"||(row.document_number!==null&&typeof row.document_number!=="string")||
      typeof row.vendor_name!=="string"||(row.supplier_invoice_reference!==null&&typeof row.supplier_invoice_reference!=="string")||
      !validNullableDate(row.supplier_invoice_date)||!validDate(row.issue_date)||!validDate(row.accounting_date)||!validNullableDate(row.due_date)||
      typeof row.total_amount!=="string"||(row.residual_amount!==null&&typeof row.residual_amount!=="string")||typeof row.settlement_status!=="string"||
      typeof row.overdue!=="boolean"||typeof row.duplicate_reference!=="boolean")throw new Error("Invalid supplier bill row.");
    return{id:parseUuid(row.id),organizationId:parseOrganizationId(row.organization_id),state:row.state,documentNumber:row.document_number,vendorName:row.vendor_name,
      invoiceReference:row.supplier_invoice_reference,invoiceDate:row.supplier_invoice_date,issueDate:row.issue_date,accountingDate:row.accounting_date,dueDate:row.due_date,
      totalAmount:parseMoneyString(row.total_amount),residualAmount:row.residual_amount===null?null:parseMoneyString(row.residual_amount),settlementStatus:row.settlement_status,
      overdue:row.overdue,duplicateReference:row.duplicate_reference};
  });
  const hasMore=rows.length>input.limit;const items=hasMore?rows.slice(0,input.limit):rows;return{items,nextCursor:hasMore?items.at(-1)?.id??null:null};
}
export async function findDuplicateSupplierBillReferences(client:RpcClient,actor:ActorContext,input:{partyId:string;reference:string;excludeDocumentId?:string}):Promise<DuplicateBillReference[]>{
  if(!actor.capabilities.includes("purchases.write"))throw CommandError.forbidden();const partyId=parseUuid(input.partyId,"party_id");
  const reference=input.reference.trim();if(reference.length<1||reference.length>160)throw CommandError.validation({reference:"Enter a supplier invoice reference up to 160 characters."});
  const excludeDocumentId=input.excludeDocumentId?parseUuid(input.excludeDocumentId,"document_id"):null;
  const r=await client.rpc("find_duplicate_supplier_bill_reference",{p_organization_id:actor.organizationId,p_party_id:partyId,p_reference:reference,p_exclude_document_id:excludeDocumentId});
  if(r.error){if(r.error.code==="42501")throw CommandError.forbidden();if(r.error.code==="P0002")throw CommandError.notFound();if(r.error.code==="22023")throw CommandError.validation({party_id:"Choose an active supplier and valid invoice reference."});throw new Error("Duplicate supplier references could not be checked.");}
  if(!Array.isArray(r.data)||r.data.length>25)throw new Error("Invalid duplicate supplier reference response.");
  return r.data.map((value:unknown)=>{const row=record(value,"duplicate_reference");if((row.document_number!==null&&typeof row.document_number!=="string")||typeof row.document_state!=="string"||!validNullableDate(row.supplier_invoice_date))throw new Error("Invalid duplicate supplier reference row.");
    return{documentId:parseUuid(row.document_id),documentNumber:row.document_number,state:row.document_state,supplierInvoiceDate:row.supplier_invoice_date};});
}
export async function readSupplierBillLifecycle(client:RpcClient,actor:ActorContext,documentId:string){
  if(!actor.capabilities.includes("purchases.read"))throw CommandError.forbidden();const r=await client.rpc("read_supplier_bill_lifecycle",{p_organization_id:actor.organizationId,p_document_id:parseUuid(documentId,"document_id")});
  if(r.error){if(r.error.code==="42501")throw CommandError.forbidden();if(r.error.code==="P0002")throw CommandError.notFound();throw new Error("Supplier bill lifecycle could not be loaded.");}
  const row=record(r.data,"bill_lifecycle");if(row.organization_id!==actor.organizationId||typeof row.state!=="string"||typeof row.settlement_status!=="string"||typeof row.overdue!=="boolean"||
    typeof row.duplicate_reference!=="boolean"||(row.residual_amount!==null&&typeof row.residual_amount!=="string")||typeof row.applied_amount!=="string"||!Array.isArray(row.allocations)||!Array.isArray(row.approvals)||
    !Array.isArray(row.attachments)||!Array.isArray(row.activity)||!Array.isArray(row.corrections))throw new Error("Invalid supplier bill lifecycle response.");
  if(row.residual_amount!==null)parseMoneyString(row.residual_amount);parseMoneyString(row.applied_amount);return row;
}
function validDate(value:unknown):value is string{return typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value);}
function validNullableDate(value:unknown):value is string|null{return value===null||validDate(value);}
