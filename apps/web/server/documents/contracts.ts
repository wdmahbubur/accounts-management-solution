import { parseMoneyString, parseUuid, type MoneyString, type Uuid } from "@ams/contracts";
import { CommandError } from "../commands/errors.ts";

export const sourceTypes = ["invoice","customer_credit","bill","vendor_credit","paid_expense","receipt","vendor_payment","customer_refund","vendor_refund","customer_advance","vendor_advance","transfer","manual_journal","controlled_adjustment","opening_balance"] as const;
export type SourceType = typeof sourceTypes[number];
export interface DraftLine { id: Uuid|null; itemId: Uuid|null; originalLineId: Uuid|null; description: string; quantity: string; unitPrice: string; discountAmount: MoneyString; accountId: Uuid; costCenterId: Uuid|null; taxCodeId: Uuid|null; taxMode: "inclusive"|"exclusive"; cashFlowClass: string|null }
export interface DraftDocument {
  documentType: SourceType; partyId: Uuid|null; issueDate: string; accountingDate: string; dueDate: string|null;
  externalReference: string|null; description: string; currency: "BDT"; roundingAdjustment: MoneyString; roundingReason:string|null; roundingAccountId:Uuid|null;
  trade: Record<string, unknown>|null; movement: Record<string, unknown>|null; transfer: Record<string, unknown>|null;
  lines: DraftLine[]; journalRows: Record<string, unknown>[]; allocationPlan: { targetOpenItemId: Uuid; amount: MoneyString }[];
}
export function record(raw: unknown, field="body"): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw CommandError.validation({ [field]: "Expected an object." });
  return raw as Record<string, unknown>;
}
function exactKeys(r: Record<string,unknown>,keys:readonly string[],field:string){if(Object.keys(r).some((key)=>!keys.includes(key)))throw CommandError.validation({[field]:"Unexpected field."});}
function text(value:unknown,field:string,max:number,empty=false){if(typeof value!=="string"||value.trim().length>max||(!empty&&!value.trim()))throw CommandError.validation({[field]:`Use ${empty?"0":1}-${max} characters.`});return value.trim();}
function date(value:unknown,field:string,nullable=false):string|null{if(nullable&&value===null)return null;if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value)){throw CommandError.validation({[field]:"Use a valid calendar date."});}const d=new Date(`${value}T00:00:00Z`);if(Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==value)throw CommandError.validation({[field]:"Use a valid calendar date."});return value;}
function decimal(value:unknown,field:string,scale:number){const pattern=scale===6?/^(0|[1-9]\d{0,13})(?:\.\d{1,6})?$/:/^(0|[1-9]\d{0,13})(?:\.\d{1,2})?$/;if(typeof value!=="string"||!pattern.test(value))throw CommandError.validation({[field]:`Use a non-negative decimal with at most ${scale} fractional digits.`});return value;}
function idOrNull(value:unknown,field:string):Uuid|null{return value===null?null:parseUuid(value,field);}
function enumValue(value:unknown,values:readonly string[],field:string){if(typeof value!=="string"||!values.includes(value))throw CommandError.validation({[field]:"Choose a supported value."});return value;}
function jsonObject(value:unknown,keys:readonly string[],field:string):Record<string,unknown>|null{if(value===undefined||value===null)return null;const r=record(value,field);exactKeys(r,keys,field);return r;}
export function validateDraftDocument(raw:unknown):DraftDocument{
  const r=record(raw);exactKeys(r,["document_type","party_id","issue_date","accounting_date","due_date","external_reference","description","currency","rounding_adjustment","rounding_reason","rounding_account_id","trade","movement","transfer","lines","journal_rows","allocation_plan"],"body");
  const documentType=enumValue(r.document_type,sourceTypes,"document_type") as SourceType;
  if(r.currency!=="BDT")throw CommandError.validation({currency:"V1 supports BDT only."});
  if(!Array.isArray(r.lines)||r.lines.length>500)throw CommandError.validation({lines:"Use up to 500 document lines."});
  if(!Array.isArray(r.journal_rows)||r.journal_rows.length>1000)throw CommandError.validation({journal_rows:"Use up to 1,000 journal rows."});
  const allocationPlanRaw=r.allocation_plan??[];if(!Array.isArray(allocationPlanRaw)||allocationPlanRaw.length>100)throw CommandError.validation({allocation_plan:"Use up to 100 settlement targets."});
  const allocationPlan=allocationPlanRaw.map((item,index)=>{const plan=record(item,`allocation_plan.${index+1}`);exactKeys(plan,["target_open_item_id","amount"],`allocation_plan.${index+1}`);const amount=parseMoneyString(plan.amount,`allocation_plan.${index+1}.amount`);if(BigInt(amount.replace(".",""))<=0n)throw CommandError.validation({[`allocation_plan.${index+1}.amount`]:"Enter an amount greater than zero."});return{targetOpenItemId:parseUuid(plan.target_open_item_id,"target_open_item_id"),amount};});
  const lines=r.lines.map((item,index)=>{const line=record(item,`lines.${index+1}`);exactKeys(line,["id","item_id","original_line_id","description","quantity","unit_price","discount_amount","account_id","cost_center_id","tax_code_id","tax_mode","cash_flow_class"],`lines.${index+1}`);return{
    id:idOrNull(line.id??null,"line_id"),itemId:idOrNull(line.item_id??null,"item_id"),originalLineId:idOrNull(line.original_line_id??null,"original_line_id"),description:text(line.description,`lines.${index+1}.description`,500),
    quantity:decimal(line.quantity,`lines.${index+1}.quantity`,6),unitPrice:decimal(line.unit_price,`lines.${index+1}.unit_price`,6),discountAmount:parseMoneyString(line.discount_amount??"0.00",`lines.${index+1}.discount_amount`),
    accountId:parseUuid(line.account_id,`lines.${index+1}.account_id`),costCenterId:idOrNull(line.cost_center_id??null,"cost_center_id"),taxCodeId:idOrNull(line.tax_code_id??null,"tax_code_id"),
    taxMode:enumValue(line.tax_mode??"exclusive",["exclusive","inclusive"],"tax_mode") as "exclusive"|"inclusive",cashFlowClass:line.cash_flow_class===null||line.cash_flow_class===undefined?null:enumValue(line.cash_flow_class,["operating","investing","financing","internal","opening","unclassified"],"cash_flow_class")};});
  const trade=jsonObject(r.trade,["original_document_id","recognition_mode","performance_confirmed","supplier_invoice_date","supplier_invoice_key","terms","notes"],"trade");
  if(trade){if(trade.original_document_id!==undefined&&trade.original_document_id!==null)trade.original_document_id=parseUuid(trade.original_document_id,"original_document_id");if(trade.recognition_mode!==undefined)trade.recognition_mode=enumValue(trade.recognition_mode,["earned_or_incurred","deferred_revenue"],"recognition_mode");if(trade.performance_confirmed!==undefined&&typeof trade.performance_confirmed!=="boolean")throw CommandError.validation({performance_confirmed:"Expected true or false."});if(trade.supplier_invoice_date!==undefined)trade.supplier_invoice_date=trade.supplier_invoice_date===null?null:date(trade.supplier_invoice_date,"supplier_invoice_date");if(trade.supplier_invoice_key!==undefined)trade.supplier_invoice_key=trade.supplier_invoice_key===null?null:text(trade.supplier_invoice_key,"supplier_invoice_key",160);if(trade.terms!==undefined)trade.terms=trade.terms===null?null:text(trade.terms,"terms",500,true);if(trade.notes!==undefined)trade.notes=trade.notes===null?null:text(trade.notes,"notes",2000,true);}
  const movement=jsonObject(r.movement,["cash_account_id","direction","amount","method","reference","cash_flow_class"],"movement");
  if(movement){movement.cash_account_id=parseUuid(movement.cash_account_id,"cash_account_id");movement.direction=enumValue(movement.direction,["in","out"],"direction");movement.amount=parseMoneyString(movement.amount,"amount");movement.method=enumValue(movement.method,["cash","bank_transfer","mobile_wallet","card","other"],"method");movement.reference=movement.reference===null?null:text(movement.reference,"reference",160,true);movement.cash_flow_class=enumValue(movement.cash_flow_class,["operating","investing","financing","internal","opening","unclassified"],"cash_flow_class");}
  const transfer=jsonObject(r.transfer,["from_cash_account_id","to_cash_account_id","amount","fee_amount","fee_account_id"],"transfer");
  if(transfer){transfer.from_cash_account_id=parseUuid(transfer.from_cash_account_id,"from_cash_account_id");transfer.to_cash_account_id=parseUuid(transfer.to_cash_account_id,"to_cash_account_id");transfer.amount=parseMoneyString(transfer.amount,"amount");transfer.fee_amount=parseMoneyString(transfer.fee_amount??"0.00","fee_amount");transfer.fee_account_id=idOrNull(transfer.fee_account_id??null,"fee_account_id");}
  const journalRows=r.journal_rows.map((item,index)=>{const row=record(item,`journal_rows.${index+1}`);exactKeys(row,["account_id","party_id","cost_center_id","debit","credit","description","cash_flow_class","open_item_reference","open_item_due_date"],`journal_rows.${index+1}`);return{
    account_id:parseUuid(row.account_id,"account_id"),party_id:idOrNull(row.party_id??null,"party_id"),cost_center_id:idOrNull(row.cost_center_id??null,"cost_center_id"),debit:parseMoneyString(row.debit??"0.00","debit"),credit:parseMoneyString(row.credit??"0.00","credit"),description:text(row.description,`journal_rows.${index+1}.description`,500),
    cash_flow_class:row.cash_flow_class===null||row.cash_flow_class===undefined?null:enumValue(row.cash_flow_class,["operating","investing","financing","internal","opening","unclassified"],"cash_flow_class"),open_item_reference:row.open_item_reference===null||row.open_item_reference===undefined?null:text(row.open_item_reference,"open_item_reference",160),open_item_due_date:row.open_item_due_date===null||row.open_item_due_date===undefined?null:date(row.open_item_due_date,"open_item_due_date")};});
  for(const [index,row] of journalRows.entries()){if((row.debit==="0.00")===(row.credit==="0.00"))throw CommandError.validation({[`journal_rows.${index+1}.amount`]:"Enter either a debit or a credit."});}
  const tradeTypes=["invoice","customer_credit","bill","vendor_credit","paid_expense"];
  const movementTypes=["receipt","vendor_payment","customer_refund","vendor_refund","customer_advance","vendor_advance","paid_expense"];
  if(tradeTypes.includes(documentType)!==(trade!==null))throw CommandError.validation({trade:"Trade details are required only for trade documents."});
  if(movementTypes.includes(documentType)!==(movement!==null))throw CommandError.validation({movement:"Cash movement details are required for this source type."});
  if((documentType==="transfer")!==(transfer!==null))throw CommandError.validation({transfer:"Transfer details are required only for transfers."});
  if(!["receipt","vendor_payment"].includes(documentType)&&allocationPlan.length)throw CommandError.validation({allocation_plan:"Only receipt and supplier payment drafts can propose open-item settlements."});
  if(!["manual_journal","controlled_adjustment","opening_balance"].includes(documentType)&&journalRows.length>0)throw CommandError.validation({journal_rows:"Journal rows are only valid for journal sources."});
  if(!tradeTypes.includes(documentType)&&lines.length>0)throw CommandError.validation({lines:"Trade lines are only valid for trade sources."});
  if(tradeTypes.includes(documentType)&&lines.length===0)throw CommandError.validation({lines:"Add at least one trade line."});
  const issueDate=date(r.issue_date,"issue_date")!;const accountingDate=date(r.accounting_date,"accounting_date")!;const dueDate=date(r.due_date??null,"due_date",true);
  if(dueDate&&dueDate<issueDate)throw CommandError.validation({due_date:"Due date must not precede issue date."});
  const roundingAdjustment=parseMoneyString(r.rounding_adjustment??"0.00","rounding_adjustment");const roundingUnits=BigInt(roundingAdjustment.replace(".",""));
  const roundingReason=r.rounding_reason===null||r.rounding_reason===undefined?null:text(r.rounding_reason,"rounding_reason",500);
  const roundingAccountId=idOrNull(r.rounding_account_id??null,"rounding_account_id");
  if((roundingUnits===0n&&(roundingReason!==null||roundingAccountId!==null))||(roundingUnits!==0n&&(roundingUnits < -5n||roundingUnits>5n||!roundingReason||!roundingAccountId)))throw CommandError.validation({rounding_adjustment:"A nonzero rounding adjustment up to 0.05 BDT needs a reason and rounding account."});
  return{documentType,partyId:idOrNull(r.party_id??null,"party_id"),issueDate,accountingDate,dueDate,externalReference:r.external_reference===null||r.external_reference===undefined?null:text(r.external_reference,"external_reference",160,true),description:text(r.description??"","description",2000,true),currency:"BDT",roundingAdjustment,roundingReason,roundingAccountId,trade,movement,transfer,lines,journalRows,allocationPlan};
}
export function documentDatabaseError(error:{code?:string}):CommandError{
  if(error.code==="28000")return CommandError.unauthenticated();if(error.code==="42501")return CommandError.forbidden();if(error.code==="P0002")return CommandError.notFound();
  if(error.code==="40001")return CommandError.conflict("STALE_VERSION");if(error.code==="23505")return CommandError.conflict("IDEMPOTENCY_CONFLICT");
  if(error.code==="22023"||error.code==="23514"||error.code==="22P02"||error.code==="23503"||error.code==="23502"||error.code==="22001")return CommandError.validation({document:"The draft conflicts with a company, date, account, or source rule."});
  return new CommandError({code:"INTERNAL_ERROR"});
}
