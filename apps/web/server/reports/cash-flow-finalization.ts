import { capability } from '@ams/permissions';
import { CommandError } from '../commands/errors.ts';
import type { OrganizationCommandDefinition } from '../commands/types.ts';
import type { RequestClient } from '../request-client.ts';
import { record,documentDatabaseError } from '../documents/contracts.ts';
import { isCreditApplicationDate } from '../../lib/credit-application.ts';
type Input={from:string;to:string;expected_digest:string};
export function finalizeCashFlowCommand(client:Pick<RequestClient,'rpc'>):OrganizationCommandDefinition<Input,unknown>{
  return {operation:'cash-flow.finalize',capability:capability('periods.lock'),idempotency:'required',
    validate(raw){const r=record(raw);if(Object.keys(r).some(k=>!['from','to','expected_digest'].includes(k))||!isCreditApplicationDate(r.from)||!isCreditApplicationDate(r.to)||r.from>r.to||typeof r.expected_digest!=='string'||!/^[a-f0-9]{64}$/.test(r.expected_digest))throw CommandError.validation({report:'Refresh a valid cash-flow report before finalizing.'});return r as Input;},
    async execute(ctx,input){const result=await client.rpc('finalize_cash_flow_report',{p_organization_id:ctx.actor.organizationId,p_from:input.from,p_to:input.to,p_expected_digest:input.expected_digest,p_request_id:ctx.requestId,p_idempotency_key:ctx.idempotencyKey,p_request_hash:ctx.requestHash});
      if(result.error){
        if(result.error.code==='23514')throw CommandError.validation({report:'Resolve the cash-flow classification or reconciliation exceptions before finalizing.'});
        if(result.error.code==='22023')throw CommandError.validation({report:'Refresh a valid cash-flow report before finalizing.'});
        throw documentDatabaseError(result.error);
      }
      return result.data;}};
}
