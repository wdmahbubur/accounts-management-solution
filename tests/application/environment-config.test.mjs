import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  checkEnvironment,
  formatEnvironmentCheck,
  resolveOwnerDatabaseUrl
} from "../../scripts/environment-config.mjs";

const cliPath = fileURLToPath(new URL("../../scripts/check-environment.mjs", import.meta.url));
const preview = {
  AUTH_URL: "https://preview.example.com",
  NEXT_PUBLIC_APP_URL: "https://preview.example.com",
  AUTH_SECRET: "synthetic-test-value-with-more-than-32-bytes",
  DATABASE_RUNTIME_URL: "postgresql://app:synthetic@database.example.com/preview"
};
const errorCodes = (result) => result.errors.map(({ code }) => code);

function withConfigurationDirectory(run) {
  const directory = mkdtempSync(join(tmpdir(), "ams-environment-test-"));
  try {
    return run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runCli(args, environment, cwd) {
  // Replace the entire child environment: never read the developer's real values.
  return spawnSync(process.execPath, [cliPath, ...args], { env: environment, cwd, encoding: "utf8" });
}

test("database setup consistently selects the explicit isolated owner override", () => {
  const explicitTarget = "postgresql://owner:synthetic@isolated.example.com/preview";
  const fallbackTarget = "postgresql://owner:synthetic@other.example.com/default";
  assert.equal(resolveOwnerDatabaseUrl({ MIGRATION_DATABASE_URL: explicitTarget, DATABASE_URL: fallbackTarget }), explicitTarget);
  assert.equal(resolveOwnerDatabaseUrl({ DATABASE_URL: fallbackTarget }), fallbackTarget);
  for (const override of ["", " \n "]) {
    assert.throws(() => resolveOwnerDatabaseUrl({ MIGRATION_DATABASE_URL: override, DATABASE_URL: fallbackTarget }), /MIGRATION_DATABASE_URL/);
  }
  assert.throws(() => resolveOwnerDatabaseUrl({ DATABASE_RUNTIME_URL: preview.DATABASE_RUNTIME_URL }), /owner target/);
});

test("a demo preview only requires its canonical origins, auth secret and runtime database URL", () => {
  const result = checkEnvironment(preview, "preview");
  assert.deepEqual(result.errors, []);
  assert.match(formatEnvironmentCheck(result), /No service was contacted/);
  assert.match(formatEnvironmentCheck(result), /Email is optional/);
  assert.match(formatEnvironmentCheck(result), /Workers.*optional/);
  assert.deepEqual(errorCodes(checkEnvironment({}, "preview")), [
    "NEXT_PUBLIC_APP_URL_MISSING", "AUTH_URL_MISSING", "AUTH_SECRET_MISSING", "DATABASE_RUNTIME_URL_MISSING"
  ]);
});

test("local loopback origins work while non-loopback HTTP and loopback previews fail", () => {
  for (const origin of ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"]) {
    const environment = { ...preview, AUTH_URL: origin, NEXT_PUBLIC_APP_URL: origin };
    assert.deepEqual(checkEnvironment(environment, "local").errors, []);
    assert.ok(errorCodes(checkEnvironment(environment, "preview")).includes("AUTH_URL_INVALID"));
  }
  for (const origin of ["http://preview.example.com", "https://localhost:3000"]) {
    assert.ok(errorCodes(checkEnvironment({ ...preview, AUTH_URL: origin }, "preview")).includes("AUTH_URL_INVALID"));
  }
  assert.ok(errorCodes(checkEnvironment({ ...preview, AUTH_URL: "http://preview.example.com" }, "local")).includes("AUTH_URL_INVALID"));
  assert.ok(errorCodes(checkEnvironment({ ...preview, AUTH_URL: "http://127.attacker.example" }, "local")).includes("AUTH_URL_INVALID"));
});

test("origin validation rejects pasted credentials, non-web schemes and non-origin URL components", () => {
  for (const origin of [
    "preview.example.com", "https:preview.example.com", "javascript:alert(1)", "file:///tmp/preview",
    "https://user:synthetic@preview.example.com", "https://preview.example.com/api/auth",
    "https://preview.example.com?token=synthetic", "https://preview.example.com#sign-in",
    "https://preview.example.com?", " https://preview.example.com", "https:\\preview.example.com"
  ]) {
    const result = checkEnvironment({ ...preview, AUTH_URL: origin, NEXT_PUBLIC_APP_URL: origin }, "preview");
    assert.deepEqual(errorCodes(result), ["NEXT_PUBLIC_APP_URL_INVALID", "AUTH_URL_INVALID"]);
  }
  assert.deepEqual(checkEnvironment({ ...preview, AUTH_URL: "https://preview.example.com:443/" }, "preview").errors, []);
});

test("canonical-origin mismatch and conflicting legacy auth URLs fail before runtime login", () => {
  assert.deepEqual(errorCodes(checkEnvironment({ ...preview, AUTH_URL: "https://other.example.com" }, "preview")), ["ORIGIN_MISMATCH"]);
  assert.deepEqual(errorCodes(checkEnvironment({ ...preview, NEXTAUTH_URL: "http://localhost:3000" }, "preview")), ["NEXTAUTH_URL_CONFLICT"]);
  assert.deepEqual(checkEnvironment({ ...preview, NEXTAUTH_URL: preview.AUTH_URL }, "preview").errors, []);
});

test("runtime database configuration cannot silently use an owner fallback or malformed URL", () => {
  const environment = { ...preview, DATABASE_RUNTIME_URL: undefined, DATABASE_URL: preview.DATABASE_RUNTIME_URL };
  assert.deepEqual(errorCodes(checkEnvironment(environment, "preview")), ["DATABASE_RUNTIME_URL_MISSING"]);
  for (const connection of ["not a connection", "https://database.example.com/preview", "postgresql://app@database.example.com", "postgresql://database.example.com/preview"]) {
    assert.deepEqual(errorCodes(checkEnvironment({ ...preview, DATABASE_RUNTIME_URL: connection }, "preview")), ["DATABASE_RUNTIME_URL_INVALID"]);
  }
  assert.deepEqual(errorCodes(checkEnvironment({ ...preview, DATABASE_URL: "postgresql://app:different-password@database.example.com/preview" }, "preview")), ["DATABASE_RUNTIME_OWNER_LOGIN"]);
  assert.deepEqual(checkEnvironment({ ...preview, DATABASE_URL: "postgresql://owner:synthetic@database.example.com/preview" }, "preview").errors, []);
});

test("empty and short auth secrets fail and incomplete optional mail does not block demo readiness", () => {
  assert.deepEqual(errorCodes(checkEnvironment({ ...preview, AUTH_SECRET: " " }, "preview")), ["AUTH_SECRET_MISSING"]);
  assert.deepEqual(errorCodes(checkEnvironment({ ...preview, AUTH_SECRET: "short" }, "preview")), ["AUTH_SECRET_SHORT"]);
  const result = checkEnvironment({ ...preview, SMTP_URL: "smtp://synthetic.example.com" }, "preview");
  assert.deepEqual(result.errors, []);
  assert.match(formatEnvironmentCheck(result), /Email setup is incomplete/);
});

test("diagnostics name problems without returning supplied secrets or credential-bearing URLs", () => {
  const marker = "DO_NOT_OUTPUT_SYNTHETIC_VALUE";
  const result = checkEnvironment({
    AUTH_URL: `https://preview.example.com?token=${marker}`,
    NEXT_PUBLIC_APP_URL: `https://user:${marker}@preview.example.com`,
    AUTH_SECRET: marker,
    DATABASE_RUNTIME_URL: `postgresql://app:${marker}@database.example.com`,
    SMTP_URL: marker,
    NEXT_PUBLIC_AUTH_SECRET: marker
  }, "preview");
  assert.ok(result.errors.length >= 5);
  assert.ok(errorCodes(result).includes("PUBLIC_SECRET"));
  assert.ok(!JSON.stringify(result).includes(marker));
  assert.ok(!formatEnvironmentCheck(result).includes(marker));
  assert.match(formatEnvironmentCheck(result), /NEXT_PUBLIC_AUTH_SECRET/);
});

test("preview CLI ignores a local environment file and uses only explicitly supplied values", () => {
  withConfigurationDirectory((cwd) => {
    writeFileSync(join(cwd, ".env.local"), Object.entries(preview).map(([key, value]) => `${key}=${value}`).join("\n"));
    const missing = runCli(["--preview"], {}, cwd);
    assert.equal(missing.status, 1);
    assert.match(missing.stdout, /AUTH_SECRET is required/);
    const configured = runCli(["--preview"], preview, cwd);
    assert.equal(configured.status, 0);
    assert.equal(configured.stderr, "");
    assert.match(configured.stdout, /configuration check passed/);
    for (const value of Object.values(preview)) assert.ok(!configured.stdout.includes(value));
  });
});

test("local CLI loads local settings without overriding injected canonical origins", () => {
  withConfigurationDirectory((cwd) => {
    writeFileSync(join(cwd, ".env.local"), Object.entries(preview).map(([key, value]) => `${key}=${value}`).join("\n"));
    const configured = runCli(["--local"], {
      AUTH_URL: "http://127.0.0.1:3000",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000"
    }, cwd);
    assert.equal(configured.status, 0);
    assert.equal(configured.stderr, "");
    assert.match(configured.stdout, /configuration check passed/);
  });
});

test("CLI failures and help never echo unexpected argument or configuration values", () => {
  withConfigurationDirectory((cwd) => {
    const marker = "DO_NOT_OUTPUT_SYNTHETIC_VALUE";
    const failure = runCli(["--preview"], { ...preview, AUTH_URL: `https://user:${marker}@preview.example.com` }, cwd);
    assert.equal(failure.status, 1);
    assert.ok(!(failure.stdout + failure.stderr).includes(marker));
    const misuse = runCli(["--preview", marker], {}, cwd);
    assert.equal(misuse.status, 2);
    assert.ok(!(misuse.stdout + misuse.stderr).includes(marker));
    const help = runCli(["--help"], {}, cwd);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /never load local environment files/);
    assert.ok(!help.stdout.includes("configuration check failed"));
  });
});
