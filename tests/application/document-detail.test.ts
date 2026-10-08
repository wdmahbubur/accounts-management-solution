import assert from "node:assert/strict";
import test from "node:test";
import { parseOrganizationId, parseUuid } from "@ams/contracts";
import {
  accountLabel, detailDate, detailDecimal, detailRows, documentHeading, documentList, exactJournalTotals,
  invoiceDetailActions, issuedPartyDetails, sourceStateExplanation, sourceStateLabel
} from "../../apps/web/components/finance/document-detail-model.ts";
import { readFinancialDocument } from "../../apps/web/server/documents/service.ts";
import type { RequestClient } from "../../apps/web/server/request-client.ts";
import type { ActorContext } from "../../apps/web/server/auth/types.ts";

const id = "deba95d9-6b20-4b9f-b01b-c3636595a825";
const invoice = { id, document_type: "invoice", state: "posted", document_number: "INV-00001", party_id: id, total_amount: "1250.37" };

test("unnumbered approved documents keep their source type and approval state, without a Draft heading", () => {
  const approved = { ...invoice, state: "approved", document_number: null };
  assert.equal(documentHeading(approved), "Invoice");
  assert.equal(sourceStateLabel(approved), "Approved");
  assert.doesNotMatch(sourceStateExplanation(approved), /draft/i);
  assert.equal(sourceStateLabel({state:"pending_approval"}), "Awaiting approval");
  assert.equal(documentHeading(invoice), "INV-00001");
  assert.equal(documentHeading({document_type:"vendor_payment",state:"approved"}), "Supplier payment");
});

test("issued customer display uses only immutable snapshot data, including legacy address and tax fields", () => {
  const snapshot = { display_name:"Original issued customer",legal_name:"Original legal name",email:"original@example.invalid",phone:null,
    billing_address:{line1:"Original address",city:"Dhaka",legacy:{floor:"3"}},tax_identifiers:{tin:"ORIGINAL",legacy_tax:"Kept"} };
  const source = { ...invoice, party_snapshot:snapshot, party:{display_name:"Changed live name",billing_address:{line1:"Changed live address"}} };
  const before = structuredClone(source), displayed = issuedPartyDetails(source);
  assert.equal(displayed.displayName,"Original issued customer");
  assert.deepEqual(displayed.addressLines,["Original address","Dhaka","Legacy · Floor: 3"]);
  assert.equal(displayed.taxIdentifiers.find(item=>item.label==="Tax identification number (TIN)")?.value,"ORIGINAL");
  assert.equal(displayed.taxIdentifiers.find(item=>item.label==="Legacy tax")?.value,"Kept");
  assert.doesNotMatch(JSON.stringify(displayed),/Changed live/);
  assert.deepEqual(source,before);
  assert.notEqual(issuedPartyDetails({...source,party_snapshot:null}).displayName,"Changed live name");
});

test("saved six-place quantities and rates retain every digit without floating point coercion", () => {
  assert.equal(detailDecimal("12345678901234.123456",true),"৳12,345,678,901,234.123456");
  assert.equal(detailDecimal("0.000001"),"0.000001");
  assert.equal(detailDecimal("1.000000"),"1");
  assert.equal(detailDecimal("1250.370000",true),"৳1,250.37");
  assert.equal(detailDecimal("2.100000",true),"৳2.10");
  for (const invalid of [12.34,null,"1e3","12.1234567","01.25"]) assert.throws(()=>detailDecimal(invalid,true));
});

test("complete journal display sums exact large amounts and never turns empty or malformed lines into a balanced journal", () => {
  const rows = [{debit:"9007199254740993.17",credit:"0.00"},{debit:"0.02",credit:"0.00"},{debit:"0.00",credit:"9007199254740993.19"}];
  const before = structuredClone(rows);
  assert.deepEqual(exactJournalTotals(rows),{debit:"9007199254740993.19",credit:"9007199254740993.19",balanced:true});
  assert.deepEqual(rows,before);
  assert.equal(exactJournalTotals([]).balanced,false);
  assert.equal(exactJournalTotals(rows.slice(0,2)).balanced,false);
  assert.throws(()=>exactJournalTotals([{debit:25.25,credit:"0.00"}]));
  assert.equal(detailRows(rows).length,3);
  for (const invalid of [[rows[0],null],[rows[0],"bad line"],{},[[]]]) assert.throws(()=>detailRows(invalid));
});

