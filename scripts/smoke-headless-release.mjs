import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const version = execFileSync('opentig', ['--version'], { encoding: 'utf8' }).trim();
const home = await mkdtemp(path.join(tmpdir(), 'opentig-cli-smoke-'));
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
let child;
let exited;
let output = '';
async function start() {
  output = '';
  child = spawn('opentig', ['serve', '--home', home, '--host', '127.0.0.1', '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  exited = once(child, 'exit');
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.resume();
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('CLI exited before readiness.');
    try {
      const response = await fetch(`${origin}/readyz`, { signal: AbortSignal.timeout(1000) });
      if (response.ok && output.includes('#token=')) {
        assert.equal((await response.json()).appVersion, version);
        return;
      }
    } catch { /* Wait for the listener. */ }
    await delay(100);
  }
  throw new Error('CLI did not become ready within ten seconds.');
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    assert.deepEqual(await exited, [143, null], 'CLI must finish its SIGTERM handler');
    assert.equal(existsSync(path.join(home, 'runtime.json')), false, 'Shutdown must remove the runtime identity');
  }
  finally { clearTimeout(timer); }
}
try {
  await start();
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /OpenTig/);
  const descriptor = await fetch(`${origin}/api/auth/descriptor`);
  assert.equal((await descriptor.json()).authenticated, false);
  const url = output.match(/http:\/\/[^\s]+#token=[^\s]+/)?.[0];
  assert.ok(url, 'CLI prints a one-use pairing URL');
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get('token');
  const paired = await fetch(`${origin}/api/auth/pair`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ token, clientName: 'CLI release smoke' }),
  });
  assert.equal(paired.status, 204);
  const cookie = paired.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  await stop();
  await start();
  const resumed = await fetch(`${origin}/api/auth/descriptor`, { headers: { Cookie: cookie } });
  assert.equal((await resumed.json()).authenticated, true);
  console.log(`CLI_SMOKE_OK ${version}: global executable, HTTP/client, pairing, session after restart.`);
} finally {
  await stop();
  await rm(home, { recursive: true, force: true });
}
