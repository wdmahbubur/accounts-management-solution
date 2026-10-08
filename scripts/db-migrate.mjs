import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Pool } from "@neondatabase/serverless";
import "./load-local-env.mjs";
import { resolveOwnerDatabaseUrl } from "./environment-config.mjs";

const connectionString = resolveOwnerDatabaseUrl(process.env);

const migrationDirectory = join(import.meta.dirname, "..", "database", "migrations");
const legacyMigrationChecksums = JSON.parse(await readFile(join(import.meta.dirname, "migration-history-overrides.json"), "utf8"));
const migrationLockId = 1095580483n;
const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
const client = await pool.connect();

try {
  // Bootstrap the non-login grant role before migrations that grant to it.
  await client.query(`
    DO $role$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'ams_runtime') THEN
        CREATE ROLE ams_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      END IF;
    END
    $role$
  `);
  await client.query("CREATE SCHEMA IF NOT EXISTS app_meta");
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_meta.schema_migrations (
      migration_name text PRIMARY KEY,
      sha256 char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationDirectory))
    .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
    .sort();

  for (const file of files) {
    // Hash and execute canonical LF SQL so Windows checkouts produce the same migration identity.
    const sql = (await readFile(join(migrationDirectory, file), "utf8")).replaceAll("\r\n", "\n");
    const digest = createHash("sha256").update(sql).digest("hex");
    await client.query("BEGIN");
    try {
      // Transaction-level locking is compatible with Neon pooler connections.
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [migrationLockId.toString()]);
      const existing = await client.query(
        "SELECT sha256 FROM app_meta.schema_migrations WHERE migration_name = $1",
        [file]
      );

      if (existing.rowCount) {
        const recordedDigest = existing.rows[0].sha256.trim();
        if (recordedDigest !== digest && recordedDigest !== legacyMigrationChecksums[file]) {
          throw new Error(`Applied migration was edited: ${file}`);
        }
        await client.query("COMMIT");
        continue;
      }

      await client.query(sql);
      await client.query(
        "INSERT INTO app_meta.schema_migrations (migration_name, sha256) VALUES ($1, $2)",
        [basename(file), digest]
      );
      await client.query("COMMIT");
      process.stdout.write(`Applied ${file}\n`);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }

  process.stdout.write(`Migration check complete (${files.length} files).\n`);
} finally {
  client.release();
  await pool.end();
}
