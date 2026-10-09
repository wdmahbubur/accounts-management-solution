import { parseMoneyString, parseUuid, type Uuid } from "@ams/contracts";
import type { RequestClient } from "../request-client.ts";
import type { ActorContext } from "../auth/types.ts";
import { CommandError } from "../commands/errors.ts";
import { record } from "./contracts.ts";

type RpcClient = Pick<RequestClient,"rpc">;
export interface SupplierBillTarget {
  openItemId:Uuid; documentId:Uuid; documentNumber:string|null; supplierReference:string|null;
  issueDate:string; dueDate:string|null; totalAmount:string; residualAmount:string; availableAmount:string;
}
export type SupplierDocumentLifecycle = {
  id:Uuid; organization_id:string; document_type:"bill"|"vendor_payment"; state:string; as_of_date:string;
  total_amount:string; residual_amount:string|null; applied_amount:string; settlement_status:string; overdue:boolean;
  allocations:{id:Uuid;amount:string;effective_date:string;counter_document_id:Uuid|null;counter_document_type:string|null;counter_document_number:string|null;reversed_on:string|null}[];
  corrections:{id:Uuid;document_type:string;document_number:string|null;state:string;accounting_date:string;reason:string|null}[];
};
const statuses = new Set(["not_posted","not_yet_effective","unpaid","partially_paid","paid","unallocated","partially_allocated","fully_allocated","reversed"]);
function validDate(value:unknown):value is string {
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const parsed=new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf())&&parsed.toISOString().slice(0,10)===value;
}
function date(value:unknown):string {if(!validDate(value))throw new Error("Invalid supplier document date.");return value;}
function optionalText(value:unknown):string|null {if(value===null)return null;if(typeof value!=="string")throw new Error("Invalid supplier document text.");return value;}
function requiredText(value:unknown):string {if(typeof value!=="string")throw new Error("Invalid supplier document text.");return value;}
function rows(value:unknown):Record<string,unknown>[] {if(!Array.isArray(value))throw new Error("Invalid supplier document rows.");return value.map(item=>record(item,"supplier_document_row"));}
function databaseError(error:{code?:string}):never {
  if(error.code==="42501")throw CommandError.forbidden();
  if(error.code==="P0002")throw CommandError.notFound();
  if(error.code==="22023"||error.code==="22007"||error.code==="22008")throw CommandError.validation({party_id:"Choose an active supplier and a valid accounting date."});
  if(error.code==="23514")throw CommandError.validation({document:"Supplier balances could not be read. Check the payable account mapping and saved source."});
  throw new Error("Supplier settlement information could not be loaded.");
}

export async function readSupplierPaymentAllocationOptions(client:RpcClient,actor:ActorContext,partyId:string,accountingDate:string):Promise<SupplierBillTarget[]> {
  if(!["purchases.write","documents.read","dues.read"].every(code=>actor.capabilities.includes(code)))throw CommandError.forbidden();
  const party=parseUuid(partyId,"party_id");
  if(!validDate(accountingDate))throw CommandError.validation({accounting_date:"Choose a valid accounting date."});
  const result=await client.rpc("read_supplier_payment_allocation_options",{p_organization_id:actor.organizationId,p_party_id:party,p_accounting_date:accountingDate});
  if(result.error)databaseError(result.error);
  if(!Array.isArray(result.data))throw new Error("Invalid eligible supplier bill response.");
  if(result.data.length>1000)throw CommandError.validation({party_id:"More than 1,000 eligible bills were found. The complete bill list could not be loaded."});
  const seen=new Set<string>();
  return result.data.map(value=>{
    const row=record(value,"supplier_bill");
    if(row.organization_id!==actor.organizationId||row.party_id!==party)throw new Error("Invalid supplier bill scope.");
    const target:SupplierBillTarget={openItemId:parseUuid(row.open_item_id),documentId:parseUuid(row.document_id),documentNumber:optionalText(row.document_number),
      supplierReference:optionalText(row.supplier_reference),issueDate:date(row.issue_date),dueDate:row.due_date===null?null:date(row.due_date),
      totalAmount:parseMoneyString(row.total_amount),residualAmount:parseMoneyString(row.residual_amount),availableAmount:parseMoneyString(row.available_amount)};
    const units=(amount:string)=>BigInt(amount.replace(".",""));
    if(seen.has(target.openItemId)||units(target.availableAmount)<=0n||units(target.availableAmount)>units(target.residualAmount)||units(target.residualAmount)>units(target.totalAmount))throw new Error("Invalid supplier bill capacity.");
    seen.add(target.openItemId);return target;
  });
}

export async function readSupplierDocumentLifecycle(client:RpcClient,actor:ActorContext,documentId:string):Promise<SupplierDocumentLifecycle> {
  if(!actor.capabilities.includes("purchases.read"))throw CommandError.forbidden();
  const id=parseUuid(documentId,"document_id");
  const result=await client.rpc("read_supplier_document_lifecycle",{p_organization_id:actor.organizationId,p_document_id:id});
  if(result.error)databaseError(result.error);
  const row=record(result.data,"supplier_document_lifecycle");
  if(row.id!==id||row.organization_id!==actor.organizationId||!["bill","vendor_payment"].includes(String(row.document_type))||
    typeof row.overdue!=="boolean"||typeof row.settlement_status!=="string"||!statuses.has(row.settlement_status))throw new Error("Invalid supplier document lifecycle.");
  return {id,organization_id:actor.organizationId,document_type:row.document_type as "bill"|"vendor_payment",state:requiredText(row.state),as_of_date:date(row.as_of_date),
    total_amount:parseMoneyString(row.total_amount),residual_amount:row.residual_amount===null?null:parseMoneyString(row.residual_amount),applied_amount:parseMoneyString(row.applied_amount),
    settlement_status:row.settlement_status,overdue:row.overdue,
    allocations:rows(row.allocations).map(item=>({id:parseUuid(item.id),amount:parseMoneyString(item.amount),effective_date:date(item.effective_date),
      counter_document_id:item.counter_document_id===null?null:parseUuid(item.counter_document_id),counter_document_type:optionalText(item.counter_document_type),
      counter_document_number:optionalText(item.counter_document_number),reversed_on:item.reversed_on===null?null:date(item.reversed_on)})),
    corrections:rows(row.corrections).map(item=>({id:parseUuid(item.id),document_type:requiredText(item.document_type),document_number:optionalText(item.document_number),
      state:requiredText(item.state),accounting_date:date(item.accounting_date),reason:optionalText(item.reason)}))};
}
