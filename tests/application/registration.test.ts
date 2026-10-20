import assert from "node:assert/strict";
import test from "node:test";

import { registerAccount, requestVerification } from "../../apps/web/server/auth/registration.ts";

function form(password = "SyntheticPassword123") {
  const data = new FormData();
  data.set("email", " New.User@Example.Invalid ");
  data.set("display_name", " Test User ");
  data.set("password", password);
  return data;
}

test("signup rejects invalid credentials before account creation or email delivery", async () => {
  const services = { emailAvailable: true,
    createUser: async () => { throw new Error("must not create a user"); },
    sendVerification: async () => { throw new Error("must not send email"); } };
  assert.deepEqual(await registerAccount(form("lowercaseonly"), services), { error: "password_policy" });
  const invalid = form(); invalid.set("email", "bad email");
  assert.deepEqual(await registerAccount(invalid, services), { error: "invalid_input" });
});

test("missing email configuration stops signup and resend before any identity lookup", async () => {
  let accesses = 0;
  const services = { emailAvailable: false,
    createUser: async () => { accesses++; return "user"; },
    findUnverifiedUser: async () => { accesses++; return "user"; },
    sendVerification: async () => { accesses++; } };
  assert.deepEqual(await registerAccount(form(), services), { error: "email_unavailable" });
  assert.deepEqual(await requestVerification(form(), services), { error: "email_unavailable" });
  assert.equal(accesses, 0);
});

test("new signup sends verification to the normalized email and never returns credentials", async () => {
  const calls: unknown[] = [];
  const result = await registerAccount(form(), { emailAvailable: true,
    createUser: async (...args) => { calls.push(args); return "user-123"; },
    sendVerification: async (...args) => { calls.push(args); } });
  assert.deepEqual(calls, [["new.user@example.invalid", "SyntheticPassword123", "Test User"],
    ["user-123", "new.user@example.invalid"]]);
  assert.deepEqual(result, { status: "check_email" });
  assert.doesNotMatch(JSON.stringify(result), /SyntheticPassword|new\.user|user-123/);
});

test("duplicate signup and provider failures remain enumeration-safe", async () => {
  const duplicate = await registerAccount(form(), { emailAvailable: true,
    createUser: async () => null, sendVerification: async () => assert.fail("duplicate must not send") });
  const failed = await registerAccount(form(), { emailAvailable: true,
    createUser: async () => "user", sendVerification: async () => { throw new Error("private SMTP details"); } });
  assert.deepEqual(duplicate, { status: "check_email" });
  assert.deepEqual(failed, duplicate);
});

test("verification resend has the same response for existing, absent and failed delivery", async () => {
  const responses = [];
  for (const user of [null, "user", "failed"]) {
    responses.push(await requestVerification(form(), { emailAvailable: true,
      findUnverifiedUser: async () => user,
      sendVerification: async (id, email) => {
        assert.equal(email, "new.user@example.invalid");
        if (id === "failed") throw new Error("private SMTP details");
      } }));
  }
  assert.deepEqual(responses, Array(3).fill({ status: "verification_requested" }));
});
