// Installs the packed opentig alias together with the packed @opentig/cli it
// depends on, then checks that the alias's command behaves as the CLI's own:
// the same version, help, and usage error, and a server that starts.
//
//   node scripts/smoke-npm-alias.mjs dist/headless
//
// Nothing comes from the npm registry except the CLI's own dependencies.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { bundledNpm } from './bundled-npm.mjs';

const directory = path.resolve(process.argv[2] ?? 'dist/headless');
const metadata = JSON.parse(await readFile(path.join(directory, 'opentig-headless.json'), 'utf8'));
if (!metadata.alias) {
  console.log(`No opentig alias was packed with @opentig/cli@${metadata.version}; nothing to check.`);
  process.exit(0);
}
const project = await mkdtemp(path.join(tmpdir(), 'opentig-alias-smoke-'));
const run = (entry, args) => {
  try {
    return { code: 0, stdout: execFileSync(process.execPath, [entry, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, OPENTIG_HOME: path.join(project, 'home') }, windowsHide: true }) };
  } catch (error) { return { code: error.status, stdout: error.stdout, stderr: error.stderr }; }
};
let child;
try {
  // The override stands in for the registry's copy of the same, not yet published, version.
  // Absolute paths with forward slashes: on Windows the checkout and the temporary
  // directory can be on different drives.
  const tarball = name => `file:${path.join(directory, name).replaceAll('\\', '/')}`;
  await writeFile(path.join(project, 'package.json'), JSON.stringify({
    private: true,
    dependencies: { opentig: tarball(metadata.alias.filename) },
    overrides: { '@opentig/cli': tarball(metadata.filename) },
  }));
  execFileSync(process.execPath, [bundledNpm().cli, 'install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: project, stdio: 'inherit', windowsHide: true });
  const aliasPackage = JSON.parse(await readFile(path.join(project, 'node_modules/opentig/package.json'), 'utf8'));
  const cliPackage = JSON.parse(await readFile(path.join(project, 'node_modules/@opentig/cli/package.json'), 'utf8'));
  assert.equal(aliasPackage.version, metadata.version);
  assert.equal(cliPackage.version, metadata.version);
  const lock = JSON.parse(await readFile(path.join(project, 'package-lock.json'), 'utf8'));
  assert.match(lock.packages['node_modules/@opentig/cli']?.resolved ?? '', /^file:/, 'the CLI must come from its packed tarball, not the registry');
  const alias = path.join(project, 'node_modules/opentig/bin.mjs');
  const cli = path.join(project, 'node_modules/@opentig/cli/dist/bin.mjs');

  assert.equal(run(alias, ['--version']).stdout.trim(), metadata.version, 'opentig --version');
  for (const args of [['--help'], ['--version'], ['not-a-command']]) {
    assert.deepEqual(run(alias, args), run(cli, args), `opentig ${args.join(' ')} must match @opentig/cli`);
  }
  assert.equal(run(alias, ['not-a-command']).code, 2);

  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  child = spawn(process.execPath, [alias, 'serve', '--home', path.join(project, 'home'), '--host', '127.0.0.1', '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  for (let attempt = 0; ; attempt++) {
    assert.equal(child.exitCode, null, `opentig serve exited early:\n${output}`);
    assert.ok(attempt < 150, `opentig serve did not become ready:\n${output}`);
    const ready = await fetch(`http://127.0.0.1:${port}/readyz`, { signal: AbortSignal.timeout(1000) }).then(response => response.ok && response.json()).catch(() => null);
    if (ready && output.includes('#token=')) {
      assert.equal(ready.appVersion, metadata.version);
      break;
    }
    await delay(100);
  }
  console.log(`ALIAS_SMOKE_OK opentig@${metadata.version}: same version, help, and usage error as @opentig/cli; serve became ready.`);
} finally {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  await rm(project, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
