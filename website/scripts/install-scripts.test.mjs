// The website's install scripts, run against stand-in node, npx, and git
// programs on a PATH that holds nothing else. Real installations are checked by
// verify-install.mjs in CI.
//
// Shells that are not installed are skipped. OPENTIG_REQUIRE_INSTALL_SHELLS
// lists the ones that must be present, such as "dash,pwsh,shellcheck".
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const windows = process.platform === 'win32';
const installSh = new URL('../public/install.sh', import.meta.url);
const installPs1 = new URL('../public/install.ps1', import.meta.url);
const shScript = readFileSync(installSh, 'utf8');
const psScript = readFileSync(installPs1, 'utf8');
const requiredTools = new Set((process.env.OPENTIG_REQUIRE_INSTALL_SHELLS ?? '').split(',').map(name => name.trim()).filter(Boolean));
const root = mkdtempSync(path.join(tmpdir(), 'opentig-install-scripts-'));
after(() => rmSync(root, { recursive: true, force: true }));

function which(name) {
  const extensions = windows ? ['.exe', '.cmd'] : [''];
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, name + extension);
      if (directory && existsSync(candidate)) return candidate;
    }
  }
  return null;
}

// The program's path, or a reason to skip the tests that need it.
function tool(name) {
  const found = which(name);
  if (!found && requiredTools.has(name)) throw new Error(`${name} is required by OPENTIG_REQUIRE_INSTALL_SHELLS but is not on PATH.`);
  return { path: found, skip: found ? false : `${name} is not installed` };
}

let directories = 0;
// A directory of stand-in programs; each one records its call in calls.log.
function fakePath(programs) {
  const directory = path.join(root, `bin-${directories++}`);
  mkdirSync(directory);
  const log = path.join(directory, 'calls.log');
  for (const [name, { output = '', code = 0 }] of Object.entries(programs)) {
    if (windows) {
      writeFileSync(path.join(directory, `${name}.cmd`), `@echo off\r\necho ${name} %*>>"${log}"\r\n${output ? `echo ${output}\r\n` : ''}exit /b ${code}\r\n`);
    } else {
      const file = path.join(directory, name);
      const stdin = name === 'npx' ? `if read -r line; then echo "stdin: $line" >>'${log}'; else echo 'stdin: empty' >>'${log}'; fi\n` : '';
      writeFileSync(file, `#!/bin/sh\necho "${name} $*" >>'${log}'\n${stdin}${output ? `echo '${output}'\n` : ''}exit ${code}\n`);
      chmodSync(file, 0o755);
    }
  }
  if (!windows && !programs.uname) symlinkSync(which('uname'), path.join(directory, 'uname'));
  return { directory, calls: () => existsSync(log) ? readFileSync(log, 'utf8') : '' };
}

const working = {
  node: { output: 'v24.11.0' },
  npx: {},
  git: { output: 'git version 2.47.1' },
};

const environment = (directory, extra = {}) => {
  const env = { PATH: directory, HOME: root, NO_COLOR: '1', ...extra };
  // PowerShell and cmd.exe need the system's own variables to start.
  if (windows) for (const name of ['SystemRoot', 'SYSTEMROOT', 'ComSpec', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'PSModulePath']) if (process.env[name]) env[name] = process.env[name];
  return env;
};

