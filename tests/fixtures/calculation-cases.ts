// Rates are mathematical examples only, not statutory Bangladesh defaults.
export const line = (extra: Record<string, unknown> = {}) => ({ quantity: "1", unit_price: "10000", tax_rate: "10", tax_mode: "exclusive", ...extra });
export const document = (lines: unknown[] = [line()], extra: Record<string, unknown> = {}) => ({ currency: "BDT", lines, ...extra });
export const goldenCases = [
  { name: "T-17 exclusive", input: document(), amounts: ["10000.00", "1000.00", "11000.00"] },
  { name: "T-17 inclusive", input: document([line({ unit_price: "11000", tax_mode: "inclusive" })]), amounts: ["10000.00", "1000.00", "11000.00"] },
  { name: "T-18 fractional half-up", input: document([line({ quantity: "0.125", unit_price: "10.04", tax_rate: "0" })]), amounts: ["1.26", "0.00", "1.26"] },
  { name: "line sums not header rerounding", input: document(Array.from({ length: 3 }, () => line({ unit_price: "0.05" }))), amounts: ["0.15", "0.03", "0.18"] },
  { name: "percent discount follows rounded base", input: document([line({ unit_price: "0.05", discount_percent: "10", tax_rate: "0" })]), amounts: ["0.04", "0.00", "0.04"] },
  { name: "amount discount before inclusive tax", input: document([line({ unit_price: "110.00", discount_amount: "11.00", tax_mode: "inclusive" })]), amounts: ["90.00", "9.00", "99.00"] },
  { name: "free line preview (not permission to post zero journal)", input: document([line({ unit_price: "0" })]), amounts: ["0.00", "0.00", "0.00"] },
  { name: "six-digit precision", input: document([line({ quantity: "0.000001", unit_price: "999999.999999", tax_rate: "0" })]), amounts: ["1.00", "0.00", "1.00"] },
  { name: "beyond JS safe integer", input: document([line({ quantity: "10000", unit_price: "99999999999999.999999", tax_rate: "0" })]), amounts: ["999999999999999999.99", "0.00", "999999999999999999.99"] },
  { name: "signed explicit adjustment", input: document([line({ unit_price: "1", tax_rate: "0" })], { rounding: { amount: "-0.05", reason: "Supplier rounding evidence", account_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } }), amounts: ["1.00", "0.00", "0.95"] }
];
export const invalidCases: unknown[] = [null, [], {}, document([], {}), document([line()], { currency: "USD" }),
  document([line()], { total: "1.00" }), document([line()], { discount_amount: "0.00" }),
  ...["0", "-1", "NaN", "Infinity", "1e2", "01", " 1", "1.", ".1", "0.0000001", "100000000000000", 1, null].map((quantity) => document([line({ quantity })])),
  ...["-1", "NaN", "Infinity", "1.0000001", 1].map((unit_price) => document([line({ unit_price })])),
  ...["-1", "100.000001", "NaN", 10, null].map((tax_rate) => document([line({ tax_rate })])),
  document([line({ tax_mode: "unknown" })]), document([line({ discount_amount: "1" })]),
  document([line({ discount_amount: "-0.00" })]), document([line({ discount_amount: "-1.00" })]),
  document([line({ discount_amount: "10000.01" })]), document([line({ discount_percent: "100.000001" })]),
  document([line({ discount_amount: "1.00", discount_percent: "1" })]),
  document([line({ quantity: "10001", unit_price: "99999999999999.999999" })]),
  document([line({ quantity: "10000", unit_price: "99999999999999.999999" }), line()]),
  document([line()], { rounding: { amount: "0.06", reason: "Too large", account_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } }),
  document([line()], { rounding: { amount: "0.01" } }),
  document([line()], { rounding: null }), document(Array.from({ length: 1001 }, () => line()))
];
// Deterministic bounded cases broaden parity beyond hand-picked goldens.
export const parityCases = Array.from({ length: 120 }, (_, i) => document([line({
  quantity: `${i+1}.${String((i*7919)%1000000).padStart(6,"0")}`,
  unit_price: `${i*333+1}.${String((i*8123)%1000000).padStart(6,"0")}`,
  tax_rate: `${i%100}.${String((i*1237)%1000000).padStart(6,"0")}`,
  discount_percent: `${i%37}.123456`, tax_mode: i%2 ? "inclusive" : "exclusive"
})]));
