import assert from "node:assert/strict";
import test from "node:test";
import { mapStatementRows, readStatementMatrix } from "../../apps/web/server/banking/statement-import.ts";

const mapping={date:0,description:1,debit:2,credit:3};
const headers=["Date","Description","Debit","Credit"];

test("ordinary debit/credit CSV imports the populated side and preserves the blank original cell",async()=>{
  const csv="Date,Description,Debit,Credit\r\n2026-10-09,Customer receipt,,100.25\r\n2026-10-09,Bank payment,12.30,\r\n";
  const parsed=await readStatementMatrix(new File([csv],"statement.csv",{type:"text/csv"}));
  const result=mapStatementRows(parsed.matrix,mapping);
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.rows.map(row=>row.amount),["100.25","-12.30"]);
  assert.equal(result.rows[0]?.raw_row.Debit,"");assert.equal(result.rows[1]?.raw_row.Credit,"");assert.equal(parsed.bytes.toString("utf8"),csv);
});

test("blank, null and explicit zero opposite cells are equivalent without binary money arithmetic",()=>{
  const result=mapStatementRows([headers,["2026-10-09","Receipt"," ","999999999999.99"],["2026-10-09","Payment","15.09",null],["2026-10-09","Receipt","0.00","25"]],mapping);
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.rows.map(row=>row.amount),["999999999999.99","-15.09","25.00"]);
});

test("neither side, both positive sides, negative unsigned sides and excess precision stay invalid",()=>{
  const result=mapStatementRows([headers,["2026-10-09","No amount","",""],["2026-10-09","Both zero","0","0.00"],["2026-10-09","Both filled","10","20"],["2026-10-09","Wrong sign","-10",""],["2026-10-09","Too precise","","1.001"]],mapping);
  assert.equal(result.rows.length,0);assert.equal(result.errors.length,5);
});

test("canonical amount text avoids zero imports and inconsistent fingerprints while raw cells remain intact",()=>{
  const result=mapStatementRows([headers,["2026-10-09","Same receipt","","0001.20"],["2026-10-09","Same receipt","0","1.2"],["2026-10-09","Zero","","000.00"]],mapping);
  assert.equal(result.errors.length,1);assert.deepEqual(result.rows.map(row=>row.amount),["1.20","1.20"]);assert.equal(result.repeatedFingerprints,1);
  assert.equal(result.rows[0]?.raw_row.Credit,"0001.20");
});

test("signed amount mapping still requires a nonzero exact value and preserves movement direction",()=>{
  const result=mapStatementRows([["Date","Description","Amount"],["2026-10-09","Missing",""],["2026-10-09","Zero","-000.00"],["2026-10-09","Debit","-0003.40"],["2026-10-09","Credit","12.50"]],{date:0,description:1,amount:2});
  assert.equal(result.errors.length,2);assert.deepEqual(result.rows.map(row=>row.amount),["-3.40","12.50"]);
});
