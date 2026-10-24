import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "@neondatabase/serverless";
import "../../scripts/load-local-env.mjs";
import { isolatedRecoveryUrl } from "../../scripts/recovery-database.mjs";
import { createInvitationSecret } from "../../apps/web/server/invitations/tokens.ts";

test("current identity invitation lifecycle and live membership revocation", { timeout: 180_000 }, async t => {
  const ownerUrl = isolatedRecoveryUrl(process.env.DATABASE_URL, process.env.AMS_TEST_DATABASE_HOST);
  const runtimeUrl = isolatedRecoveryUrl(process.env.DATABASE_RUNTIME_URL, process.env.AMS_TEST_DATABASE_HOST);
  assert.equal(ownerUrl.pathname, runtimeUrl.pathname);
  const admin = new Pool({ connectionString: ownerUrl.toString(), max: 1 });
  const runtime = new Pool({ connectionString: runtimeUrl.toString(), max: 2 });
  const ids = Object.fromEntries(["owner", "inviter", "recipient", "second", "third", "outsider"].map(key => [key, randomUUID()]));
  const emails = Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, `invitation-${id}@example.invalid`]));
  const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const request = () => `invitation-test-${randomUUID()}`;
  async function call(user, sql, args = [], readOnly = false) {
    const db = await runtime.connect();
    try {
      await db.query(readOnly ? "BEGIN READ ONLY" : "BEGIN");
      await db.query("SET LOCAL statement_timeout='25s'");
      await db.query("SELECT set_config('ams.actor_user_id',$1,true)", [user]);
      const result = await db.query(sql, args);
      await db.query("COMMIT"); return result;
    } catch (error) { await db.query("ROLLBACK"); throw error; }
    finally { db.release(); }
  }
  const denied = (code, run) => assert.rejects(run, error => error.code === code);
  const issueSql = "SELECT public.issue_company_invitation($1,$2,$3,$4,$5,$6::jsonb,$7) AS id";
  const inspect = (user, secret) => call(user, "SELECT * FROM public.inspect_company_invitation($1)", [secret.invitationPath.split("/").at(-1)], true);
  let org, ownerMember, inviterMember, role, invitation, initial, replacement;
  async function issue(user, email, roleId = role, organization = org) {
    const id = randomUUID(), secret = createInvitationSecret(organization, id);
    await call(user, issueSql, [organization, id, email, roleId, secret.tokenHash, JSON.stringify(secret.delivery), request()]);
    return { id, secret };
  }
  try {
    for (const [key, id] of Object.entries(ids)) {
      await admin.query("INSERT INTO identity.users(id,email_normalized,display_name,password_hash,email_verified_at) VALUES($1,$2,$3,'$argon2id$non-login-fixture',CASE WHEN $4 THEN now() ELSE NULL END)", [id, emails[key], `Synthetic invitation ${key}`, key !== "recipient"]);
      await admin.query("INSERT INTO identity.auth_sessions(id,user_id,session_version,recent_auth_at,expires_at) VALUES($1,$2,0,now(),now()+interval '1 hour')", [randomUUID(), id]);
    }
    const created = (await call(ids.owner, "SELECT * FROM public.create_company_atomic('Invitation security QA','Invitation security QA','BD','BDT','Asia/Dhaka',1::smallint,'2026-01-01'::date,$1)", [randomUUID()])).rows[0];
    org = created.organization_id; ownerMember = created.owner_member_id;
    const ownerRole = (await admin.query("SELECT id FROM finance.roles WHERE organization_id=$1 AND template_key='owner'", [org])).rows[0].id;
    inviterMember = randomUUID(); role = randomUUID();
    await admin.query("INSERT INTO finance.organization_members(id,organization_id,user_id,display_name_snapshot) VALUES($1,$2,$3,'Synthetic inviter')", [inviterMember, org, ids.inviter]);
    await admin.query("INSERT INTO finance.member_roles(organization_id,member_id,role_id) VALUES($1,$2,$3)", [org, inviterMember, ownerRole]);
    await admin.query("INSERT INTO finance.roles(id,organization_id,name) VALUES($1,$2,'Synthetic reports reader')", [role, org]);
    await admin.query("INSERT INTO finance.role_permissions(organization_id,role_id,permission_id) SELECT $1,$2,id FROM finance.permissions WHERE code='reports.read'", [org, role]);

    await t.test("normalized recipient, verified identity and hidden token hashes", async () => {
      ({ id: invitation, secret: initial } = await issue(ids.owner, `  ${emails.recipient.toUpperCase()}  `));
      await denied("42501", () => call(ids.owner, "SELECT token_hash FROM finance.invitations WHERE id=$1", [invitation], true));
      await denied("42501", () => inspect(ids.recipient, initial));
      await admin.query("UPDATE identity.users SET email_verified_at=now() WHERE id=$1", [ids.recipient]);
      assert.equal((await inspect(ids.recipient, initial)).rows[0].organization_id, org);
      await denied("P0002", () => inspect(ids.second, initial));
      await denied("42501", () => issue(ids.owner, emails.owner));
      await denied("23505", () => issue(ids.owner, emails.inviter));
    });
    await t.test("resend cooldown, superseded-token rejection and immutable delivery payloads", async () => {
      replacement = createInvitationSecret(org, invitation);
      const args = [org, invitation, replacement.tokenHash, JSON.stringify(replacement.delivery), request()];
      const resend = () => call(ids.owner, "SELECT public.resend_company_invitation($1,$2,$3,$4::jsonb,$5)", args);
      await denied("P0429", resend);
      const before = (await admin.query("SELECT id,payload FROM finance.outbox_events WHERE organization_id=$1 AND payload->>'invitation_id'=$2", [org, invitation])).rows[0];
      // Aging only this new fixture's cooldown avoids a real-time wait.
      await admin.query("UPDATE finance.invitations SET last_issued_at=now()-interval '61 seconds' WHERE id=$1", [invitation]);
      await resend();
      const after = (await admin.query("SELECT payload,status,last_error_code FROM finance.outbox_events WHERE id=$1", [before.id])).rows[0];
      assert.equal(digest(after.payload), digest(before.payload));
      assert.equal(after.status, "failed"); assert.equal(after.last_error_code, "INVITATION_SUPERSEDED");
      await denied("P0002", () => inspect(ids.recipient, initial));
      assert.equal((await inspect(ids.recipient, replacement)).rows[0].organization_id, org);
    });
    await t.test("one-time acceptance grants the snapshotted role only", async () => {
      const token = replacement.invitationPath.split("/").at(-1);
      const accept = () => call(ids.recipient, "SELECT * FROM public.respond_company_invitation($1,'accept',$2)", [token, request()]);
      const result = (await accept()).rows[0];
      assert.equal(result.invitation_status, "accepted");
      const roles = (await admin.query("SELECT role_id FROM finance.member_roles WHERE organization_id=$1 AND member_id=$2 ORDER BY role_id", [org, result.member_id])).rows;
      assert.deepEqual(roles, [{ role_id: role }]);
      await denied("P0002", accept);
      await denied("23505", () => issue(ids.owner, emails.recipient));
    });
    await t.test("unverified and disabled issuers cannot issue invitations", async () => {
      await admin.query("UPDATE identity.users SET email_verified_at=NULL WHERE id=$1", [ids.inviter]);
      await denied("42501", () => issue(ids.inviter, emails.second));
      await admin.query("UPDATE identity.users SET email_verified_at=now(),disabled_at=now() WHERE id=$1", [ids.inviter]);
      await denied("42501", () => issue(ids.inviter, emails.second));
      await admin.query("UPDATE identity.users SET disabled_at=NULL WHERE id=$1", [ids.inviter]);
    });
    await t.test("deactivating an inviter atomically invalidates pending links and queued delivery", async () => {
      const pending = await issue(ids.inviter, emails.second);
      await call(ids.owner, "SELECT public.deactivate_member($1,$2,$3)", [org, inviterMember, request()]);
      const state = (await admin.query("SELECT status FROM finance.invitations WHERE id=$1", [pending.id])).rows[0];
      assert.equal(state.status, "revoked");
      const delivery = (await admin.query("SELECT status,last_error_code FROM finance.outbox_events WHERE organization_id=$1 AND payload->>'invitation_id'=$2", [org, pending.id])).rows[0];
      assert.deepEqual(delivery, { status: "failed", last_error_code: "INVITATION_SUPERSEDED" });
      await denied("P0002", () => inspect(ids.second, pending.secret));
      await denied("42501", () => call(ids.inviter, "SELECT * FROM public.list_company_invitations($1)", [org], true));
    });
    await t.test("cross-company roles, private helpers and self-deactivation remain denied", async () => {
      const foreignOrg = (await call(ids.outsider, "SELECT * FROM public.create_company_atomic('Invitation foreign QA','Invitation foreign QA','BD','BDT','Asia/Dhaka',1::smallint,'2026-01-01'::date,$1)", [randomUUID()])).rows[0].organization_id;
      const foreignRole = (await admin.query("SELECT id FROM finance.roles WHERE organization_id=$1 AND template_key='owner'", [foreignOrg])).rows[0].id;
      await denied("22023", () => issue(ids.owner, emails.third, foreignRole));
      await denied("42501", () => issue(ids.owner, emails.third, role, foreignOrg));
      await denied("42501", () => call(ids.owner, "SELECT finance_private.verified_invitation_email()", [], true));
      await denied("42501", () => call(ids.owner, "SELECT public.deactivate_member($1,$2,$3)", [org, ownerMember, request()]));
    });
    await t.test("changing a role after issuance cannot expand an outstanding invitation", async () => {
      const pending = await issue(ids.owner, emails.third);
      await admin.query("INSERT INTO finance.role_permissions(organization_id,role_id,permission_id) SELECT $1,$2,id FROM finance.permissions WHERE code='sales.read'", [org, role]);
      await denied("P0002", () => inspect(ids.third, pending.secret));
      await denied("P0002", () => call(ids.third, "SELECT * FROM public.respond_company_invitation($1,'accept',$2)", [pending.secret.invitationPath.split("/").at(-1), request()]));
    });
  } finally { await runtime.end(); await admin.end(); }
});
