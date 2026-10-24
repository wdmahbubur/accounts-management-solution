import { parseUuid, type MoneyString } from "@ams/contracts";
import { reportMoney as money } from "../report-money.ts";

export type TrialBalanceRow = {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  opening_balance: MoneyString;
  movement_debit: MoneyString;
  movement_credit: MoneyString;
  closing_debit: MoneyString;
  closing_credit: MoneyString;
};

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid trial balance text.");
  return value;
}

export function parseTrialBalanceRows(value: unknown): TrialBalanceRow[] {
  if (!Array.isArray(value)) throw new Error("Invalid trial balance response.");
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid trial balance row.");
    const row = item as Record<string, unknown>;
    return {
      account_id: parseUuid(row.account_id),
      account_code: text(row.account_code),
      account_name: text(row.account_name),
      account_type: text(row.account_type),
      opening_balance: money(row.opening_balance, "opening_balance"),
      movement_debit: money(row.movement_debit, "movement_debit"),
      movement_credit: money(row.movement_credit, "movement_credit"),
      closing_debit: money(row.closing_debit, "closing_debit"),
      closing_credit: money(row.closing_credit, "closing_credit")
    };
  });
}
