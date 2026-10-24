import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSettlementDraft } from '../../apps/web/server/documents/linked-settlements.ts';
const id='e0f71cf6-aa64-48bb-987d-32aac22d386a',target='b45bc9f2-d6ac-48f3-bd18-4c866487dd44';
const body=()=>({document_id:null,expected_version:null,payload:{document_type:'advance_application',source_open_item_id:id,target_open_item_id:target,amount:'1.01',accounting_date:'2025-01-15',description:'Apply advance'}});
test('settlement boundaries preserve exact money and require an explicit source and target',()=>{
  const value=validateSettlementDraft(body());assert.equal(value.payload.amount,'1.01');assert.equal(value.payload.source_open_item_id,id);assert.equal(value.payload.target_open_item_id,target);
  for(const extra of [{amount:1.01},{amount:'0.00'},{amount:'1.001'},{source_open_item_id:null},{target_open_item_id:null},{accounting_date:'2025-02-30'},{cash_account_id:id},{unexpected:'ignored'}]) {
    assert.throws(()=>validateSettlementDraft({...body(),payload:{...body().payload,...extra}}));
  }
});
test('refunds require a cash account and explicit classification and prohibit a second target',()=>{
  const value={...body(),payload:{...body().payload,document_type:'customer_refund',target_open_item_id:null,cash_account_id:id,cash_flow_class:'operating',reference:'External evidence',method:'bank_transfer'}};
  assert.equal(validateSettlementDraft(value).payload.cash_account_id,id);
  for(const extra of [{target_open_item_id:target},{cash_account_id:null},{cash_flow_class:'internal'},{reference:'x'.repeat(161)},{reference:' '},{method:'unknown'}])assert.throws(()=>validateSettlementDraft({...value,payload:{...value.payload,...extra}}));
});
test('editing binds the existing document version and rejects undeclared fields',()=>{
  assert.throws(()=>validateSettlementDraft({...body(),document_id:id}));
  assert.equal(validateSettlementDraft({...body(),document_id:id,expected_version:2}).expectedVersion,2);
  assert.throws(()=>validateSettlementDraft({...body(),actor_member_id:id}));
});
