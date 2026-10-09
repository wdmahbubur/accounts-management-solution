import assert from "node:assert/strict";
import test from "node:test";
import { ContractValidationError, parseOrganizationId, parseUuid } from "@ams/contracts";
import { CashAccountSaveGuard, parseCashAccountInput, performCashAccountSave, type CashAccountInput } from "../../apps/web/lib/cash-account-requests.ts";
import { cashAccountSaveError, readCashAccountMapping } from "../../apps/web/server/banking/cash-accounts.ts";
import { registerHref } from "../../apps/web/lib/register-navigation.ts";
import { readTransferRegister } from "../../apps/web/server/documents/transfers.ts";
import type { ActorContext } from "../../apps/web/server/auth/types.ts";
import type { RequestClient } from "../../apps/web/server/request-client.ts";

const org = parseOrganizationId("11111111-1111-4111-8111-111111111111");
const ledger = parseUuid("22222222-2222-4222-8222-222222222222"), id = parseUuid("33333333-3333-4333-8333-333333333333");
const input: CashAccountInput = { name: "Operating bank", kind: "bank", account_id: ledger, institution: "Example bank", masked_account_number: "••1234", is_cash_equivalent: true, allow_negative_balance: false };
const success = { data: { id, organization_id: org, account_id: ledger }, meta: { request_id: "confirmed-create" } };
const reply = (body: unknown, status = 200) => Response.json(body, { status });
const actor: ActorContext = { organizationId: org, userId: id, memberId: id, capabilities: ["banking.read"] };

test("cash-account validation keeps useful field names and normalizes only submitted text", () => {
  const before = structuredClone(input);
  assert.deepEqual(parseCashAccountInput({ ...input, name: " Operating bank ", institution: " ", masked_account_number: " ••1234 " }), { ...input, institution: null });
  assert.throws(() => parseCashAccountInput({ ...input, name: " ", account_id: "not-an-account" }), (error: unknown) => error instanceof ContractValidationError && Boolean(error.fields.name && error.fields.account_id));
  assert.throws(() => parseCashAccountInput({ ...input, book_balance: "10.00" }), ContractValidationError);
  assert.deepEqual(input, before);
});

test("known SQL save failures have actionable field errors without raw database details", () => {
  const duplicate = cashAccountSaveError({ code: "23505" });
  assert.equal(duplicate.status, 422);
  assert.equal(duplicate.code, "VALIDATION_FAILED");
  assert.match(duplicate.fields?.account_id ?? "", /already linked/);
  for (const code of ["23514", "23503"]) assert.match(cashAccountSaveError({ code }).fields?.account_id ?? "", /active, postable/);
  assert.equal(cashAccountSaveError({ code: "42501" }).status, 403);
  assert.equal(cashAccountSaveError({ code: "22023" }).status, 422);
  assert.equal(cashAccountSaveError({ code: "08006" }).status, 500);
});

test("cash-account save guard blocks double submission and retains exact unknown values", async () => {
  const guard = new CashAccountSaveGuard(), submitted = { ...input };
  const attempt = guard.begin(submitted)!;
  assert.equal(guard.begin({ ...input, name: "Second click" }), null);
  submitted.name = "Edited while waiting";
  const result = await performCashAccountSave(org, attempt, async () => { throw new Error("Connection lost"); });
  assert.equal(result.kind, "uncertain"); guard.finish(result);
  assert.equal(guard.needsRecovery, true);
  const retry = guard.begin({ ...input, account_id: id, name: "Different account" })!;
  assert.equal(retry.body, attempt.body);
  assert.equal(retry.input.name, input.name);
  assert.equal(retry.input.account_id, ledger);
  assert.equal(retry.recovering, true);
});

test("cash-account recovery read is permission scoped, read-only and returns only the requested mapping", async () => {
  const calls: unknown[] = [];
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push([name, args]);
    return { data: [{ ...input, id, is_active: true, book_balance: "900.00" }, { ...input, id: ledger, account_id: id, is_active: true }], error: null };
  } } as Pick<RequestClient, "rpc">;
  await assert.rejects(readCashAccountMapping(client, { ...actor, capabilities: ["banking.write"] }, ledger));
  assert.deepEqual(calls, []);
  assert.deepEqual(await readCashAccountMapping(client, actor, ledger), { ...input, id, is_active: true });
  assert.deepEqual(calls, [["read_cash_accounts", { p_organization_id: org }]]);
  assert.equal(await readCashAccountMapping(client, actor, org), null);
  const broken = { rpc: async () => ({ data: [{ ...input, id: "bad-id", is_active: true }], error: null }) } as Pick<RequestClient, "rpc">;
  await assert.rejects(readCashAccountMapping(broken, actor, ledger), /could not be confirmed/);
  const incomplete = { rpc: async () => ({ data: [{ name: input.name }], error: null }) } as Pick<RequestClient, "rpc">;
  await assert.rejects(readCashAccountMapping(incomplete, actor, ledger), /Invalid cash account mapping/);
});

