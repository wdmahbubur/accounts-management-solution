import assert from "node:assert/strict";
import test from "node:test";
import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { readSupplierDocumentLifecycle, readSupplierPaymentAllocationOptions } from "../../apps/web/server/documents/supplier-payments.ts";
import type { ActorContext } from "../../apps/web/server/auth/types.ts";
import type { RequestClient } from "../../apps/web/server/request-client.ts";

const org="bbdcbba0-9ac6-4e36-a389-bd9859c302a9",party="caf48288-7cc0-4ef4-a27e-59f577016772",id="8fafbe78-54c0-4c57-840f-8d0374693efa",item="707a5e2f-1f61-4baf-ae8a-f73b8a0305e3";
const actor=(capabilities:readonly string[]=["purchases.write","documents.read","dues.read","purchases.read"]):ActorContext=>({organizationId:parseOrganizationId(org),userId:parseUuid(id),memberId:parseUuid(item),capabilities});
const target={organization_id:org,party_id:party,open_item_id:item,document_id:id,document_number:"BILL-FY 2026-000001",supplier_reference:"সরবরাহ-০০১",
  issue_date:"2026-01-15",due_date:null,total_amount:"99999999999999.99",residual_amount:"99999999999999.98",available_amount:"12.37"};
const client=(data:unknown,error:null|{code:string}=null)=>({rpc:async()=>({data,error})}) as Pick<RequestClient,"rpc">;
const lifecycle={id,organization_id:org,document_type:"vendor_payment",state:"posted",as_of_date:"2026-10-09",total_amount:"1250.37",residual_amount:"250.37",applied_amount:"1000.00",
  settlement_status:"partially_allocated",overdue:false,allocations:[{id:item,amount:"1000.00",effective_date:"2026-10-08",counter_document_id:id,counter_document_type:"bill",counter_document_number:"BILL-1",reversed_on:null}],corrections:[]};

test("supplier choices preserve exact dated residual and lower future-safe capacity, with explicit tenant/party RPC scope",async()=>{
  const calls:unknown[]=[];
  const rpc={rpc:async(name:string,args:unknown)=>{calls.push({name,args});return {data:[target],error:null};}} as Pick<RequestClient,"rpc">;
  const result=await readSupplierPaymentAllocationOptions(rpc,actor(),party,"2026-10-09");
  assert.deepEqual(calls,[{name:"read_supplier_payment_allocation_options",args:{p_organization_id:org,p_party_id:party,p_accounting_date:"2026-10-09"}}]);
  assert.deepEqual(result,[{openItemId:item,documentId:id,documentNumber:target.document_number,supplierReference:target.supplier_reference,issueDate:target.issue_date,dueDate:null,
    totalAmount:target.total_amount,residualAmount:target.residual_amount,availableAmount:"12.37"}]);
});

test("supplier choices deny missing preparation/dues capabilities before making a database call",async()=>{
  let calls=0;const rpc={rpc:async()=>{calls++;return {data:[],error:null};}} as Pick<RequestClient,"rpc">;
  for(const missing of ["purchases.write","documents.read","dues.read"]){
    await assert.rejects(()=>readSupplierPaymentAllocationOptions(rpc,actor(actor().capabilities.filter(code=>code!==missing)),party,"2026-10-09"),{code:"FORBIDDEN"});
  }
  assert.equal(calls,0);
});

test("supplier choices reject impossible calendar dates and invalid identities before RPC",async()=>{
  let calls=0;const rpc={rpc:async()=>{calls++;return {data:[],error:null};}} as Pick<RequestClient,"rpc">;
  for(const invalid of ["2026-02-29","2026-04-31","2026-10-09T00:00:00Z","2026-13-01",""]){
    await assert.rejects(()=>readSupplierPaymentAllocationOptions(rpc,actor(),party,invalid));
  }
  await assert.rejects(()=>readSupplierPaymentAllocationOptions(rpc,actor(),"not-a-uuid","2026-10-09"));assert.equal(calls,0);
  assert.deepEqual(await readSupplierPaymentAllocationOptions(rpc,actor(),party,"2028-02-29"),[]);
});

