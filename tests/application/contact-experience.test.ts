import assert from "node:assert/strict";
import test from "node:test";
import { addressFieldDefinitions, taxFieldDefinitions, formatContactDetails, formatContactMoney } from "../../apps/web/lib/contact-details.ts";
import { additionalContactDetails, contactEditFields, mergeContactFields } from "../../apps/web/lib/contact-fields.ts";
import { ContactSaveGuard, contactSaveDestination, LatestContactLookup, performContactSave } from "../../apps/web/lib/contact-requests.ts";
import { saveContactCommand } from "../../apps/web/server/contacts/service.ts";
import { CommandError, commandErrorBody } from "../../apps/web/server/commands/errors.ts";
import type { RequestClient } from "../../apps/web/server/request-client.ts";

const id="8fafbe78-54c0-4c57-840f-8d0374693efa";
const legacyAddress={line1:"12 Test Road",city:"Dhaka",postcode:"1212",country:"BD",delivery_note:"Reception",legacy_import:{source:"batch2-synthetic"}};
const legacyTax={tin:"TEST-TIN-001",bin:"TEST-BIN-001",custom_registration:"SYNTHETIC-REG"};
const values=(object:unknown,definitions:typeof addressFieldDefinitions)=>Object.fromEntries(contactEditFields(object,definitions).map(field=>[field.name,field.value]));
const confirmed={id,row_version:2,is_customer:true,is_vendor:false};

test("plain address editing preserves unknown nested legacy values and existing postcode alias",()=>{
  const original=structuredClone(legacyAddress);Object.freeze(original.legacy_import);Object.freeze(original);
  const edited=mergeContactFields(original,addressFieldDefinitions,{...values(original,addressFieldDefinitions),line1:"34 New Road",postal_code:"1207"});
  assert.deepEqual(edited,{...legacyAddress,line1:"34 New Road",postcode:"1207"});
  assert.equal(Object.hasOwn(edited,"postal_code"),false);
  assert.deepEqual(original,legacyAddress);
});

test("editing tax fields retains custom registrations without imposing numeric identifier rules",()=>{
  const updated=mergeContactFields(legacyTax,taxFieldDefinitions,{...values(legacyTax,taxFieldDefinitions),tin:"নম্বর A-001 / test"});
  assert.deepEqual(updated,{...legacyTax,tin:"নম্বর A-001 / test"});
  assert.deepEqual(mergeContactFields(legacyTax,taxFieldDefinitions,values(legacyTax,taxFieldDefinitions)),legacyTax);
});

test("unchanged nulls, whitespace, arrays, booleans and duplicate aliases survive an unrelated edit",()=>{
  const original={line1:"  Original road  ",line2:null,postcode:"0012",postal_code:"0013",legacy:[null,false,0,{tag:"শাখা"}],region:{bn:"ঢাকা"}};
  const fields=contactEditFields(original,addressFieldDefinitions);
  assert.equal(fields.find(field=>field.name==="region")?.readOnly,true);
  const updated=mergeContactFields(original,addressFieldDefinitions,{...values(original,addressFieldDefinitions),city:"Dhaka",region:"attempted replacement"});
  assert.deepEqual(updated,{...original,city:"Dhaka"});
  assert.deepEqual(additionalContactDetails(original,addressFieldDefinitions),[
    {label:"Postcode",value:"0012"},{label:"Legacy · 2",value:"false"},{label:"Legacy · 3",value:"0"},{label:"Legacy · 4 · Tag",value:"শাখা"},{label:"Region · Bn",value:"ঢাকা"}
  ]);
});

test("explicit clearing removes only the edited supported field",()=>{
  const updated=mergeContactFields(legacyAddress,addressFieldDefinitions,{...values(legacyAddress,addressFieldDefinitions),line1:" "});
  const expected={...legacyAddress} as Record<string,unknown>;delete expected.line1;
  assert.deepEqual(updated,expected);
  assert.deepEqual(mergeContactFields({},addressFieldDefinitions,values({},addressFieldDefinitions)),{});
  assert.deepEqual(mergeContactFields({line2:null},addressFieldDefinitions,{line2:"Suite 2"}),{line2:"Suite 2"});
});

