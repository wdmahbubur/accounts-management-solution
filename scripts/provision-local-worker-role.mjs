import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";
import "./load-local-env.mjs";

if (process.env.NODE_ENV === "production") throw new Error("This helper provisions local development only.");
const adminUrl = process.env.DATABASE_URL;
const runtimeUrl = process.env.DATABASE_RUNTIME_URL;
if (!adminUrl || !runtimeUrl) throw new Error("DATABASE_URL and DATABASE_RUNTIME_URL are required.");
if (process.env.DATABASE_WORKER_URL) throw new Error("DATABASE_WORKER_URL is already configured; refusing to rotate it.");
const admin = new URL(adminUrl);
const runtime = new URL(runtimeUrl);
if (admin.hostname !== runtime.hostname || admin.pathname !== runtime.pathname) {
  throw new Error("Migration and runtime URLs must target the same development database.");
}

const secret = randomBytes(32).toString("base64url");
const pool = new Pool({ connectionString: adminUrl, max: 1, connectionTimeoutMillis: 10_000 });
try {
  await pool.query(`ALTER ROLE ams_job_worker_login WITH PASSWORD '${secret}'`);
  const worker = new URL(runtimeUrl);
  worker.username = "ams_job_worker_login";
  worker.password = secret;
  const envPath = ".env.local";
  const contents = await readFile(envPath, "utf8");
  const next = `${contents.replace(/\s*$/, "\n")}DATABASE_WORKER_URL=${worker.toString()}\n`;
  await writeFile(envPath, next, { mode: 0o600 });
} finally {
  await pool.end();
}
process.stdout.write("Configured the local restricted worker credential in .env.local.\n");
