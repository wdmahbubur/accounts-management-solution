import type { SupabaseClient } from "@supabase/supabase-js";
import { capability } from "@ams/permissions";
import { CommandError } from "../commands/errors.ts";
import type { OrganizationCommandDefinition } from "../commands/types.ts";
import { record } from "./contracts.ts";

type RpcClient=Pick<SupabaseClient,"rpc">;
export interface ReverseDocumentInput { reversalDate:string;reason:string }
export interface ReverseDocumentReceipt { reversalDocumentId:string;documentNumber:string;journalEntryId:string;reversalDate:string;state:"posted" }
function validate(raw:unknown):ReverseDocumentInput{const r=record(raw,"request");if(Object.keys(r).some(k=>!(k==="reversal_date"||k==="reason")))throw CommandError.validation({body:"Unexpected request field."});
 if(typeof r.reversal_date!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(r.reversal_date)){throw CommandError.validation({reversal_date:"Use a valid reversal date."});}
 const d=new Date(`${r.reversal_date}T00:00:00Z`);if(Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==r.reversal_date)throw CommandError.validation({reversal_date:"Use a valid reversal date."});
 if(typeof r.reason!=="string"||r.reason.trim().length<10||r.reason.trim().length>800)throw CommandError.validation({reason:"Explain the correction in 10-800 characters."});return{reversalDate:r.reversal_date,reason:r.reason.trim()};}
export function reversePostedDocumentCommand(client:RpcClient,sourceDocumentId:string):OrganizationCommandDefinition<ReverseDocumentInput,ReverseDocumentReceipt>{return{
 operation:`documents.reverse:${sourceDocumentId}`,capability:capability("journal.post"),idempotency:"required",validate,
 async execute(context,input){if(!context.idempotencyKey)throw CommandError.validation({idempotency_key:"A stable idempotency key is required."});
  const result=await client.rpc("reverse_posted_document",{p_organization_id:context.actor.organizationId,p_source_document_id:sourceDocumentId,p_reversal_date:input.reversalDate,
   p_reason:input.reason,p_request_id:context.requestId,p_idempotency_key:context.idempotencyKey,p_request_hash:context.requestHash});
  if(result.error){if(result.error.code==="42501")throw CommandError.forbidden();if(result.error.code==="28000")throw CommandError.unauthenticated();if(result.error.code==="P0002")throw CommandError.notFound();
   if(result.error.code==="P0001")throw CommandError.conflict("REVERSAL_EXISTS");if(result.error.code==="55P03")throw CommandError.conflict("PERIOD_LOCKED");if(result.error.code==="55000")throw CommandError.conflict("RECONCILIATION_LOCKED");if(result.error.code==="23505")throw CommandError.conflict("IDEMPOTENCY_CONFLICT");
   if(result.error.code==="23P01")throw CommandError.conflict("ALLOCATION_EXCEEDED");if(["22023","23514"].includes(result.error.code??""))throw CommandError.validation({reversal:"The source, date, or correction reason violates a reversal rule."});throw new Error("The source reversal could not be posted.");}
  if(!Array.isArray(result.data)||result.data.length!==1)throw new Error("Invalid reversal receipt.");const row=record(result.data[0],"receipt");if(typeof row.reversal_document_id!=="string"||typeof row.document_number!=="string"||typeof row.journal_entry_id!=="string"||typeof row.reversal_date!=="string"||row.state!=="posted")throw new Error("Malformed reversal receipt.");
  return{reversalDocumentId:row.reversal_document_id,documentNumber:row.document_number,journalEntryId:row.journal_entry_id,reversalDate:row.reversal_date,state:"posted"};
 }};}
