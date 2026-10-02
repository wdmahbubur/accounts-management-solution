import { parseMoneyString, parseUuid } from "@ams/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CommandError } from "../commands/errors.ts";
import type { ActorContext } from "../auth/types.ts";
import { record } from "./contracts.ts";

type RpcClient=Pick<SupabaseClient,"rpc">;
export interface RefundTarget { openItemId:string;documentId:string;documentNumber:string|null;documentType:"customer_credit"|"customer_advance";controlKind:"ar"|"customer_advance";issueDate:string;dueDate:string|null;totalAmount:string;residualAmount:string }
export async function readRefundAllocationOptions(client:RpcClient,actor:ActorContext,partyId:string,accountingDate:string):Promise<RefundTarget[]>{
 if(!actor.capabilities.includes("sales.write")||!actor.capabilities.includes("banking.write")||!actor.capabilities.includes("dues.allocate"))throw CommandError.forbidden();
 const party=parseUuid(partyId,"party_id");if(!/^\d{4}-\d{2}-\d{2}$/.test(accountingDate))throw CommandError.validation({accounting_date:"Choose a valid accounting date."});
 const result=await client.rpc("read_customer_refund_allocation_options",{p_organization_id:actor.organizationId,p_party_id:party,p_accounting_date:accountingDate});
 if(result.error){if(result.error.code==="42501")throw CommandError.forbidden();if(result.error.code==="22023")throw CommandError.validation({party_id:"Choose an active customer and valid accounting date."});throw new Error("Eligible customer credits could not be loaded.");}
 if(!Array.isArray(result.data)||result.data.length>1000)throw new Error("Invalid eligible customer-credit response.");
 return result.data.map((value:unknown)=>{const row=record(value,"refund_target");if(typeof row.document_type!=="string"||!(["customer_credit","customer_advance"] as string[]).includes(row.document_type)||typeof row.control_kind!=="string"||!(["ar","customer_advance"] as string[]).includes(row.control_kind)||typeof row.issue_date!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(row.issue_date)||(row.due_date!==null&&(typeof row.due_date!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(row.due_date)))||(row.document_number!==null&&typeof row.document_number!=="string")||typeof row.total_amount!=="string"||typeof row.residual_amount!=="string")throw new Error("Invalid eligible customer-credit row.");
  return{openItemId:parseUuid(row.open_item_id),documentId:parseUuid(row.document_id),documentNumber:row.document_number,documentType:row.document_type as RefundTarget["documentType"],controlKind:row.control_kind as RefundTarget["controlKind"],issueDate:row.issue_date,dueDate:row.due_date,totalAmount:parseMoneyString(row.total_amount),residualAmount:parseMoneyString(row.residual_amount)};});
}
export async function readRefundLifecycle(client:RpcClient,actor:ActorContext,documentId:string){
 if(!actor.capabilities.includes("sales.read"))throw CommandError.forbidden();const result=await client.rpc("read_customer_refund_lifecycle",{p_organization_id:actor.organizationId,p_document_id:parseUuid(documentId,"document_id")});
 if(result.error){if(result.error.code==="42501")throw CommandError.forbidden();if(result.error.code==="P0002")throw CommandError.notFound();throw new Error("Customer refund history could not be loaded.");}
 const row=record(result.data,"refund_lifecycle");if(typeof row.state!=="string"||typeof row.total_amount!=="string"||typeof row.settled_amount!=="string"||!Array.isArray(row.allocations))throw new Error("Invalid refund history response.");parseMoneyString(row.total_amount);parseMoneyString(row.settled_amount);return row;
}
