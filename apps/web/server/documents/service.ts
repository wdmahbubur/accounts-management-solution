import type { SupabaseClient } from "@supabase/supabase-js";
import { capability } from "@ams/permissions";
import { calculateDocument, moneyUnits, formatMoney } from "@ams/accounting";
import { CommandError } from "../commands/errors.ts";
import type { ActorContext } from "../auth/types.ts";
import type { OrganizationCommandDefinition } from "../commands/types.ts";
import { record, documentDatabaseError, validateDraftDocument, type DraftDocument } from "./contracts.ts";

type RpcClient=Pick<SupabaseClient,"rpc">;
const typeCapability:Record<string,string>={invoice:"sales.write",customer_credit:"sales.write",receipt:"sales.write",customer_refund:"sales.write",customer_advance:"sales.write",
  bill:"purchases.write",vendor_credit:"purchases.write",paid_expense:"purchases.write",vendor_payment:"purchases.write",vendor_refund:"purchases.write",vendor_advance:"purchases.write",transfer:"banking.write"};
export interface SaveDraftReceipt { documentId:string; documentVersion:number; state:string; netAmount:string; taxAmount:string; totalAmount:string; materialDigest:string }
function validateSaveEnvelope(raw:unknown){const r=record(raw);if(Object.keys(r).some((key)=>!(["expected_version","draft"] as string[]).includes(key)))throw CommandError.validation({body:"Unexpected request field."});
  if(!Number.isSafeInteger(r.expected_version)||Number(r.expected_version)<1)throw CommandError.validation({expected_version:"Refresh the current document before saving."});
  return{expectedVersion:Number(r.expected_version),draft:validateDraftDocument(r.draft)};}
async function save(client:RpcClient,actor:ActorContext,request:{requestId:string;idempotencyKey:string|null;requestHash:string},draft:DraftDocument,documentId:string|null,expectedVersion:number|null):Promise<SaveDraftReceipt>{
  const required=typeCapability[draft.documentType]??"journal.write";if(!actor.capabilities.includes(required))throw CommandError.forbidden();
  if(draft.allocationPlan.length&&!actor.capabilities.includes("dues.read"))throw CommandError.forbidden();
  if(!request.idempotencyKey)throw CommandError.validation({idempotency_key:"A stable idempotency key is required."});
  const r=await client.rpc("save_financial_document",{p_organization_id:actor.organizationId,p_document_id:documentId,p_expected_version:expectedVersion,
    p_request_id:request.requestId,p_idempotency_key:request.idempotencyKey,p_request_hash:request.requestHash,p_payload:{document_type:draft.documentType,
      party_id:draft.partyId,issue_date:draft.issueDate,accounting_date:draft.accountingDate,due_date:draft.dueDate,external_reference:draft.externalReference,
      description:draft.description,currency:draft.currency,rounding_adjustment:draft.roundingAdjustment,rounding_reason:draft.roundingReason,rounding_account_id:draft.roundingAccountId,trade:draft.trade,movement:draft.movement,transfer:draft.transfer,
      lines:draft.lines.map((line)=>({id:line.id,item_id:line.itemId,original_line_id:line.originalLineId,description:line.description,quantity:line.quantity,
        unit_price:line.unitPrice,discount_amount:line.discountAmount,account_id:line.accountId,cost_center_id:line.costCenterId,tax_code_id:line.taxCodeId,
        tax_mode:line.taxMode,cash_flow_class:line.cashFlowClass})),journal_rows:draft.journalRows,
      allocation_plan:draft.allocationPlan.map((plan)=>({target_open_item_id:plan.targetOpenItemId,amount:plan.amount}))}});
  if(r.error)throw documentDatabaseError(r.error);if(!Array.isArray(r.data)||r.data.length!==1)throw new Error("Invalid document save receipt.");const row=record(r.data[0],"receipt");
  if(typeof row.document_id!=="string"||!Number.isSafeInteger(row.document_version)||typeof row.state!=="string"||typeof row.net_amount!=="string"||typeof row.tax_amount!=="string"||typeof row.total_amount!=="string"||typeof row.material_digest!=="string")throw new Error("Malformed document save receipt.");
  return{documentId:row.document_id,documentVersion:Number(row.document_version),state:row.state,netAmount:row.net_amount,taxAmount:row.tax_amount,totalAmount:row.total_amount,materialDigest:row.material_digest};
}
export function createDraftCommand(client:RpcClient):OrganizationCommandDefinition<DraftDocument,SaveDraftReceipt>{return{operation:"documents.save",capability:capability("documents.read"),idempotency:"required",validate:validateDraftDocument,
  execute:(context,input)=>save(client,context.actor,context,input,null,null)};}
