import { expect, test } from "@playwright/test";

test("unauthenticated company onboarding returns to verified sign-in", async ({ page }) => {
  await page.goto("/onboarding/company");
  await expect(page).toHaveURL(/\/auth\/sign-in\?next=%2Fonboarding%2Fcompany|\/auth\/sign-in\?next=\/onboarding\/company/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
