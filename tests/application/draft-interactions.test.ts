import assert from "node:assert/strict";
import test from "node:test";
import { bangladeshDate } from "../../apps/web/lib/date.ts";
import { DraftEditGuard, duplicateTradeDraft } from "../../apps/web/app/o/[organizationId]/accounting/documents/draft-interactions.ts";

test("review is blocked after an edit until that revision is successfully saved", () => {
  const guard = new DraftEditGuard();
  assert.equal(guard.canReview(), true);
  guard.markChanged();
  const submittedRevision = guard.revision;
  assert.equal(guard.dirty, true);
  assert.equal(guard.canReview(), false);

  // A rejected/uncertain save does not confirm its revision; another attempt is safe.
  assert.equal(guard.revision, submittedRevision);
  assert.equal(guard.canReview(), false);
  assert.equal(guard.confirmSaved(submittedRevision), true);
  assert.equal(guard.dirty, false);
  assert.equal(guard.canReview(), true);
});

test("a save response cannot erase edits made while it was pending", () => {
  const guard = new DraftEditGuard();
  guard.markChanged();
  const submittedRevision = guard.revision;
  guard.markChanged();
  assert.equal(guard.confirmSaved(submittedRevision), false);
  assert.equal(guard.dirty, true);
  assert.equal(guard.canReview(), false);
  assert.equal(guard.confirmSaved(guard.revision), true);
  assert.equal(guard.canReview(), true);
});

test("a preview response for an older form revision is discarded even after a later save", () => {
  const guard = new DraftEditGuard();
  const previewRevision = guard.revision;
  guard.markChanged();
  assert.equal(guard.canReview(previewRevision), false);
  guard.confirmSaved(guard.revision);
  assert.equal(guard.canReview(), true);
  assert.equal(guard.canReview(previewRevision), false);
});

function issuedSource(documentType: "invoice" | "bill") {
  return {
    id: "old-document", document_type: documentType, state: "posted", version: 9,
    document_number: "ISSUED-0009", material_digest: "old-material", approved_by: "old-reviewer",
    approval_request_id: "old-approval", posted_journal: { id: "old-journal" },
    reversed_by_document_id: "old-reversal", party_id: "same-company-party",
    party_snapshot: { display_name: "Historic customer" },
    issue_date: "2026-08-01", accounting_date: "2026-08-01", due_date: "2026-08-31",
    external_reference: "old-reference", description: "Monthly design services",
    total_amount: "5500.00", rounding_adjustment: "0.00", rounding_reason: null,
    rounding_account_id: null,
    trade: {
      recognition_mode: "earned_or_incurred", performance_confirmed: true,
      original_document_id: "old-source", supplier_invoice_date: "2026-08-01",
      supplier_invoice_key: "SUPPLIER-OLD", terms: "Pay within 30 days", notes: "Thank you",
      approval_digest: "must-not-copy"
    },
    lines: [{
      id: "old-line", original_line_id: "old-source-line", document_id: "old-document",
      organization_id: "original-company", description: "Design services", quantity: "2.000000",
      unit_price: "2500.000000", discount_amount: "0.00", account_id: "same-company-account",
      item_id: "same-company-item", item_snapshot: { name: "Design services", unit: "hours" },
      cost_center_id: null, cost_center_snapshot: null, tax_code_id: "same-company-tax", tax_mode: "exclusive",
      tax_rate_snapshot: "10.000000", tax_amount: "500.00", gross_amount: "5500.00"
    }],
    movement: { id: "old-movement" }, transfer: { id: "old-transfer" },
    journal_rows: [{ id: "old-journal-row" }], allocation_plan: [{ target_open_item_id: "old-target", amount: "5000.00" }]
  };
}

for (const documentType of ["invoice", "bill"] as const) {
  test(documentType + " duplication retains editable values and removes issued identities and settlement history", () => {
    const source = issuedSource(documentType);
    const original = structuredClone(source);
    const draft = duplicateTradeDraft(source, documentType, "2026-10-09");
    assert.equal(draft.document_type, documentType);
    assert.equal(draft.state, "draft");
    assert.equal(draft.party_id, source.party_id);
    assert.equal(draft.description, source.description);
    assert.equal(draft.issue_date, "2026-10-09");
    assert.equal(draft.accounting_date, "2026-10-09");
    assert.equal(draft.due_date, null);
    assert.equal(draft.external_reference, null);
    for (const field of ["id", "version", "document_number", "material_digest", "approved_by", "approval_request_id", "posted_journal", "reversed_by_document_id", "party_snapshot", "total_amount"]) {
      assert.equal(field in draft, false, field + " must not be copied");
    }
    assert.deepEqual(draft.trade, {
      recognition_mode: "earned_or_incurred", terms: "Pay within 30 days", notes: "Thank you",
      original_document_id: null, performance_confirmed: false, supplier_invoice_date: null, supplier_invoice_key: null
    });
    const line = (draft.lines as Record<string, unknown>[])[0];
    assert.equal(line.id, null);
    assert.equal(line.original_line_id, null);
    assert.equal(line.quantity, "2.000000");
    assert.equal(line.unit_price, "2500.000000");
    assert.equal(line.account_id, source.lines[0].account_id);
    assert.equal(line.tax_code_id, source.lines[0].tax_code_id);
    for (const field of ["document_id", "organization_id", "tax_rate_snapshot", "tax_amount", "gross_amount"]) {
      assert.equal(field in line, false, field + " must be calculated or assigned for the new draft");
    }
    assert.equal(draft.movement, null);
    assert.equal(draft.transfer, null);
    assert.deepEqual(draft.journal_rows, []);
    assert.deepEqual(draft.allocation_plan, []);
    assert.deepEqual(source, original, "reading a duplicate must not mutate its issued source");
  });
}

test("duplicate requests cannot reinterpret invoices as bills or bills as invoices", () => {
  assert.throws(() => duplicateTradeDraft(issuedSource("invoice"), "bill", "2026-10-09"), /same invoice or bill type/);
  assert.throws(() => duplicateTradeDraft(issuedSource("bill"), "invoice", "2026-10-09"), /same invoice or bill type/);
});

test("document dates roll over at midnight in Bangladesh, not midnight UTC", () => {
  assert.equal(bangladeshDate(new Date("2026-10-08T17:59:59Z")), "2026-10-08");
  assert.equal(bangladeshDate(new Date("2026-10-08T18:00:00Z")), "2026-10-09");
  assert.equal(bangladeshDate(new Date("2026-12-31T18:00:00Z")), "2027-01-01");
});
