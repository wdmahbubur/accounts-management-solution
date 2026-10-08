import assert from "node:assert/strict";
import test from "node:test";
import { renderIssuedInvoicePdf, type IssuedInvoicePdfSnapshot } from "../../apps/web/server/documents/invoice-pdf.ts";

function issuedInvoice(unitPrice = "100.000000"): IssuedInvoicePdfSnapshot {
  return {
    state: "posted", documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", documentNumber: "INV-2026-0001",
    materialDigest: "a".repeat(64), documentVersion: 3, issueDate: "2026-10-09", dueDate: "2026-11-08",
    currency: "BDT", netAmount: "100.00", taxAmount: "0.00", roundingAdjustment: "0.00", totalAmount: "100.00",
    company: { name: "Audit Studio", legalName: null, address: null, taxIdentifiers: [] },
    customer: { displayName: "Example Customer", legalName: null, email: null, phone: null, billingAddress: null, taxIdentifiers: [] },
    lines: [{ description: "Design service", itemName: null, quantity: "1.000000", unit: null, unitPrice,
      discountAmount: "0.00", taxLabel: null, taxRate: "0.000000", taxMode: "exclusive",
      netAmount: "100.00", taxAmount: "0.00", grossAmount: "100.00" }]
  };
}

test("issued invoice PDF accepts PostgreSQL six-decimal unit prices and keeps source identity", async () => {
  const snapshot = issuedInvoice();
  const result = await renderIssuedInvoicePdf(snapshot);
  assert.equal(result.bytes.subarray(0, 5).toString(), "%PDF-");
  assert.ok(result.bytes.length > 1_000);
  assert.equal(result.sourceDocumentId, snapshot.documentId);
  assert.equal(result.sourceDocumentVersion, snapshot.documentVersion);
  assert.equal(result.sourceMaterialDigest, snapshot.materialDigest);
  assert.equal(snapshot.lines[0]?.unitPrice, "100.000000");
});

test("PDF accepts fractional unit prices while keeping posted money at two decimals", async () => {
  const snapshot = issuedInvoice("0.123456");
  snapshot.netAmount = snapshot.totalAmount = "0.12";
  snapshot.lines = [{ ...snapshot.lines[0]!, netAmount: "0.12", grossAmount: "0.12" }];
  assert.ok((await renderIssuedInvoicePdf(snapshot)).bytes.length > 1_000);
  for (const invalid of ["0.1234567", "-1.000000", "NaN"]) {
    await assert.rejects(renderIssuedInvoicePdf(issuedInvoice(invalid)), /invalid.*unit price/i);
  }
  await assert.rejects(renderIssuedInvoicePdf({ ...issuedInvoice(), totalAmount: "100.000000" }), /invalid BDT amount/);
});
