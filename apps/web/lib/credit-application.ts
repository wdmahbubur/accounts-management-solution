import { moneyUnits } from "@ams/accounting";
import { parseMoneyString, parseUuid } from "@ams/contracts";

export interface CreditApplicationOptions {
  organization_id:string; document_id:string; document_type:"customer_credit"|"vendor_credit"; document_number:string|null;
  original_document_id:string; original_document_type:"invoice"|"bill"; original_document_number:string|null;
  effective_date:string; minimum_date:string; credit_amount:string; credit_residual_amount:string|null;
  original_residual_amount:string|null; available_amount:string; status:"available"|"already_allocated"|"original_settled"|"not_yet_effective"|"reversed"|"no_capacity";
  debit_open_item_id:string; credit_open_item_id:string;
  allocations:{id:string;amount:string;effective_date:string;counter_document_id:string|null;counter_document_number:string|null;counter_document_type:string|null;reversed_on:string|null}[];
}

function object(value:unknown):Record<string,unknown> {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Credit application information is incomplete.");
  return value as Record<string,unknown>;
}
function text(value:unknown):string|null {
  if(value===null)return null;
  if(typeof value!=="string")throw new Error("Credit application text is invalid.");
  return value;
}
export function isCreditApplicationDate(value:unknown):value is string {
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf())&&date.toISOString().slice(0,10)===value;
}
function date(value:unknown):string {
  if(!isCreditApplicationDate(value))throw new Error("Credit application date is invalid.");
  return value;
}
export function parseCreditApplicationOptions(raw:unknown,expected:{organizationId:string;documentId:string;effectiveDate:string}):CreditApplicationOptions {
  const row=object(raw);
  const type=row.document_type;
  if(row.organization_id!==expected.organizationId||row.document_id!==expected.documentId||row.effective_date!==expected.effectiveDate||
    (type!=="customer_credit"&&type!=="vendor_credit")||row.original_document_type!==(type==="customer_credit"?"invoice":"bill"))throw new Error("Credit application scope changed. Refresh the document.");
  const statuses=["available","already_allocated","original_settled","not_yet_effective","reversed","no_capacity"];
  if(typeof row.status!=="string"||!statuses.includes(row.status)||!Array.isArray(row.allocations))throw new Error("Credit application state is invalid.");
  const result:CreditApplicationOptions={organization_id:parseUuid(row.organization_id),document_id:parseUuid(row.document_id),document_type:type,document_number:text(row.document_number),
    original_document_id:parseUuid(row.original_document_id),original_document_type:row.original_document_type as "invoice"|"bill",original_document_number:text(row.original_document_number),
    effective_date:date(row.effective_date),minimum_date:date(row.minimum_date),credit_amount:parseMoneyString(row.credit_amount),
    credit_residual_amount:row.credit_residual_amount===null?null:parseMoneyString(row.credit_residual_amount),
    original_residual_amount:row.original_residual_amount===null?null:parseMoneyString(row.original_residual_amount),available_amount:parseMoneyString(row.available_amount),
    status:row.status as CreditApplicationOptions["status"],debit_open_item_id:parseUuid(row.debit_open_item_id),credit_open_item_id:parseUuid(row.credit_open_item_id),
    allocations:row.allocations.map(rawAllocation=>{const allocation=object(rawAllocation);return{id:parseUuid(allocation.id),amount:parseMoneyString(allocation.amount),
      effective_date:date(allocation.effective_date),counter_document_id:allocation.counter_document_id===null?null:parseUuid(allocation.counter_document_id),
      counter_document_number:text(allocation.counter_document_number),counter_document_type:text(allocation.counter_document_type),reversed_on:allocation.reversed_on===null?null:date(allocation.reversed_on)};})};
  if(result.document_id===result.original_document_id||result.debit_open_item_id===result.credit_open_item_id||
    result.credit_residual_amount!==null&&moneyUnits(result.credit_residual_amount)>moneyUnits(result.credit_amount)||
    result.credit_residual_amount!==null&&moneyUnits(result.available_amount)>moneyUnits(result.credit_residual_amount)||
    result.original_residual_amount!==null&&moneyUnits(result.available_amount)>moneyUnits(result.original_residual_amount)||
    (result.status==="available")!==(moneyUnits(result.available_amount)>0n)||
    result.status==="available"&&(result.credit_residual_amount===null||result.original_residual_amount===null||result.effective_date<result.minimum_date))throw new Error("Credit application capacity is invalid.");
  return result;
}

export function creditApplicationMessage(options:CreditApplicationOptions):string {
  switch(options.status) {
    case "available": return "Apply this credit to the original document. The remaining credit stays available for a later settlement.";
    case "already_allocated": return "This credit has no unused balance on the selected date.";
    case "original_settled": return "The original document is already settled on this date. Any unused credit remains available separately.";
    case "not_yet_effective": return `Choose an effective date on or after ${options.minimum_date}.`;
    case "reversed": return "The credit or its original document has a linked reversal. A new application is unavailable.";
    case "no_capacity": return "Later dated settlements use the available balance. Review the settlement history before applying more.";
  }
}

export function confirmedCreditApplicationReceipt(raw:unknown,expected:{amount:string;effectiveDate:string}) {
  const row=object(raw);
  const receipt={allocationId:parseUuid(row.allocationId),amount:parseMoneyString(row.amount),effectiveDate:date(row.effectiveDate),
    availableDebit:parseMoneyString(row.availableDebit),availableCredit:parseMoneyString(row.availableCredit)};
  if(receipt.amount!==expected.amount||receipt.effectiveDate!==expected.effectiveDate)throw new Error("The application receipt could not be confirmed. Retry the same request.");
  return receipt;
}
