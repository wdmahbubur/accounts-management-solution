import { parseMoneyString, type MoneyString } from "@ams/contracts";

// PostgreSQL numeric aggregates and expressions can return "0" or "3.5" as
// text. Supply the canonical money contract without changing value or precision.
export function reportMoney(value: unknown, field = "amount"): MoneyString {
  if (typeof value !== "string" || !/^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/.test(value)) {
    throw new Error(`Invalid report money value: ${field}.`);
  }
  const [whole, fraction = ""] = value.split(".");
  return parseMoneyString(`${whole}.${fraction.padEnd(2, "0")}`, field);
}
