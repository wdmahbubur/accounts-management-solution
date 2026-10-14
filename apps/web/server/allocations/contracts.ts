import { parseMoneyString, parseUuid, type MoneyString } from "@ams/contracts";
import { CommandError } from "../commands/errors.ts";

export interface AllocationInput { debitOpenItemId:string; creditOpenItemId:string; amount:MoneyString; effectiveDate:string }
export interface AllocationReceipt { allocationId:string; amount:MoneyString; effectiveDate:string; availableDebit:MoneyString; availableCredit:MoneyString }
function record(raw:unknown):Record<string,unknown>{if(!raw||typeof raw!=="object"||Array.isArray(raw))throw CommandError.validation({body:"Send a JSON object."});return raw as Record<string,unknown>;}
export function validateAllocationInput(raw:unknown):AllocationInput{
  const v=record(raw);if(Object.keys(v).some((key)=>!["debit_open_item_id","credit_open_item_id","amount","effective_date"].includes(key)))throw CommandError.validation({body:"Unexpected request field."});
  const debitOpenItemId=parseUuid(v.debit_open_item_id,"debit_open_item_id");const creditOpenItemId=parseUuid(v.credit_open_item_id,"credit_open_item_id");
  if(debitOpenItemId===creditOpenItemId)throw CommandError.validation({credit_open_item_id:"Choose a different credit item."});
  const amount=parseMoneyString(v.amount);if(amount==="0.00")throw CommandError.validation({amount:"Enter an amount above zero."});
  const effectiveDate=v.effective_date;if(typeof effectiveDate!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)){throw CommandError.validation({effective_date:"Use a valid accounting date."});}
  const date=new Date(`${effectiveDate}T00:00:00Z`);if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==effectiveDate)throw CommandError.validation({effective_date:"Use a valid accounting date."});
  return{debitOpenItemId,creditOpenItemId,amount,effectiveDate};
}
export function parseAllocationReceipt(raw:unknown):AllocationReceipt{
  if(!Array.isArray(raw)||raw.length!==1)throw new Error("Invalid allocation receipt.");const r=record(raw[0]);
  if(typeof r.allocation_id!=="string"||typeof r.effective_date!=="string")throw new Error("Invalid allocation receipt.");
  return{allocationId:parseUuid(r.allocation_id),amount:parseMoneyString(r.amount),effectiveDate:r.effective_date,
    availableDebit:parseMoneyString(r.available_debit),availableCredit:parseMoneyString(r.available_credit)};
}
