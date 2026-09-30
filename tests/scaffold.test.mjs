import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

test("US-002 exposes the required modular boundaries", async () => {
  const expected = ["accounting", "reporting", "contracts", "permissions"];

  for (const name of expected) {
    const pkg = await readJson(`packages/${name}/package.json`);
    assert.equal(pkg.name, `@ams/${name}`);
    await access(`packages/${name}/src/index.ts`);
  }

  const web = await readJson("apps/web/package.json");
  for (const name of expected) {
    assert.equal(web.dependencies[`@ams/${name}`], "0.0.0");
  }
});

test("provider and toolchain dependencies are exact and lockfile-backed", async () => {
  const root = await readJson("package.json");
  const web = await readJson("apps/web/package.json");
  const lock = await readJson("package-lock.json");

  const declared = {
    ...root.devDependencies,
    ...web.dependencies
  };

  for (const [name, version] of Object.entries(declared)) {
    assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, `${name} must be exact`);
  }

  assert.equal(root.engines.node, "24.21.0");
  assert.equal(root.packageManager, "npm@11.19.0");
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.packages[""].engines.node, "24.21.0");
});

test("environment example contains only public non-secret bootstrap settings", async () => {
  const env = await readFile(".env.example", "utf8");

  assert.match(env, /NEXT_PUBLIC_APP_URL=/);
  assert.match(env, /NEXT_PUBLIC_SUPABASE_URL=/);
  assert.match(env, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=/);
  assert.doesNotMatch(env, /SERVICE_ROLE|SECRET_KEY|PASSWORD=/i);
});

test("CI is review-gated quality verification and contains no deployment step", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");

  for (const command of [
    "npm ci",
    "npm run lint",
    "npm run typecheck",
    "npm test",
    "npm run build"
  ]) {
    assert.ok(workflow.includes(command), `CI must run: ${command}`);
  }

  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:/);
  assert.match(workflow, /branches:\s*\[master\]/);
  assert.doesNotMatch(workflow, /\bdeploy\b|vercel|production/i);
});