test("formatter reads supplied issued snapshot without mutating it or observing later live contact edits",()=>{
  const issued={display_name:"Issued customer",legal_name:null,email:"",phone:null,billing_address:structuredClone(legacyAddress),tax_identifiers:structuredClone(legacyTax)};
  const before=structuredClone(issued);const rendered=formatContactDetails(issued);
  const editedLiveContact={...issued,display_name:"New name",billing_address:mergeContactFields(issued.billing_address,addressFieldDefinitions,{line1:"New address"})};
  assert.equal(formatContactDetails(editedLiveContact).displayName,"New name");
  assert.deepEqual(formatContactDetails(issued),rendered);
  assert.deepEqual(issued,before);
  assert.deepEqual(rendered.addressLines,["12 Test Road","Dhaka","1212","BD","Delivery note: Reception","Legacy import · Source: batch2-synthetic"]);
  assert.equal(rendered.email,null);assert.equal(rendered.phone,null);
  assert.deepEqual(rendered.taxIdentifiers.map(field=>field.value),["TEST-TIN-001","TEST-BIN-001","SYNTHETIC-REG"]);
  assert.deepEqual(formatContactDetails(null).addressLines,[]);
});

test("profile money normalizes integer/one-decimal strings exactly without hiding invalid values",()=>{
  assert.equal(formatContactMoney("0"),"0.00");assert.equal(formatContactMoney("1250.3"),"1,250.30");
  assert.equal(formatContactMoney("999999999999999999.99"),"999,999,999,999,999,999.99");
  assert.equal(formatContactMoney("-1234.50"),"-1,234.50");
  for(const invalid of [0,NaN,null,undefined,"","NaN","1e3","1.001","1,250.37"])assert.equal(formatContactMoney(invalid),null);
});

test("UI payload keeps the API's existing version, money-string and JSON preservation contract",()=>{
  const client={rpc:async()=>({data:null,error:null})} as Pick<RequestClient,"rpc">;
  const input=saveContactCommand(client,id).validate({expected_version:7,contact:{display_name:"Customer",legal_name:null,is_customer:true,is_vendor:false,email:null,phone:null,
    billing_address:mergeContactFields(legacyAddress,addressFieldDefinitions,{city:"ঢাকা"}),tax_identifiers:mergeContactFields(legacyTax,taxFieldDefinitions,{tin:"TEST-002"}),
    payment_terms_days:30,credit_limit:"99999999999999.99",external_key:null,is_active:true}});
  assert.equal(input.expectedVersion,7);assert.equal(input.contact.credit_limit,"99999999999999.99");
  assert.deepEqual(input.contact.billing_address.legacy_import,legacyAddress.legacy_import);
  assert.equal(input.contact.tax_identifiers.custom_registration,"SYNTHETIC-REG");
});

test("pending and confirmed saves reject repeated submission before React state updates",()=>{
  const guard=new ContactSaveGuard();let keys=0;
  const request=guard.begin('{"name":"Customer"}',()=>`key-${++keys}`);assert.ok(request);
  assert.equal(guard.begin(request.body,()=>`key-${++keys}`),null);assert.equal(keys,1);
  guard.saved();assert.equal(guard.begin(request.body,()=>`key-${++keys}`),null);
});

test("lost response retries send the identical bytes/key; changed edits cannot become a new uncertain mutation",async()=>{
  const guard=new ContactSaveGuard();let keys=0;const original=JSON.stringify({expected_version:1,contact:{credit_limit:"99999999999999.99",billing_address:legacyAddress}});
  const first=guard.begin(original,()=>`key-${++keys}`)!;const sent:RequestInit[]=[];
  const transport:typeof fetch=async(_url,init)=>{sent.push(init!);if(sent.length===1)throw new Error("connection lost");return Response.json({data:confirmed});};
  const input={url:"/api/contacts",method:"PATCH" as const,expectedId:id,request:first,requestId:"first"};
  assert.deepEqual(await performContactSave(input,transport),{kind:"uncertain"});guard.uncertain();
  assert.equal(guard.begin(original+" ",()=>`key-${++keys}`),null);
  const retry=guard.begin(original,()=>`key-${++keys}`)!;assert.equal(retry,first);assert.equal(keys,1);
  assert.deepEqual(await performContactSave({...input,request:retry,requestId:"retry"},transport),{kind:"confirmed",contact:confirmed});
  assert.equal(sent[0].body,sent[1].body);assert.equal(new Headers(sent[0].headers).get("Idempotency-Key"),new Headers(sent[1].headers).get("Idempotency-Key"));
});

test("definitive validation failure exposes field errors and permits a corrected request with a new key",async()=>{
  const guard=new ContactSaveGuard();const first=guard.begin("original",()=>"first")!;
  const failure=commandErrorBody(CommandError.validation({email:"Use a valid email"},"Validation failed"),"test");
  const outcome=await performContactSave({url:"/api/contacts",method:"POST",request:first,requestId:"test"},async()=>Response.json({...failure,error:{...failure.error,fields:{...failure.error.fields,ignored:123}}},{status:422}));
  assert.deepEqual(outcome,{kind:"rejected",message:"Validation failed",fields:{email:"Use a valid email"}});
  guard.reject();const corrected=guard.begin("corrected",()=>"second");assert.equal(corrected?.body,"corrected");assert.equal(corrected?.key,"second");
});

