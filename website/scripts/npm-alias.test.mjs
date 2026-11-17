import assert from 'node:assert/strict';
import test from 'node:test';
import { checkBeforeDeploy, checkNpmAlias } from './npm-alias.mjs';

// Stand-in registry: each package's latest version, or null when it does not exist.
const registry = versions => async url => {
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!(name in versions)) throw new Error(`unexpected lookup: ${name}`);
  const latest = versions[name];
  return latest === null ? new Response('{}', { status: 404 }) : Response.json({ 'dist-tags': { latest } });
};

test('allows a deployment once the alias is on npm at the CLI version', async () => {
  assert.equal(await checkNpmAlias(registry({ '@opentig/cli': '1.1.0', opentig: '1.1.0' })), '1.1.0');
});

test('refuses a deployment before the alias is published or while it lags the CLI', async () => {
  await assert.rejects(checkNpmAlias(registry({ '@opentig/cli': '1.1.0', opentig: null })), /opentig@latest is not published while @opentig\/cli@latest is 1\.1\.0/);
  await assert.rejects(checkNpmAlias(registry({ '@opentig/cli': '1.1.0', opentig: '1.0.1' })), /opentig@latest is 1\.0\.1 while @opentig\/cli@latest is 1\.1\.0/);
});

test('fails rather than guessing when npm cannot answer', async () => {
  await assert.rejects(checkNpmAlias(async () => new Response('', { status: 503 })), /HTTP 503/);
});

test('the override deploys anyway, with a warning that names what the site gets wrong', async () => {
  const warnings = [];
  const missing = registry({ '@opentig/cli': '1.1.0', opentig: null });
  await assert.rejects(checkBeforeDeploy({ fetchImplementation: missing, warn: message => warnings.push(message) }), /not published/);
  assert.deepEqual(warnings, [], 'without the override nothing is waved through');
  const result = await checkBeforeDeploy({ fetchImplementation: missing, allowMismatch: true, warn: message => warnings.push(message) });
  assert.deepEqual(result, { version: null, overridden: true });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^WARNING: .*opentig@latest is not published while @opentig\/cli@latest is 1\.1\.0/);
  assert.match(warnings[0], /npx opentig@latest service install/);
  // A matching alias needs no override and prints no warning.
  assert.deepEqual(await checkBeforeDeploy({ fetchImplementation: registry({ '@opentig/cli': '1.1.0', opentig: '1.1.0' }), allowMismatch: true, warn: message => warnings.push(message) }),
    { version: '1.1.0', overridden: false });
  assert.equal(warnings.length, 1);
});