test("foreign scope, duplicate items and impossible or non-string capacities fail the entire choice list",async()=>{
  for(const changed of [{organization_id:party},{party_id:id},{available_amount:"0.00"},{available_amount:"99999999999999.99"},
    {residual_amount:"100000000000000.00"},{available_amount:12.37},{due_date:"2026-02-30"},{supplier_reference:42}]){
    await assert.rejects(()=>readSupplierPaymentAllocationOptions(client([{...target,...changed}]),actor(),party,"2026-10-09"));
  }
  await assert.rejects(()=>readSupplierPaymentAllocationOptions(client([target,target]),actor(),party,"2026-10-09"));
  await assert.rejects(()=>readSupplierPaymentAllocationOptions(client([target,null]),actor(),party,"2026-10-09"));
});

test("overflow is an explicit failure and never a silently incomplete bill list",async()=>{
  await assert.rejects(()=>readSupplierPaymentAllocationOptions(client(Array.from({length:1001},()=>target)),actor(),party,"2026-10-09"),{code:"VALIDATION_FAILED"});
});

test("supplier read errors preserve permission, masked absence and actionable setup/date distinctions",async()=>{
  for(const [sql,code] of [["42501","FORBIDDEN"],["P0002","NOT_FOUND"],["22023","VALIDATION_FAILED"],["22008","VALIDATION_FAILED"],["23514","VALIDATION_FAILED"]]){
    await assert.rejects(()=>readSupplierPaymentAllocationOptions(client(null,{code:sql!}),actor(),party,"2026-10-09"),{code});
  }
  await assert.rejects(()=>readSupplierPaymentAllocationOptions(client(null,{code:"XX000"}),actor(),party,"2026-10-09"),/could not be loaded/);
});

test("purchase lifecycle preserves all settlement rows, including inaccessible targets and future unapply dates",async()=>{
  const source={...lifecycle,allocations:[...lifecycle.allocations,{...lifecycle.allocations[0],id:party,counter_document_id:null,counter_document_type:null,counter_document_number:null,reversed_on:"2026-10-31"}]};
  const result=await readSupplierDocumentLifecycle(client(source),actor(["purchases.read"]),id);
  assert.deepEqual(result,source);assert.equal(result.allocations.length,2);
});

test("future and reversed purchase lifecycle retain explicit status instead of inventing current outstanding",async()=>{
  for(const source of [{...lifecycle,settlement_status:"not_yet_effective",residual_amount:null,applied_amount:"0.00"},
    {...lifecycle,settlement_status:"reversed",residual_amount:"0.00",applied_amount:"1250.37",corrections:[{id:party,document_type:"reversal",document_number:"REV-1",state:"posted",accounting_date:"2026-10-09",reason:"Synthetic correction"}]}]){
    assert.deepEqual(await readSupplierDocumentLifecycle(client(source),actor(["purchases.read"]),id),source);
  }
});

test("supplier lifecycle rejects foreign identity and malformed rows without discarding financial evidence",async()=>{
  for(const changed of [{organization_id:party},{id:party},{document_type:"invoice"},{residual_amount:250.37},{allocations:[null]},
    {allocations:[{...lifecycle.allocations[0],amount:"1000"}]},{as_of_date:"2026-02-30"},{settlement_status:"unknown"}]){
    await assert.rejects(()=>readSupplierDocumentLifecycle(client({...lifecycle,...changed}),actor(),id));
  }
  let calls=0;const rpc={rpc:async()=>{calls++;return {data:lifecycle,error:null};}} as Pick<RequestClient,"rpc">;
  await assert.rejects(()=>readSupplierDocumentLifecycle(rpc,actor(["documents.read"]),id),{code:"FORBIDDEN"});assert.equal(calls,0);
});
