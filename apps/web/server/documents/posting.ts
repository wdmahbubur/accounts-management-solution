import type { RequestClient } from "../request-client.ts";
import { capability } from "@ams/permissions";
import { CommandError, retryableTransactionError } from "../commands/errors.ts";
import type { ActorContext } from "../auth/types.ts";
import type { OrganizationCommandDefinition } from "../commands/types.ts";
import { record } from "./contracts.ts";

export interface PostDocumentInput { expectedVersion:number }
export interface PostDocumentReceipt { documentId:string;documentNumber:string;documentVersion:number;journalEntryId:string;state:"posted" }
const postCapability:Record<string,string>={invoice:"sales.post",customer_credit:"sales.post",receipt:"sales.post",customer_refund:"sales.post",customer_advance:"sales.post",
  bill:"purchases.post",vendor_credit:"purchases.post",paid_expense:"purchases.post",vendor_payment:"purchases.post",vendor_refund:"purchases.post",vendor_advance:"purchases.post",
  transfer:"banking.write",manual_journal:"journal.post",controlled_adjustment:"journal.post",opening_balance:"journal.post"};
export function canPostDocument(actor:ActorContext,documentType:string){const required=postCapability[documentType];return !!required&&actor.capabilities.includes(required);}
type RpcClient=Pick<RequestClient,"rpc">;
function error(value:{code?:string;message?:string}){
  const retry=retryableTransactionError(value);if(retry)return retry;
  if(value.code==="42501")throw CommandError.forbidden();if(value.code==="28000")throw CommandError.unauthenticated();if(value.code==="P0002")throw CommandError.notFound();
  if(value.code==="P0001")throw CommandError.conflict("APPROVAL_REQUIRED");if(value.code==="55P03")throw CommandError.conflict("PERIOD_LOCKED");
  if(value.code==="40001")throw CommandError.conflict("APPROVAL_STALE");if(value.code==="23P01")throw CommandError.conflict("ALLOCATION_EXCEEDED");
  if(value.code==="23505")throw CommandError.conflict(/idempotency/i.test(value.message??"")?"IDEMPOTENCY_CONFLICT":"DOCUMENT_ALREADY_POSTED");
  if(value.code==="22023"||value.code==="23514")throw CommandError.validation({document:"The source is incomplete or does not satisfy its accounting controls."});
  throw new Error("Posting could not be completed.");
}
function validate(raw:unknown):PostDocumentInput{const value=record(raw,"request");if(Object.keys(value).some((key)=>key!=="expected_version")||!Number.isSafeInteger(value.expected_version)||Number(value.expected_version)<1)
  throw CommandError.validation({expected_version:"Refresh the approved source before posting."});return{expectedVersion:Number(value.expected_version)};}
function parse(raw:unknown):PostDocumentReceipt{if(!Array.isArray(raw)||raw.length!==1)throw new Error("Invalid posting receipt.");const row=record(raw[0],"receipt");
  if(typeof row.document_id!=="string"||typeof row.document_number!=="string"||typeof row.journal_entry_id!=="string"||!Number.isSafeInteger(row.document_version)||row.state!=="posted")throw new Error("Malformed posting receipt.");
  return{documentId:row.document_id,documentNumber:row.document_number,documentVersion:Number(row.document_version),journalEntryId:row.journal_entry_id,state:"posted"};}
export function postFinancialDocumentCommand(client:RpcClient,documentId:string,documentType:string):OrganizationCommandDefinition<PostDocumentInput,PostDocumentReceipt>{
  const required=postCapability[documentType];if(!required)throw CommandError.validation({document:"This document type does not have a posting command yet."});
  return{operation:`documents.post:${documentId}`,capability:capability(required),idempotency:"required",validate,
    async execute(context,input){if(!context.idempotencyKey)throw CommandError.validation({idempotency_key:"A stable idempotency key is required."});
      const result=await client.rpc("post_financial_document",{p_organization_id:context.actor.organizationId,p_document_id:documentId,p_expected_version:input.expectedVersion,
        p_request_id:context.requestId,p_idempotency_key:context.idempotencyKey,p_request_hash:context.requestHash});if(result.error)error(result.error);return parse(result.data);
    }};
}
