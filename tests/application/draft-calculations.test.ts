import assert from "node:assert/strict";
import test from "node:test";
import { calculateTradeDraft, canonicalAmountInput, type SavedLineTax, type TradeLineInput } from "../../apps/web/app/o/[organizationId]/accounting/documents/draft-calculations.ts";

const taxCodes = [{ id: "example-tax", rate_percent: "10.000000" }];
const rounding = { amount: "0.00", reason: "", accountId: "" };
const line = (values: Partial<TradeLineInput> = {}): TradeLineInput => ({
  id: null, original_line_id: null, quantity: "1", unit_price: "100", discount_amount: "0.00",
  tax_code_id: "example-tax", tax_mode: "exclusive", ...values
});

test("draft display applies line discounts before mixed tax modes and sums rounded lines", () => {
  const input = {
    lines: [line({ unit_price: "11000", discount_amount: "1100", tax_mode: "inclusive" }),
      line({ quantity: "2", unit_price: "125.555", discount_amount: "1.11" }),
      line({ unit_price: "0", tax_code_id: null })],
    taxCodes,
    rounding: { amount: "-0.05", reason: "Supplier rounding difference", accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
  };
  const unchanged = structuredClone(input);
  const result = calculateTradeDraft(input);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.lines.map(row => row.amounts?.gross), ["9900.00", "275.00", "0.00"]);
  assert.equal(result.totals?.base, "11251.11");
  assert.equal(result.totals?.discount, "1101.11");
  assert.equal(result.totals?.net, "9250.00");
  assert.equal(result.totals?.tax, "925.00");
  assert.equal(result.totals?.total, "10174.95");
  assert.deepEqual(input, unchanged, "display calculations must not overwrite entered values");
});

test("live draft totals retain six-place precision and amounts above the JS safe integer", () => {
  const large = calculateTradeDraft({ lines: [line({ quantity: "10000", unit_price: "99999999999999.999999", tax_code_id: null })], taxCodes, rounding });
  assert.equal(large.totals?.total, "999999999999999999.99");
  const fractional = calculateTradeDraft({ lines: [line({ quantity: "0.125", unit_price: "10.04", tax_code_id: null })], taxCodes, rounding });
  assert.equal(fractional.lines[0]?.amounts?.base, "1.26");
  assert.equal(fractional.totals?.total, "1.26");
});

test("invalid or incomplete line input never produces a partial document total", () => {
  for (const [value, field] of [["", "quantity"], ["0", "quantity"], ["1e2", "unit_price"], ["1.0000001", "unit_price"], ["100.01", "discount_amount"]] as const) {
    const result = calculateTradeDraft({ lines: [line(), line({ [field]: value })], taxCodes, rounding });
    assert.equal(result.lines[0]?.amounts?.gross, "110.00");
    assert.equal(result.lines[1]?.amounts, null);
    assert.equal(result.totals, null);
    assert.equal(result.issues[0]?.field, `lines.2.${field}`);
  }
});

test("an unavailable tax code withholds totals instead of silently using zero tax", () => {
  const result = calculateTradeDraft({ lines: [line({ tax_code_id: "unavailable-version" })], taxCodes, rounding });
  assert.equal(result.lines[0]?.amounts, null);
  assert.match(result.lines[0]?.notice ?? "", /tax rate is unavailable/);
  assert.equal(result.totals, null);
});

const saved: SavedLineTax = { id: "saved-line", original_line_id: null, tax_code_id: "historic-tax", tax_rate_snapshot: "15.000000", tax_mode: "exclusive" };

test("editing a saved line preserves its tax snapshot until the selected tax code changes", () => {
  const options = [...taxCodes, { id: "historic-tax", rate_percent: "20" }];
  const unchangedTax = calculateTradeDraft({ lines: [line({ id: saved.id, tax_code_id: saved.tax_code_id, quantity: "2" })], taxCodes: options, savedLines: [saved], rounding });
  assert.equal(unchangedTax.totals?.tax, "30.00");
  assert.equal(unchangedTax.totals?.total, "230.00");
  const changedTax = calculateTradeDraft({ lines: [line({ id: saved.id })], taxCodes: options, savedLines: [saved], rounding });
  assert.equal(changedTax.totals?.tax, "10.00");
  const archived = calculateTradeDraft({ lines: [line({ id: saved.id, tax_code_id: saved.tax_code_id })], taxCodes: [], savedLines: [saved], rounding });
  assert.equal(archived.totals?.tax, "15.00", "an archived saved snapshot is still usable");
});

test("credit display uses the original saved tax mode and refuses a guess when its source line changes", () => {
  const original: SavedLineTax = { ...saved, original_line_id: "original-line", tax_mode: "inclusive" };
  const credit = line({ id: saved.id, original_line_id: original.original_line_id, unit_price: "115.00", tax_code_id: "example-tax", tax_mode: "exclusive" });
  const result = calculateTradeDraft({ lines: [credit], taxCodes, savedLines: [original], credit: true, rounding });
  assert.equal(result.totals?.net, "100.00");
  assert.equal(result.totals?.tax, "15.00");
  assert.equal(result.totals?.total, "115.00");
  const changed = calculateTradeDraft({ lines: [{ ...credit, original_line_id: "another-line" }], taxCodes, savedLines: [original], credit: true, rounding });
  assert.equal(changed.totals, null);
  assert.match(changed.lines[0]?.notice ?? "", /Save this credit/);
});

test("rounding needs the permitted amount, reason and account before showing a complete total", () => {
  const missingDetails = calculateTradeDraft({ lines: [line()], taxCodes, rounding: { ...rounding, amount: "0.01" } });
  assert.deepEqual(missingDetails.issues.map(issue => issue.field), ["rounding_reason", "rounding_account_id"]);
  assert.equal(missingDetails.totals, null);
  const overLimit = calculateTradeDraft({ lines: [line()], taxCodes, rounding: { amount: "0.06", reason: "Difference", accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } });
  assert.equal(overLimit.issues[0]?.field, "rounding_adjustment");
  assert.equal(overLimit.totals, null);
});

test("typed money is normalized without rounding or float conversion", () => {
  for (const [raw, expected] of [["1250", "1250.00"], ["1250.5", "1250.50"], ["9007199254740993.17", "9007199254740993.17"], [" 0.00 ", "0.00"]]) {
    assert.equal(canonicalAmountInput(raw!), expected);
  }
  assert.equal(canonicalAmountInput("-0", true), "0.00");
  assert.equal(canonicalAmountInput("-0.05", true), "-0.05");
  for (const raw of ["", "1.001", "1e2", "NaN", "Infinity", "1,000.00", "01", "-1.00", "1000000000000000000.00"]) {
    assert.throws(() => canonicalAmountInput(raw), { name: "ContractValidationError" }, raw);
  }
});
