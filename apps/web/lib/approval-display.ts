/** Approval snapshots contain integer JSON values, not money/text fields. */
export function approvalCount(value: unknown, minimum = 0): string {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
    ? String(value)
    : "—";
}
