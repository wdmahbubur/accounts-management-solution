import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import test from "node:test";
import { Pool } from "@neondatabase/serverless";
import "../../scripts/load-local-env.mjs";
import { canAttemptPasswordLogin, clearPasswordLoginFailures, recordFailedPasswordLogin } from "../../apps/web/server/auth/identity.ts";

test("real restricted-login limiter counts five failures, expires, clears and handles independent connections", { timeout: 180_000 }, async (t) => {
  assert.equal(process.env.AMS_DATABASE_TESTS, "isolated", "Use only an explicitly isolated disposable database.");
  const pool = new Pool({ connectionString: process.env.DATABASE_RUNTIME_URL, max: 1 });
  const email = `limiter-${randomUUID()}@example.invalid`;
  const key = createHash("sha256").update(email).digest();
  const state = async () => (await pool.query("SELECT attempts, blocked_until, window_started_at FROM identity.auth_rate_limits WHERE email_hash=$1", [key])).rows[0];
  try {
    const role = (await pool.query(`SELECT NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AS restricted,
      pg_has_role(current_user,'ams_runtime','MEMBER') AS runtime FROM pg_roles WHERE rolname=current_user`)).rows[0];
    assert.ok(role.restricted && role.runtime);
    await t.test("first through fourth attempts remain allowed; fifth blocks", async () => {
      assert.equal(await canAttemptPasswordLogin(email), true);
      for (let count = 1; count <= 5; count++) {
        await recordFailedPasswordLogin(`  ${email.toUpperCase()}  `);
        assert.equal((await state()).attempts, count);
        assert.equal(await canAttemptPasswordLogin(email), count < 5);
      }
      const blocked = await state();
      await recordFailedPasswordLogin(email);
      assert.deepEqual(await state(), blocked, "In-flight failures cannot extend or clear an active lockout.");
    });
    await t.test("expired lockout starts at one and successful-login cleanup removes it", async () => {
      await pool.query(`UPDATE identity.auth_rate_limits SET window_started_at=now()-interval '31 minutes',
        blocked_until=now()-interval '1 minute' WHERE email_hash=$1`, [key]);
      assert.equal(await canAttemptPasswordLogin(email), true);
      await recordFailedPasswordLogin(email);
      assert.equal((await state()).attempts, 1);
      assert.equal((await state()).blocked_until, null);
      await clearPasswordLoginFailures(email);
      assert.equal(await state(), undefined);
    });
    await t.test("an expired four-failure window resets instead of prematurely blocking", async () => {
      await recordFailedPasswordLogin(email);
      await pool.query(`UPDATE identity.auth_rate_limits SET attempts=4, window_started_at=now()-interval '16 minutes' WHERE email_hash=$1`, [key]);
      await recordFailedPasswordLogin(email);
      assert.equal((await state()).attempts, 1);
      assert.equal(await canAttemptPasswordLogin(email), true);
      await clearPasswordLoginFailures(email);
    });
    await t.test("eight independent app processes cannot lose first-insert or threshold races", async () => {
      const script = `import {recordFailedPasswordLogin} from './apps/web/server/auth/identity.ts';
        await recordFailedPasswordLogin(process.env.AMS_LIMITER_TEST_EMAIL);process.exit(0);`;
      await Promise.all(Array.from({ length: 8 }, () => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", script], {
          cwd: new URL("../..", import.meta.url), env: { ...process.env, AMS_LIMITER_TEST_EMAIL: email }, stdio: ["ignore", "ignore", "pipe"]
        });
        let error = ""; child.stderr.on("data", (chunk) => { error += chunk; });
        child.on("error", reject);
        child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Limiter worker failed (${code}): ${error}`)));
      })));
      assert.equal((await state()).attempts, 5);
      assert.equal(await canAttemptPasswordLogin(email), false);
    });
  } finally {
    await clearPasswordLoginFailures(email);
    await pool.end();
  }
});
