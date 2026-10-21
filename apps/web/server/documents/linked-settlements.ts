import { parseMoneyString, parseUuid } from '@ams/contracts';
import { capability } from '@ams/permissions';
import { record, documentDatabaseError } from './contracts.ts';
import { CommandError } from '../commands/errors.ts';
import type { OrganizationCommandDefinition } from '../commands/types.ts';
import type { ActorContext } from '../auth/types.ts';
import type { RequestClient } from '../request-client.ts';
import { isCreditApplicationDate } from '../../lib/credit-application.ts';

export interface SettlementChoice {
  id:string; document_id:string; document_type:string; document_number:string|null; party_id:string;
  party_name?:string; control_kind:string; original_amount?:string; remaining_amount:string;
  applied_amount?:string; refunded_amount?:string; reversed?:boolean;
  history?:{document_id:string;document_type:string;document_number:string|null;amount:string;effective_date:string;reversed_on:string|null}[];
}
export interface SettlementOptions { organization_id:string; effective_date:string; sources:SettlementChoice[]; targets:SettlementChoice[] }
export interface SettlementDraftInput {documentId:string|null;expectedVersion:number|null;payload:Record<string,unknown>}
export function validateSettlementDraft(raw:unknown):SettlementDraftInput {
  const r=record(raw),p=record(r.payload,'payload');
  if(Object.keys(r).some(k=>!['document_id','expected_version','payload'].includes(k))||Object.keys(p).some(k=>!['document_type','source_open_item_id','target_open_item_id','amount','accounting_date','description','cash_account_id','reference','cash_flow_class','method'].includes(k)))throw CommandError.validation({document:'Unexpected field.'});
  const type=p.document_type;
  if(!['advance_application','customer_refund','vendor_refund'].includes(String(type)))throw CommandError.validation({document_type:'Choose an application or refund.'});
  const amount=parseMoneyString(p.amount);
  if(BigInt(amount.replace('.',''))<=0n)throw CommandError.validation({amount:'Enter an amount greater than zero.'});
  if(!isCreditApplicationDate(p.accounting_date))throw CommandError.validation({accounting_date:'Choose a valid date.'});
  if(typeof p.description!=='string'||p.description.trim().length<1||p.description.trim().length>500)throw CommandError.validation({description:'Enter a description up to 500 characters.'});
  const payload:Record<string,unknown>={document_type:type,source_open_item_id:parseUuid(p.source_open_item_id),amount,accounting_date:p.accounting_date,description:p.description.trim(),target_open_item_id:p.target_open_item_id?parseUuid(p.target_open_item_id):null};
  if(type==='advance_application') {
    if(!payload.target_open_item_id||p.cash_account_id||p.cash_flow_class||p.reference||p.method)throw CommandError.validation({document:'Select an invoice or bill. Applications have no cash movement.'});
  }else{
    if(payload.target_open_item_id||!['operating','investing','financing'].includes(String(p.cash_flow_class))||!['cash','bank_transfer','mobile_wallet','card','other'].includes(String(p.method))||typeof p.reference!=='string'||!p.reference.trim()||p.reference.length>160)throw CommandError.validation({document:'Select the refund account, payment method, cash classification and evidence reference.'});
    payload.cash_account_id=parseUuid(p.cash_account_id);payload.reference=p.reference.trim();payload.cash_flow_class=p.cash_flow_class;payload.method=p.method;
  }
  const documentId=r.document_id?parseUuid(r.document_id):null;
  if(documentId&&(!Number.isSafeInteger(r.expected_version)||Number(r.expected_version)<1))throw CommandError.validation({expected_version:'Refresh the saved draft.'});
  if(!documentId&&r.expected_version!=null)throw CommandError.validation({expected_version:'A new draft has no version.'});
  return {documentId,expectedVersion:documentId?Number(r.expected_version):null,payload};
}
export function saveLinkedSettlementCommand(client:Pick<RequestClient,'rpc'>):OrganizationCommandDefinition<SettlementDraftInput,{documentId:string;documentVersion:number}> {
  return {operation:'linked-settlements.save',capability:capability('dues.allocate'),idempotency:'required',validate:validateSettlementDraft,
    async execute(ctx,input){
      const required=input.payload.document_type==='customer_refund'?'sales.write':input.payload.document_type==='vendor_refund'?'purchases.write':'journal.write';
      if(!ctx.actor.capabilities.includes(required))throw CommandError.forbidden();
      if(input.payload.document_type!=='advance_application'&&!ctx.actor.capabilities.includes('banking.write'))throw CommandError.forbidden();
      const result=await client.rpc('save_linked_settlement_draft',{p_organization_id:ctx.actor.organizationId,p_document_id:input.documentId,p_expected_version:input.expectedVersion,p_request_id:ctx.requestId,p_idempotency_key:ctx.idempotencyKey,p_request_hash:ctx.requestHash,p_payload:input.payload});
      if(result.error)throw documentDatabaseError(result.error);
      if(!Array.isArray(result.data)||result.data.length!==1)throw new Error('Invalid settlement receipt.');
      const row=record(result.data[0]);if(!Number.isSafeInteger(row.document_version)||row.state!=='draft')throw new Error('Invalid settlement receipt.');
      return {documentId:parseUuid(row.document_id),documentVersion:Number(row.document_version)};
    }};
}
export async function readSettlementOptions(client:Pick<RequestClient,'rpc'>,actor:ActorContext,date:string):Promise<SettlementOptions> {
  if(!actor.capabilities.includes('dues.read'))throw CommandError.forbidden();
  if(!isCreditApplicationDate(date))throw CommandError.validation({date:'Choose a valid date.'});
  const result=await client.rpc('read_linked_settlement_options',{p_organization_id:actor.organizationId,p_effective_date:date});
  if(result.error)throw documentDatabaseError(result.error);
  const data=record(result.data);if(data.organization_id!==actor.organizationId||data.effective_date!==date||!Array.isArray(data.sources)||!Array.isArray(data.targets))throw new Error('Settlement options scope changed.');
  for(const item of [...data.sources,...data.targets]){const r=record(item);parseUuid(r.id);parseUuid(r.document_id);parseUuid(r.party_id);parseMoneyString(r.remaining_amount);}
  return data as unknown as SettlementOptions;
}

export function applyAdvanceCommand(client:Pick<RequestClient,'rpc'>,advanceId:string):OrganizationCommandDefinition<Record<string,unknown>,{documentId:string;documentVersion:number}> {
  const shared=saveLinkedSettlementCommand(client);
  return {operation:`advances.apply:${advanceId}`,capability:capability('dues.allocate'),idempotency:'required',
    validate(raw){const p=record(raw);if(Object.keys(p).some(k=>!['target_open_item_id','amount','accounting_date','description'].includes(k)))throw CommandError.validation({document:'Unexpected field.'});return p;},
    async execute(ctx,input){
      const options=await readSettlementOptions(client,ctx.actor,String(input.accounting_date));
      const item=options.sources.find(s=>s.document_id===advanceId&&['customer_advance','vendor_advance'].includes(s.document_type)&&!s.reversed);
      if(!item)throw CommandError.notFound();
      const data=validateSettlementDraft({document_id:null,expected_version:null,payload:{...input,document_type:'advance_application',source_open_item_id:item.id}});
      return shared.execute(ctx,data);
    }};
}
