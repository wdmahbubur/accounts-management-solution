import type { SupabaseClient } from "@supabase/supabase-js";
import { capability } from "@ams/permissions";
import { CommandError, retryableTransactionError } from "../commands/errors.ts";
import type { OrganizationCommandDefinition } from "../commands/types.ts";
import { parseApprovalDecisionReceipt, parseSubmitApprovalReceipt, validateApprovalDecision, validateSubmitApproval,
  type ApprovalDecisionInput, type ApprovalDecisionReceipt, type SubmitApprovalInput, type SubmitApprovalReceipt } from "./contracts.ts";

type RpcClient=Pick<SupabaseClient,"rpc">;
function databaseError(error:{code?:string;message?:string}){
  const retry=retryableTransactionError(error);if(retry)return retry;
  if(error.code==="42501")return CommandError.forbidden();if(error.code==="28000")return CommandError.unauthenticated();
  if(error.code==="P0002")return CommandError.notFound();if(error.code==="P0001")return CommandError.conflict("APPROVAL_REQUIRED");
  if(error.code==="40001")return CommandError.conflict("APPROVAL_STALE");if(error.code==="23505")return CommandError.conflict("IDEMPOTENCY_CONFLICT");
  if(error.code==="22023"||error.code==="23514")return CommandError.validation({approval:"The approval request conflicts with the current document or policy."});
  return new CommandError({code:"INTERNAL_ERROR"});
}
export function submitFinancialDocumentCommand(client:RpcClient,documentId:string):OrganizationCommandDefinition<SubmitApprovalInput,SubmitApprovalReceipt>{
  const operation=`documents.submit:${documentId}`;
  return{operation,capability:capability("documents.read"),idempotency:"required",validate:validateSubmitApproval,
    async execute(context,input){const key=context.idempotencyKey;if(!key)throw CommandError.validation({idempotency_key:"A stable idempotency key is required."});
      const result=await client.rpc("submit_financial_document",{p_organization_id:context.actor.organizationId,p_document_id:documentId,
        p_expected_version:input.expectedVersion,p_operation:operation,p_request_id:context.requestId,p_idempotency_key:key,p_request_hash:context.requestHash});
      if(result.error)throw databaseError(result.error);return parseSubmitApprovalReceipt(result.data);
    }};
}
export function decideFinancialApprovalCommand(client:RpcClient,approvalRequestId:string):OrganizationCommandDefinition<ApprovalDecisionInput,ApprovalDecisionReceipt>{
  const operation=`approvals.decide:${approvalRequestId}`;
  return{operation,capability:capability("approvals.decide"),idempotency:"required",validate:validateApprovalDecision,
    async execute(context,input){const key=context.idempotencyKey;if(!key)throw CommandError.validation({idempotency_key:"A stable idempotency key is required."});
      const result=await client.rpc("decide_financial_approval",{p_organization_id:context.actor.organizationId,p_approval_request_id:approvalRequestId,
        p_operation:operation,p_request_id:context.requestId,p_idempotency_key:key,p_request_hash:context.requestHash,p_decision:input.decision,p_reason:input.reason});
      if(result.error)throw databaseError(result.error);return parseApprovalDecisionReceipt(result.data);
    }};
}
