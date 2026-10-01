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

test("S-15 company switching invalidates the prior tenant shell and lists only active memberships", async ({
  browser
}) => {
  const status = localStatus();
  const url = pick(status, "API_URL", "api_url", "PROJECT_URL", "project_url");
  const publishable = pick(
    status,
    "PUBLISHABLE_KEY",
    "publishable_key",
    "ANON_KEY",
    "anon_key"
  );
  const secret = pick(
    status,
    "SECRET_KEY",
    "secret_key",
    "SERVICE_ROLE_KEY",
    "service_role_key"
  );
  const dbUrl =
    (typeof status.DB_URL === "string" && status.DB_URL) ||
    (typeof status.db_url === "string" && status.db_url) ||
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const email = "us008-browser@example.invalid";
  const password = "SecureSwitch123";
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: "US008 Browser User" }
  });
  expect(created.error).toBeNull();

  const userClient = createClient(url, publishable, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const signedIn = await userClient.auth.signInWithPassword({ email, password });
  expect(signedIn.error).toBeNull();

  const createA = await userClient.rpc("create_company_atomic", {
    p_name: "US008 Browser A",
    p_legal_name: "US008 Browser A Limited",
    p_country_code: "BD",
    p_base_currency: "BDT",
    p_timezone: "Asia/Dhaka",
    p_fiscal_year_start_month: 1,
    p_books_start_date: "2026-04-01",
    p_idempotency_key: "us008_browser_a_0123456789"
  });
  const createB = await userClient.rpc("create_company_atomic", {
    p_name: "US008 Browser B",
    p_legal_name: "US008 Browser B Limited",
    p_country_code: "BD",
    p_base_currency: "BDT",
    p_timezone: "Asia/Dhaka",
    p_fiscal_year_start_month: 1,
    p_books_start_date: "2026-04-01",
    p_idempotency_key: "us008_browser_b_0123456789"
  });

  expect(createA.error).toBeNull();
  expect(createB.error).toBeNull();
  const orgA = createA.data?.[0]?.organization_id as string;
  const orgB = createB.data?.[0]?.organization_id as string;
  expect(orgA).toMatch(/^[0-9a-f-]{36}$/i);
  expect(orgB).toMatch(/^[0-9a-f-]{36}$/i);

  const context = await browser.newContext();
  const pageA = await context.newPage();

  await pageA.goto("http://127.0.0.1:3000/auth/sign-in?next=/companies");
  await pageA.getByLabel("Email").fill(email);
  await pageA.getByLabel("Password").fill(password);
  await pageA.getByRole("button", { name: "Sign in" }).click();

  await expect(pageA).toHaveURL(/\/companies/);
  await expect(pageA.getByRole("heading", { name: "Your companies" })).toBeVisible();
  await expect(pageA.getByText("US008 Browser A", { exact: true })).toBeVisible();
  await expect(pageA.getByText("US008 Browser B", { exact: true })).toBeVisible();

  await pageA.getByRole("button", { name: "Open US008 Browser A" }).click();
  await expect(pageA).toHaveURL(new RegExp(`/o/${orgA}$`));
  await expect(pageA.getByRole("heading", { name: "US008 Browser A" })).toBeVisible();

  const pageB = await context.newPage();
  await pageB.goto("http://127.0.0.1:3000/companies");
  await expect(pageB.getByText("Current", { exact: true })).toBeVisible();
  await pageB.getByRole("button", { name: "Open US008 Browser B" }).click();
  await expect(pageB).toHaveURL(new RegExp(`/o/${orgB}$`));
  await expect(pageB.getByRole("heading", { name: "US008 Browser B" })).toBeVisible();

  await pageA.reload();
  await expect(pageA).toHaveURL(/\/companies\?error=context_mismatch/);
  await expect(
    pageA.getByText("Your active company changed. Open the company again before continuing.")
  ).toBeVisible();

  const userId = created.data.user?.id;
  expect(userId).toBeTruthy();

  execFileSync("psql", [
    dbUrl,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `update finance.organization_members set status='inactive' where user_id='${userId}' and organization_id='${orgB}';`
  ]);

  await pageB.goto("http://127.0.0.1:3000/companies");
  await expect(pageB.getByText("US008 Browser A", { exact: true })).toBeVisible();
  await expect(pageB.getByText("US008 Browser B", { exact: true })).toHaveCount(0);

  await context.close();
});
