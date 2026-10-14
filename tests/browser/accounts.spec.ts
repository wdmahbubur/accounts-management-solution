import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { browserApi, localStack, openCompany } from "./support/local-auth.ts";

test("US-014 account management and mapping commands enforce chart rules", async ({ browser }) => {
  const stack = localStack();
  const owner = await stack.user("us014-browser-owner", "US014 Browser Owner");
  const companyName = `US014 Browser ${randomUUID().slice(0, 8)}`;
  const created = await owner.client.rpc("create_company_atomic", {
    p_name: companyName,
    p_legal_name: companyName,
    p_country_code: "BD",
    p_base_currency: "BDT",
    p_timezone: "Asia/Dhaka",
    p_fiscal_year_start_month: 1,
    p_books_start_date: "2026-01-01",
    p_idempotency_key: randomUUID()
  });
  expect(created.error).toBeNull();
  const organizationId = created.data[0].organization_id as string;
  const membership = await owner.client.rpc("resolve_active_membership", {
    p_organization_id: organizationId
  });
  expect(membership.error).toBeNull();
  expect(membership.data?.[0]?.capabilities).toContain("journal.write");

  const context = await browser.newContext();
  const page = await context.newPage();
  await openCompany(page, owner, companyName);
  await expect(page).toHaveURL(new RegExp(`/o/${organizationId}$`));
  await expect(page.getByRole("heading", { name: companyName, exact: true, level: 1 })).toBeVisible();
  await page.getByRole("navigation", { name: "Quick actions", exact: true })
    .getByRole("link", { name: "Chart of accounts", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${organizationId}/accounting/accounts$`));
  await expect(page.getByRole("heading", { name: "Chart of accounts", exact: true })).toBeVisible();

  const accountCode = `US14-${randomUUID().slice(0, 8)}`;
  const accountName = "US014 browser asset";
  await page.getByLabel("Code", { exact: true }).fill(accountCode);
  await page.getByLabel("Name", { exact: true }).fill(accountName);
  await page.getByLabel("Report group", { exact: true }).fill("other-assets");
  const accountSave = page.waitForResponse((response) =>
    response.url().endsWith(`/api/v1/organizations/${organizationId}/accounts`) &&
    response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  const savedAccount = await accountSave;
  expect(savedAccount.status()).toBe(200);

  let accountRow = page.getByRole("row").filter({ hasText: accountCode });
  await expect(accountRow).toContainText(accountName);
  await expect(accountRow).toContainText("Active");
  await accountRow.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("US014 edited browser asset");
  await page.getByRole("button", { name: "Save account", exact: true }).click();
  accountRow = page.getByRole("row").filter({ hasText: accountCode });
  await expect(accountRow).toContainText("US014 edited browser asset");

  const catalogResponse = await browserApi(page, `/api/v1/organizations/${organizationId}/accounts`);
  expect(catalogResponse.status).toBe(200);
  const catalog = catalogResponse.body.data as {
    accounts: Array<{ id: string; code: string; accountType: string; normalSide: string }>;
    mappings: Array<{ key: string; accountId: string; rowVersion: number }>;
  };
  const newAccount = catalog.accounts.find((account) => account.code === accountCode);
  const cashMapping = catalog.mappings.find((mapping) => mapping.key === "cash");
  const defaultCash = catalog.accounts.find((account) => account.id === cashMapping?.accountId);
  const liability = catalog.accounts.find((account) => account.accountType === "liability");
  expect(newAccount).toBeDefined();
  expect(cashMapping).toBeDefined();
  expect(defaultCash).toBeDefined();
  expect(liability).toBeDefined();

  const cashSelect = page.getByLabel("Cash", { exact: true });
  await cashSelect.selectOption(newAccount!.id);
  await cashSelect.locator("xpath=ancestor::form").getByRole("button", { name: "Save mapping", exact: true }).click();
  await expect(page.getByLabel("Cash", { exact: true })).toHaveValue(newAccount!.id);

  const invalidMapping = await browserApi(page, `/api/v1/organizations/${organizationId}/account-mappings`, {
    method: "POST",
    headers: { "X-Request-Id": `us014-invalid-${randomUUID()}` },
    data: { mapping_key: "cash", account_id: liability!.id, expected_version: cashMapping!.rowVersion + 1 }
  });
  expect(invalidMapping.status).toBe(422);
  expect(invalidMapping.body.error.fields.account).toContain("classification");

  const cashAfterReject = page.getByLabel("Cash", { exact: true });
  await cashAfterReject.selectOption(defaultCash!.id);
  await cashAfterReject.locator("xpath=ancestor::form").getByRole("button", { name: "Save mapping", exact: true }).click();
  await expect(page.getByLabel("Cash", { exact: true })).toHaveValue(defaultCash!.id);

  accountRow = page.getByRole("row").filter({ hasText: accountCode });
  await accountRow.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Active", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Save account", exact: true }).click();
  accountRow = page.getByRole("row").filter({ hasText: accountCode });
  await expect(accountRow).toContainText("Archived");

  await context.close();
});
