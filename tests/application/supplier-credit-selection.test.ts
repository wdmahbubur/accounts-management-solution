import assert from "node:assert/strict";
import test from "node:test";
import { parseOrganizationId, parseUuid } from "@ams/contracts";
import type { CreditNoteOptions, CreditSourceLine } from "../../apps/web/server/documents/credit-notes.ts";
import { calculateTradeDraft } from "../../apps/web/app/o/[organizationId]/accounting/documents/draft-calculations.ts";
import { creditLineValues, creditSelectionIssues, creditSourceIdForLookup, originalCreditTaxes, parseCreditOptions } from "../../apps/web/app/o/[organizationId]/accounting/documents/credit-source-selection.ts";
import { hasPositiveSettlement, parseSupplierBillTargets, suggestedBillAmount, supplierAllocationDisplay } from "../../apps/web/app/o/[organizationId]/accounting/documents/supplier-payment-selection.ts";

const organizationId = parseOrganizationId("11111111-1111-4111-8111-111111111111");
const partyId = parseUuid("22222222-2222-4222-8222-222222222222");
const sourceId = parseUuid("33333333-3333-4333-8333-333333333333");
const lineId = parseUuid("44444444-4444-4444-8444-444444444444");
const accountId = parseUuid("55555555-5555-4555-8555-555555555555");
const openItemId = parseUuid("66666666-6666-4666-8666-666666666666");
const target = { openItemId, documentId: sourceId, documentNumber: "BILL-001", supplierReference: "SUP-42", issueDate: "2026-10-09", dueDate: null,
  totalAmount: "1000.00", residualAmount: "800.00", availableAmount: "300.00" };
const original: CreditSourceLine = { id: lineId, lineNo: 1, description: "Original consulting service", itemId: null, accountId,
  accountCode: "4000", accountName: "Service revenue", costCenterId: null, costCenterCode: null, costCenterName: null,
  quantity: "2.000000", unitPrice: "115.000000", discountAmount: "0.00", netAmount: "200.00", taxAmount: "30.00", grossAmount: "230.00",
  taxCodeId: null, taxLabelSnapshot: "Original approved rate", taxRateSnapshot: "15.000000", taxMode: "inclusive",
  taxRecoverabilitySnapshot: "none", taxAccountId: null, remainingQuantity: "1.000000", remainingNetAmount: "100.00",
  remainingTaxAmount: "15.00", remainingGrossAmount: "115.00", eligible: true, blockedReason: null };
const summary = { id: sourceId, documentNumber: "INV-001", partyId, partyName: "Example customer", issueDate: "2026-10-09",
  accountingDate: "2026-10-09", supplierReference: null, totalAmount: "230.00", eligible: true, blockedReason: null };
const options: CreditNoteOptions = { organizationId, documentType: "customer_credit", accountingDate: "2026-10-09", hasMore: false,
  sources: [summary], selectedSource: { ...summary, remainingTotalAmount: "115.00", partySnapshot: { display_name: summary.partyName }, recognitionMode: "earned_or_incurred", lines: [original] } };
const scope = { organizationId, documentType: "customer_credit", accountingDate: "2026-10-09", partyId, sourceId };

test("credit source retry retains the original selection until a different party is known", () => {
  assert.equal(creditSourceIdForLookup(sourceId, null, partyId), sourceId);
  assert.equal(creditSourceIdForLookup(sourceId, undefined, partyId), sourceId);
  assert.equal(creditSourceIdForLookup(sourceId, partyId, partyId), sourceId);
  assert.equal(creditSourceIdForLookup(sourceId, partyId, ""), sourceId);
  assert.equal(creditSourceIdForLookup(sourceId, partyId, accountId), "");
  assert.equal(creditSourceIdForLookup("", null, partyId), "");
});

test("supplier allocation uses safe future capacity rather than only the accounting-date residual", () => {
  const targets = parseSupplierBillTargets([target]);
  assert.equal(suggestedBillAmount("500.00", [], targets[0]!), "300.00");
  const tooMuch = supplierAllocationDisplay("500.00", [{ target_open_item_id: openItemId, amount: "300.01" }], targets);
  assert.equal(tooMuch.applied, "300.01");
  assert.ok(tooMuch.issues.some(issue => issue.field === "allocation_plan.1.amount"));
  const exact = supplierAllocationDisplay("500.00", [{ target_open_item_id: openItemId, amount: "300" }], targets);
  assert.deepEqual(exact, { payment: "500.00", applied: "300.00", remaining: "200.00", issues: [] });
});

test("supplier approval requires a real positive target while an unallocated draft is valid", () => {
  assert.deepEqual(supplierAllocationDisplay("100.00", [], []).issues, []);
  assert.equal(hasPositiveSettlement([]), false);
  assert.equal(hasPositiveSettlement([{ target_open_item_id: openItemId, amount: "0.00" }]), false);
  assert.equal(hasPositiveSettlement([{ target_open_item_id: "invalid", amount: "100.00" }]), false);
  assert.equal(hasPositiveSettlement([{ target_open_item_id: openItemId, amount: "1e2" }]), false);
  assert.equal(hasPositiveSettlement([{ target_open_item_id: openItemId, amount: "0.01" }]), true);
});

