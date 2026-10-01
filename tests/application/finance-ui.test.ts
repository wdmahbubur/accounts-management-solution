import assert from "node:assert/strict";
import test from "node:test";
import { displayMoney, feedback, moneyInputError, pickerData } from "../../apps/web/components/finance/contracts.ts";

test("presentation preserves every cent above Number's safe integer and formats BDT without coercion", () => {
  assert.equal(displayMoney("9007199254740993.17"), "৳9,007,199,254,740,993.17");
  assert.equal(displayMoney("-1234567.89"), "৳-1,234,567.89");
  assert.equal(displayMoney("0.00"), "৳0.00");
  for (const raw of [null, undefined, 0, "NaN", "Infinity", "1e3", "1.000", "01.00"]) assert.throws(() => displayMoney(raw));
});
test("MoneyInput never turns an empty/invalid value into zero or rounds excess precision", () => {
  for (const raw of ["", "1", "1.001", " 1.00", "-0.00", "-1.00", "1e2", "1000000000000000000.00"]) assert.ok(moneyInputError(raw));
  assert.equal(moneyInputError("0.00"), undefined);
  assert.equal(moneyInputError("9007199254740993.17"), undefined);
  assert.equal(moneyInputError("-1.00", true), undefined);
});
test("server picker projection strips foreign, forbidden, nonselectable and sensitive fields before serialization", () => {
  const rows = [
    { id: "a", organizationId: "A", label: "ব্যাংক", selectable: true, secret: "must not escape" },
    { id: "b", organizationId: "B", label: "Other company's bank" },
    { id: "c", organizationId: "A", label: "Inactive account", selectable: false }
  ];
  assert.deepEqual(pickerData("A", true, rows), { organizationId: "A", options: [{ id: "a", label: "ব্যাংক" }] });
  assert.deepEqual(pickerData("A", false, rows), { organizationId: "A", options: [] });
  assert.equal(rows.length, 3);
});
test("shared feedback distinguishes absence, failed reads, conflicts and offline financial writes", () => {
  assert.notEqual(feedback.empty.title, feedback.loading.title);
  assert.notEqual(feedback.error.title, feedback.empty.title);
  for (const kind of ["loading", "error", "forbidden"] as const) assert.doesNotMatch(feedback[kind].description, /৳0|0\.00/);
  assert.match(feedback.offline.description, /never queued offline/);
  assert.match(feedback.error.description, /new key/);
});
