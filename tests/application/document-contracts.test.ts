import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { types } from "@neondatabase/serverless";
import "../../apps/web/server/database.ts";
import { validateDraftDocument } from "../../apps/web/server/documents/contracts.ts";

test("draft quantities and unit prices reach PostgreSQL as exact fixed-scale decimal strings", () => {
  const draft = validateDraftDocument({
    document_type: "invoice",
    party_id: "09a79fda-decf-4da4-8f96-e92d4404fb41",
    issue_date: "2026-10-04",
    accounting_date: "2026-10-04",
    due_date: null,
    external_reference: null,
    description: "",
    currency: "BDT",
    rounding_adjustment: "0.00",
    rounding_reason: null,
    rounding_account_id: null,
    trade: { recognition_mode: "earned_or_incurred", performance_confirmed: false },
    movement: null,
    transfer: null,
    lines: [{
      id: null,
      item_id: null,
      original_line_id: null,
      description: "QA service",
      quantity: "1",
      unit_price: "5000",
      discount_amount: "0.00",
      account_id: "09a79fda-decf-4da4-8f96-e92d4404fb42",
      cost_center_id: null,
      tax_code_id: null,
      tax_mode: "exclusive",
      cash_flow_class: null
    }],
    journal_rows: [],
    allocation_plan: []
  });

  assert.equal(draft.lines[0].quantity, "1.000000");
  assert.equal(draft.lines[0].unitPrice, "5000.000000");
});

test("document detail reads can request same-company line snapshots through the RPC allowlist", () => {
  const requestClient = readFileSync(new URL(
    "../../apps/web/server/request-client.ts",
    import.meta.url
  ), "utf8");
  assert.match(requestClient, /"read_line_item_snapshots"/);
});

test("PostgreSQL DATE values stay calendar strings instead of shifting through a time zone", () => {
  assert.equal(types.getTypeParser(types.builtins.DATE)("2026-10-04"), "2026-10-04");
});