test("invoice actions follow actual source, write, generic command and settlement permission requirements", () => {
  assert.deepEqual(invoiceDetailActions(invoice,["sales.read"]),{downloadPdf:true,sendEmail:false,recordReceipt:false,issueCredit:false});
  assert.deepEqual(invoiceDetailActions(invoice,["documents.read","ledger.read"]),{downloadPdf:false,sendEmail:false,recordReceipt:false,issueCredit:false});
  assert.equal(invoiceDetailActions(invoice,["sales.read","sales.write"]).recordReceipt,false);
  const writer = ["sales.read","sales.write","documents.read","dues.read"];
  assert.deepEqual(invoiceDetailActions(invoice,writer),{downloadPdf:true,sendEmail:true,recordReceipt:true,issueCredit:true});
  assert.deepEqual(invoiceDetailActions({...invoice,state:"approved"},writer),{downloadPdf:false,sendEmail:false,recordReceipt:false,issueCredit:false});
  assert.deepEqual(invoiceDetailActions({...invoice,reversed_by_document_id:id},writer),{downloadPdf:true,sendEmail:false,recordReceipt:false,issueCredit:false});
  assert.equal(invoiceDetailActions({...invoice,document_type:"bill"},writer).recordReceipt,false);
});

test("document back links use an authorized existing module route and account IDs stay out of primary labels", () => {
  assert.equal(documentList(id,"receipt",["sales.read"]).href,`/o/${id}/sales/receipts`);
  assert.equal(documentList(id,"transfer",["banking.read"]).href,`/o/${id}/banking/transfers`);
  assert.equal(documentList(id,"manual_journal",["ledger.read"]).href,`/o/${id}/accounting/journals`);
  assert.equal(documentList(id,"invoice",["documents.read"]).href,`/o/${id}/accounting/documents`);
  assert.equal(accountLabel({account_id:id,account_code:"1100",account_name:"Accounts receivable"}),"1100 · Accounts receivable");
  assert.doesNotMatch(accountLabel({account_id:id}),new RegExp(id));
  assert.equal(detailDate("2026-10-08"),"08 Oct 2026");
});

test("authorized source read preserves enriched account and journal evidence while fetching only issued line snapshots", async () => {
  const source = { ...invoice, party_snapshot:{display_name:"Issued customer"}, lines:[{id,description:"Issued service",account_code:"4000",account_name:"Revenue",unit_price:"1250.370000",gross_amount:"1250.37"}],
    posted_journal:{id,lines:[{line_id:id,account_code:"1100",account_name:"Receivable",debit:"1250.37",credit:"0.00"}]} };
  const calls:string[]=[];
  const client = {rpc:async(name:string)=>{calls.push(name);if(name==="read_financial_document")return{data:structuredClone(source),error:null};
    assert.equal(name,"read_line_item_snapshots");return{data:[{line_id:id,snapshot:{name:"Issued item",sku:"SAVED"},cost_center_snapshot:null}],error:null};}} as Pick<RequestClient,"rpc">;
  const actor: ActorContext = {
    organizationId: parseOrganizationId(id),
    userId: parseUuid("deba95d9-6b20-4b9f-b01b-c3636595a826"),
    memberId: parseUuid("deba95d9-6b20-4b9f-b01b-c3636595a827"),
    capabilities: ["documents.read", "ledger.read"]
  };
  const result = await readFinancialDocument(client,actor,id);
  assert.deepEqual(calls,["read_financial_document","read_line_item_snapshots"]);
  assert.deepEqual(result.party_snapshot,source.party_snapshot);
  assert.deepEqual(result.posted_journal,source.posted_journal);
  assert.deepEqual((result.lines as Record<string,unknown>[])[0],{...source.lines[0],item_snapshot:{name:"Issued item",sku:"SAVED"},cost_center_snapshot:null});
});
