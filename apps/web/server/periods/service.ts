import type {RequestClient} from "../request-client.ts";
import {capability} from "@ams/permissions";
import type {ActorContext} from "../auth/types.ts";
import {CommandError} from "../commands/errors.ts";
import type {OrganizationCommandDefinition} from "../commands/types.ts";
import {parsePeriods,periodDatabaseError,validatePeriodAction} from "./contracts.ts";

type RpcClient=Pick<RequestClient,"rpc">;
export async function readPeriods(client:RpcClient,actor:ActorContext){if(!actor.capabilities.includes("accounting.read"))throw CommandError.forbidden();const r=await client.rpc("list_accounting_periods",{p_organization_id:actor.organizationId});if(r.error)throw periodDatabaseError(r.error);return parsePeriods(r.data);}
type ActionInput=ReturnType<typeof validatePeriodAction>;
export interface PeriodReceipt{periodId:string;rowVersion:number;lockedAt?:string}
export function periodCommand(action:"lock"|"reopen",periodId:string,client:RpcClient):OrganizationCommandDefinition<ActionInput,PeriodReceipt>{
  const permission=action==="lock"?"periods.lock":"periods.reopen";
  return{operation:`periods.${action}`,capability:capability(permission),idempotency:"optional",validate:validatePeriodAction,
    async execute(context,input){
      const r=await client.rpc(action==="lock"?"lock_accounting_period":"reopen_accounting_period",{
        p_organization_id:context.actor.organizationId,p_period_id:periodId,p_expected_version:input.expectedVersion,
        p_request_id:context.requestId,p_reason:input.reason});if(r.error)throw periodDatabaseError(r.error);
      if(!Array.isArray(r.data)||r.data.length!==1)throw new Error("Invalid period receipt.");const row=r.data[0] as Record<string,unknown>;
      return{periodId:String(row.period_id),rowVersion:Number(row.row_version),...(typeof row.locked_at==="string"?{lockedAt:row.locked_at}:{})};
    }};
}
