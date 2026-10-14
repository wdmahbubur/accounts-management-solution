import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { browserApi, companyNonce, localStack, openCompany } from "./support/local-auth.ts";

test("US-012 company settings, stale edits, tenant context, immutable foundation and live read permissions", async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const stack = localStack();
  const owner = await stack.user("us012-browser-owner", "Settings Owner");
  const reader = await stack.user("us012-browser-reader", "Settings Reader");
  const createCompany = async (name: string, key: string) => {
    const result = await owner.client.rpc("create_company_atomic", { p_name: name, p_legal_name: name, p_country_code: "BD",
      p_base_currency: "BDT", p_timezone: "Asia/Dhaka", p_fiscal_year_start_month: 1, p_books_start_date: "2026-04-01", p_idempotency_key: key });
    expect(result.error).toBeNull(); const id = result.data[0].organization_id as string; expect(id).toMatch(/^[0-9a-f-]{36}$/i); return id;
  };
  const org = await createCompany("Settings Company", "us012_browser_company_a_0123456789");
  const otherOrg = await createCompany("Other Settings Company", "us012_browser_company_b_0123456789");
  const ownerMember = stack.sql(`select id from finance.organization_members where organization_id='${org}' and user_id='${owner.id}';`);
  const readerRole = await owner.client.rpc("create_custom_role", { p_organization_id: org, p_name: "Profile reader", p_permission_codes: ["company.read"], p_request_id: "req_us012_reader" });
  expect(readerRole.error).toBeNull();
  const readerMember = stack.sql(`insert into finance.organization_members(organization_id,user_id,display_name_snapshot) values('${org}','${reader.id}','Settings Reader') returning id;`);
  const assigned = await owner.client.rpc("set_member_roles", { p_organization_id: org, p_member_id: readerMember, p_role_ids: [readerRole.data], p_request_id: "req_us012_assign" });
  expect(assigned.error).toBeNull();
  const ctx = await browser.newContext(), page = await ctx.newPage();
  await openCompany(page, owner, "Settings Company");
  await page.getByRole("navigation", { name: "Workspace navigation", exact: true }).getByRole("link", { name: "Company settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Company settings", exact: true })).toBeVisible();
  const form = page.getByRole("form", { name: "Company settings", exact: true });
  await form.getByLabel("Legal name", { exact: true }).fill("বাংলা সেবা Limited");
  await form.getByLabel("Contact email", { exact: true }).fill("BOSS@Example.invalid");
  await form.getByLabel("Address line 1", { exact: true }).fill("Synthetic test address");
  await form.getByLabel("City", { exact: true }).fill("Dhaka");
  await form.getByLabel("Reason for change", { exact: true }).fill("Approved legal and contact update");
  await form.getByRole("button", { name: "Save company settings", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Company settings saved");
  await expect.poll(() => stack.sql(`select legal_name||'|'||contact_email from finance.organizations where id='${org}';`)).toBe("বাংলা সেবা Limited|boss@example.invalid");
  const api = `/api/v1/organizations/${org}/settings`;
  const initial = await browserApi(page, api); expect(initial.status).toBe(200); expect(initial.body.data.settingsVersion).toBe(2);
  const staleTab = await ctx.newPage(); await staleTab.goto(`/o/${org}/settings/company`);
  await expect(staleTab.getByLabel("Books start date", { exact: true })).toHaveValue("2026-04-01");
  await form.getByLabel("Books start date", { exact: true }).fill("2026-05-15");
  await form.getByLabel("Fiscal year starts in", { exact: true }).selectOption("7");
  await form.getByLabel("Reason for change", { exact: true }).fill("Approved unused calendar correction");
  await form.getByRole("button", { name: "Save company settings", exact: true }).click();
  await expect.poll(() => stack.sql(`select settings_version from finance.organizations where id='${org}';`)).toBe("3");
  await expect(page.getByRole("table")).toContainText("2026-05-14");
  const staleForm = staleTab.getByRole("form", { name: "Company settings", exact: true });
  await staleForm.getByLabel("Legal name", { exact: true }).fill("Stale overwrite");
  await staleForm.getByLabel("Reason for change", { exact: true }).fill("Stale tab test");
  await staleForm.getByRole("button", { name: "Save company settings", exact: true }).click();
  await expect(staleForm.getByRole("alert")).toContainText("Settings changed");
  expect(stack.sql(`select legal_name from finance.organizations where id='${org}';`)).toBe("বাংলা সেবা Limited");
  const headers = { "x-company-context": await companyNonce(page) };
  for (const changes of [{ base_currency: "USD" }, { books_start_date: "2026-02-30" }, { actor_id: reader.id }]) {
    expect((await browserApi(page, api, { method: "PATCH", headers, data: { expected_version: 3, changes, reason: "Invalid data test" } })).status).toBe(422);
  }
  await page.screenshot({ path: testInfo.outputPath("us012-settings-desktop.png"), fullPage: true });

  // Verify the accounting foundation before switching this shared browser
  // context to another company. An old tab must stay stale after that switch.
  const sourceId = randomUUID();
  stack.sql(`insert into finance.business_documents(id,organization_id,document_type,issue_date,accounting_date,total_amount,created_by_member_id)
    values('${sourceId}','${org}','invoice','2026-05-15','2026-05-15',123.45,'${ownerMember}');`);
  await page.reload();
  await expect(form.getByLabel("Books start date", { exact: true })).toBeDisabled();
  await expect(form.getByLabel("Fiscal year starts in", { exact: true })).toBeDisabled();
  await expect(form.getByText(/Accounting setup is locked/)).toBeVisible();
  expect((await browserApi(page, api, { method: "PATCH", headers: { "x-company-context": await companyNonce(page) }, data: { expected_version: 4, changes: { books_start_date: "2026-06-01" }, reason: "Cannot rewrite books" } })).status).toBe(409);
  await form.getByLabel("Timezone", { exact: true }).fill("Asia/Kuala_Lumpur");
  await form.getByLabel("Reason for change", { exact: true }).fill("Update display timezone only");
  await form.getByRole("button", { name: "Save company settings", exact: true }).click();
  await expect.poll(() => stack.sql(`select settings_version from finance.organizations where id='${org}';`)).toBe("5");
  expect(stack.sql(`select total_amount::text||'|'||accounting_date::text from finance.business_documents where id='${sourceId}';`)).toBe("123.45|2026-05-15");
  expect(stack.sql(`select count(*) from finance.audit_events where organization_id='${org}' and action='company.settings_updated' and actor_member_id='${ownerMember}' and reason is not null;`)).toBe("3");
  expect(stack.sql(`select count(*) from finance.audit_events where organization_id='${org}' and redacted_change::text like '%boss@example.invalid%';`)).toBe("0");

  const oldNonce = await companyNonce(page);
  const switcher = await ctx.newPage(); await switcher.goto("/companies");
  await switcher.getByRole("button", { name: "Open Other Settings Company", exact: true }).click();
  await expect(switcher).toHaveURL(new RegExp(`/o/${otherOrg}$`));
  expect((await browserApi(page, api, { method: "PATCH", headers: { "x-company-context": oldNonce }, data: { expected_version: 5, changes: { name: "Wrong tenant" }, reason: "Stale context test" } })).status).toBe(409);
  await ctx.setOffline(true);
  await expect(form.getByRole("button", { name: "Save company settings", exact: true })).toBeDisabled();
  await ctx.setOffline(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("us012-settings-mobile.png"), fullPage: true });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const readCtx = await browser.newContext(), readPage = await readCtx.newPage();
  await openCompany(readPage, reader, "Settings Company"); await readPage.goto(`/o/${org}/settings/company`);
  await expect(readPage.getByText(/Read-only access. You need company.update/)).toBeVisible();
  expect((await browserApi(readPage, api)).status).toBe(200);
  expect((await browserApi(readPage, `/api/v1/organizations/${otherOrg}/settings`)).status).toBe(404);
  expect((await browserApi(readPage, api, { method: "PATCH", headers: { "x-company-context": await companyNonce(readPage) }, data: { expected_version: 5, changes: { name: "Forbidden update" }, reason: "No update permission" } })).status).toBe(403);
  const removed = await owner.client.rpc("deactivate_member", { p_organization_id: org, p_member_id: readerMember, p_request_id: "req_us012_remove_reader" });
  expect(removed.error).toBeNull(); expect((await browserApi(readPage, api)).status).toBe(404);
  await readCtx.close(); await ctx.close();
});
