export type BalanceSheetDateQuery = {
  as_of?: string | string[];
  comparison_as_of?: string | string[];
};

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function parseBalanceSheetDates(query: BalanceSheetDateQuery, today: string): { asOf: string; comparisonAsOf: string | null } | null {
  const asOf = query.as_of ?? today;
  // A blank optional date input is submitted as an empty query value by the GET form.
  const comparisonAsOf = query.comparison_as_of === undefined || query.comparison_as_of === "" ? null : query.comparison_as_of;
  if (!validDate(asOf) || (comparisonAsOf !== null && (!validDate(comparisonAsOf) || comparisonAsOf === asOf))) return null;
  return { asOf, comparisonAsOf };
}
