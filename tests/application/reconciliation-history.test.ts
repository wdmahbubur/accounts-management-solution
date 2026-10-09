import assert from "node:assert/strict";
import test from "node:test";
import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { parseReconciliationFilters, reconciliationHistoryQuery, reconciliationLinkLabel } from "../../apps/web/lib/reconciliation-history.ts";
import { parseReconciliationStart, readReconciliationHistory } from "../../apps/web/server/banking/reconciliations.ts";
import { CommandError } from "../../apps/web/server/commands/errors.ts";
import type { ActorContext } from "../../apps/web/server/auth/types.ts";
import type { RequestClient } from "../../apps/web/server/request-client.ts";

const org = "8a516341-5d81-4ad5-a788-b3211e113301", accountId = "8a516341-5d81-4ad5-a788-b3211e113302", id = "8a516341-5d81-4ad5-a788-b3211e113303";
const secondId = "8a516341-5d81-4ad5-a788-b3211e113304", thirdId = "8a516341-5d81-4ad5-a788-b3211e113305";
const actor: ActorContext = { organizationId: parseOrganizationId(org), userId: parseUuid(secondId), memberId: parseUuid(thirdId), capabilities: ["banking.read"] };
const filters = { cashAccountId: null, status: null, page: 1 };
function fixture() {
  const row = { id, cash_account_id: accountId, account_name: "Original bank", account_kind: "bank", account_active: false,
    starts_on: "2026-10-01", ends_on: "2026-10-08", statement_opening: "-90071992547409.93", statement_closing: "0.01",
    state: "draft", status: "draft", created_at: "2026-10-08T21:00:00+00:00", finalized_at: null as string | null,
    reopen_count: 0, last_reopened_at: null as string | null, active_match_count: 2 };
  return { organization_id: org, cash_account_id: null as string | null, status: null as string | null, offset: 0, page_size: 50, has_more: false,
    accounts: [{ id: accountId, name: "Original bank", kind: "bank", is_active: false }], sessions: [row] };
}
function client(data: unknown, calls: { name: string; args: Record<string, unknown> }[] = [], error: { code: string } | null = null): Pick<RequestClient, "rpc"> {
  return { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { data, error }; } } as Pick<RequestClient, "rpc">;
}

test("banking.read alone lists exact balances and archived account labels without write-only options", async () => {
  const raw = fixture(), calls: { name: string; args: Record<string, unknown> }[] = [];
  const result = await readReconciliationHistory(client(raw, calls), actor, filters);
  assert.equal(result.sessions[0].statementOpening, "-90071992547409.93");
  assert.equal(result.sessions[0].statementClosing, "0.01");
  assert.equal(result.sessions[0].createdAt, raw.sessions[0].created_at);
  assert.equal(result.sessions[0].accountActive, false);
  assert.deepEqual(calls, [{ name: "read_reconciliation_list", args: { p_organization_id: org, p_cash_account_id: null, p_status: null, p_offset: 0 } }]);
});

test("write-only, document and missing permissions cannot list reconciliation metadata", async () => {
  for (const capabilities of [[], ["banking.write"], ["documents.read"], ["periods.lock"]]) {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    await assert.rejects(() => readReconciliationHistory(client(fixture(), calls), { ...actor, capabilities }, filters), { code: "FORBIDDEN" });
    assert.equal(calls.length, 0);
  }
  await assert.rejects(() => readReconciliationHistory(client(null, [], { code: "42501" }), actor, filters), { code: "FORBIDDEN" });
  await assert.rejects(() => readReconciliationHistory(client(null, [], { code: "P0002" }), actor, filters), { code: "NOT_FOUND" });
});

test("draft, reopened and re-finalized sessions retain real state and timestamps with permitted link wording", async () => {
  const raw = fixture(), base = raw.sessions[0];
  raw.sessions = [base, { ...base, id: secondId, status: "reopened", reopen_count: 1, last_reopened_at: "2026-10-09T01:00:00Z" },
    { ...base, id: thirdId, state: "finalized", status: "finalized", reopen_count: 1, last_reopened_at: "2026-10-09T01:00:00Z", finalized_at: "2026-10-09T02:00:00Z" }];
  const result = await readReconciliationHistory(client(raw), actor, filters);
  assert.deepEqual(result.sessions.map(row => [row.state, row.status, row.finalizedAt]), [["draft", "draft", null], ["draft", "reopened", null], ["finalized", "finalized", "2026-10-09T02:00:00Z"]]);
  assert.equal(reconciliationLinkLabel(result.sessions[1], true), "Resume matching");
  assert.equal(reconciliationLinkLabel(result.sessions[1], false), "View session");
  assert.equal(reconciliationLinkLabel(result.sessions[2], true), "View finalized session");
});

