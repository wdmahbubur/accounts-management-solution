import assert from "node:assert/strict";
import test from "node:test";
import { formatMoney, moneyUnits } from "@ams/accounting";
import { parseTrialBalanceRows } from "../../apps/web/app/o/[organizationId]/reports/trial-balance/report-rows.ts";

const asset = {
  account_id: "d937174a-7022-4b26-a1e0-7a6ebac1f485", account_code: "1100", account_name: "Trade receivables", account_type: "asset",
  opening_balance: "75.25", movement_debit: "0.00", movement_credit: "0.00", closing_debit: "75.25", closing_credit: "0"
};
const income = {
  ...asset, account_id: "6a31db48-ecf5-455b-a043-33d1036a71ee", account_code: "4000", account_name: "Service revenue", account_type: "income",
  opening_balance: "-75.25", closing_debit: "0", closing_credit: "75.25"
};

test("SQL-shaped zero closing values render and sum through the canonical money boundary", () => {
  const input = [asset, income];
  const before = JSON.stringify(input);
  const rows = parseTrialBalanceRows(input);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.closing_credit, "0.00");
  assert.equal(rows[1]!.closing_debit, "0.00");
  assert.equal(rows[1]!.opening_balance, "-75.25");
  const debit = rows.reduce((total, row) => total + moneyUnits(row.closing_debit), 0n);
  const credit = rows.reduce((total, row) => total + moneyUnits(row.closing_credit), 0n);
  assert.equal(formatMoney(debit), "75.25");
  assert.equal(formatMoney(credit), "75.25");
  assert.equal(debit - credit, 0n);
  assert.equal(JSON.stringify(input), before);
});

test("all five money columns preserve large exact values and pad only absent decimal places", () => {
  const [row] = parseTrialBalanceRows([{ ...asset, opening_balance: "-9007199254740993.17", movement_debit: "17", movement_credit: "3.5", closing_debit: "999999999999999999.99", closing_credit: "0" }]);
  assert.equal(row!.opening_balance, "-9007199254740993.17");
  assert.equal(row!.movement_debit, "17.00");
  assert.equal(row!.movement_credit, "3.50");
  assert.equal(row!.closing_debit, "999999999999999999.99");
  assert.equal(moneyUnits(row!.closing_debit), 99999999999999999999n);
  assert.equal(row!.closing_credit, "0.00");
});

test("an actual imbalance is retained and empty authoritative rows remain empty", () => {
  const rows = parseTrialBalanceRows([asset, { ...income, closing_credit: "75.24" }]);
  const difference = rows.reduce((total, row) => total + moneyUnits(row.closing_debit) - moneyUnits(row.closing_credit), 0n);
  assert.equal(formatMoney(difference), "0.01");
  assert.deepEqual(parseTrialBalanceRows([]), []);
});

test("malformed or nonstring monetary data is rejected in every money column", () => {
  for (const field of ["opening_balance", "movement_debit", "movement_credit", "closing_debit", "closing_credit"]) {
    for (const value of [0, 75.25, null, undefined, "", " ", "1e3", "1,000.00", "0.001", "01.00", "+1.00", "1.", "1000000000000000000.00", {}, []]) {
      assert.throws(() => parseTrialBalanceRows([{ ...asset, [field]: value }]), `${field}: ${String(value)}`);
    }
  }
});

test("invalid report collections, rows, identities and label shapes fail closed", () => {
  for (const value of [null, {}, "", [null], [[]], ["row"], [{ ...asset, account_id: "not-a-uuid" }], [{ ...asset, account_name: {} }], [{ ...asset, account_code: 1100 }], [{ ...asset, account_type: null }]]) {
    assert.throws(() => parseTrialBalanceRows(value));
  }
});
