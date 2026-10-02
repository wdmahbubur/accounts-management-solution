import type { SupabaseClient } from "@supabase/supabase-js";
import { capability } from "@ams/permissions";
import { CommandError, retryableTransactionError } from "../commands/errors.ts";
import type { ActorContext } from "../auth/types.ts";
import type { OrganizationCommandDefinition } from "../commands/types.ts";
import { parseApprovalPolicyList, parseApprovalRoleList, parseSaveApprovalPolicy, validateSaveApprovalPolicy,
  type ApprovalPolicyCatalog, type SaveApprovalPolicyInput, type SaveApprovalPolicyReceipt } from "./policy-contracts.ts";

type RpcClient=Pick<SupabaseClient,"rpc">;
function databaseError(error:{code?:string;message?:string}){
  const retry=retryableTransactionError(error);if(retry)return retry;
  if(error.code==="42501")return CommandError.forbidden();if(error.code==="28000")return CommandError.unauthenticated();
  if(error.code==="40001")return CommandError.conflict("STALE_VERSION");if(error.code==="23505")return CommandError.conflict("STALE_VERSION");
  if(error.code==="22023"||error.code==="23514"||error.code==="22P02")return CommandError.validation({policy:"The approval policy conflicts with its role or another active threshold."});
  return new CommandError({code:"INTERNAL_ERROR"});
}
export async function readApprovalPolicyCatalog(client:RpcClient,actor:ActorContext):Promise<ApprovalPolicyCatalog>{
  if(!actor.capabilities.includes("approvals.manage"))throw CommandError.forbidden();
  const [policies,roles]=await Promise.all([client.rpc("list_approval_policies",{p_organization_id:actor.organizationId}),client.rpc("list_approval_policy_roles",{p_organization_id:actor.organizationId})]);
  if(policies.error)throw databaseError(policies.error);if(roles.error)throw databaseError(roles.error);
  return{policies:parseApprovalPolicyList(policies.data),eligibleRoles:parseApprovalRoleList(roles.data)};
}
export function saveApprovalPolicyCommand(client:RpcClient):OrganizationCommandDefinition<SaveApprovalPolicyInput,SaveApprovalPolicyReceipt>{
  return{operation:"approvals.policy.save",capability:capability("approvals.manage"),idempotency:"required",validate:validateSaveApprovalPolicy,
    async execute(context,input){const key=context.idempotencyKey;if(!key)throw CommandError.validation({idempotency_key:"A stable idempotency key is required."});
      const result=await client.rpc("save_approval_policy",{p_organization_id:context.actor.organizationId,p_request_id:context.requestId,p_idempotency_key:key,
        p_request_hash:context.requestHash,p_policy_id:input.policyId,p_expected_version:input.expectedVersion,p_name:input.name,p_document_type:input.documentType,
        p_threshold_amount:input.thresholdAmount,p_approver_role_id:input.approverRoleId,p_required_approvals:input.requiredApprovals,
        p_allow_self_approval:input.allowSelfApproval,p_is_active:input.isActive,p_reason:input.reason});
      if(result.error)throw databaseError(result.error);return parseSaveApprovalPolicy(result.data);
    }};
}
