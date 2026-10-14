import type { SupabaseClient } from "@supabase/supabase-js";
import { capability } from "@ams/permissions";
import { CommandError, retryableTransactionError } from "../commands/errors.ts";
import type { OrganizationCommandDefinition } from "../commands/types.ts";
import { parseAllocationReceipt, validateAllocationInput, type AllocationInput, type AllocationReceipt } from "./contracts.ts";

type RpcClient=Pick<SupabaseClient,"rpc">;
function databaseError(error:{code?:string;message?:string}){
  const retry=retryableTransactionError(error);if(retry)return retry;
  if(error.code==="42501")return CommandError.forbidden();if(error.code==="28000")return CommandError.unauthenticated();
  if(error.code==="P0002")return CommandError.notFound();if(error.code==="23505")return CommandError.conflict("IDEMPOTENCY_CONFLICT");
  if(error.code==="40001")return CommandError.conflict("STALE_VERSION");
  if(error.code==="23P01")return CommandError.conflict("ALLOCATION_EXCEEDED");
  if(error.code==="55P03")return CommandError.conflict("PERIOD_LOCKED");
  if(error.code==="22023")return CommandError.validation({body:"The allocation request is invalid."});
  return new Error("Allocation command failed.");
}
export function allocateOpenItemsCommand(client:RpcClient):OrganizationCommandDefinition<AllocationInput,AllocationReceipt>{
  return{operation:"allocations.create",capability:capability("dues.allocate"),idempotency:"required",validate:validateAllocationInput,
    async execute(context,input){
      const key=context.idempotencyKey;if(!key)throw CommandError.validation({idempotency_key:"A stable idempotency key is required."});
      const result=await client.rpc("allocate_open_items",{p_organization_id:context.actor.organizationId,p_request_id:context.requestId,
        p_idempotency_key:key,p_request_hash:context.requestHash,p_debit_open_item_id:input.debitOpenItemId,
        p_credit_open_item_id:input.creditOpenItemId,p_amount:input.amount,p_effective_date:input.effectiveDate});
      if(result.error)throw databaseError(result.error);return parseAllocationReceipt(result.data);
    }};
}
