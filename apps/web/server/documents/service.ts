import type { RequestClient } from "../request-client.ts";
import { capability } from "@ams/permissions";
import { calculateDocument, moneyUnits, formatMoney } from "@ams/accounting";
import { cashPreviewTypes, parseCashPreviewDatabaseResult, type PostingPreviewResult } from "../../lib/posting-preview.ts";
import { readApprovalReview } from "../approvals/inbox-service.ts";
import { CommandError } from "../commands/errors.ts";
import type { ActorContext } from "../auth/types.ts";
import type { OrganizationCommandDefinition } from "../commands/types.ts";
import { record, documentDatabaseError, validateDraftDocument, validateAllocationPlanInput, type AllocationPlanInput, type DraftDocument } from "./contracts.ts";

type RpcClient=Pick<RequestClient,"rpc">;
const typeCapability:Record<string,string>={invoice:"sales.write",customer_credit:"sales.write",receipt:"sales.write",customer_refund:"sales.write",customer_advance:"sales.write",
  bill:"purchases.write",vendor_credit:"purchases.write",paid_expense:"purchases.write",vendor_payment:"purchases.write",vendor_refund:"purchases.write",vendor_advance:"purchases.write",transfer:"banking.write"};
export function canEditFinancialDocument(actor:Pick<ActorContext,"capabilities">,documentType:string){
  return actor.capabilities.includes(typeCapability[documentType]??"journal.write");
}
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
export function updateDraftCommand(client:RpcClient,documentId:string):OrganizationCommandDefinition<{expectedVersion:number;draft:DraftDocument},SaveDraftReceipt>{return{operation:`documents.save:${documentId}`,capability:capability("documents.read"),idempotency:"required",validate:validateSaveEnvelope,
  execute:(context,input)=>save(client,context.actor,context,input.draft,documentId,input.expectedVersion)};}
export function updateAllocationPlanCommand(client:RpcClient,documentId:string):OrganizationCommandDefinition<AllocationPlanInput,SaveDraftReceipt>{return{operation:`documents.allocation-plan:${documentId}`,capability:capability("documents.read"),idempotency:"required",validate:validateAllocationPlanInput,
  async execute(context,input){const source=await readFinancialDocument(client,context.actor,documentId);const type=String(source.document_type);const required=typeCapability[type];
    if(!required||!context.actor.capabilities.includes(required)||!context.actor.capabilities.includes("dues.read"))throw CommandError.forbidden();
    const r=await client.rpc("save_document_allocation_plan",{p_organization_id:context.actor.organizationId,p_document_id:documentId,p_expected_version:input.expectedVersion,
      p_request_id:context.requestId,p_idempotency_key:context.idempotencyKey,p_request_hash:context.requestHash,
      p_allocation_plan:input.allocationPlan.map((p)=>({target_open_item_id:p.targetOpenItemId,amount:p.amount}))});
    if(r.error)throw documentDatabaseError(r.error);if(!Array.isArray(r.data)||r.data.length!==1)throw new Error("Invalid allocation-plan receipt.");const row=record(r.data[0],"receipt");
    if(typeof row.document_id!=="string"||!Number.isSafeInteger(row.document_version)||typeof row.state!=="string"||typeof row.net_amount!=="string"||typeof row.tax_amount!=="string"||typeof row.total_amount!=="string"||typeof row.material_digest!=="string")throw new Error("Malformed allocation-plan receipt.");
    return{documentId:row.document_id,documentVersion:Number(row.document_version),state:row.state,netAmount:row.net_amount,taxAmount:row.tax_amount,totalAmount:row.total_amount,materialDigest:row.material_digest};
  }};}
