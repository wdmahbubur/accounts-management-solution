// Child process used only by the crash-after-commit acceptance case. No HTTP
// success or command receipt reaches its caller before the process is killed.
import { Pool, neonConfig } from "@neondatabase/serverless";
import { assertIsolatedTargets, assertRestrictedRuntime } from "./isolation.mjs";

assertIsolatedTargets(process.env.TEST_DATABASE_URL, process.env.DATABASE_RUNTIME_URL);
neonConfig.webSocketConstructor = WebSocket;
const pool = new Pool({ connectionString: process.env.DATABASE_RUNTIME_URL, max: 1 });
await assertRestrictedRuntime(pool, process.env.DATABASE_RUNTIME_URL);
process.once("message", async ({ actor, args }) => {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT set_config('ams.actor_user_id',$1,true)", [actor]);
    await db.query("SELECT * FROM public.post_financial_document($1,$2,$3,$4,$5,$6)", args);
    await db.query("COMMIT");
    process.send({ boundary: "committed-before-response" });
    // Keep the process alive without replying with a command result.
    setInterval(() => undefined, 1000);
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    process.send({ error: error.code ?? "unexpected-child-error" });
    process.exitCode = 1;
    db.release(); await pool.end(); process.disconnect();
  }
});
