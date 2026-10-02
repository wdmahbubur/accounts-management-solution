import type { SupabaseClient } from "@supabase/supabase-js";
import { capability } from "@ams/permissions";
import { CommandError, retryableTransactionError } from "../commands/errors.ts";
import type { OrganizationCommandDefinition } from "../commands/types.ts";
import { parseAllocationReversalReceipt, validateAllocationReversalInput, type AllocationReversalInput, type AllocationReversalReceipt } from "./reversal-contracts.ts";

type RpcClient=Pick<SupabaseClient,"rpc">;
function databaseError(error:{code?:string;message?:string}){
  const retry=retryableTransactionError(error);if(retry)return retry;
  if(error.code==="42501")return CommandError.forbidden();if(error.code==="28000")return CommandError.unauthenticated();
  if(error.code==="P0002")return CommandError.notFound();if(error.code==="23505")return CommandError.conflict("IDEMPOTENCY_CONFLICT");
  if(error.code==="P0001")return CommandError.conflict("REVERSAL_EXISTS");if(error.code==="40001")return CommandError.conflict("STALE_VERSION");
  if(error.code==="55P03")return CommandError.conflict("PERIOD_LOCKED");
  if(error.code==="22023")return CommandError.validation({body:"The reversal request is invalid or predates its allocation."});
  return new Error("Allocation reversal failed.");
}
export function reverseOpenItemAllocationCommand(client:RpcClient,allocationId:string):OrganizationCommandDefinition<AllocationReversalInput,AllocationReversalReceipt>{
  return{operation:`allocations.reverse:${allocationId}`,capability:capability("dues.allocate"),idempotency:"required",validate:validateAllocationReversalInput,
    async execute(context,input){const key=context.idempotencyKey;if(!key)throw CommandError.validation({idempotency_key:"A stable idempotency key is required."});
      const result=await client.rpc("reverse_open_item_allocation",{p_organization_id:context.actor.organizationId,p_allocation_id:allocationId,p_operation:`allocations.reverse:${allocationId}`,
        p_request_id:context.requestId,p_idempotency_key:key,p_request_hash:context.requestHash,p_effective_date:input.effectiveDate,p_reason:input.reason});
      if(result.error)throw databaseError(result.error);return parseAllocationReversalReceipt(result.data);
    }};
}