test("a confirmed validation rejection allows correction without mutating the entered values", async () => {
  const guard = new CashAccountSaveGuard(), before = structuredClone(input);
  const result = await performCashAccountSave(org, guard.begin(input)!, async () => reply({ error: { code: "VALIDATION_FAILED", message: "Ledger account is already used.", fields: { account_id: "Choose another ledger account." } }, meta: { request_id: "rejection" } }, 422));
  assert.equal(result.kind, "rejected"); guard.finish(result);
  assert.equal(guard.needsRecovery, false);
  assert.deepEqual(input, before);
  assert.equal(guard.begin({ ...input, account_id: id })?.input.account_id, id);
});

test("malformed, wrong-company and wrong-ledger success responses never confirm creation", async () => {
  for (const data of [{}, { ...success.data, id: "invalid" }, { ...success.data, organization_id: ledger }, { ...success.data, account_id: id }]) {
    const guard = new CashAccountSaveGuard(), result = await performCashAccountSave(org, guard.begin(input)!, async () => reply({ data }, 201));
    assert.equal(result.kind, "uncertain"); guard.finish(result); assert.equal(guard.needsRecovery, true);
  }
  const guard = new CashAccountSaveGuard();
  assert.deepEqual(await performCashAccountSave(org, guard.begin(input)!, async () => reply(success, 201)), { kind: "confirmed", id });
});

test("timeouts and unknown application errors retain the pending creation", async () => {
  for (const [status, body] of [[408, { error: { code: "VALIDATION_FAILED", message: "Timeout" }, meta: { request_id: "timeout" } }], [422, { error: { message: "Proxy rejection" } }], [503, { error: { code: "INTERNAL_ERROR", message: "Unknown" } }]] as const) {
    const guard = new CashAccountSaveGuard(), result = await performCashAccountSave(org, guard.begin(input)!, async () => reply(body, status));
    assert.equal(result.kind, "uncertain"); guard.finish(result); assert.equal(guard.needsRecovery, true);
  }
});

function recoveringAttempt() {
  const guard = new CashAccountSaveGuard(); guard.begin(input); guard.finish({ kind: "uncertain" });
  return guard.begin()!;
}

test("lost creation response is recovered by a scoped read without sending a second POST", async () => {
  let reads = 0;
  const result = await performCashAccountSave(org, recoveringAttempt(), async (url, init) => {
    reads++; assert.equal(init?.method, undefined); assert.equal(init?.cache, "no-store");
    assert.equal(String(url), `/api/v1/organizations/${org}/cash-accounts?account_id=${ledger}`);
    return reply({ data: { organization_id: org, account_id: ledger, account: { ...input, id, is_active: true } } });
  });
  assert.deepEqual(result, { kind: "confirmed", id }); assert.equal(reads, 1);
});

test("recovery never accepts another ledger mapping, mismatched details or an archived account", async () => {
  for (const account of [{ ...input, id, name: "Someone else's account", is_active: true }, { ...input, id, is_active: false }]) {
    const result = await performCashAccountSave(org, recoveringAttempt(), async () => reply({ data: { organization_id: org, account_id: ledger, account } }));
    assert.equal(result.kind, "rejected");
  }
  const wrongScope = await performCashAccountSave(org, recoveringAttempt(), async () => reply({ data: { organization_id: ledger, account_id: ledger, account: { ...input, id, is_active: true } } }));
  assert.equal(wrongScope.kind, "uncertain");
  for (const account of [{ ...input, id, account_id: id, is_active: true }, { ...input, id }]) {
    const malformed = await performCashAccountSave(org, recoveringAttempt(), async () => reply({ data: { organization_id: org, account_id: ledger, account } }));
    assert.equal(malformed.kind, "uncertain");
  }
});