test("stale contact response cannot silently retry against a newer version",async()=>{
  const guard=new ContactSaveGuard();const request=guard.begin('{"expected_version":1}',()=>"key")!;
  const outcome=await performContactSave({url:"/api/contacts",method:"PATCH",expectedId:id,request,requestId:"test"},async()=>Response.json(commandErrorBody(CommandError.conflict("STALE_VERSION"),"test"),{status:409}));
  assert.deepEqual(outcome,{kind:"conflict",stale:true});guard.conflict();
  assert.equal(guard.begin('{"expected_version":2}',()=>"another-key"),null);
  assert.equal(request.body,'{"expected_version":1}');
});

test("server failure, malformed success and wrong edited-contact receipt remain uncertain",async()=>{
  const input={url:"/api/contacts",method:"PATCH" as const,expectedId:id,request:{key:"key",body:"saved body"},requestId:"test"};
  for(const response of [new Response("temporary failure",{status:503}),Response.json({data:{}}),Response.json({data:{...confirmed,id:"8fafbe78-54c0-4c57-840f-8d0374693efb"}})]) {
    assert.deepEqual(await performContactSave(input,async()=>response),{kind:"uncertain"});
  }
});

test("timeouts and unrecognized 4xx after a simulated commit retain identical retry bytes and key",async()=>{
  const responses=[
    new Response("Request timed out",{status:408}),
    Response.json(commandErrorBody(CommandError.validation({contact:"Retry later"}),"test"),{status:408}),
    new Response("<html>Gateway rejected the response</html>",{status:403}),
    Response.json({error:{message:"Unknown gateway failure"}},{status:422}),
    Response.json({error:{code:"UNKNOWN_GATEWAY_ERROR",message:"Unavailable"},meta:{request_id:"test"}},{status:400}),
    new Response("Conflict from gateway",{status:409})
  ];
  for(const firstResponse of responses){
    const guard=new ContactSaveGuard();let keys=0,commits=0;const applied=new Set<string>(),sent:RequestInit[]=[];
    const original=JSON.stringify({expected_version:1,contact:{billing_address:legacyAddress,credit_limit:"1250.37"}});
    const request=guard.begin(original,()=>`key-${++keys}`)!;
    const transport:typeof fetch=async(_url,init)=>{
      sent.push(init!);const key=new Headers(init?.headers).get("Idempotency-Key")!;
      if(!applied.has(key)){applied.add(key);commits++;}
      return sent.length===1?firstResponse:Response.json({data:confirmed});
    };
    const input={url:"/api/contacts",method:"PATCH" as const,expectedId:id,request,requestId:"test"};
    assert.deepEqual(await performContactSave(input,transport),{kind:"uncertain"});guard.uncertain();
    assert.equal(guard.begin(original+" ",()=>`key-${++keys}`),null);
    const retry=guard.begin(original,()=>`key-${++keys}`)!;
    assert.deepEqual(await performContactSave({...input,request:retry,requestId:"retry"},transport),{kind:"confirmed",contact:confirmed});
    assert.equal(commits,1);assert.equal(keys,1);assert.equal(sent[0].body,sent[1].body);
    assert.equal(new Headers(sent[0].headers).get("Idempotency-Key"),new Headers(sent[1].headers).get("Idempotency-Key"));
  }
});

test("late duplicate responses cannot replace a newer lookup or a cleared short name",()=>{
  const lookup=new LatestContactLookup();const old=lookup.next();const current=lookup.next();
  assert.equal(lookup.isCurrent(old),false);assert.equal(lookup.isCurrent(current),true);
  lookup.next();assert.equal(lookup.isCurrent(current),false);
});


test("confirmed role changes never navigate into a profile the actor cannot read",()=>{
  const supplierOnly={id,is_customer:false,is_vendor:true};
  assert.equal(contactSaveDestination("company","customer",["customer"],supplierOnly),null);
  assert.equal(contactSaveDestination("company","customer",[],confirmed),null);
  assert.equal(contactSaveDestination("company","customer",["vendor"],supplierOnly),`/o/company/purchases/vendors/${id}`);
  assert.equal(contactSaveDestination("company","vendor",["customer","vendor"],{...confirmed,is_vendor:true}),`/o/company/purchases/vendors/${id}`);
});
