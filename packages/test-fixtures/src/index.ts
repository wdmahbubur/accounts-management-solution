export const fixtureIds = {
  user: "11111111-1111-4111-8111-111111111111",
  organizationA: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  organizationB: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  memberA: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  memberB: "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb",
  accountantRoleA: "aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa",
  billingRoleB: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
  fiscalYearA: "aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa",
  periodA: "aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa",
  accounts: {
    bank: "aaaaaaaa-0000-4000-8000-000000001001",
    ar: "aaaaaaaa-0000-4000-8000-000000001002",
    ap: "aaaaaaaa-0000-4000-8000-000000001003",
    revenue: "aaaaaaaa-0000-4000-8000-000000001004",
    expense: "aaaaaaaa-0000-4000-8000-000000001005",
    capital: "aaaaaaaa-0000-4000-8000-000000001006",
    orgBBank: "bbbbbbbb-0000-4000-8000-000000001001"
  }
} as const;

export const fixtureDates = {
  booksStart: "2026-01-01",
  fiscalStart: "2026-01-01",
  fiscalEnd: "2026-12-31",
  periodStart: "2026-09-01",
  scenarioDate: "2026-09-30"
} as const;

export const dualMembershipFixture = {
  userId: fixtureIds.user,
  memberships: [
    {
      organizationId: fixtureIds.organizationA,
      memberId: fixtureIds.memberA,
      role: "Accountant",
      capabilities: ["accounting.read"]
    },
    {
      organizationId: fixtureIds.organizationB,
      memberId: fixtureIds.memberB,
      role: "Billing",
      capabilities: ["billing.read"]
    }
  ]
} as const;

export const goldenScenario = {
  currency: "BDT",
  date: fixtureDates.scenarioDate,
  journals: [
    {
      event: "owner_contribution",
      lines: [
        { account: "bank", debit: "100000.00", credit: "0.00" },
        { account: "capital", debit: "0.00", credit: "100000.00" }
      ]
    },
    {
      event: "earned_invoice",
      lines: [
        { account: "ar", debit: "10000.00", credit: "0.00" },
        { account: "revenue", debit: "0.00", credit: "10000.00" }
      ]
    },
    {
      event: "customer_receipt",
      lines: [
        { account: "bank", debit: "6000.00", credit: "0.00" },
        { account: "ar", debit: "0.00", credit: "6000.00" }
      ]
    },
    {
      event: "vendor_bill",
      lines: [
        { account: "expense", debit: "4000.00", credit: "0.00" },
        { account: "ap", debit: "0.00", credit: "4000.00" }
      ]
    },
    {
      event: "vendor_payment",
      lines: [
        { account: "ap", debit: "3000.00", credit: "0.00" },
        { account: "bank", debit: "0.00", credit: "3000.00" }
      ]
    },
    {
      event: "paid_rent",
      lines: [
        { account: "expense", debit: "1000.00", credit: "0.00" },
        { account: "bank", debit: "0.00", credit: "1000.00" }
      ]
    }
  ],
  expected: {
    bank: "102000.00",
    ar: "4000.00",
    ap: "1000.00",
    revenue: "10000.00",
    expense: "5000.00",
    profit: "5000.00",
    assets: "106000.00",
    liabilities: "1000.00",
    capital: "100000.00",
    untransferredProfit: "5000.00"
  }
} as const;