export async function readFinancialDocument(client:RpcClient,actor:ActorContext,documentId:string){
  const r=await client.rpc("read_financial_document",{p_organization_id:actor.organizationId,p_document_id:documentId});if(r.error)throw documentDatabaseError(r.error);
  const document=record(r.data,"document");if(Array.isArray(document.lines)&&document.lines.length){
    const snapshots=await client.rpc("read_line_item_snapshots",{p_organization_id:actor.organizationId,p_document_id:documentId});if(snapshots.error)throw documentDatabaseError(snapshots.error);
    const byLine=new Map<string,{item:Record<string,unknown>|null;costCenter:Record<string,unknown>|null}>();if(Array.isArray(snapshots.data))for(const raw of snapshots.data){const row=record(raw,"line_snapshot");if(typeof row.line_id==="string")byLine.set(row.line_id,{item:row.snapshot&&typeof row.snapshot==="object"?record(row.snapshot,"item_snapshot"):null,costCenter:row.cost_center_snapshot&&typeof row.cost_center_snapshot==="object"?record(row.cost_center_snapshot,"cost_center_snapshot"):null});}
    document.lines=document.lines.map((raw)=>{const line=record(raw,"line");const snapshot=byLine.get(String(line.id));return{...line,item_snapshot:snapshot?.item??null,cost_center_snapshot:snapshot?.costCenter??null};});
  }
  return document;
}
export async function readDraftOptions(client:RpcClient,actor:ActorContext,documentType:string,accountingDate:string){
  const permission=typeCapability[documentType]??"journal.write";if(!actor.capabilities.includes(permission))throw CommandError.forbidden();
  const r=await client.rpc("list_document_draft_options",{p_organization_id:actor.organizationId,p_document_type:documentType,p_accounting_date:accountingDate});
  if(r.error)throw documentDatabaseError(r.error);return record(r.data,"draft_options");
}
function previewDatabaseError(error:{code?:string;message?:string},approval=false){
  if(error.code==="40001")return CommandError.conflict(approval?"APPROVAL_STALE":"STALE_VERSION");
  if(error.code==="23P01")return CommandError.conflict("ALLOCATION_EXCEEDED");
  if(error.code==="55P03")return CommandError.conflict("PERIOD_LOCKED");
  if(error.code==="22023"||error.code==="23514")return CommandError.validation({document:"The posting preview could not be prepared. Check the saved customer or supplier, cash accounts, account mappings and settlement targets."});
  return documentDatabaseError(error);
}
function sourceCalculationPreview(source:Record<string,unknown>,documentId:string,expectedVersion:number):PostingPreviewResult{
  const type=String(source.document_type);
  const rows=Array.isArray(source.lines)?source.lines.map(raw=>record(raw,"line")):[];
  const warnings=["Preview only. No journal, settlement or cash movement is created."];
  if(["invoice","customer_credit","bill","vendor_credit","paid_expense"].includes(type)&&rows.length){
    const rounding=String(source.rounding_adjustment??"0.00");
    const preview=calculateDocument({currency:"BDT",lines:rows.map(line=>({quantity:String(line.quantity),unit_price:String(line.unit_price),
      discount_amount:String(line.discount_amount),tax_rate:String(line.tax_rate_snapshot),tax_mode:String(line.tax_mode)})),
      ...(rounding==="0.00"?{}:{rounding:{amount:rounding,reason:String(source.rounding_reason),account_id:String(source.rounding_account_id)}})});
    return{documentId,documentVersion:expectedVersion,preview:{kind:"trade",...preview,descriptions:rows.map(row=>String(row.description??""))},warnings};
  }
  if(!["manual_journal","controlled_adjustment","opening_balance"].includes(type)){
    throw CommandError.validation({document:"A posting preview is not available for this source. Check its saved details."});
  }
  const journal=Array.isArray(source.journal_rows)?source.journal_rows.map(raw=>record(raw,"journal_row")):[];
  let debits=0n,credits=0n;
  const lines=journal.map((row,index)=>{
    debits+=moneyUnits(String(row.debit));credits+=moneyUnits(String(row.credit));
    return{lineNo:index+1,accountId:String(row.account_id),accountCode:null,accountName:null,partyName:null,
      description:String(row.description??""),debit:formatMoney(moneyUnits(String(row.debit))),credit:formatMoney(moneyUnits(String(row.credit)))};
  });
  const balanced=journal.length>=2&&debits>0n&&debits===credits;
  if(!balanced)warnings.unshift("The journal needs at least two lines with equal, positive debit and credit totals.");
  return{documentId,documentVersion:expectedVersion,preview:{kind:"journal",currency:"BDT",debit:formatMoney(debits),credit:formatMoney(credits),balanced,lines},warnings};
}
export async function previewFinancialDocument(client:RpcClient,actor:ActorContext,documentId:string,expectedVersion:number):Promise<PostingPreviewResult>{
  const source=await readFinancialDocument(client,actor,documentId);const type=String(source.document_type);const required=typeCapability[type]??"journal.write";
  if(!actor.capabilities.includes(required))throw CommandError.forbidden();if(Number(source.version)!==expectedVersion)throw CommandError.conflict("STALE_VERSION");
  if(source.state==="posted"||source.state==="void")throw CommandError.validation({document:"Posted and void sources do not have an editable posting preview."});
  if((cashPreviewTypes as readonly string[]).includes(type)){
    const result=await client.rpc("preview_cash_document_posting",{p_organization_id:actor.organizationId,p_document_id:documentId,p_expected_version:expectedVersion});
    if(result.error)throw previewDatabaseError(result.error);
    return parseCashPreviewDatabaseResult(result.data,documentId,expectedVersion);
  }
  return sourceCalculationPreview(source,documentId,expectedVersion);
}
export async function previewApprovalDocument(client:RpcClient,actor:ActorContext,approvalRequestId:string,expectedVersion:number):Promise<PostingPreviewResult>{
  if(!actor.capabilities.includes("approvals.read"))throw CommandError.forbidden();
  const review=await readApprovalReview(client,actor,approvalRequestId);
  const source=record(review.document,"document");const documentId=String(review.document_id);
  if(review.stale===true||review.document_version!==expectedVersion||Number(source.version)!==expectedVersion
    ||!["pending","approved"].includes(String(review.state))||!["pending_approval","approved"].includes(String(source.state)))throw CommandError.conflict("APPROVAL_STALE");
  if((cashPreviewTypes as readonly string[]).includes(String(source.document_type))){
    const result=await client.rpc("preview_approval_cash_posting",{p_organization_id:actor.organizationId,p_approval_request_id:approvalRequestId,p_expected_version:expectedVersion});
    if(result.error)throw previewDatabaseError(result.error,true);
    return parseCashPreviewDatabaseResult(result.data,documentId,expectedVersion);
  }
  return sourceCalculationPreview(source,documentId,expectedVersion);
}
