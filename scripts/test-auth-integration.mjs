import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

import { createClient } from "@supabase/supabase-js";

import {
  createSupabaseIdentityVerifier,
  createSupabaseMembershipResolver,
  resolveActorContext
} from "../apps/web/server/auth/index.ts";
import { CommandError } from "../apps/web/server/commands/errors.ts";
import { parseOrganizationId } from "../packages/contracts/src/index.ts";

function localStatus() {
  const raw = execFileSync("supabase", ["status", "-o", "json"], {
    encoding: "utf8"
  });
  return JSON.parse(raw);
}

function pick(status, ...keys) {
  for (const key of keys) {
    if (typeof status[key] === "string" && status[key].length > 0) {
      return status[key];
    }
  }
  throw new Error(`Missing local Supabase status key. Available: ${Object.keys(status).join(", ")}`);
}

function client(url, key) {
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

function sql(dbUrl, statement) {
  execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-c", statement], {
    stdio: ["ignore", "ignore", "inherit"]
  });
}

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
  status.DB_URL ??
  status.db_url ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const admin = client(url, secret);
const publicClient = client(url, publishable);

const email = "us006-live@example.invalid";
const password = "SecureAuth123";
const recoveryEmail = "us006-recovery@example.invalid";
const expiredEmail = "us006-expired@example.invalid";
const orgId = "66cccccc-cccc-4ccc-8ccc-cccccccccccc";
const memberId = "66dddddd-dddd-4ddd-8ddd-dddddddddddd";

const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
for (const user of listed.data.users ?? []) {
  if ([email, recoveryEmail, expiredEmail].includes(user.email ?? "")) {
    await admin.auth.admin.deleteUser(user.id);
  }
}

const signUp = await publicClient.auth.signUp({
  email,
  password,
  options: { data: { role: "Owner", display_name: "US006 Live" } }
});
assert.equal(signUp.error, null);
assert.ok(signUp.data.user);
assert.equal(signUp.data.session, null, "confirmation-required signup must not create a session");

const unverified = await publicClient.auth.signInWithPassword({ email, password });
assert.ok(unverified.error, "unverified account must not sign in");

const resend = await publicClient.auth.resend({ type: "signup", email });
assert.ok(resend.error, "immediate verification resend must be rate limited");

await admin.auth.admin.updateUserById(signUp.data.user.id, {
  email_confirm: true
});

const sessionA = client(url, publishable);
const signedA = await sessionA.auth.signInWithPassword({ email, password });
assert.equal(signedA.error, null);
assert.ok(signedA.data.session);

const liveUserId = signedA.data.user?.id;
assert.match(liveUserId ?? "", /^[0-9a-f-]{36}$/i);

sql(
  dbUrl,
  `insert into finance.organizations
    (id,name,slug,legal_name,books_start_date,fiscal_year_start_month,status)
   values
    ('${orgId}','US006 Live Org','us006-live-org','US006 Live Org','2026-01-01',1,'active')
   on conflict (id) do nothing;
   insert into finance.organization_members
    (id,organization_id,user_id,display_name_snapshot,status)
   values
    ('${memberId}','${orgId}','${liveUserId}','US006 Live','active')
   on conflict (organization_id,user_id) do update set status='active';`
);


const onboardingPayload = {
  p_name: "US007 Live Company",
  p_legal_name: "US007 Live Company Limited",
  p_country_code: "BD",
  p_base_currency: "BDT",
  p_timezone: "Asia/Dhaka",
  p_fiscal_year_start_month: 1,
  p_books_start_date: "2026-04-01",
  p_idempotency_key: "us007_live_rpc_key_0123456789"
};

const onboarding = await sessionA.rpc("create_company_atomic", onboardingPayload);
assert.equal(onboarding.error, null);
assert.equal(onboarding.data?.length, 1);
assert.equal(onboarding.data?.[0]?.replayed, false);
assert.match(onboarding.data?.[0]?.organization_id ?? "", /^[0-9a-f-]{36}$/i);

