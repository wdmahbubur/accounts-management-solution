import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { parseSettings, settingsInput } from "../../apps/web/server/settings/contracts.ts";
import { companySettingsCommand, readCompanySettings, settingsDatabaseError } from "../../apps/web/server/settings/service.ts";
import { executeOrganizationCommand } from "../../apps/web/server/commands/execute.ts";
import { defaultRequestDependencies } from "../../apps/web/server/commands/request-context.ts";
const org = parseOrganizationId("12000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const otherOrg = parseOrganizationId("12000000-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const user = parseUuid("12000000-1111-4111-8111-111111111111"), member = parseUuid("12000000-aaaa-4aaa-8aaa-000000000001");
const input = { expected_version: 1, changes: { name: "  বাংলা কোম্পানি  ", address: { city: "Dhaka" }, contact_email: "BOSS@Example.invalid" }, reason: "Approved profile correction" };
const row = { organization_id: org, name: "Example", legal_name: "Example Ltd", country_code: "BD", base_currency: "BDT", timezone: "Asia/Dhaka",
  books_start_date: "2026-04-01", fiscal_year_start_month: 1, address: { line1: "", line2: "", city: "Dhaka", postal_code: "", legacy_secret: "do not serialize" },
  contact_email: "", contact_phone: "", settings_version: 1, foundation_locked: false,
  calendar: [{ label: "Opening", kind: "opening", starts_on: "2026-03-31", ends_on: "2026-03-31", status: "open", internal_field: "private" }] };
test("settings normalize approved profile values and preserve partial address semantics", () => {
  const result = settingsInput(input);
  assert.deepEqual(result, { expectedVersion: 1, changes: { name: "বাংলা কোম্পানি", contact_email: "boss@example.invalid", address: { city: "Dhaka" } }, reason: input.reason });
  assert.deepEqual(settingsInput({ ...input, changes: {} }).changes, {});
});
for (const [name, changes] of Object.entries({
  emptyName: { name: "  " }, longName: { name: "x".repeat(161) }, wrongType: { legal_name: 2 }, unknown: { arbitrary: true },
  nullAddress: { address: null }, arrayAddress: { address: [] }, secretAddress: { address: { private_key: "secret" } },
  longAddress: { address: { line1: "x".repeat(241) } }, wrongAddress: { address: { city: 2 } },
  foreignCurrency: { base_currency: "USD" }, invalidCountry: { country_code: "Bangladesh" }, lowerCountry: { country_code: "bd" },
  invalidTimezone: { timezone: "Imaginary/Zone" }, nonfiniteDate: { books_start_date: "infinity" }, impossibleDate: { books_start_date: "2026-02-30" },
  shortDate: { books_start_date: "2026-2-01" }, lowDate: { books_start_date: "1900-01-01" }, highDate: { books_start_date: "9999-01-01" },
  zeroMonth: { fiscal_year_start_month: 0 }, textMonth: { fiscal_year_start_month: "1" }, fractionalMonth: { fiscal_year_start_month: 1.5 },
  bigMonth: { fiscal_year_start_month: 13 }, nullMonth: { fiscal_year_start_month: null },
  badEmail: { contact_email: "nope" }, injectedPhone: { contact_phone: "123\r\nHeader" }, nul: { name: "A\0B" }
})) test(`settings reject ${name}`, () => { assert.throws(() => settingsInput({ ...input, changes })); });
test("settings require a bounded optimistic version and reason; no caller authority", () => {
  for (const expected_version of [null, "1", 0, -1, NaN, Infinity, 2147483648]) assert.throws(() => settingsInput({ ...input, expected_version }));
  for (const reason of [null, "", "a", "x".repeat(501)]) assert.throws(() => settingsInput({ ...input, reason }));
  assert.throws(() => settingsInput({ ...input, actor_id: user }));
  assert.throws(() => settingsInput({ ...input, changes: { organization_id: org } }));
  assert.equal(settingsInput({ ...input, changes: { books_start_date: "2024-02-29", fiscal_year_start_month: 12 } }).changes.books_start_date, "2024-02-29");
});
test("settings DTO is explicitly tenant-bound and projects only public fields", () => {
  const projected = parseSettings({ ...row, raw_audit: "secret" }, org);
  assert.equal(projected.organizationId, org); assert.equal(projected.calendar.length, 1);
  assert.doesNotMatch(JSON.stringify(projected), /secret|legacy_secret|internal_field|raw_audit/);
  assert.throws(() => parseSettings(row, otherOrg));
  assert.throws(() => parseSettings({ ...row, calendar: [{ ...row.calendar[0], starts_on: "2026-04-30", ends_on: "2026-04-01" }] }, org));
  assert.throws(() => parseSettings({ ...row, foundation_locked: "false" }, org));
});
function fixture(capabilities = ["company.read", "company.update"], error: { code: string } | null = null) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args }); return { data: name === "read_company_settings" ? row : 2, error };
  } } as unknown as Pick<SupabaseClient, "rpc">;
  const actor = { userId: user, memberId: member, organizationId: org, capabilities };
  return { client, calls, actor, dependencies: { ...defaultRequestDependencies,
    identityVerifier: { verifyIdentity: async () => ({ userId: user }) },
    membershipResolver: { resolveActiveMembership: async () => ({ memberId: member, organizationId: org, capabilities }) } } };
}
test("settings command derives company/actor authority and passes version and reason to SQL", async () => {
  const f = fixture();
  const result = await executeOrganizationCommand({ definition: companySettingsCommand(f.client), organizationId: org,
    rawInput: input, headers: new Headers({ "x-request-id": "req_settings_unit" }), dependencies: f.dependencies });
  assert.equal(result.status, 200); assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0], { name: "update_company_settings", args: { p_organization_id: org, p_expected_version: 1,
    p_changes: settingsInput(input).changes, p_reason: input.reason, p_request_id: "req_settings_unit" } });
});
test("read-only, removed and unverified callers cannot mutate; current read scope is checked", async () => {
  const f = fixture(["company.read"]);
  assert.equal((await readCompanySettings(f.client, f.actor)).name, "Example");
  f.calls.length = 0;
  const request = { definition: companySettingsCommand(f.client), organizationId: org, rawInput: input, headers: new Headers(), dependencies: f.dependencies };
  assert.equal((await executeOrganizationCommand(request)).status, 403);
  assert.equal((await executeOrganizationCommand({ ...request, dependencies: { ...f.dependencies, membershipResolver: { resolveActiveMembership: async () => null } } })).status, 404);
  assert.equal((await executeOrganizationCommand({ ...request, dependencies: { ...f.dependencies, identityVerifier: { verifyIdentity: async () => null } } })).status, 401);
  await assert.rejects(() => readCompanySettings(f.client, { ...f.actor, capabilities: [] }));
  assert.equal(f.calls.length, 0);
});
test("settings stale version and foundation lock are not reported as successful saves", async () => {
  for (const [code, expected] of [["P0409", "STALE_VERSION"], ["P0412", "PERIOD_LOCKED"]]) {
    const f = fixture(undefined, { code: code! });
    const result = await executeOrganizationCommand({ definition: companySettingsCommand(f.client), organizationId: org,
      rawInput: input, headers: new Headers(), dependencies: f.dependencies });
    assert.equal(result.status, 409); assert.ok("error" in result.body && result.body.error.code === expected);
  }
});
test("settings database error mapping never exposes internal SQL details", () => {
  for (const [code, status] of [["P0409",409],["P0412",409],["42501",403],["28000",401],["P0002",404],["22023",422],["23P01",422],["XX000",500]] as const)
    assert.equal(settingsDatabaseError({ code }).status, status);
});
