export type WorkspaceNavigationItem = {
  href: string;
  label: string;
  aliases?: string[];
};

export type WorkspaceNavigationGroup = {
  id: string;
  label: string;
  items: WorkspaceNavigationItem[];
};

type NavigationDefinition = {
  path: string;
  label: string;
  anyCapability?: readonly string[];
  allCapabilities?: readonly string[];
  aliases?: string[];
};

const definitions: { id: string; label: string; items: NavigationDefinition[] }[] = [
  { id: "overview", label: "Overview", items: [
    { path: "", label: "Dashboard", aliases: ["/dashboard"] },
    { path: "/reports", label: "Reports", anyCapability: ["reports.read", "ledger.read", "banking.read", "dues.read", "sales.read", "purchases.read"] },
    { path: "/notifications", label: "Notifications" }
  ] },
  { id: "sales", label: "Sales", items: [
    { path: "/sales/invoices", label: "Invoices", anyCapability: ["sales.read"] },
    { path: "/sales/receipts", label: "Customer receipts", anyCapability: ["sales.read"] },
    { path: "/sales/customers", label: "Customers", anyCapability: ["sales.read"] },
    { path: "/catalog/items", label: "Service catalogue", anyCapability: ["catalog.read"], aliases: ["/catalog/cost-centers"] }
  ] },
  { id: "purchases", label: "Purchases", items: [
    { path: "/purchases/bills", label: "Supplier bills", anyCapability: ["purchases.read"] },
    { path: "/purchases/vendors", label: "Suppliers", anyCapability: ["purchases.read"] }
  ] },
  { id: "banking", label: "Banking", items: [
    { path: "/banking/accounts", label: "Cash and bank accounts", anyCapability: ["banking.read"] },
    { path: "/banking/transfers", label: "Transfers", anyCapability: ["banking.read"] },
    { path: "/banking/import", label: "Import bank statement", anyCapability: ["banking.write"] },
    { path: "/banking/reconciliations", label: "Reconciliation", anyCapability: ["banking.read", "banking.write"] }
  ] },
  { id: "accounting", label: "Accounting", items: [
    { path: "/accounting/documents", label: "Financial documents", anyCapability: ["documents.read"] },
    { path: "/accounting/journals", label: "Journal register", anyCapability: ["ledger.read"] },
    { path: "/accounting/general-ledger", label: "General ledger", anyCapability: ["ledger.read"] },
    { path: "/reports/trial-balance", label: "Trial balance", anyCapability: ["reports.read"] },
    { path: "/accounting/accounts", label: "Chart of accounts", anyCapability: ["accounting.read"] },
    { path: "/accounting/periods", label: "Fiscal periods", anyCapability: ["accounting.read"] },
    { path: "/accounting/year-close", label: "Fiscal year close", anyCapability: ["accounting.read"] }
  ] },
  { id: "workspace", label: "Review and records", items: [
    { path: "/approvals", label: "Approval inbox", anyCapability: ["approvals.read"] },
    { path: "/documents", label: "Evidence library", anyCapability: ["attachments.read"] },
    { path: "/imports", label: "Imports", anyCapability: ["imports.read"] },
    { path: "/exports", label: "Export jobs", anyCapability: ["exports.read"] },
    { path: "/audit", label: "Audit trail", anyCapability: ["audit.read"] }
  ] },
  { id: "settings", label: "Settings", items: [
    { path: "/settings/setup", label: "Company setup", anyCapability: ["company.update"] },
    { path: "/settings/users", label: "Users and invitations", anyCapability: ["users.read"] },
    { path: "/settings/roles", label: "Roles and permissions", anyCapability: ["users.read"] },
    { path: "/settings/taxes", label: "Tax configuration", anyCapability: ["tax.read"] },
    { path: "/settings/approvals", label: "Approval policies", anyCapability: ["approvals.manage"] },
    { path: "/settings/opening-balances", label: "Opening balances", allCapabilities: ["journal.write", "documents.read", "accounting.read"] },
    { path: "/notifications/preferences", label: "Email preferences" }
  ] }
];

