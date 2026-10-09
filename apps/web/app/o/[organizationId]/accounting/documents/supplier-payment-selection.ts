import { formatMoney, moneyUnits } from "@ams/accounting";
import { parseMoneyString, parseUuid } from "@ams/contracts";
import type { SupplierBillTarget } from "../../../../../server/documents/supplier-payments.ts";
import { canonicalAmountInput, type DraftFieldIssue } from "./draft-calculations.ts";

export interface SettlementPlanLine { target_open_item_id: string; amount: string }
export interface SupplierAllocationDisplay {
  payment: string | null;
  applied: string | null;
  remaining: string | null;
  issues: DraftFieldIssue[];
}

export function hasPositiveSettlement(plan: readonly SettlementPlanLine[]): boolean {
  return plan.some(row => {
    try { parseUuid(row.target_open_item_id); return moneyUnits(canonicalAmountInput(row.amount)) > 0n; }
    catch { return false; }
  });
}

/** Treat failed/malformed lookup responses as unavailable, never as an empty valid list. */
export function parseSupplierBillTargets(value: unknown): SupplierBillTarget[] {
  if (!Array.isArray(value) || value.length > 1000) throw new Error("Eligible bills could not be loaded.");
  const ids = new Set<string>();
  return value.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Eligible bills could not be loaded.");
    const row = raw as Record<string, unknown>;
    const openItemId = parseUuid(row.openItemId);
    if (ids.has(openItemId)) throw new Error("The bill list contains duplicate settlement targets.");
    ids.add(openItemId);
    const date = (input: unknown): string => {
      if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input)) throw new Error("A bill date is unavailable.");
      return input;
    };
    if ((row.documentNumber !== null && typeof row.documentNumber !== "string") ||
      (row.supplierReference !== null && typeof row.supplierReference !== "string")) throw new Error("A bill reference is unavailable.");
    const totalAmount = parseMoneyString(row.totalAmount);
    const residualAmount = parseMoneyString(row.residualAmount);
    const availableAmount = parseMoneyString(row.availableAmount);
    if (moneyUnits(totalAmount) <= 0n || moneyUnits(availableAmount) <= 0n || moneyUnits(availableAmount) > moneyUnits(residualAmount) || moneyUnits(residualAmount) > moneyUnits(totalAmount)) {
      throw new Error("A bill's available amount is invalid.");
    }
    return { openItemId, documentId: parseUuid(row.documentId), documentNumber: row.documentNumber,
      supplierReference: row.supplierReference, issueDate: date(row.issueDate), dueDate: row.dueDate === null ? null : date(row.dueDate),
      totalAmount, residualAmount, availableAmount };
  });
}

/** Display and input guidance only; posting rechecks balances and historical capacity. */
export function supplierAllocationDisplay(amount: string, plan: readonly SettlementPlanLine[], targets: readonly SupplierBillTarget[]): SupplierAllocationDisplay {
  const issues: DraftFieldIssue[] = [];
  let payment: string | null = null, applied = 0n, complete = true;
  try {
    payment = canonicalAmountInput(amount);
    if (moneyUnits(payment) <= 0n) issues.push({ field: "amount", message: "Enter the payment amount, greater than zero." });
  } catch { issues.push({ field: "amount", message: "Enter a payment amount with up to two decimal places." }); }
  const available = new Map<string, string>(targets.map(target => [target.openItemId, target.availableAmount]));
  const seen = new Set<string>();
  plan.forEach((row, index) => {
    const prefix = `allocation_plan.${index + 1}`;
    if (seen.has(row.target_open_item_id)) issues.push({ field: `${prefix}.target_open_item_id`, message: "Select each supplier bill only once." });
    seen.add(row.target_open_item_id);
    const cap = available.get(row.target_open_item_id);
    if (cap === undefined) issues.push({ field: `${prefix}.target_open_item_id`, message: "This selected bill is not available for this supplier and date. Refresh the list or remove this selection." });
    try {
      const units = moneyUnits(canonicalAmountInput(row.amount));
      applied += units;
      if (units <= 0n) issues.push({ field: `${prefix}.amount`, message: "Enter an amount greater than zero, or remove this bill." });
      else if (cap !== undefined && units > moneyUnits(cap)) issues.push({ field: `${prefix}.amount`, message: `This bill has ${cap} BDT available to apply. Reduce the amount or refresh the bill list.` });
    } catch { complete = false; issues.push({ field: `${prefix}.amount`, message: "Enter an amount with up to two decimal places." }); }
  });
  if (payment && complete && applied > moneyUnits(payment)) issues.push({ field: "allocation_plan", message: "The amount applied to bills exceeds this payment. Reduce the bill amounts or increase the payment." });
  let formattedApplied: string | null = null, remaining: string | null = null;
  if (complete) {
    try { formattedApplied = formatMoney(applied); remaining = payment ? formatMoney(moneyUnits(payment) - applied) : null; }
    catch { issues.push({ field: "allocation_plan", message: "The combined bill amounts exceed the supported payment range. Reduce the amounts." }); }
  }
  return { payment, applied: formattedApplied, remaining, issues };
}

/** Selecting a bill proposes only the currently unallocated payment, capped by safe capacity. */
export function suggestedBillAmount(amount: string, plan: readonly SettlementPlanLine[], target: SupplierBillTarget): string {
  try {
    const remainder = moneyUnits(canonicalAmountInput(amount)) - plan.reduce((sum, row) => sum + moneyUnits(canonicalAmountInput(row.amount)), 0n);
    const available = moneyUnits(target.availableAmount);
    return formatMoney(remainder <= 0n ? 0n : remainder < available ? remainder : available);
  } catch { return "0.00"; }
}
