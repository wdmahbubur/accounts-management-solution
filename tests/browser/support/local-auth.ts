import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";

export function localStack() {
  const status: Record<string, unknown> = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" }));
  const pick = (...keys: string[]) => {
    for (const key of keys) if (typeof status[key] === "string" && status[key]) return status[key] as string;
    throw new Error(`Missing local test configuration: ${keys.join(",")}`);
  };
  const url = pick("API_URL", "api_url", "PROJECT_URL", "project_url");
  const dbUrl = pick("DB_URL", "db_url");
  for (const target of [url, dbUrl]) {
    if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(target).hostname)) {
      throw new Error("Browser fixtures must never run against a hosted project.");
    }
  }
  const settings = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const admin = createClient(url, pick("SECRET_KEY", "secret_key", "SERVICE_ROLE_KEY", "service_role_key"), settings);
  const publicKey = pick("PUBLISHABLE_KEY", "publishable_key", "ANON_KEY", "anon_key");
  return {
    async uploadPrivateFixture(key: string, contents: string) {
      const result = await admin.storage.from("ams-private-artifacts").upload(key, Buffer.from(contents), {
        contentType: "application/octet-stream", cacheControl: "0", upsert: false
      });
      if (result.error) throw new Error(`Could not upload synthetic private fixture: ${result.error.message}`);
    },
    publicArtifactUrl: (key: string) => `${url}/storage/v1/object/public/ams-private-artifacts/${key}`,
    sql: (statement: string) => execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-qAtc", statement], { encoding: "utf8" }).trim(),
    async user(prefix: string, displayName: string) {
      const email = `${prefix}@example.invalid`;
      const password = "LocalBrowserTest123!";
      const result = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: displayName } });
      if (result.error || !result.data.user) throw new Error("Could not create isolated test identity.");
      expect(result.data.user.id).toMatch(/^[0-9a-f-]{36}$/i);
      const client = createClient(url, publicKey, settings);
      const signed = await client.auth.signInWithPassword({ email, password });
      expect(signed.error).toBeNull();
      // Metadata is not the company's immutable audit-name snapshot. Set the
      // actual own profile through the ordinary authenticated application RPC.
      const profile = await client.rpc("update_own_profile", {
        p_display_name: displayName, p_locale: "en-BD", p_timezone: "Asia/Dhaka"
      });
      expect(profile.error).toBeNull();
      return { id: result.data.user.id, email, password, client };
    }
  };
}
export async function openCompany(page: Page, user: { email: string; password: string }, companyName: string) {
  await page.goto("/auth/sign-in?next=/companies");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/companies/);
  await page.getByRole("button", { name: `Open ${companyName}`, exact: true }).click();
  await expect(page.getByRole("heading", { name: companyName, exact: true })).toBeVisible();
}
export async function companyNonce(page: Page) {
  const nonce = (await page.context().cookies()).find((cookie) => cookie.name === "ams_company_context")?.value;
  expect(nonce).toMatch(/^[A-Za-z0-9_-]{22,172}$/);
  return nonce!;
}

// Execute protected API requests in the browser so production Secure cookies on
// loopback are handled by Chromium, exactly as for ordinary same-origin requests.
// APIRequestContext has different HTTP-loopback Secure-cookie behavior.
export async function browserApi(page: Page, url: string, options: {
  method?: string; headers?: Record<string, string>; data?: unknown;
} = {}) {
  return page.evaluate(async ({ url, options }) => {
    const response = await fetch(url, {
      method: options.method ?? "GET", credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...options.headers },
      ...(options.data === undefined ? {} : { body: JSON.stringify(options.data) })
    });
    return { status: response.status, body: await response.json() };
  }, { url, options });
}