export function workspaceNavigation(organizationId: string, capabilities: readonly string[]): WorkspaceNavigationGroup[] {
  const root = `/o/${organizationId}`;
  return definitions.map(group => ({
    id: group.id,
    label: group.label,
    items: group.items
      .filter(item => (!item.anyCapability || item.anyCapability.some(capability => capabilities.includes(capability))) &&
        (!item.allCapabilities || item.allCapabilities.every(capability => capabilities.includes(capability))))
      .map(item => ({
        href: `${root}${item.path}`,
        label: item.label,
        ...(item.aliases ? { aliases: item.aliases.map(alias => `${root}${alias}`) } : {})
      }))
  })).filter(group => group.items.length > 0);
}

function cleanPath(path: string): string {
  return path.split(/[?#]/)[0].replace(/\/+$/, "");
}

export function activeNavigationHref(groups: readonly WorkspaceNavigationGroup[], path: string): string | undefined {
  const current = cleanPath(path);
  let active: { href: string; length: number } | undefined;
  for (const item of groups.flatMap(group => group.items)) {
    for (const candidate of [item.href, ...(item.aliases ?? [])]) {
      // A company root is exact-only, so unknown pages never select Dashboard.
      const isRoot = /^\/o\/[^/]+$/.test(candidate);
      if ((current === candidate || (!isRoot && current.startsWith(`${candidate}/`)))
        && (!active || candidate.length > active.length)) active = { href: item.href, length: candidate.length };
    }
  }
  return active?.href;
}

export type WorkspaceBreadcrumb = { label: string; href?: string };

const pageLabels: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/catalog/cost-centers": "Cost centers",
  "/reports/profit-loss": "Profit and Loss",
  "/reports/balance-sheet": "Balance Sheet",
  "/reports/cash-flow": "Cash flow",
  "/reports/receivables": "Receivable aging",
  "/reports/payables": "Payable aging",
  "/reports/statements": "Customer and supplier statements",
  "/accounting/write-offs/new": "New write-off"
};

const recordPages: Record<string, { create: string; detail: string; edit?: string }> = {
  "/sales/invoices": { create: "Create invoice", detail: "Invoice details", edit: "Edit invoice" },
  "/sales/receipts": { create: "Record receipt", detail: "Receipt details" },
  "/sales/customers": { create: "New customer", detail: "Customer details", edit: "Edit customer" },
  "/purchases/bills": { create: "Create supplier bill", detail: "Supplier bill details" },
  "/purchases/vendors": { create: "New supplier", detail: "Supplier details", edit: "Edit supplier" },
  "/accounting/documents": { create: "New financial document", detail: "Document details" },
  "/accounting/journals": { create: "New journal", detail: "Journal details" },
  "/banking/accounts": { create: "Cash and bank accounts", detail: "Cashbook ledger" },
  "/banking/transfers": { create: "New transfer", detail: "Transfer details" },
  "/banking/reconciliations": { create: "Reconciliation", detail: "Reconciliation details" }
};

export function workspaceBreadcrumbs(organizationId: string, path: string): WorkspaceBreadcrumb[] {
  const root = `/o/${organizationId}`;
  const current = cleanPath(path);
  if (current === root || current === `${root}/dashboard`) return [{ label: "Dashboard" }];
  if (!current.startsWith(`${root}/`)) return [{ label: "Workspace" }];
  const relative = current.slice(root.length);
  const items = definitions.flatMap(group => group.items);
  const exact = items.find(item => item.path === relative);
  if (relative.startsWith("/reports/")) {
    const label = pageLabels[relative] ?? exact?.label;
    if (label) return [{ label: "Reports", href: `${root}/reports` }, { label }];
  }
  if (exact) return [{ label: exact.label }];
  if (pageLabels[relative]) return [{ label: pageLabels[relative] }];
  for (const [prefix, names] of Object.entries(recordPages)) {
    if (!relative.startsWith(`${prefix}/`)) continue;
    const parent = items.find(item => item.path === prefix);
    const suffix = relative.slice(prefix.length + 1);
    const label = suffix === "new" ? names.create : suffix.endsWith("/edit") && names.edit ? names.edit : names.detail;
    return [...(parent ? [{ label: parent.label, href: `${root}${prefix}` }] : []), { label }];
  }
  return [{ label: "Workspace" }];
}