// Runs a program to completion in a new session on macOS and Linux: without a
// controlling terminal, the script cannot read /dev/tty even when the tests
// run from one.
function execute(command, args, { input, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, detached: !windows, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

const posixShells = windows ? [] : ['sh', 'dash', 'bash'].map(name => ({ name, ...tool(name) }));
const powerShells = (windows ? ['powershell', 'pwsh'] : ['pwsh']).map(name => ({ name, ...tool(name) }));

// install.sh piped into the shell, as `curl ... | sh` does.
async function runSh(shell, programs, { args = [], env = {}, script = shScript } = {}) {
  const fake = fakePath(programs);
  const result = await execute(shell.path, ['-s', '--', ...args], { input: script, env: environment(fake.directory, env) });
  return { ...result, output: result.stdout + result.stderr, calls: fake.calls() };
}

// install.ps1 piped into Invoke-Expression, as `irm ... | iex` does.
async function runPs(shell, programs, { env = {} } = {}) {
  const fake = fakePath(programs);
  const file = path.join(fake.directory, 'install.ps1.txt');
  writeFileSync(file, psScript);
  const result = await execute(shell.path, ['-NoProfile', '-NonInteractive', '-Command', `Get-Content -Raw -LiteralPath '${file}' | iex`], {
    env: environment(fake.directory, { DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1', ...env }), encoding: 'utf8',
  });
  return { ...result, output: result.stdout + result.stderr, calls: fake.calls() };
}

const failures = [
  { name: 'Node.js is missing', programs: { npx: {}, git: working.git }, message: 'Node.js 24 or later is required, but no node command was found on PATH.' },
  { name: 'Node.js is too old', programs: { ...working, node: { output: 'v22.12.0' } }, message: /Node\.js 24 or later is required; found Node\.js 22\.12\.0 at .*node/ },
  { name: 'npx is missing', programs: { node: working.node, git: working.git }, message: /npx, which comes with npm, was not found on PATH \(Node\.js 24\.11\.0 is at / },
  { name: 'Git is missing', programs: { node: working.node, npx: {} }, message: 'Git 2.31 or later is required, but no git command was found on PATH.' },
  { name: 'Git is too old', programs: { ...working, git: { output: 'git version 2.30.9' } }, message: /Git 2\.31 or later is required; found Git 2\.30\.9 at .*git/ },
];

describe('install.sh', () => {
  for (const shell of posixShells) {
    describe(`under ${shell.name}`, { skip: shell.skip }, () => {
      for (const failure of failures) {
        test(`stops with exit code 1 when ${failure.name}`, async () => {
          const result = await runSh(shell, failure.programs);
          assert.equal(result.status, 1, result.output);
          if (typeof failure.message === 'string') assert.ok(result.stderr.includes(failure.message), result.stderr);
          else assert.match(result.stderr, failure.message);
          assert.match(result.stderr, /Nothing was installed or changed\.\n$/);
          assert.match(result.stderr, failure.name.startsWith('Node') || failure.name.startsWith('npx') ? /https:\/\/nodejs\.org\/en\/download/ : /https:\/\/git-scm\.com\/downloads/);
          assert.doesNotMatch(result.calls, /^npx /m, 'npx must not run');
        });
      }

      test('refuses systems other than macOS and Linux', async () => {
        const windowsShell = await runSh(shell, { ...working, uname: { output: 'MINGW64_NT-10.0-26100' } });
        assert.equal(windowsShell.status, 1);
        assert.match(windowsShell.stderr, /irm https:\/\/opentig\.com\/install\.ps1 \| iex/);
        const other = await runSh(shell, { ...working, uname: { output: 'FreeBSD' } });
        assert.equal(other.status, 1);
        assert.match(other.stderr, /this system reports "FreeBSD"/);
        assert.doesNotMatch(windowsShell.calls + other.calls, /^npx /m);
      });

      test('runs service install from the published CLI with nothing on standard input', async () => {
        const result = await runSh(shell, working);
        assert.equal(result.status, 0, result.output);
        assert.match(result.calls, /^npx --yes --package=@opentig\/cli@latest opentig service install\nstdin: empty$/m);
        assert.match(result.stdout, /Package {2}@opentig\/cli@latest/);
        assert.ok(!result.stdout.includes('\u001b['), 'no color when the output is not a terminal');
      });

      test('pins a version, runs another package, and passes options through', async () => {
        const pinned = await runSh(shell, working, { env: { OPENTIG_VERSION: '1.0.0' }, args: ['--port', '6768', '--no-modify-path'] });
        assert.equal(pinned.status, 0, pinned.output);
        assert.match(pinned.calls, /^npx --yes --package=@opentig\/cli@1\.0\.0 opentig service install --port 6768 --no-modify-path$/m);
        const local = await runSh(shell, working, { env: { OPENTIG_VERSION: '1.0.0', OPENTIG_PACKAGE: '/tmp/opentig cli.tgz' } });
        assert.match(local.calls, /^npx --yes --package=\/tmp\/opentig cli\.tgz opentig service install$/m);
      });

      test('returns the exit code of a failed service install', async () => {
        const result = await runSh(shell, { ...working, npx: { code: 3 } });
        assert.equal(result.status, 3);
        assert.match(result.stderr, /OpenTig service install stopped with exit code 3\./);
      });

      test('a copy cut short runs nothing', async () => {
        const call = shScript.lastIndexOf('\nopentig_install ') + 1;
        // Every line end and a spread of points inside lines, up to a partial name on the last line.
        const cuts = new Set([call + 'opentig_inst'.length]);
        for (let index = 0; index < call; index++) if (shScript[index] === '\n' || index % 41 === 0) cuts.add(index);
        const programs = fakePath(working);
        for (const cut of cuts) {
          const result = await execute(shell.path, ['-s'], { input: shScript.slice(0, cut), env: environment(programs.directory) });
          assert.equal(programs.calls(), '', `a copy cut at byte ${cut} of ${shScript.length} ran a program (exit ${result.status})`);
        }
        // The same stand-ins notice a complete copy.
        await execute(shell.path, ['-s'], { input: shScript, env: environment(programs.directory) });
        assert.match(programs.calls(), /^npx /m);
      });
    });
  }

  const shellcheck = tool('shellcheck');
  test('passes shellcheck as a POSIX sh script', { skip: shellcheck.skip }, async () => {
    const result = await execute(shellcheck.path, ['--shell=sh', '--severity=style', fileURLToPath(installSh)], {});
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
});

describe('install.ps1', () => {
  for (const shell of powerShells) {
    describe(`under ${shell.name}`, { skip: shell.skip }, () => {
      for (const failure of failures) {
        test(`stops with an error when ${failure.name}`, async () => {
          const result = await runPs(shell, failure.programs);
          assert.equal(result.status, 1, result.output);
          if (typeof failure.message === 'string') assert.ok(result.output.includes(failure.message), result.output);
          else assert.match(result.output, failure.message);
          assert.match(result.output, /Nothing was installed or changed\./);
          assert.match(result.output, /OpenTig was not installed\./);
          assert.doesNotMatch(result.calls, /^npx /m, 'npx must not run');
        });
      }

      test('runs service install from the published CLI, or a pinned version or package', async () => {
        const latest = await runPs(shell, working);
        assert.equal(latest.status, 0, latest.output);
        assert.match(latest.calls, /^npx --yes --package=@opentig\/cli@latest opentig service install\s*$/m);
        const pinned = await runPs(shell, working, { env: { OPENTIG_VERSION: '1.0.0' } });
        assert.match(pinned.calls, /^npx --yes --package=@opentig\/cli@1\.0\.0 opentig service install\s*$/m);
        const local = await runPs(shell, working, { env: { OPENTIG_PACKAGE: path.join(root, 'opentig cli.tgz') } });
        assert.ok(local.calls.includes(`--package=${path.join(root, 'opentig cli.tgz')} opentig service install`), local.calls);
      });

      test('fails when service install fails, and leaves the session as it was', async () => {
        const failed = await runPs(shell, { ...working, npx: { code: 3 } });
        assert.equal(failed.status, 1);
        assert.match(failed.output, /OpenTig service install stopped with exit code 3\./);
        // Run in a session with its own settings, then read them back.
        const fake = fakePath(working);
        const file = path.join(fake.directory, 'install.ps1.txt');
        writeFileSync(file, psScript);
        const session = await execute(shell.path, ['-NoProfile', '-NonInteractive', '-Command', [
          "$ErrorActionPreference = 'Inquire'; Set-StrictMode -Off; $names = (Get-Variable).Name",
          `Get-Content -Raw -LiteralPath '${file}' | iex`,
          "$added = (Get-Variable).Name | Where-Object { $_ -notin $names -and $_ -notin @('names', 'LASTEXITCODE', '_') }",
          "Write-Output \"preference=$ErrorActionPreference added=$($added -join ',') functions=$(@(Get-Command Stop-Install, Find-Program -ErrorAction SilentlyContinue).Count)\"",
        ].join('\n')], { env: environment(fake.directory, { DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1' }) });
        assert.match(session.stdout, /^preference=Inquire added= functions=0$/m, session.stdout + session.stderr);
      });

      test('a copy cut short runs nothing', async () => {
        const fake = fakePath(working);
        const file = path.join(fake.directory, 'install.ps1.txt');
        writeFileSync(file, psScript);
        const cuts = [];
        for (let index = 1; index < psScript.trimEnd().length; index++) if (psScript[index] === '\n' || index % 37 === 0) cuts.push(index);
        const result = await execute(shell.path, ['-NoProfile', '-NonInteractive', '-Command', [
          `$text = Get-Content -Raw -LiteralPath '${file}'`,
          `foreach ($cut in @(${cuts.join(',')})) { try { Invoke-Expression $text.Substring(0, $cut) } catch { } }`,
          "Write-Output 'all cuts tried'",
        ].join('\n')], { env: environment(fake.directory, { DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1' }) });
        assert.match(result.stdout, /all cuts tried/, result.stdout + result.stderr);
        assert.equal(fake.calls(), '', 'a copy cut short ran a program');
        assert.equal((await runPs(shell, working)).calls.includes('npx '), true, 'the stand-ins notice a complete copy');
      });
    });
  }
});
