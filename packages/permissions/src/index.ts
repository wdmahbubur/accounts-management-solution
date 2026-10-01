export type Capability = string & { readonly __brand: "Capability" };

const CAPABILITY_PATTERN = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/;

export const capabilityCodes = [
  "company.read",
  "company.update",
  "users.read",
  "users.manage",
  "sales.read",
  "sales.write",
  "sales.post",
  "purchases.read",
  "purchases.write",
  "purchases.post",
  "contacts.read",
  "contacts.write",
  "catalog.read",
  "catalog.write",
  "documents.read",
  "banking.read",
  "banking.write",
  "dues.read",
  "dues.allocate",
  "accounting.read",
  "journal.write",
  "journal.post",
  "ledger.read",
  "tax.read",
  "tax.manage",
  "approvals.read",
  "approvals.decide",
  "periods.lock",
  "periods.reopen",
  "reports.read",
  "reports.export",
  "imports.read",
  "imports.run",
  "exports.read",
  "attachments.read",
  "attachments.write",
  "audit.read",
  "subscription.read",
  "subscription.manage"
] as const;

export type CapabilityCode = (typeof capabilityCodes)[number];

export const roleTemplateCapabilityCodes = {
  owner: capabilityCodes,
  admin: [
    "company.read",
    "company.update",
    "users.read",
    "users.manage"
  ],
  finance_manager: [
    "sales.read","sales.write","sales.post",
    "purchases.read","purchases.write","purchases.post",
    "contacts.read","contacts.write","catalog.read","catalog.write",
    "documents.read","banking.read","banking.write","dues.read","dues.allocate",
    "accounting.read","journal.write","journal.post","ledger.read",
    "tax.read","tax.manage","approvals.read","approvals.decide",
    "periods.lock","periods.reopen","reports.read","reports.export",
    "imports.read","imports.run","exports.read",
    "attachments.read","attachments.write","audit.read"
  ],
  accountant: [
    "sales.read","sales.write","sales.post",
    "purchases.read","purchases.write","purchases.post",
    "contacts.read","contacts.write","catalog.read","catalog.write",
    "documents.read","banking.read","banking.write","dues.read","dues.allocate",
    "accounting.read","journal.write","journal.post","ledger.read",
    "tax.read","tax.manage","approvals.read",
    "reports.read","reports.export","imports.read","imports.run","exports.read",
    "attachments.read","attachments.write","audit.read"
  ],
  billing: [
    "sales.read",
    "sales.write",
    "sales.post",
    "contacts.write",
    "catalog.read",
    "dues.allocate"
  ],
  auditor: [
    "company.read","sales.read","purchases.read","contacts.read","catalog.read",
    "documents.read","banking.read","dues.read","accounting.read","ledger.read",
    "tax.read","approvals.read","reports.read","reports.export",
    "imports.read","exports.read","attachments.read","audit.read"
  ]
} as const satisfies Record<string, readonly CapabilityCode[]>;

export type RoleTemplateKey = keyof typeof roleTemplateCapabilityCodes;

export function capability(value: string): Capability {
  if (!CAPABILITY_PATTERN.test(value)) {
    throw new Error(`Invalid capability name: ${value}`);
  }
  return value as Capability;
}

export function hasCapability(
  granted: readonly string[],
  required: Capability
): boolean {
  return granted.includes(required);
}

export const permissionsModule = {
  name: "permissions",
  responsibility:
    "Capability vocabulary and authorization contracts; never client-side authority."
} as const;
