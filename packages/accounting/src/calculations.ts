import { ContractValidationError, parseMoneyString, parseUuid, type MoneyString } from "@ams/contracts";

const SCALE = 1_000_000n;
const PERCENT = 100n * SCALE;
const LIMIT = 10n ** 20n;
export const MAX_PREVIEW_LINES = 1000;
function fail(field: string, message: string): never {
  throw new ContractValidationError("Calculation validation failed.", { [field]: message });
}
function record(raw: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail(field, "Expected an object.");
  if (Object.keys(raw).some((key) => !keys.includes(key))) return fail(field, "Unexpected field; totals and authority are server-derived.");
  return raw as Record<string, unknown>;
}
/** Strict numeric(20,6) input. No Number conversion or silent scale truncation. */
export function decimal6(raw: unknown, field = "decimal"): bigint {
  if (typeof raw !== "string" || raw.length > 21 || !/^(0|[1-9]\d{0,13})(?:\.\d{1,6})?$/.test(raw)) {
    return fail(field, "Expected a nonnegative decimal string with at most 14 integer and 6 fractional digits.");
  }
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole!) * SCALE + BigInt(fraction.padEnd(6, "0"));
}
export function moneyUnits(raw: unknown, field = "amount"): bigint {
  const value = parseMoneyString(raw, field);
  if (value === "-0.00") return fail(field, "Negative zero is not canonical.");
  return BigInt(value.replace(".", ""));
}
/** Ties away from zero, including signed corrections. Denominator is positive. */
export function roundRatio(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError("Denominator must be positive.");
  const magnitude = numerator < 0n ? -numerator : numerator;
  const rounded = (magnitude + denominator / 2n) / denominator;
  return numerator < 0n ? -rounded : rounded;
}
export function formatMoney(units: bigint, field = "amount"): MoneyString {
  const magnitude = units < 0n ? -units : units;
  if (magnitude >= LIMIT) return fail(field, "Amount exceeds numeric(20,2).");
  return `${units < 0n ? "-" : ""}${magnitude / 100n}.${(magnitude % 100n).toString().padStart(2, "0")}` as MoneyString;
}
export interface CalculatedLine {
  base: MoneyString; discount: MoneyString; net: MoneyString; tax: MoneyString; gross: MoneyString;
}
export interface DocumentPreview {
  currency: "BDT"; lines: CalculatedLine[]; base: MoneyString; discount: MoneyString;
  net: MoneyString; tax: MoneyString; gross: MoneyString; rounding_adjustment: MoneyString; total: MoneyString;
}
export function calculateLine(raw: unknown): CalculatedLine {
  const line = record(raw, ["quantity", "unit_price", "discount_amount", "discount_percent", "tax_rate", "tax_mode"], "line");
  const quantity = decimal6(line.quantity, "quantity");
  if (quantity <= 0n) return fail("quantity", "Quantity must be positive.");
  const price = decimal6(line.unit_price, "unit_price");
  const rate = decimal6(line.tax_rate, "tax_rate");
  if (rate > PERCENT) return fail("tax_rate", "Rate must be between 0 and 100.");
  if (line.tax_mode !== "inclusive" && line.tax_mode !== "exclusive") return fail("tax_mode", "Choose inclusive or exclusive.");
  if ("discount_amount" in line && "discount_percent" in line) return fail("discount", "Use one line discount type only.");
  const base = roundRatio(quantity * price * 100n, SCALE * SCALE);
  formatMoney(base, "base");
  let discount = 0n;
  if ("discount_amount" in line) discount = moneyUnits(line.discount_amount, "discount_amount");
  if ("discount_percent" in line) {
    const percent = decimal6(line.discount_percent, "discount_percent");
    if (percent > PERCENT) return fail("discount_percent", "Discount percentage must be between 0 and 100.");
    discount = roundRatio(base * percent, PERCENT);
  }
  if (discount < 0n || discount > base) return fail("discount", "Discount must be between zero and the rounded base.");
  const x = base - discount;
  const net = line.tax_mode === "inclusive" ? roundRatio(x * PERCENT, PERCENT + rate) : x;
  const tax = line.tax_mode === "inclusive" ? x - net : roundRatio(net * rate, PERCENT);
  return { base: formatMoney(base), discount: formatMoney(discount), net: formatMoney(net), tax: formatMoney(tax), gross: formatMoney(net + tax) };
}
/** Pure preview, NOT a posting authorization or an approved statutory tax rate. */
export function calculateDocument(raw: unknown): DocumentPreview {
  const input = record(raw, ["currency", "lines", "rounding"], "document");
  if (input.currency !== "BDT") return fail("currency", "V1 supports BDT only.");
  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > MAX_PREVIEW_LINES) {
    return fail("lines", `Supply 1-${MAX_PREVIEW_LINES} lines.`);
  }
  const lines = input.lines.map(calculateLine);
  let adjustment = 0n;
  if ("rounding" in input) {
    const r = record(input.rounding, ["amount", "reason", "account_id"], "rounding");
    adjustment = moneyUnits(r.amount, "rounding.amount");
    if (adjustment < -5n || adjustment > 5n) return fail("rounding.amount", "Explicit rounding is limited to 0.05 BDT either way.");
    if (typeof r.reason !== "string" || !r.reason.trim() || r.reason.length > 500) return fail("rounding.reason", "Provide a reason of 1-500 characters.");
    parseUuid(r.account_id, "rounding.account_id");
  }
  const sum = (key: keyof CalculatedLine) => lines.reduce((total, line) => total + moneyUnits(line[key]), 0n);
  const gross = sum("gross");
  if (gross + adjustment < 0n) return fail("total", "Document total cannot be negative.");
  return { currency: "BDT", lines, base: formatMoney(sum("base")), discount: formatMoney(sum("discount")),
    net: formatMoney(sum("net")), tax: formatMoney(sum("tax")), gross: formatMoney(gross),
    rounding_adjustment: formatMoney(adjustment), total: formatMoney(gross + adjustment) };
}
