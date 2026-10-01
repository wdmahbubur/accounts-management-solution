import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

function localStatus() {
  return JSON.parse(
    execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" })
  );
}

function pick(status: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = status[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  throw new Error(`Missing Supabase status key: ${keys.join(", ")}`);
}

test("verified user completes atomic company onboarding wizard", async ({ page }) => {
  const status = localStatus();
  const url = pick(status, "API_URL", "api_url", "PROJECT_URL", "project_url");
  const secret = pick(
    status,
    "SECRET_KEY",
    "secret_key",
    "SERVICE_ROLE_KEY",
    "service_role_key"
  );

  const admin = createClient(url, secret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });

  const email = "us007-browser@example.invalid";
  const password = "SecureOnboard123";

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: "US007 Browser Owner" }
  });
  expect(created.error).toBeNull();

  await page.goto("/auth/sign-in?next=/onboarding/company");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/onboarding\/company/);
  await expect(page.getByRole("heading", { name: "Start your books" })).toBeVisible();

  await page.getByLabel("Display name").fill("US007 Browser Company");
  await page.getByLabel("Legal name").fill("US007 Browser Company Limited");
  await page.getByLabel("Country code").fill("BD");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Fiscal calendar" })).toBeVisible();
  await page.getByLabel("Timezone").fill("Asia/Dhaka");
  await page.getByLabel("Fiscal year starts in").selectOption("1");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Books and starter accounts" })).toBeVisible();
  await page.getByLabel("Books start date").fill("2026-04-01");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Roles, cash and tax setup" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Review and create" })).toBeVisible();
  await page.getByRole("button", { name: "Create company" }).click();

  await expect(page).toHaveURL(/status=created/);
  await expect(page.getByRole("heading", { name: "Company setup created" })).toBeVisible();
  await expect(page.getByText("committed atomically")).toBeVisible();
});
