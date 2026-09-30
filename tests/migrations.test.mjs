import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const normalize = (value) => value.replace(/\s+/g, " ").trim();

const createTableBlock = (sql, name) => {
  const start = sql.indexOf(`CREATE TABLE finance.${name} (`);
  assert.notEqual(start, -1, `missing CREATE TABLE for ${name}`);
  const end = sql.indexOf("\n);", start);
  assert.notEqual(end, -1, `unterminated CREATE TABLE for ${name}`);
  return normalize(sql.slice(start, end + 3));
};

const names = (sql, pattern) => [...sql.matchAll(pattern)].map((match) => match[1]).sort();

test("US-003 migrations preserve all 52 catalogued table definitions verbatim", async () => {
  const [reference, catalog, core] = await Promise.all([
    readFile("docs/reference-schema.sql", "utf8"),
    readFile("docs/schema-catalog.json", "utf8").then(JSON.parse),
    readFile("supabase/migrations/20260930111830_core_finance_schema.sql", "utf8")
  ]);

  assert.equal(catalog.length, 52);

  for (const table of catalog) {
    assert.equal(
      createTableBlock(core, table.name),
      createTableBlock(reference, table.name),
      `${table.name} field/constraint definition drifted from the reviewed source`
    );
  }
});

test("US-003 migration versions are unique, ordered and cover source indexes/security", async () => {
  const migrationDir = "supabase/migrations";
  const migrationFiles = (await readdir(migrationDir)).filter((name) => name.endsWith(".sql")).sort();
  assert.deepEqual(migrationFiles, [
    "20260930111830_core_finance_schema.sql",
    "20260930112000_read_only_security_baseline.sql"
  ]);

  const [reference, core, security] = await Promise.all([
    readFile("docs/reference-schema.sql", "utf8"),
    readFile(`${migrationDir}/${migrationFiles[0]}`, "utf8"),
    readFile(`${migrationDir}/${migrationFiles[1]}`, "utf8")
  ]);
  const combined = `${core}\n${security}`;

  assert.deepEqual(
    names(combined, /CREATE (?:UNIQUE )?INDEX\s+([A-Za-z0-9_]+)/g),
    names(reference, /CREATE (?:UNIQUE )?INDEX\s+([A-Za-z0-9_]+)/g)
  );
  assert.equal(names(reference, /CREATE (?:UNIQUE )?INDEX\s+([A-Za-z0-9_]+)/g).length, 124);

  assert.deepEqual(
    names(security, /ALTER TABLE finance\.([A-Za-z0-9_]+) ENABLE ROW LEVEL SECURITY;/g),
    names(reference, /ALTER TABLE finance\.([A-Za-z0-9_]+) ENABLE ROW LEVEL SECURITY;/g)
  );
  assert.equal(names(security, /ALTER TABLE finance\.([A-Za-z0-9_]+) ENABLE ROW LEVEL SECURITY;/g).length, 52);

  assert.deepEqual(
    names(security, /CREATE POLICY\s+([A-Za-z0-9_]+)/g),
    names(reference, /CREATE POLICY\s+([A-Za-z0-9_]+)/g)
  );
});

test("US-003 keeps finance schemas private and ordinary API writes disabled", async () => {
  const [config, core, security] = await Promise.all([
    readFile("supabase/config.toml", "utf8"),
    readFile("supabase/migrations/20260930111830_core_finance_schema.sql", "utf8"),
    readFile("supabase/migrations/20260930112000_read_only_security_baseline.sql", "utf8")
  ]);
  const combined = `${core}\n${security}`;

  const apiSchemas = config.match(/\[api\][\s\S]*?schemas\s*=\s*\[([^\]]*)\]/)?.[1] ?? "";
  assert.doesNotMatch(apiSchemas, /finance(?:_private)?/);
  assert.match(config, /\[db\.seed\][\s\S]*?enabled\s*=\s*false/);

  assert.doesNotMatch(
    combined,
    /GRANT\s+(?:INSERT|UPDATE|DELETE|TRUNCATE|ALL)(?:\s*,\s*(?:INSERT|UPDATE|DELETE|TRUNCATE))*\s+ON[^;]+TO\s+(?:anon|authenticated)/i
  );
  assert.match(security, /REVOKE ALL ON FUNCTION finance_private\.has_permission\(uuid,text\) FROM PUBLIC, anon, authenticated;/);
  assert.match(security, /SECURITY DEFINER SET search_path = ''/);
});
