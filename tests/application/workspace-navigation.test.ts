import assert from "node:assert/strict";
import test from "node:test";
import { activeNavigationHref, workspaceBreadcrumbs, workspaceNavigation } from "../../apps/web/components/shell/navigation.ts";

const organization = "company-a";
const root = `/o/${organization}`;
const capabilities = ["sales.read", "purchases.read", "catalog.read", "banking.read", "banking.write", "reports.read", "ledger.read", "documents.read", "attachments.read", "accounting.read", "users.read", "journal.write"];
const groups = workspaceNavigation(organization, capabilities);

test("navigation preserves capability boundaries and makes authorized reports discoverable", () => {
  const sales = workspaceNavigation(organization, ["sales.read"]);
  const links = sales.flatMap(group => group.items).map(item => item.href);
  assert.ok(links.includes(`${root}/sales/invoices`));
  assert.ok(links.includes(`${root}/reports`));
  assert.ok(!links.includes(`${root}/purchases/bills`));
  assert.ok(!links.includes(`${root}/accounting/accounts`));
  assert.ok(!links.includes(`${root}/settings/users`));
  assert.deepEqual(workspaceNavigation(organization, []).flatMap(group => group.items).map(item => item.href),
    [root, `${root}/notifications`, `${root}/notifications/preferences`]);
});

test("banking setup links use the existing page write capability", () => {
  const readOnly = workspaceNavigation(organization, ["banking.read"]).flatMap(group => group.items);
  assert.ok(readOnly.some(item => item.href === `${root}/banking/accounts`));
  assert.ok(!readOnly.some(item => item.href === `${root}/banking/import` || item.href === `${root}/banking/reconciliations`));
  const writable = workspaceNavigation(organization, ["banking.write"]).flatMap(group => group.items);
  assert.ok(writable.some(item => item.href === `${root}/banking/import`));
  assert.ok(writable.some(item => item.href === `${root}/banking/reconciliations`));
});

test("nested records and their edits retain the owning navigation item", () => {
  assert.equal(activeNavigationHref(groups, `${root}/sales/invoices/invoice-id/edit`), `${root}/sales/invoices`);
  assert.equal(activeNavigationHref(groups, `${root}/banking/accounts/cash-id`), `${root}/banking/accounts`);
  assert.equal(activeNavigationHref(groups, `${root}/catalog/cost-centers`), `${root}/catalog/items`);
});

test("the most specific matching route wins without selecting other companies or unknown pages", () => {
  assert.equal(activeNavigationHref(groups, `${root}/notifications/preferences`), `${root}/notifications/preferences`);
  assert.equal(activeNavigationHref(groups, `${root}/reports/trial-balance?as_of=2026-10-08`), `${root}/reports/trial-balance`);
  assert.equal(activeNavigationHref(groups, `${root}/reports/profit-loss`), `${root}/reports`);
  assert.equal(activeNavigationHref(groups, `${root}/dashboard`), root);
  assert.equal(activeNavigationHref(groups, `${root}/sales/invoices-archive`), undefined);
  assert.equal(activeNavigationHref(groups, "/o/company-a2/sales/invoices"), undefined);
  assert.equal(activeNavigationHref(groups, `${root}/unknown`), undefined);
});

test("breadcrumbs distinguish evidence, financial documents and bank reconciliation", () => {
  assert.deepEqual(workspaceBreadcrumbs(organization, `${root}/documents`), [{ label: "Evidence library" }]);
  assert.deepEqual(workspaceBreadcrumbs(organization, `${root}/accounting/documents`), [{ label: "Financial documents" }]);
  assert.deepEqual(workspaceBreadcrumbs(organization, `${root}/banking/reconciliations/record-id`), [
    { label: "Reconciliation", href: `${root}/banking/reconciliations` }, { label: "Reconciliation details" }
  ]);
});

test("report breadcrumbs return to the report hub and identify the current report", () => {
  for (const [path, label] of [["profit-loss", "Profit and Loss"], ["balance-sheet", "Balance Sheet"], ["cash-flow", "Cash flow"], ["trial-balance", "Trial balance"]]) {
    assert.deepEqual(workspaceBreadcrumbs(organization, `${root}/reports/${path}`), [
      { label: "Reports", href: `${root}/reports` }, { label }
    ]);
  }
});

test("record breadcrumbs offer a readable parent instead of exposing internal record IDs", () => {
  assert.deepEqual(workspaceBreadcrumbs(organization, `${root}/sales/invoices/new`), [
    { label: "Invoices", href: `${root}/sales/invoices` }, { label: "Create invoice" }
  ]);
  assert.deepEqual(workspaceBreadcrumbs(organization, `${root}/sales/invoices/internal-uuid/edit`), [
    { label: "Invoices", href: `${root}/sales/invoices` }, { label: "Edit invoice" }
  ]);
  assert.deepEqual(workspaceBreadcrumbs(organization, "/o/company-b/sales/invoices"), [{ label: "Workspace" }]);
});
