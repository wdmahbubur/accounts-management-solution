import type { RequestClient } from "../request-client.ts";
import { capability } from "@ams/permissions";
import { parseMoneyString, parseUuid } from "@ams/contracts";
import { CommandError } from "../commands/errors.ts";
import type { OrganizationCommandDefinition } from "../commands/types.ts";
import { record } from "../documents/contracts.ts";

type RpcClient=Pick<RequestClient,"rpc">;
export interface SaveWriteOffInput { accountingDate:string;targetOpenItemId:string;expenseAccountId:string;amount:string;reason:string }
function date(value:unknown){if(typeof value!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value))throw CommandError.validation({accounting_date:"Use a valid accounting date."});const d=new Date(`${value}T00:00:00Z`);if(Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==value)throw CommandError.validation({accounting_date:"Use a valid accounting date."});return value;}
function validate(raw:unknown):SaveWriteOffInput{const r=record(raw);if(Object.keys(r).some(k=>!(["accounting_date","target_open_item_id","expense_account_id","amount","reason"] as string[]).includes(k)))throw CommandError.validation({body:"Unexpected request field."});
 const reason=typeof r.reason==="string"?r.reason.trim():"";if(reason.length<10||reason.length>500)throw CommandError.validation({reason:"Explain the write-off in 10-500 characters."});
 const amount=parseMoneyString(r.amount,"amount");if(BigInt(amount.replace(".",""))<=0n)throw CommandError.validation({amount:"Enter an amount greater than zero."});
 return{accountingDate:date(r.accounting_date),targetOpenItemId:parseUuid(r.target_open_item_id,"target_open_item_id"),expenseAccountId:parseUuid(r.expense_account_id,"expense_account_id"),amount,reason};}
export function saveWriteOffCommand(client:RpcClient):OrganizationCommandDefinition<SaveWriteOffInput,{documentId:string;version:number;state:string;totalAmount:string}>{return{
 operation:"write_offs.save",capability:capability("dues.adjust"),idempotency:"required",validate,
 async execute(context,input){if(!context.idempotencyKey)throw CommandError.validation({idempotency_key:"A stable idempotency key is required."});
  const r=await client.rpc("save_write_off_draft",{p_organization_id:context.actor.organizationId,p_document_id:null,p_expected_version:null,p_request_id:context.requestId,
   p_idempotency_key:context.idempotencyKey,p_request_hash:context.requestHash,p_accounting_date:input.accountingDate,p_target_open_item_id:input.targetOpenItemId,
   p_expense_account_id:input.expenseAccountId,p_amount:input.amount,p_reason:input.reason});
  if(r.error){if(r.error.code==="42501")throw CommandError.forbidden();if(r.error.code==="P0002")throw CommandError.notFound();if(r.error.code==="23505")throw CommandError.conflict("IDEMPOTENCY_CONFLICT");if(r.error.code==="55P03")throw CommandError.conflict("PERIOD_LOCKED");if(r.error.code==="23P01")throw CommandError.conflict("ALLOCATION_EXCEEDED");if(["22023","23514"].includes(r.error.code??""))throw CommandError.validation({write_off:"The write-off conflicts with the receivable, accounting date, or account rules."});throw new Error("Write-off draft could not be saved.");}
  if(!Array.isArray(r.data)||r.data.length!==1)throw new Error("Invalid write-off receipt.");const row=record(r.data[0],"receipt");if(typeof row.document_id!=="string"||!Number.isSafeInteger(row.document_version)||typeof row.state!=="string"||typeof row.total_amount!=="string")throw new Error("Malformed write-off receipt.");
  return{documentId:row.document_id,version:Number(row.document_version),state:row.state,totalAmount:row.total_amount};
 }};}
