import assert from 'node:assert/strict';
import test from 'node:test';
import {countryCodes,currencyCodes,countryOptions,isCountryCode,isBaseCurrency,parseBaseCurrency} from '@ams/contracts';
import {calculateDocument} from '@ams/accounting';
import {parseCompanyOnboardingForm} from '../../apps/web/server/onboarding/input.ts';
import {validateDraftDocument} from '../../apps/web/server/documents/contracts.ts';
import {reportPresentation} from '../../apps/web/server/exports/report-presentation.ts';
import {readCompanyLocale} from '../../apps/web/server/companies/locale.ts';
test('the shared catalog has unique named countries and supported two-decimal currencies',()=>{
 assert.equal(new Set(countryCodes).size,249);assert.equal(new Set(currencyCodes).size,132);
 for(const code of ['BD','US','GB','DE','JP','TW'])assert.ok(isCountryCode(code));
 for(const code of ['BDT','USD','EUR','GBP','INR','AED'])assert.ok(isBaseCurrency(code));
 for(const code of ['XXX','JPY','KWD','BTC','usd',null,1])assert.equal(isBaseCurrency(code),false);
 for(const code of ['ZZ','XX','UK','USA','',null])assert.equal(isCountryCode(code),false);
 assert.ok(countryOptions.every(o=>o.name.length>1));assert.throws(()=>parseBaseCurrency('JPY'));
});
test('onboarding preserves the selected country and accounting currency',()=>{
 const values={name:'Synthetic global company',legal_name:'Synthetic Global Company',country_code:'us',base_currency:'usd',timezone:'America/New_York',fiscal_year_start_month:'1',books_start_date:'2026-01-01',idempotency_key:'synthetic-global-company-123456'};
 const form=new FormData();for(const[k,v]of Object.entries(values))form.set(k,v);
 const result=parseCompanyOnboardingForm(form);assert.equal(result.countryCode,'US');assert.equal(result.baseCurrency,'USD');
 form.set('country_code','ZZ');assert.throws(()=>parseCompanyOnboardingForm(form));
 form.set('country_code','UK');assert.throws(()=>parseCompanyOnboardingForm(form));
});
test('two-decimal document calculations preserve the code and exact fractional amount',()=>{
 for(const currency of ['BDT','USD','EUR','GBP']){
  const result=calculateDocument({currency,lines:[{quantity:'3',unit_price:'0.335',discount_amount:'0.00',tax_rate:'0',tax_mode:'exclusive'}]});
  assert.equal(result.currency,currency);assert.equal(result.total,'1.01');
 }
 assert.throws(()=>calculateDocument({currency:'JPY',lines:[]}));
});
test('new PDF report presentation uses the supplied currency without relabeling the values',()=>{
 const lines=reportPresentation('trial_balance',[{account_code:'1000',account_name:'Synthetic bank',opening_balance:'0.00',movement_debit:'123.45',movement_credit:'0.00',closing_debit:'123.45',closing_credit:'0.00'}],'USD');
 assert.ok(lines.some(l=>l.text.includes('USD 123.45')));assert.ok(lines.every(l=>!l.text.includes('BDT')));
});
test('draft input rejects currency codes that exceed the engine precision',()=>{
 assert.throws(()=>validateDraftDocument({currency:'KWD'}));
});
test('company locale uses the authorized server calendar without a country or browser fallback',async()=>{
 const id='e398394d-978c-4591-a980-f9362cac6148';
 const locale={organization_id:id,country_code:'US',base_currency:'USD',timezone:'America/New_York',today:'2026-12-31'};
 const client={rpc:async()=>({data:locale,error:null})};
 assert.deepEqual(await readCompanyLocale(client,id),{countryCode:'US',baseCurrency:'USD',timezone:'America/New_York',today:'2026-12-31'});
 const legacy=await readCompanyLocale({rpc:async()=>({data:{...locale,country_code:'UK'},error:null})},id);assert.equal(legacy.countryCode,'UK','Legacy typed country codes must not make existing books unreadable.');
 for(const change of[{today:undefined},{timezone:null},{organization_id:'foreign'},{base_currency:'JPY'}])await assert.rejects(readCompanyLocale({rpc:async()=>({data:{...locale,...change},error:null})},id));
});