const onboardingReplay = await sessionA.rpc("create_company_atomic", onboardingPayload);
assert.equal(onboardingReplay.error, null);
assert.equal(onboardingReplay.data?.[0]?.organization_id, onboarding.data?.[0]?.organization_id);
assert.equal(onboardingReplay.data?.[0]?.replayed, true);

const changedOnboarding = await sessionA.rpc("create_company_atomic", {
  ...onboardingPayload,
  p_name: "US007 Changed Company"
});
assert.equal(changedOnboarding.error?.code, "23505");

const unsupportedCurrency = await sessionA.rpc("create_company_atomic", {
  ...onboardingPayload,
  p_name: "US007 USD Company",
  p_legal_name: "US007 USD Company",
  p_base_currency: "USD",
  p_idempotency_key: "us007_usd_rpc_key_0123456789"
});
assert.equal(unsupportedCurrency.error?.code, "22023");

const metadataUpdate = await sessionA.auth.updateUser({
  data: { role: "Owner", capabilities: ["*"] }
});
assert.equal(metadataUpdate.error, null);

const resolver = createSupabaseMembershipResolver(sessionA);
const active = await resolver.resolveActiveMembership({
  userId: liveUserId,
  organizationId: parseOrganizationId(orgId)
});
assert.ok(active);
assert.deepEqual(active.capabilities, [], "editable metadata must not grant DB capabilities");

const profileUpdate = await sessionA.rpc("update_own_profile", {
  p_display_name: "US006 Persisted",
  p_locale: "bn-BD",
  p_timezone: "Asia/Dhaka"
});
assert.equal(profileUpdate.error, null);

const ownProfile = await sessionA.rpc("get_own_profile");
assert.equal(ownProfile.error, null);
assert.equal(ownProfile.data?.[0]?.display_name, "US006 Persisted");

sql(
  dbUrl,
  `update finance.organization_members set status='inactive'
   where id='${memberId}' and organization_id='${orgId}';`
);

await assert.rejects(
  () =>
    resolveActorContext(parseOrganizationId(orgId), {
      identityVerifier: createSupabaseIdentityVerifier(sessionA),
      membershipResolver: resolver
    }),
  (error) => error instanceof CommandError && error.code === "NOT_FOUND"
);

const recoveryUser = await admin.auth.admin.createUser({
  email: recoveryEmail,
  password,
  email_confirm: true
});
assert.equal(recoveryUser.error, null);

const firstReset = await publicClient.auth.resetPasswordForEmail(recoveryEmail, {
  redirectTo: "http://127.0.0.1:3000/auth/verify"
});
assert.equal(firstReset.error, null);
const secondReset = await publicClient.auth.resetPasswordForEmail(recoveryEmail, {
  redirectTo: "http://127.0.0.1:3000/auth/verify"
});
assert.ok(secondReset.error, "immediate password reset replay must be rate limited");

const expiredUser = await admin.auth.admin.createUser({
  email: expiredEmail,
  password,
  email_confirm: true
});
assert.equal(expiredUser.error, null);

const generated = await admin.auth.admin.generateLink({
  type: "recovery",
  email: expiredEmail,
  options: { redirectTo: "http://127.0.0.1:3000/auth/verify" }
});
assert.equal(generated.error, null);
const hashedToken = generated.data.properties?.hashed_token;
assert.ok(hashedToken);

sql(
  dbUrl,
  `update auth.users set recovery_sent_at = now() - interval '2 hours'
   where id='${expiredUser.data.user?.id}';`
);

const expiredVerification = await publicClient.auth.verifyOtp({
  type: "recovery",
  token_hash: hashedToken
});
assert.ok(expiredVerification.error, "expired recovery link must be rejected");

const sessionB = client(url, publishable);
const signedB = await sessionB.auth.signInWithPassword({ email, password });
assert.equal(signedB.error, null);
assert.ok(signedB.data.session);

const globalSignOut = await sessionA.auth.signOut({ scope: "global" });
assert.equal(globalSignOut.error, null);

const revokedRefresh = await sessionB.auth.refreshSession();
assert.ok(
  revokedRefresh.error || !revokedRefresh.data.session,
  "global sign-out must revoke other refresh sessions"
);

console.log("US-006 local Auth integration PASS");
