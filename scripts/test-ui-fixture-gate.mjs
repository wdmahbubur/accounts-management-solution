import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const require = createRequire(import.meta.url);
const cli = require.resolve('next/dist/bin/next', { paths: [resolve('apps/web')] });
const server = spawn(process.execPath, [cli, 'start', '--hostname', '127.0.0.1', '--port', '3001'], {
  cwd: resolve('apps/web'), env: { ...process.env, NODE_ENV: 'production', AMS_UI_TEST_HARNESS: '' }, stdio: ['ignore', 'pipe', 'pipe']
});
let logs = ''; server.stdout.on('data', (chunk) => { logs += chunk.toString(); });
server.stderr.on('data', (chunk) => { logs += chunk.toString(); });
try {
  let response;
  for (let n = 0; n < 100; n++) {
    if (server.exitCode !== null) throw new Error(`Production smoke server exited: ${logs}`);
    try { response = await fetch('http://127.0.0.1:3001/internal/ui-fixtures'); break; } catch { await delay(100); }
  }
  assert.ok(response, 'Production smoke server did not become ready.');
  assert.equal(response.status, 404, 'Synthetic UI route must be disabled in ordinary deployment runtime.');
  assert.doesNotMatch(await response.text(), /UI test fixtures — synthetic only|Confirmed actions:/);
  console.log('US-082 production-runtime fixture gate PASS: /internal/ui-fixtures is 404 without the explicit isolated test flag.');
} finally {
  server.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => server.once('exit', resolve)), delay(2000)]);
  if (server.exitCode === null) server.kill('SIGKILL');
}
