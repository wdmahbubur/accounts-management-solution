import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { browserApi, localStack, openCompany } from "./support/local-auth.ts";

test("US-082 finance components preserve exact Unicode values, modal focus and uncertain-action safety", async ({ page, context }, testInfo) => {
  await page.goto("/internal/ui-fixtures");
  await expect(page.getByRole("heading", { name: "UI test fixtures — synthetic only" })).toBeVisible();
  const amount = page.getByLabel("Amount", { exact: true });
  await expect(amount).toHaveValue("");
  await expect(amount).toHaveAttribute("type", "text");
  await expect(amount).toHaveAttribute("inputmode", "decimal");
  await amount.fill("1.001"); await amount.press("Tab");
  await expect(amount).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Enter a valid amount with exactly two decimal places.")).toBeVisible();
  await amount.fill("9007199254740993.17"); await amount.press("Tab");
  await expect(amount).toHaveAttribute("aria-invalid", "false");
  await expect(amount).toHaveValue("9007199254740993.17");
  await expect(page.getByText("৳9,007,199,254,740,993.17", { exact: true })).toBeVisible();
  const account = page.getByRole("combobox", { name: "Account", exact: true });
  await account.focus(); await account.press("ArrowDown"); await account.press("Enter");
  await expect(account).toHaveValue("bank");
  await page.getByRole("combobox", { name: "Party", exact: true }).selectOption("party");
  await expect(page.getByLabel("Description line 1", { exact: true })).toHaveValue("পরামর্শ সেবা");
  await page.getByLabel("Description line 1", { exact: true }).fill("বাংলা পরামর্শ — Unicode محفوظ");
  await page.getByLabel("To date", { exact: true }).fill("2025-12-31");
  await expect(page.getByLabel("To date", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("End date must not precede start date.")).toBeVisible();
  await page.getByLabel("To date", { exact: true }).fill("2026-01-31");
  await expect(page.getByLabel("Read-only amount", { exact: true })).toBeDisabled();
  const loading = page.getByRole("status").filter({ hasText: "Loading records" });
  await expect(loading).toHaveAttribute("aria-busy", "true"); await expect(loading).not.toContainText("0.00");
  await expect(page.getByRole("region", { name: "Posting preview", exact: true })).toContainText("Not posted");

  await context.setOffline(true);
  await expect(amount).toBeDisabled(); await expect(account).toBeDisabled();
  await expect(page.getByLabel("Quantity line 1", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Confirm fixture action", exact: true })).toBeDisabled();
  await context.setOffline(false); await expect(amount).toBeEnabled();

  const audit = page.getByRole("button", { name: "View audit history", exact: true });
  await audit.focus(); await audit.press("Enter");
  const auditDialog = page.getByRole("dialog", { name: "Audit history", exact: true });
  await expect(auditDialog).toBeVisible(); await expect(auditDialog).toContainText("Synthetic draft updated");
  await page.keyboard.press("Escape"); await expect(auditDialog).not.toBeVisible(); await expect(audit).toBeFocused();
  const trigger = page.getByRole("button", { name: "Confirm fixture action", exact: true });
  await trigger.focus(); await trigger.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Confirm synthetic action", exact: true });
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).evaluate((button) => {
    (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click();
  });
  await expect(page.getByText("Confirmed actions: 1", { exact: true })).toBeVisible();
  await expect(dialog).not.toBeVisible(); await expect(trigger).toBeDisabled();
  const uncertain = page.getByRole("button", { name: "Simulate uncertain response", exact: true });
  await uncertain.click();
  const failed = page.getByRole("dialog", { name: "Simulate a failure", exact: true });
  await failed.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(failed.getByRole("alert")).toContainText("same request key");
  await expect(failed.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape"); await expect(uncertain).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("us082-components-mobile.png"), fullPage: true });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("US-082 real company shell, role-sensitive navigation, switching and session loss", async ({ browser }, testInfo) => {
  const stack = localStack(); const owner = await stack.user("us082-shell-owner", "Shell Owner");
  const reader = await stack.user("us082-shell-reader", "Shell Reader");
  const makeCompany = async (name: string) => {
    const result = await owner.client.rpc("create_company_atomic", {
      p_name: name, p_legal_name: name, p_country_code: "BD", p_base_currency: "BDT", p_timezone: "Asia/Dhaka",
      p_fiscal_year_start_month: 1, p_books_start_date: "2026-01-01", p_idempotency_key: randomUUID()
    });
    expect(result.error).toBeNull(); const id = result.data[0].organization_id as string;
    expect(id).toMatch(/^[a-f0-9-]{36}$/i); return id;
  };
  const first = await makeCompany("বাংলা সেবা কোম্পানি"), second = await makeCompany("Second Shell Company");
  const readerMember = randomUUID();
  stack.sql(`insert into finance.organization_members(id,organization_id,user_id,display_name_snapshot) values('${readerMember}','${first}','${reader.id}','Shell Reader');
    insert into finance.member_roles(organization_id,member_id,role_id) select '${first}','${readerMember}',id from finance.roles where organization_id='${first}' and template_key='billing';`);
  const context = await browser.newContext(); const page = await context.newPage();
  await openCompany(page, owner, "বাংলা সেবা কোম্পানি");
  const sidebar = page.getByRole("complementary", { name: "Workspace sidebar" });
  await expect(sidebar).toContainText("বাংলা সেবা কোম্পানি");
  await expect(sidebar).not.toContainText("Second Shell Company");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("বাংলা সেবা কোম্পানি");
  await expect(page.getByRole("link", { name: "Manage users", exact: true })).toBeVisible();
  await page.keyboard.press("Tab");
  await page.getByRole("link", { name: "Skip to workspace content" }).focus();
  await page.keyboard.press("Enter"); await expect(page.locator("#workspace-content")).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("us082-shell-desktop.png"), fullPage: true });
  await context.setOffline(true); await expect(page.getByText("You are offline", { exact: true })).toBeVisible();
  await context.setOffline(false); await expect(page.getByText("You are offline", { exact: true })).not.toBeVisible();
  await page.getByRole("link", { name: "Change workspace", exact: true }).click();
  await page.getByRole("button", { name: "Open Second Shell Company", exact: true }).click();
  await expect(sidebar).toContainText("Second Shell Company"); await expect(sidebar).not.toContainText("বাংলা সেবা কোম্পানি");
  stack.sql(`update finance.organizations set status='read_only' where id='${second}';`);
  await page.reload(); await expect(page.getByText("This company is read-only", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("us082-shell-mobile.png"), fullPage: true });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // A lost session is checked on the next protected server navigation; no
  // persistent shell or client cache substitutes for live server authorization.
  await context.clearCookies(); await page.goto(`/o/${second}`);
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  await expect(page.getByText("Second Shell Company", { exact: true })).not.toBeVisible();
  const readerContext = await browser.newContext(); const readerPage = await readerContext.newPage();
  await openCompany(readerPage, reader, "বাংলা সেবা কোম্পানি");
  await expect(readerPage.getByRole("link", { name: "Manage users", exact: true })).not.toBeVisible();
  const forced = await browserApi(readerPage, `/api/v1/organizations/${first}/roles`);
  expect(forced.status).toBe(403);
  await readerContext.close(); await context.close();
});
