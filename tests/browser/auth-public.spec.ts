import { expect, test } from "@playwright/test";

test("auth routes expose focused enumeration-safe forms", async ({ page }) => {
  await page.goto("/auth/sign-in?error=invalid_credentials&next=https://evil.example/path");

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(
    page.getByRole("alert").filter({
      hasText: "Email or password is incorrect, or the account is not verified."
    })
  ).toBeVisible();
  await expect(page.locator('input[name="next"]')).toHaveValue("/");

  await page.goto("/auth/sign-up?status=verification_requested");
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "If this email can receive account messages"
  );

  await page.goto("/auth/recover?status=recovery_requested");
  await expect(page.getByRole("heading", { name: "Reset password" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "If an account can receive recovery email"
  );
});
