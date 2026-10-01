import { expect, test } from "@playwright/test";
import { browserApi, companyNonce, localStack, openCompany } from "./support/local-auth.ts";

test("US-009 real users/roles forms, API denial, stale context, transfer and live revocation", async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const stack = localStack();
  const owner = await stack.user("us009-browser-owner", "Role Owner");
  const worker = await stack.user("us009-browser-worker", "Role Worker");
  const company = async (name: string, key: string) => {
    const result = await owner.client.rpc("create_company_atomic", {
      p_name: name, p_legal_name: name, p_country_code: "BD", p_base_currency: "BDT", p_timezone: "Asia/Dhaka",
      p_fiscal_year_start_month: 1, p_books_start_date: "2026-04-01", p_idempotency_key: key
    });
    expect(result.error).toBeNull();
    const id = result.data?.[0]?.organization_id as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/i); return id;
  };
  const org = await company("Role Test Company", "us009_browser_company_a_0123456789");
  const otherOrg = await company("Role Other Company", "us009_browser_company_b_0123456789");
  // Fixture membership only; invitation acceptance is the separately tracked US-010.
  const workerMember = stack.sql(`insert into finance.organization_members(organization_id,user_id,display_name_snapshot)
    values ('${org}','${worker.id}','Role Worker') returning id;`);
  expect(workerMember).toMatch(/^[0-9a-f-]{36}$/i);
  const ownerMember = stack.sql(`select id from finance.organization_members where organization_id='${org}' and user_id='${owner.id}';`);
  const ownerRole = stack.sql(`select id from finance.roles where organization_id='${org}' and template_key='owner';`);

  const ownerContext = await browser.newContext();
  const page = await ownerContext.newPage();
  await openCompany(page, owner, "Role Test Company");
  await page.getByRole("link", { name: "Roles", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Roles and capabilities" })).toBeVisible();
  const createForm = page.getByRole("form", { name: "Create role", exact: true });
  await createForm.getByLabel("Role name", { exact: true }).fill("Invoice observer");
  await createForm.getByLabel("sales.read", { exact: true }).check();
  await createForm.getByRole("button", { name: "Create role", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Invoice observer", exact: true })).toBeVisible();
  const roleCard = page.locator("article").filter({ has: page.getByRole("heading", { name: "Invoice observer", exact: true }) });
  await roleCard.getByText("Edit Invoice observer", { exact: true }).click();
  const edit = roleCard.getByRole("form");
  await edit.getByLabel("Role name", { exact: true }).fill("Invoice reviewer");
  await edit.getByLabel("sales.write", { exact: true }).check();
  await edit.getByRole("button", { name: "Save Invoice observer", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Invoice reviewer", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("us009-roles-desktop.png"), fullPage: true });

  const allowed = await browserApi(page, `/api/v1/organizations/${org}/roles`);
  expect(allowed.status).toBe(200);
  expect(allowed.body.data.some((role: { name: string }) => role.name === "Invoice reviewer")).toBe(true);
  const oldNonce = await companyNonce(page);
  const tab = await ownerContext.newPage();
  await tab.goto("/companies");
  await tab.getByRole("button", { name: "Open Role Other Company", exact: true }).click();
  await expect(tab).toHaveURL(new RegExp(`/o/${otherOrg}$`));
  const stale = await browserApi(page, `/api/v1/organizations/${org}/roles`, { method: "POST",
    headers: { "x-company-context": oldNonce }, data: { name: "Stale role", permission_codes: ["sales.read"] }
  });
  expect(stale.status).toBe(409);
  expect((stale.body).error.code).toBe("STALE_VERSION");
  expect(stack.sql(`select count(*) from finance.roles where organization_id='${org}' and name='Stale role';`)).toBe("0");
  await page.goto("/companies");
  await page.getByRole("button", { name: "Open Role Test Company", exact: true }).click();
  await page.getByRole("link", { name: "Users", exact: true }).click();
  const workerCard = () => page.locator("article").filter({ has: page.getByRole("heading", { name: "Role Worker", exact: true }) });
  const assignment = () => workerCard().getByRole("form", { name: "Save roles for Role Worker", exact: true });
  await assignment().getByLabel("Admin", { exact: true }).check();
  await assignment().getByRole("button", { name: "Save roles for Role Worker", exact: true }).click();
  await expect(workerCard().getByText("Admin", { exact: true }).first()).toBeVisible();
  await expect.poll(() => stack.sql(`select count(*) from finance.member_roles mr join finance.roles r on r.id=mr.role_id
    where mr.member_id='${workerMember}' and r.template_key='admin';`)).toBe("1");

  const workerContext = await browser.newContext();
  const adminPage = await workerContext.newPage();
  await openCompany(adminPage, worker, "Role Test Company");
  await adminPage.getByRole("link", { name: "Roles", exact: true }).click();
  await expect(adminPage.getByRole("form", { name: "Create role", exact: true }).getByLabel("reports.read", { exact: true })).toBeDisabled();
  const adminHeaders = { "x-company-context": await companyNonce(adminPage) };
  const overGrant = await browserApi(adminPage, `/api/v1/organizations/${org}/roles`, { method: "POST",
    headers: adminHeaders, data: { name: "Escalated reports", permission_codes: ["reports.read"] }
  });
  expect(overGrant.status).toBe(403);
  const selfGrant = await browserApi(adminPage, `/api/v1/organizations/${org}/members/${workerMember}/roles`, { method: "PUT",
    headers: adminHeaders, data: { role_ids: [ownerRole] }
  });
  expect(selfGrant.status).toBe(403);
  const forged = await browserApi(adminPage, `/api/v1/organizations/${org}/roles`, { method: "POST",
    headers: adminHeaders, data: { name: "Forged", permission_codes: [], actor_id: owner.id }
  });
  expect(forged.status).toBe(422);

  // An existing Admin session loses capability immediately when assigned Billing.
  await assignment().getByLabel("Admin", { exact: true }).uncheck();
  await assignment().getByLabel("Billing", { exact: true }).check();
  await assignment().getByRole("button", { name: "Save roles for Role Worker", exact: true }).click();
  await expect(workerCard().getByText("Billing", { exact: true }).first()).toBeVisible();
  await expect.poll(() => stack.sql(`select count(*) from finance.member_roles mr join finance.roles r on r.id=mr.role_id
    where mr.member_id='${workerMember}' and r.template_key='billing';`)).toBe("1");
  await adminPage.reload();
  await expect(adminPage.getByRole("heading", { name: "Access denied", exact: true })).toBeVisible();
  const denied = await browserApi(adminPage, `/api/v1/organizations/${org}/members`);
  expect(denied.status).toBe(403);
  expect(JSON.stringify(denied.body)).not.toContain("Role Owner");

  const transfer = page.getByRole("form", { name: "Transfer ownership", exact: true });
  await transfer.getByLabel("New owner", { exact: true }).selectOption(workerMember);
  await transfer.getByLabel("I understand my Owner access will be removed.", { exact: true }).check();
  await transfer.getByRole("button", { name: "Transfer ownership", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Access denied", exact: true })).toBeVisible();
  expect(stack.sql(`select count(*) from finance.member_roles where member_id='${ownerMember}' and role_id='${ownerRole}';`)).toBe("0");
  await adminPage.goto(`/o/${org}/settings/users`);
  await expect(adminPage.getByRole("heading", { name: "Users and access", exact: true })).toBeVisible();
  const oldOwnerCard = adminPage.locator("article").filter({ has: adminPage.getByRole("heading", { name: "Role Owner", exact: true }) });
  await oldOwnerCard.getByText("Remove Role Owner's access", { exact: true }).click();
  const remove = oldOwnerCard.getByRole("form", { name: "Deactivate Role Owner", exact: true });
  await remove.getByLabel("I understand this removes company access immediately and keeps the audit identity.", { exact: true }).check();
  await remove.getByRole("button", { name: "Deactivate Role Owner", exact: true }).click();
  await expect(oldOwnerCard.getByText("Inactive", { exact: true })).toBeVisible();
  const removed = await browserApi(page, `/api/v1/organizations/${org}/members`);
  expect(removed.status).toBe(404);
  await adminPage.setViewportSize({ width: 390, height: 844 });
  await adminPage.screenshot({ path: testInfo.outputPath("us009-users-mobile.png"), fullPage: true });
  await expect.poll(() => adminPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await ownerContext.close(); await workerContext.close();
});
