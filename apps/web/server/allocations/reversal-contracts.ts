import { parseUuid } from "@ams/contracts";
import { CommandError } from "../commands/errors.ts";

export interface AllocationReversalInput { effectiveDate:string; reason:string }
export interface AllocationReversalReceipt { reversalId:string; allocationId:string; effectiveDate:string; reason:string }
function record(raw:unknown):Record<string,unknown>{if(!raw||typeof raw!=="object"||Array.isArray(raw))throw CommandError.validation({body:"Send a JSON object."});return raw as Record<string,unknown>;}
export function validateAllocationReversalInput(raw:unknown):AllocationReversalInput{
  const v=record(raw);if(Object.keys(v).some((key)=>!["effective_date","reason"].includes(key)))throw CommandError.validation({body:"Unexpected request field."});
  const effectiveDate=v.effective_date;if(typeof effectiveDate!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate))throw CommandError.validation({effective_date:"Use a valid accounting date."});
  const date=new Date(`${effectiveDate}T00:00:00Z`);if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==effectiveDate)throw CommandError.validation({effective_date:"Use a valid accounting date."});
  if(typeof v.reason!=="string"||v.reason.trim().length<10||v.reason.trim().length>1000)throw CommandError.validation({reason:"Enter a reason of 10-1,000 characters."});
  return{effectiveDate,reason:v.reason.trim()};
}
export function parseAllocationReversalReceipt(raw:unknown):AllocationReversalReceipt{
  if(!Array.isArray(raw)||raw.length!==1)throw new Error("Invalid allocation reversal receipt.");const r=record(raw[0]);
  if(typeof r.effective_date!=="string"||typeof r.reason!=="string")throw new Error("Invalid allocation reversal receipt.");
  return{reversalId:parseUuid(r.reversal_id),allocationId:parseUuid(r.allocation_id),effectiveDate:r.effective_date,reason:r.reason};
}
