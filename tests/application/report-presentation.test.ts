import assert from 'node:assert/strict';
import test from 'node:test';
import { reportPresentation } from '../../apps/web/server/exports/report-presentation.ts';

test('PDF profit and loss uses readable labels and exact signed account amounts from the captured snapshot', () => {
  const totals = { revenue:'9007199254740993.17', direct_costs:'0', gross_profit:'9007199254740993.17', operating_costs:'3.5', other_income:'0', other_expenses:'0', net_profit:'9007199254740989.67' };
  const data = { periods:{current:{from:'2025-01-01',to:'2025-01-31'},comparison:null},totals,accounts:[{account_id:'internal-id',account_code:'5000',account_name:'Office rent',account_type:'expense',report_group:'operating_expense',current_amount:'-3.5'}],warnings:['Provisional example'] };
  const original = structuredClone(data);
  const text = reportPresentation('profit_and_loss',data).map(line=>line.text).join('\n');
  assert.match(text,/Net profit: BDT 9007199254740989\.67/);
  assert.match(text,/5000 - Office rent \(Operating expense\): BDT 3\.50/);
  assert.match(text,/Provisional example/);
  assert.doesNotMatch(text,/report\.|account_id|internal-id/);
  assert.match(text,/Gross profit: Not shown \(no direct-cost accounts mapped\)/);
  assert.deepEqual(data,original);
  assert.deepEqual(reportPresentation('profit_loss',data),reportPresentation('profit_and_loss',data));
  assert.throws(()=>reportPresentation('profit_and_loss',{...data,totals:{...totals,net_profit:0}}),/Invalid report amount/);
});

test('PDF statement keeps dated movement, separate advances and control differences',()=>{
  const data={party:{name:'Synthetic customer'},from:'2025-01-01',to:'2025-01-31',opening:{trade:'0',advances:'25'},movements:{trade:'40',advances:'-5'},closing:{trade:'40',advances:'20'},events:[{date:'2025-01-15',event_type:'receipt',document_number:'RC-001',balance_effect:'-60',running_balance:'40',reference:'Golden receipt'}],control_bridge:{trade_difference:'0',advance_difference:'0'}};
  const text=reportPresentation('customer_statement',data).map(line=>line.text).join('\n');
  assert.match(text,/Advances: BDT 20\.00/);assert.match(text,/2025-01-15 - Receipt - RC-001/);assert.match(text,/Movement: BDT -60\.00/);assert.match(text,/Trade difference: BDT 0\.00/);
});
