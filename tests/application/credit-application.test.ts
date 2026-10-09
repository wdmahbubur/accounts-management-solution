import assert from "node:assert/strict";
import test from "node:test";
import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { creditApplicationMessage, confirmedCreditApplicationReceipt, isCreditApplicationDate, parseCreditApplicationOptions } from "../../apps/web/lib/credit-application.ts";
import { readCreditApplicationOptions } from "../../apps/web/server/documents/credit-application.ts";
import { RecoverableFormRequest } from "../../apps/web/app/o/[organizationId]/accounting/documents/document-action-validation.ts";
import type { ActorContext } from "../../apps/web/server/auth/types.ts";
import type { RequestClient } from "../../apps/web/server/request-client.ts";

const organizationId="deba95d9-6b20-4b9f-b01b-c3636595a825",documentId="deba95d9-6b20-4b9f-b01b-c3636595a826";
const originalId="deba95d9-6b20-4b9f-b01b-c3636595a827",debit="deba95d9-6b20-4b9f-b01b-c3636595a828",credit="deba95d9-6b20-4b9f-b01b-c3636595a829";
const expected={organizationId,documentId,effectiveDate:"2026-10-09"};
const fixture=()=>({organization_id:organizationId,document_id:documentId,document_type:"customer_credit",document_number:"CN-00001",
  original_document_id:originalId,original_document_type:"invoice",original_document_number:"INV-00001",effective_date:expected.effectiveDate,minimum_date:"2026-10-01",
  credit_amount:"100.01",credit_residual_amount:"80.01",original_residual_amount:"200.00",available_amount:"60.00",status:"available",
  debit_open_item_id:debit,credit_open_item_id:credit,allocations:[{id:originalId,amount:"20.00",effective_date:"2026-10-01",counter_document_id:originalId,counter_document_number:"INV-00001",counter_document_type:"invoice",reversed_on:null}]});
const actor:ActorContext={organizationId:parseOrganizationId(organizationId),userId:parseUuid(debit),memberId:parseUuid(credit),capabilities:["dues.read","sales.read"]};

test("credit application retains exact balances, safe future capacity and every dated history row",()=>{
  const raw=fixture(),before=structuredClone(raw);
  const options=parseCreditApplicationOptions(raw,expected);
  assert.equal(options.available_amount,"60.00");
  assert.equal(options.credit_residual_amount,"80.01");
  assert.equal(options.allocations.length,1);
  assert.equal(options.original_document_number,"INV-00001");
  assert.deepEqual(raw,before);
  const large=parseCreditApplicationOptions({...raw,credit_amount:"9007199254740993.19",credit_residual_amount:"9007199254740993.19",original_residual_amount:"9007199254740993.19",available_amount:"9007199254740993.18"},expected);
  assert.equal(large.available_amount,"9007199254740993.18");
});

test("credit application rejects mismatched company, source, date and original source type",()=>{
  for(const changes of [{organization_id:originalId},{document_id:originalId},{effective_date:"2026-10-10"},{original_document_type:"bill"},{document_type:"receipt"},{original_document_id:documentId},{credit_open_item_id:debit}]) {
    assert.throws(()=>parseCreditApplicationOptions({...fixture(),...changes},expected));
  }
  const vendor=parseCreditApplicationOptions({...fixture(),document_type:"vendor_credit",original_document_type:"bill"},expected);
  assert.equal(vendor.original_document_type,"bill");
});

test("malformed amounts, impossible capacity and dropped history are rejected",()=>{
  for(const changes of [{available_amount:60},{credit_amount:"1e3"},{available_amount:"80.02"},{credit_residual_amount:"100.02"},{original_residual_amount:"59.99"},{available_amount:"0.00"},{status:"reversed"},{allocations:[null]},{allocations:{}}]) {
    assert.throws(()=>parseCreditApplicationOptions({...fixture(),...changes},expected));
  }
  assert.throws(()=>parseCreditApplicationOptions({...fixture(),allocations:[{...fixture().allocations[0],effective_date:"2026-02-30"}]},expected));
});

test("future and settled credit states do not imply available money",()=>{
  const future=parseCreditApplicationOptions({...fixture(),status:"not_yet_effective",minimum_date:"2026-10-10",available_amount:"0.00",credit_residual_amount:null,original_residual_amount:null},expected);
  assert.match(creditApplicationMessage(future),/2026-10-10/);
  for(const status of ["already_allocated","original_settled","reversed","no_capacity"] as const) {
    const result=parseCreditApplicationOptions({...fixture(),status,available_amount:"0.00"},expected);
    assert.ok(creditApplicationMessage(result).length>20);
  }
  assert.equal(isCreditApplicationDate("2026-02-30"),false);
  assert.equal(isCreditApplicationDate("2028-02-29"),true);
});

test("credit balance service checks permission and date before reaching the database",async()=>{
  let calls=0;
  const client={rpc:async()=>{calls++;return{data:fixture(),error:null};}} as Pick<RequestClient,"rpc">;
  await assert.rejects(()=>readCreditApplicationOptions(client,{...actor,capabilities:["sales.read"]},documentId,expected.effectiveDate),{code:"FORBIDDEN"});
  await assert.rejects(()=>readCreditApplicationOptions(client,actor,documentId,"2026-02-30"));
  assert.equal(calls,0);
  assert.equal((await readCreditApplicationOptions(client,actor,documentId,expected.effectiveDate)).document_id,documentId);
  assert.equal(calls,1);
});

test("credit balance service passes the selected actor scope and respects database denials",async()=>{
  const calls:unknown[]=[];
  const client={rpc:async(name:string,args:unknown)=>{calls.push([name,args]);return{data:fixture(),error:null};}} as Pick<RequestClient,"rpc">;
  await readCreditApplicationOptions(client,actor,documentId,expected.effectiveDate);
  assert.deepEqual(calls,[["read_credit_application_options",{p_organization_id:organizationId,p_document_id:documentId,p_effective_date:expected.effectiveDate}]]);
  for(const [sql,code] of [["42501","FORBIDDEN"],["P0002","NOT_FOUND"]]) {
    const denied={rpc:async()=>({data:null,error:{code:sql}})} as Pick<RequestClient,"rpc">;
    await assert.rejects(()=>readCreditApplicationOptions(denied,actor,documentId,expected.effectiveDate),{code});
  }
});

test("a credit application confirms only its exact amount and date; ambiguous replies retain request identity",()=>{
  const receipt={allocationId:originalId,amount:"60.00",effectiveDate:expected.effectiveDate,availableDebit:"140.00",availableCredit:"20.01"};
  assert.equal(confirmedCreditApplicationReceipt(receipt,{amount:"60.00",effectiveDate:expected.effectiveDate}).allocationId,originalId);
  for(const changes of [{amount:"59.99"},{effectiveDate:"2026-10-10"},{allocationId:null},{availableCredit:20.01}]) {
    assert.throws(()=>confirmedCreditApplicationReceipt({...receipt,...changes},{amount:"60.00",effectiveDate:expected.effectiveDate}));
  }
  const request=new RecoverableFormRequest();
  const first=request.begin(JSON.stringify({amount:"60.00",effective_date:expected.effectiveDate}));
  assert.ok(first);
  request.uncertain();
  const replay=request.begin("");
  assert.equal(replay?.body,first.body);assert.equal(replay?.key,first.key);
  request.confirmed();assert.equal(request.needsRetry,false);
});