test("history rejects mismatched tenant, account, page and filtered state responses", async () => {
  const raw = fixture();
  for (const data of [{ ...raw, organization_id: id }, { ...raw, offset: 50 }, { ...raw, cash_account_id: accountId },
    { ...raw, sessions: [{ ...raw.sessions[0], cash_account_id: secondId }] },
    { ...raw, sessions: [{ ...raw.sessions[0], account_name: "Foreign name" }] }]) {
    await assert.rejects(() => readReconciliationHistory(client(data), actor, filters));
  }
  await assert.rejects(() => readReconciliationHistory(client({ ...raw, status: "finalized" }), actor, { ...filters, status: "finalized" }));
});

test("history rejects fabricated reopened/finalized state, numeric money, invalid dates and duplicate rows", async () => {
  const raw = fixture();
  for (const row of [{ ...raw.sessions[0], status: "reopened" }, { ...raw.sessions[0], state: "finalized", status: "finalized" },
    { ...raw.sessions[0], reopen_count: 1 }, { ...raw.sessions[0], statement_opening: 0 }, { ...raw.sessions[0], starts_on: "2026-02-30" },
    { ...raw.sessions[0], ends_on: "2026-09-30" }, { ...raw.sessions[0], active_match_count: -1 }]) {
    await assert.rejects(() => readReconciliationHistory(client({ ...raw, sessions: [row] }), actor, filters));
  }
  await assert.rejects(() => readReconciliationHistory(client({ ...raw, sessions: [raw.sessions[0], raw.sessions[0]] }), actor, filters));
  await assert.rejects(() => readReconciliationHistory(client({ ...raw, sessions: Array.from({ length: 51 }, () => raw.sessions[0]) }), actor, filters));
});

test("pagination and filters round-trip through the actual read service without losing archived account selection", async () => {
  const query = new URLSearchParams({ cash_account_id: accountId, status: "draft", page: "2" });
  const parsed = parseReconciliationFilters(query), raw = fixture();
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const result = await readReconciliationHistory(client({ ...raw, cash_account_id: accountId, status: "draft", offset: 50, has_more: true }, calls), actor, parsed);
  assert.equal(calls[0].args.p_offset, 50); assert.equal(result.hasMore, true); assert.equal(result.page, 2);
  assert.equal(reconciliationHistoryQuery(parsed, 3), `cash_account_id=${accountId}&status=draft&page=3`);
  assert.equal(reconciliationHistoryQuery(filters), "");
  for (const invalid of ["page=0", "page=1.5", "status=unknown", "page=1&page=2", "cash_account_id=bad"]) assert.throws(() => parseReconciliationFilters(new URLSearchParams(invalid)));
});

test("start command preserves user statement dates and signed exact balances", () => {
  assert.deepEqual(parseReconciliationStart({ cash_account_id: accountId, starts_on: "2024-02-29", ends_on: "2024-03-01", statement_opening: "-123456789012.34", statement_closing: "0.01" }),
    { cashAccountId: accountId, startsOn: "2024-02-29", endsOn: "2024-03-01", statementOpening: "-123456789012.34", statementClosing: "0.01" });
});

test("invalid or absent statement facts become field errors rather than fabricated dates or zero balances", () => {
  const valid = { cash_account_id: accountId, starts_on: "2026-10-01", ends_on: "2026-10-09", statement_opening: "0.00", statement_closing: "100.01" };
  for (const [change, field] of [[{ starts_on: "2026-02-30" }, "starts_on"], [{ ends_on: "2026-09-30" }, "ends_on"],
    [{ ends_on: "2028-01-01" }, "ends_on"], [{ statement_opening: 0 }, "statement_opening"], [{ statement_closing: "1.001" }, "statement_closing"],
    [{ statement_closing: "" }, "statement_closing"], [{ cash_account_id: "" }, "cash_account_id"]] as const) {
    assert.throws(() => parseReconciliationStart({ ...valid, ...change }), error => error instanceof CommandError && !!error.fields?.[field]);
  }
  assert.throws(() => parseReconciliationStart(null), { code: "VALIDATION_FAILED" });
});
