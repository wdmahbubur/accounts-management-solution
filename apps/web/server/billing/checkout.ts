import {capability} from '@ams/permissions';
import {CommandError} from '../commands/errors.ts';
import {record} from '../documents/contracts.ts';
import type {OrganizationCommandDefinition} from '../commands/types.ts';
import {getBillingAdapter} from './adapter.ts';
export function deferredCheckoutCommand():OrganizationCommandDefinition<Record<string,never>,never>{
 return {operation:'subscription.checkout',capability:capability('subscription.manage'),idempotency:'required',
  validate(raw){if(Object.keys(record(raw)).length)throw CommandError.validation({plan:'Paid plans are awaiting approval.'});return {};},
  async execute(){const adapter=getBillingAdapter();if(!adapter.enabled)throw new CommandError({code:'BILLING_DISABLED'});
   // Activating a provider alone must not bypass the approved-plan gate.
   throw CommandError.validation({plan:'Approved plan configuration is required before checkout.'});}};
}
