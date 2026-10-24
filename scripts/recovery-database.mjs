// Read-only verification for an operator-created, isolated database restore.
// The restore itself is performed through the provider's documented branch/PITR workflow.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Pool } from "@neondatabase/serverless";
import "./load-local-env.mjs";

const productionHost = "ep-summer-flower-b45z3gnu-pooler.c-6.us-east-2.aws.neon.tech";
const quote = value => `"${value.replaceAll('"', '""')}"`;
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function isolatedRecoveryUrl(value, expectedHost) {
  assert.equal(process.env.AMS_DATABASE_TESTS, "isolated", "Explicitly enable isolated recovery testing.");
  assert.ok(expectedHost, "Explicitly select the expected isolated hostname.");
  const url = new URL(value);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.equal(url.hostname, expectedHost, "Recovery target does not match the selected host.");
  assert.notEqual(url.hostname.replace("-pooler", ""), productionHost.replace("-pooler", ""), "Production recovery mutation/testing is forbidden.");
  assert.ok(url.username && url.pathname.length > 1, "Use an explicit database and login.");
  return url;
}

export async function databaseSnapshot(connectionString) {
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 20_000 });
  const db = await pool.connect();
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await db.query("SET LOCAL statement_timeout='60s'");
    const point = (await db.query("SELECT transaction_timestamp()::text AS timestamp, pg_current_wal_lsn()::text AS lsn, current_setting('server_version') AS version")).rows[0];
    const tables = (await db.query(`SELECT n.nspname AS schema,c.relname AS name,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,
      coalesce(c.relacl::text,'') AS acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('finance','finance_private','identity','app_meta') AND c.relkind='r' ORDER BY 1,2`)).rows;
    const facts = {};
    for (const table of tables) {
      const name = `${table.schema}.${table.name}`;
      facts[name] = (await db.query(`SELECT count(*)::text AS rows,
        encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') AS sha256
        FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS h
          FROM ${quote(table.schema)}.${quote(table.name)} t) rows`)).rows[0];
    }
    const routines = (await db.query(`SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
      md5(pg_get_functiondef(p.oid)) AS definition,coalesce(p.proacl::text,'') AS acl,p.prosecdef AS definer,p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','finance','finance_private','identity') AND p.prokind IN ('f','p') ORDER BY 1,2,3`)).rows;
    const policies = (await db.query("SELECT * FROM pg_policies WHERE schemaname IN ('finance','finance_private','identity') ORDER BY schemaname,tablename,policyname")).rows;
    const guards = (await db.query(`SELECT n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid) AS definition
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('finance','finance_private','identity') AND NOT t.tgisinternal ORDER BY 1,2,3`)).rows;
    const constraints = (await db.query(`SELECT n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid) AS definition
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('finance','finance_private','identity') ORDER BY 1,2,3`)).rows;
    const roles = (await db.query(`SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls
      FROM pg_roles WHERE rolname LIKE 'ams\\_%' ESCAPE '\\' ORDER BY rolname`)).rows;
    const memberships = (await db.query(`SELECT parent.rolname AS role,member.rolname AS member,m.admin_option,m.inherit_option,m.set_option
      FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid JOIN pg_roles member ON member.oid=m.member
      WHERE parent.rolname LIKE 'ams\\_%' ESCAPE '\\' OR member.rolname LIKE 'ams\\_%' ESCAPE '\\' ORDER BY 1,2`)).rows;
    const migrations = (await db.query("SELECT migration_name,sha256 FROM app_meta.schema_migrations ORDER BY migration_name")).rows;
    const pdfs = (await db.query("SELECT id,organization_id,document_id,object_key,sha256,byte_size::text FROM finance.invoice_pdf_versions ORDER BY id")).rows;
    const attachments = (await db.query("SELECT id,organization_id,object_key,sha256,byte_size::text,scan_status FROM finance.attachments ORDER BY id")).rows;
    const ledger = (await db.query(`SELECT organization_id,sum(debit)::text AS debit,sum(credit)::text AS credit,
      count(*)::text AS lines FROM finance.journal_lines GROUP BY organization_id ORDER BY organization_id`)).rows;
    await db.query("COMMIT");
    return { format: 1, point, facts, migrations, ledger, objects: { pdfs, attachments },
      security: { tables: hash(tables), routines: hash(routines), policies: hash(policies), triggers: hash(guards), constraints: hash(constraints), roles: hash(roles), memberships: hash(memberships) } };
  } finally {
    await db.query("ROLLBACK").catch(() => undefined);
    db.release(); await pool.end();
  }
}

async function main() {
  const [command, file] = process.argv.slice(2);
  assert.ok(file && ["capture", "verify"].includes(command), "Use capture|verify <private-manifest.json>.");
  const isCapture = command === "capture";
  const url = isolatedRecoveryUrl(isCapture ? process.env.DATABASE_URL : process.env.RECOVERY_DATABASE_URL,
    isCapture ? process.env.AMS_RECOVERY_SOURCE_HOST : process.env.AMS_RECOVERY_TARGET_HOST);
  if (!isCapture) assert.notEqual(url.hostname, process.env.AMS_RECOVERY_SOURCE_HOST, "Restore verification needs a distinct target.");
  const actual = await databaseSnapshot(url.toString());
  if (isCapture) await writeFile(file, JSON.stringify(actual, null, 2), { mode: 0o600, flag: "wx" });
  else {
    const expected = JSON.parse(await readFile(file, "utf8"));
    for (const key of ["format", "facts", "migrations", "ledger", "objects", "security"]) assert.deepEqual(actual[key], expected[key], `Restored ${key} differs from backup point.`);
  }
  console.log(JSON.stringify({ command, status: "passed", tableCount: Object.keys(actual.facts).length,
    migrationCount: actual.migrations.length, lastMigration: actual.migrations.at(-1).migration_name,
    journalGroups: actual.ledger.length, pdfs: actual.objects.pdfs.length, attachments: actual.objects.attachments.length,
    snapshotTime: actual.point.timestamp, lsn: actual.point.lsn }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(JSON.stringify({ status: "failed", code: error.code ?? error.name, message: error.message })); process.exitCode = 1; });
}
