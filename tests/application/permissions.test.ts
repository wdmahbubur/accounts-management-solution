import assert from "node:assert/strict";
import test from "node:test";

import {
  capabilityCodes,
  roleTemplateCapabilityCodes
} from "../../packages/permissions/src/index.ts";

test("US-009 permission vocabulary has 39 source capabilities and two story-scoped additions", () => {
  assert.equal(capabilityCodes.length, 41);
  assert.equal(new Set(capabilityCodes).size, 41);
  assert.equal(roleTemplateCapabilityCodes.owner.length, 41);
  assert.equal(capabilityCodes.includes("dues.adjust"), true);
  assert.equal(capabilityCodes.includes("approvals.manage"), true);
});

test("Admin defaults to company and user administration without financial read", () => {
  assert.deepEqual([...roleTemplateCapabilityCodes.admin].sort(), [
    "company.read",
    "company.update",
    "users.manage",
    "users.read"
  ]);

  for (const code of [
    "documents.read",
    "banking.read",
    "accounting.read",
    "ledger.read",
    "reports.read",
    "reports.export"
  ]) {
    assert.equal(roleTemplateCapabilityCodes.admin.includes(code as never), false);
  }
});

test("S-03 Billing template is sales-scoped and excludes broad financial reads", () => {
  for (const allowed of [
    "sales.read",
    "sales.write",
    "sales.post",
    "dues.allocate"
  ]) {
    assert.equal(roleTemplateCapabilityCodes.billing.includes(allowed as never), true);
  }

  for (const denied of [
    "contacts.read",
    "dues.read",
    "purchases.read",
    "documents.read",
    "banking.read",
    "accounting.read",
    "ledger.read",
    "reports.read",
    "reports.export",
    "audit.read"
  ]) {
    assert.equal(roleTemplateCapabilityCodes.billing.includes(denied as never), false);
  }
});

test("approval, posting, reports, bank balance and export remain separate capabilities", () => {
  const distinct = new Set([
    "approvals.decide",
    "journal.post",
    "reports.read",
    "banking.read",
    "reports.export"
  ]);
  assert.equal(distinct.size, 5);
  for (const code of distinct) {
    assert.equal(capabilityCodes.includes(code as never), true);
  }
});
