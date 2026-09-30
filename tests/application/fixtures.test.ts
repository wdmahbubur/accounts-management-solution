import assert from "node:assert/strict";
import test from "node:test";

import {
  dualMembershipFixture,
  fixtureDates,
  goldenScenario
} from "../../packages/test-fixtures/src/index.ts";

function cents(value: string): bigint {
  assert.match(value, /^-?\d+\.\d{2}$/);
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction] = unsigned.split(".");
  const result = BigInt(whole) * 100n + BigInt(fraction);
  return negative ? -result : result;
}

test("US-005 fixtures use fixed identities, dates and dual-company memberships", () => {
  assert.equal(fixtureDates.scenarioDate, "2026-09-30");
  assert.equal(dualMembershipFixture.memberships.length, 2);
  assert.notEqual(
    dualMembershipFixture.memberships[0].organizationId,
    dualMembershipFixture.memberships[1].organizationId
  );
  assert.deepEqual(dualMembershipFixture.memberships[0].capabilities, ["accounting.read"]);
  assert.deepEqual(dualMembershipFixture.memberships[1].capabilities, ["billing.read"]);
});

test("T-47 fixture expectations reconcile exactly without JavaScript float authority", () => {
  const balances = new Map<string, bigint>();
  let totalDebit = 0n;
  let totalCredit = 0n;

  for (const journal of goldenScenario.journals) {
    let debit = 0n;
    let credit = 0n;

    for (const line of journal.lines) {
      const lineDebit = cents(line.debit);
      const lineCredit = cents(line.credit);
      debit += lineDebit;
      credit += lineCredit;
      totalDebit += lineDebit;
      totalCredit += lineCredit;
      balances.set(
        line.account,
        (balances.get(line.account) ?? 0n) + lineDebit - lineCredit
      );
    }

    assert.equal(debit, credit, `${journal.event} fixture must balance`);
  }

  assert.equal(totalDebit, totalCredit);
  assert.equal(balances.get("bank"), cents(goldenScenario.expected.bank));
  assert.equal(balances.get("ar"), cents(goldenScenario.expected.ar));
  assert.equal(-(balances.get("ap") ?? 0n), cents(goldenScenario.expected.ap));
  assert.equal(
    -(balances.get("revenue") ?? 0n),
    cents(goldenScenario.expected.revenue)
  );
  assert.equal(balances.get("expense"), cents(goldenScenario.expected.expense));
  assert.equal(
    -(balances.get("capital") ?? 0n),
    cents(goldenScenario.expected.capital)
  );

  const profit =
    cents(goldenScenario.expected.revenue) - cents(goldenScenario.expected.expense);
  assert.equal(profit, cents(goldenScenario.expected.profit));
  assert.equal(
    cents(goldenScenario.expected.bank) + cents(goldenScenario.expected.ar),
    cents(goldenScenario.expected.assets)
  );
  assert.equal(
    cents(goldenScenario.expected.liabilities) +
      cents(goldenScenario.expected.capital) +
      cents(goldenScenario.expected.untransferredProfit),
    cents(goldenScenario.expected.assets)
  );
});
