import assert from "node:assert/strict";
import test from "node:test";
import { calculateDocument, calculateLine, moneyUnits, roundRatio, formatMoney, decimal6 } from "@ams/accounting";
import { goldenCases, invalidCases, parityCases, line } from "../fixtures/calculation-cases.ts";
for (const item of goldenCases) test(`US-013 ${item.name}`, () => {
  const result = calculateDocument(item.input);
  assert.deepEqual([result.net,result.tax,result.total],item.amounts);
  assert.equal(JSON.stringify(result).includes("e+"),false);
});
for (const [i,input] of invalidCases.entries()) test(`US-013 rejects invalid boundary ${i}`,()=>assert.throws(()=>calculateDocument(input)));
test("ties round away from zero and stored reversals remain exact",()=>{
  assert.equal(roundRatio(125n,10n),13n);assert.equal(roundRatio(-125n,10n),-13n);
  assert.equal(roundRatio(124n,10n),12n);assert.equal(roundRatio(-124n,10n),-12n);
  assert.throws(()=>roundRatio(1n,0n)); assert.equal(formatMoney(-moneyUnits("9007199254740993.17")),"-9007199254740993.17");
  assert.equal(formatMoney(0n),"0.00"); assert.throws(()=>formatMoney(10n**20n));
  assert.equal(decimal6("0.000001"),1n);
});
test("all deterministic previews conserve rounded line totals and do not mutate input",()=>{
  for(const input of parityCases){const before=JSON.stringify(input);const out=calculateDocument(input);
    assert.equal(moneyUnits(out.net)+moneyUnits(out.tax),moneyUnits(out.gross));
    assert.equal(moneyUnits(out.gross)+moneyUnits(out.rounding_adjustment),moneyUnits(out.total));
    assert.equal(JSON.stringify(input),before);
    for(const l of out.lines) assert.equal(moneyUnits(l.net)+moneyUnits(l.tax),moneyUnits(l.gross));
  }
});
test("full discount is valid; unit price zero is allowed but quantity zero is not",()=>{
  assert.equal(calculateLine(line({discount_percent:"100"})).gross,"0.00");
  assert.equal(calculateLine(line({unit_price:"0"})).gross,"0.00");
  assert.throws(()=>calculateLine(line({quantity:"0"})));
});
