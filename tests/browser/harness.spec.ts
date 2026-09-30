import { expect, test } from "@playwright/test";

test("browser harness loads the real Next.js application shell", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Accounts Management Solution");
  await expect(
    page.getByRole("heading", { name: "Accounts Management Solution" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Modular boundaries" })
  ).toBeVisible();
});
