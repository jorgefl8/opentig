// Runs a website install script for real, the way the website shows it, and
// checks that it leaves a working OpenTig service behind; then removes it.
//
//   node website/scripts/verify-install.mjs --shell dash --package dist/headless/opentig-cli-X.Y.Z.tgz
//
// --shell is sh, dash, bash, or zsh (install.sh, piped from curl) or
// powershell or pwsh (install.ps1, piped from irm into iex). Without
// --package, the script installs the published CLI it defaults to.
//
// With --package, the tarball is repacked with a random marker file, and the
// running service must come from it: a script that ignored OPENTIG_PACKAGE
// would install the published CLI, which can have the same version number.
//
// It registers the real per-user service, so run it only on a disposable
// machine such as a CI runner or a container: the service's data directory and
// port are temporary, but its name and the shell profile's PATH entry are the
// user's own.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));
const windows = process.platform === 'win32';
const { values } = parseArgs({ options: { shell: { type: 'string' }, package: { type: 'string' } } });
const shell = values.shell;
const powershell = shell === 'powershell' || shell === 'pwsh';
assert.ok(['sh', 'dash', 'bash', 'zsh', 'powershell', 'pwsh'].includes(shell), '--shell must be sh, dash, bash, zsh, powershell, or pwsh');
const script = powershell ? 'install.ps1' : 'install.sh';

// Serves the scripts with the content type the website's Worker gives them.
async function serveScripts() {
  const server = createServer(async (request, response) => {
    const name = request.url?.slice(1);
    if (name !== 'install.sh' && name !== 'install.ps1') return response.writeHead(404).end();
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(await readFile(path.join(publicDirectory, name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/${script}` };
}

async function freePort() {
  const server = createNetServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

// No standard input and, on macOS and Linux, a new session without a
// controlling terminal, so the script cannot open /dev/tty.
function run(command, args, env, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: !windows, windowsHide: true, ...options });
    let output = '';
    const collect = chunk => { output += chunk; process.stdout.write(chunk); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${command} did not finish in 8 minutes.`)); }, 8 * 60_000);
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); resolve({ code, output }); });
  });
}

async function ready(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/readyz`, { signal: AbortSignal.timeout(3_000) });
    const body = response.ok ? await response.json() : null;
    return body?.status === 'ready' ? body : null;
  } catch { return null; }
}

// A copy of the tarball with dist/install-check.txt added, and what that file holds.
// tar runs in the copy's folder with relative names, which every tar on Windows reads.
async function markedTarball(tarball) {
  const folder = await mkdtemp(path.join(tmpdir(), 'opentig-install-package-'));
  await copyFile(tarball, path.join(folder, 'given.tgz'));
  execFileSync('tar', ['-xzf', 'given.tgz'], { cwd: folder, windowsHide: true });
  const marker = randomUUID();
  await writeFile(path.join(folder, 'package', 'dist', 'install-check.txt'), marker);
  execFileSync('tar', ['-czf', 'marked.tgz', 'package'], { cwd: folder, windowsHide: true });
  const { version } = JSON.parse(await readFile(path.join(folder, 'package', 'package.json'), 'utf8'));
  return { folder, file: path.join(folder, 'marked.tgz'), marker, version };
}

async function publishedVersion() {
  const response = await fetch('https://registry.npmjs.org/@opentig%2fcli/latest', { signal: AbortSignal.timeout(15_000) });
  assert.ok(response.ok, `npm lookup failed: HTTP ${response.status}`);
  return (await response.json()).version;
}

const home = await mkdtemp(path.join(tmpdir(), 'opentig-install-'));
const port = await freePort();
// Only this run's home, port, and package reach the script.
const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !['OPENTIG_HOST', 'OPENTIG_VERSION', 'OPENTIG_PACKAGE'].includes(name)));
const packed = values.package ? await markedTarball(path.resolve(values.package)) : null;
const expectedVersion = packed ? packed.version : await publishedVersion();
const env = { ...inherited, OPENTIG_HOME: home, OPENTIG_PORT: String(port), ...packed ? { OPENTIG_PACKAGE: packed.file } : {} };
const command = path.join(home, 'bin', windows ? 'opentig.cmd' : 'opentig');
// The opentig command is a .cmd file on Windows, which only a shell can start.
const opentig = (...args) => windows
  ? run(`"${command}" ${args.map(arg => `"${arg}"`).join(' ')}`, [], env, { shell: true })
  : run(command, args, env);

const { server, url } = await serveScripts();
let failure;
try {
  console.log(`Installing with ${shell} from ${url} into a temporary home on port ${port}.`);
  const install = powershell
    ? await run(shell, ['-NoProfile', '-NonInteractive', '-Command', `irm '${url}' | iex`], env)
    : await run('sh', ['-c', `curl -fsSL '${url}' | ${shell}`], env);
  assert.equal(install.code, 0, `The ${script} run failed with exit code ${install.code}.`);
  assert.match(install.output, new RegExp(`OpenTig service installed and started on 127\\.0\\.0\\.1:${port}\\.`));
  assert.doesNotMatch(install.output, /Pair a device now\?/, 'Without a terminal the installer must not ask to pair.');
  assert.match(install.output, /One-time pairing link/, 'Without a terminal the installer prints the pairing link.');
  const readiness = await ready(port);
  assert.ok(readiness, 'The installed service does not answer /readyz.');
  assert.equal(readiness.appVersion, expectedVersion, 'The service runs another CLI version than the one given to the script.');
  if (packed) {
    // The service runs from its own copy of the package under <home>/service/app-<version>.
    const copies = (await readdir(path.join(home, 'service'))).filter(name => name.startsWith('app-'));
    const markers = await Promise.all(copies.map(name => readFile(path.join(home, 'service', name, 'dist', 'install-check.txt'), 'utf8').catch(() => null)));
    assert.ok(markers.includes(packed.marker), 'The service was not installed from the tarball given to the script.');
  }
  assert.ok(existsSync(command), `The opentig command is missing from ${command}.`);
  const status = await opentig('service', 'status', '--home', home);
  assert.equal(status.code, 0, 'opentig service status reports a problem.');
  console.log('The service is installed and answering.');
} catch (error) {
  failure = error;
} finally {
  server.close();
  const uninstall = existsSync(command) ? await opentig('service', 'uninstall', '--home', home).catch(error => ({ code: -1, output: String(error) })) : null;
  if (!failure && uninstall?.code !== 0) failure = new Error('opentig service uninstall failed.');
  if (!failure && await ready(port)) failure = new Error('The service still answers after uninstalling it.');
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  if (packed) await rm(packed.folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}
if (failure) throw failure;
console.log('Removed the service and its temporary home.');