export function updateDraftCommand(client:RpcClient,documentId:string):OrganizationCommandDefinition<{expectedVersion:number;draft:DraftDocument},SaveDraftReceipt>{return{operation:"documents.save",capability:capability("documents.read"),idempotency:"required",validate:validateSaveEnvelope,
  execute:(context,input)=>save(client,context.actor,context,input.draft,documentId,input.expectedVersion)};}
export async function readFinancialDocument(client:RpcClient,actor:ActorContext,documentId:string){
  const r=await client.rpc("read_financial_document",{p_organization_id:actor.organizationId,p_document_id:documentId});if(r.error)throw documentDatabaseError(r.error);
  return record(r.data,"document");
}
export async function readDraftOptions(client:RpcClient,actor:ActorContext,documentType:string,accountingDate:string){
  const permission=typeCapability[documentType]??"journal.write";if(!actor.capabilities.includes(permission))throw CommandError.forbidden();
  const r=await client.rpc("list_document_draft_options",{p_organization_id:actor.organizationId,p_document_type:documentType,p_accounting_date:accountingDate});
  if(r.error)throw documentDatabaseError(r.error);return record(r.data,"draft_options");
}
export async function previewFinancialDocument(client:RpcClient,actor:ActorContext,documentId:string,expectedVersion:number){
  const source=await readFinancialDocument(client,actor,documentId);const type=String(source.document_type);const required=typeCapability[type]??"journal.write";
  if(!actor.capabilities.includes(required))throw CommandError.forbidden();if(Number(source.version)!==expectedVersion)throw CommandError.conflict("STALE_VERSION");
  if(source.state==="posted"||source.state==="void")throw CommandError.validation({document:"Posted and void sources do not have an editable posting preview."});
  const rows=Array.isArray(source.lines)?source.lines.map((raw)=>record(raw,"line")):[];
  if(rows.length){
    const rounding=String(source.rounding_adjustment??"0.00");const preview=calculateDocument({currency:"BDT",lines:rows.map((line)=>({quantity:String(line.quantity),unit_price:String(line.unit_price),
      discount_amount:String(line.discount_amount),tax_rate:String(line.tax_rate_snapshot),tax_mode:String(line.tax_mode)})),
      ...(rounding==="0.00"?{}:{rounding:{amount:rounding,reason:String(source.rounding_reason),account_id:String(source.rounding_account_id)}})});
    return{documentId,documentVersion:expectedVersion,preview,warnings:["Preview only. No journal, settlement or cash movement is created."]};
  }
  const journal=Array.isArray(source.journal_rows)?source.journal_rows.map((raw)=>record(raw,"journal_row")):[];let debits=0n,credits=0n;
  for(const row of journal){debits+=moneyUnits(String(row.debit));credits+=moneyUnits(String(row.credit));}
  return{documentId,documentVersion:expectedVersion,preview:{currency:"BDT",debit:formatMoney(debits),credit:formatMoney(credits),balanced:debits===credits},
    warnings:[...(journal.length&&debits!==credits?["Journal draft is unbalanced."]:[]),"Preview only. No journal, settlement or cash movement is created."]};
}