test("supplier payment totals preserve cents above JavaScript safe integers", () => {
  const large = { ...target, totalAmount: "9007199254740993.17", residualAmount: "9007199254740993.17", availableAmount: "9007199254740993.17" };
  const result = supplierAllocationDisplay("9007199254740993.18", [{ target_open_item_id: openItemId, amount: "9007199254740993.17" }], [large]);
  assert.equal(result.remaining, "0.01");
  assert.equal(result.applied, "9007199254740993.17");
  assert.deepEqual(result.issues, []);
});

test("oversized combined allocations produce guidance instead of crashing the form", () => {
  const maximum = { ...target, totalAmount: "999999999999999999.99", residualAmount: "999999999999999999.99", availableAmount: "999999999999999999.99" };
  const result = supplierAllocationDisplay(maximum.totalAmount, [
    { target_open_item_id: openItemId, amount: maximum.totalAmount },
    { target_open_item_id: accountId, amount: maximum.totalAmount }
  ], [maximum, { ...maximum, openItemId: accountId }]);
  assert.equal(result.applied, null);
  assert.equal(result.remaining, null);
  assert.ok(result.issues.some(issue => /supported payment range/.test(issue.message)));
});

test("stale supplier targets and overpayment allocation errors preserve entered plans", () => {
  const plan = [{ target_open_item_id: openItemId, amount: "301.00" }];
  const before = structuredClone(plan);
  const missing = supplierAllocationDisplay("300.00", plan, []);
  assert.ok(missing.issues.some(issue => issue.field === "allocation_plan.1.target_open_item_id"));
  assert.ok(missing.issues.some(issue => issue.field === "allocation_plan"));
  assert.equal(missing.remaining, "-1.00");
  assert.deepEqual(plan, before);
  const incomplete = supplierAllocationDisplay("300.00", [{ ...plan[0]!, amount: "3e2" }], [target]);
  assert.equal(incomplete.applied, null);
  assert.equal(incomplete.remaining, null);
});

test("malformed supplier responses cannot become a valid selectable target list", () => {
  assert.throws(() => parseSupplierBillTargets([target, target]));
  assert.throws(() => parseSupplierBillTargets([{ ...target, availableAmount: "800.01" }]));
  assert.throws(() => parseSupplierBillTargets([{ ...target, openItemId: "not-a-uuid" }]));
  assert.throws(() => parseSupplierBillTargets({ data: [] }));
});

test("new credit lines inherit original values without reusing posted identity or inventing proration", () => {
  const before = structuredClone(original);
  const line = creditLineValues(original);
  assert.equal(line.id, null);
  assert.equal(line.original_line_id, lineId);
  assert.equal(line.quantity, "2.000000", "remaining quantity is guidance, not an invented automatic pricing allocation");
  assert.equal(line.unit_price, "115.000000");
  assert.deepEqual(original, before);
  assert.ok(creditSelectionIssues(scope, options, [line]).some(issue => issue.field === "lines.1.quantity"));
});

test("first-save credit totals use original tax snapshots rather than current configuration", () => {
  const line = { ...creditLineValues(original), quantity: "1", tax_mode: "exclusive" as const };
  const result = calculateTradeDraft({ lines: [line], taxCodes: [{ id: "current-tax", rate_percent: "20.000000" }], credit: true,
    originalLines: originalCreditTaxes(options.selectedSource), rounding: { amount: "0.00", reason: "", accountId: "" } });
  assert.equal(result.totals?.net, "100.00");
  assert.equal(result.totals?.tax, "15.00");
  assert.equal(result.totals?.total, "115.00");
  assert.deepEqual(creditSelectionIssues(scope, options, [line]), []);
});

test("credit limits aggregate repeated original lines and include header rounding", () => {
  const line = { ...creditLineValues(original), quantity: "0.6" };
  const over = creditSelectionIssues(scope, options, [line, line]);
  assert.ok(over.some(issue => issue.field === "lines.2.quantity"));
  assert.ok(over.some(issue => issue.field === "lines.2.unit_price"));
  const rounded = creditSelectionIssues(scope, options, [{ ...line, quantity: "1" }], "0.01");
  assert.ok(rounded.some(issue => issue.field === "rounding_adjustment"));
});

test("credit source scope and unavailable options block saving without discarding lines", () => {
  const lines = [{ ...creditLineValues(original), quantity: "1" }];
  const before = structuredClone(lines);
  for (const wrongScope of [{ ...scope, partyId: accountId }, { ...scope, accountingDate: "2026-10-10" }, { ...scope, sourceId: accountId }]) {
    assert.equal(creditSelectionIssues(wrongScope, options, lines)[0]?.field, "original_document_id");
    assert.throws(() => parseCreditOptions(options, wrongScope));
  }
  assert.equal(creditSelectionIssues(scope, null, lines)[0]?.field, "original_document_id");
  assert.deepEqual(lines, before);
  assert.deepEqual(parseCreditOptions(options, scope), options);
});

test("legacy credit account mismatches are explicit and can be repaired without changing amounts", () => {
  const line = { ...creditLineValues(original), quantity: "1", account_id: openItemId, cost_center_id: sourceId };
  const before = structuredClone(line);
  assert.ok(creditSelectionIssues(scope, options, [line]).some(issue => /original account and cost center/.test(issue.message)));
  const repaired = { ...line, account_id: original.accountId, cost_center_id: original.costCenterId };
  assert.deepEqual(creditSelectionIssues(scope, options, [repaired]), []);
  assert.equal(repaired.quantity, line.quantity);
  assert.equal(repaired.unit_price, line.unit_price);
  assert.equal(repaired.discount_amount, line.discount_amount);
  assert.deepEqual(line, before);
});