test("after a negative read, retry sends only the frozen body and a duplicate race stays recoverable", async () => {
  const attempt = recoveringAttempt(), methods: string[] = [];
  const result = await performCashAccountSave(org, attempt, async (_url, init) => {
    methods.push(init?.method ?? "GET");
    if (!init?.method) return reply({ data: { organization_id: org, account_id: ledger, account: null } });
    assert.equal(init.body, attempt.body);
    return reply({ error: { code: "VALIDATION_FAILED", message: "Account already linked.", fields: { account_id: "Already linked" } }, meta: { request_id: "duplicate-race" } }, 422);
  });
  assert.deepEqual(methods, ["GET", "POST"]); assert.equal(result.kind, "uncertain");
  const laterDenied = await performCashAccountSave(org, attempt, async (_url, init) => !init?.method
    ? reply({ data: { organization_id: org, account_id: ledger, account: null } })
    : reply({ error: { code: "FORBIDDEN", message: "Permission changed." }, meta: { request_id: "later-denial" } }, 403));
  assert.equal(laterDenied.kind, "uncertain", "A retry rejection does not prove the original request was rejected");
});

const transferId = (n: number) => parseUuid(`44444444-4444-4444-8444-${String(n).padStart(12, "0")}`);
const transfer = (n: number) => ({ id: transferId(n), organization_id: org, state: "posted", document_number: `TR-${n}`, accounting_date: "2026-10-09", from_account: "Operating bank", to_account: "Cash", amount: "9007199254740993.17", fee_amount: "0.01", total_amount: "9007199254740993.18", external_reference: "QA & exact" });

test("transfer pagination exposes every match beyond the old 101-row cutoff without overlap", async () => {
  const records = Array.from({ length: 125 }, (_, index) => transfer(125 - index)), calls: Record<string, unknown>[] = [];
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    assert.equal(name, "read_transfer_register"); assert.equal(args.p_organization_id, org); assert.equal(args.p_search, "QA & exact");
    calls.push(args);
    return { data: records.filter(row => args.p_after === null || row.id < String(args.p_after)).slice(0, Number(args.p_limit)), error: null };
  } } as Pick<RequestClient, "rpc">;
  const collected: string[] = []; let after: string | null = null;
  do {
    const page = await readTransferRegister(client, actor, { search: "QA & exact", after, limit: 50 });
    collected.push(...page.items.map(row => row.id));
    assert.ok(page.items.every(row => row.amount === "9007199254740993.17")); after = page.nextCursor;
  } while (after);
  assert.deepEqual(collected, records.map(row => row.id)); assert.equal(new Set(collected).size, 125);
  assert.equal(calls.length, 3); assert.ok(calls.every(call => call.p_limit === 51));
  assert.equal(calls[1]?.p_after, transferId(76));
});

test("transfer cursors, page limits and permissions are validated before querying", async () => {
  let queried = false;
  const client = { rpc: async () => { queried = true; return { data: [], error: null }; } } as Pick<RequestClient, "rpc">;
  for (const filters of [{ search: null, after: "bad-cursor", limit: 50 }, { search: null, after: null, limit: 101 }, { search: null, after: null, limit: 0 }]) {
    await assert.rejects(readTransferRegister(client, actor, filters));
  }
  await assert.rejects(readTransferRegister(client, { ...actor, capabilities: [] }, { search: null, after: null, limit: 50 }));
  assert.equal(queried, false);
  assert.deepEqual(await readTransferRegister(client, actor, { search: null, after: transferId(1), limit: 100 }), { items: [], nextCursor: null });
});

test("transfer pages reject cross-company data rather than displaying it", async () => {
  const client = { rpc: async () => ({ data: [{ ...transfer(1), organization_id: ledger }], error: null }) } as Pick<RequestClient, "rpc">;
  await assert.rejects(readTransferRegister(client, actor, { search: null, after: null, limit: 50 }), /Invalid transfer row/);
});

test("register navigation preserves active searches only where intended and clears stale cursors", () => {
  const base = `/o/${org}/banking/transfers`, search = "Bank & Wallet";
  const next = new URL(registerHref(base, { search, after: id }), "https://example.invalid");
  assert.equal(next.searchParams.get("search"), search); assert.equal(next.searchParams.get("after"), id);
  const first = new URL(registerHref(base, { search }), "https://example.invalid");
  assert.equal(first.searchParams.get("search"), search); assert.equal(first.searchParams.has("after"), false);
  assert.equal(registerHref(base), base);
  const billClear = new URL(registerHref(`/o/${org}/purchases/bills`, { tab: "posted" }), "https://example.invalid");
  assert.deepEqual([...billClear.searchParams], [["tab", "posted"]]);
});
