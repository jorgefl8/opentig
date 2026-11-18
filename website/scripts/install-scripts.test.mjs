// The website's install scripts, run against stand-in node, npx, and git
// programs on a PATH that holds nothing else. Real installations are checked by
// verify-install.mjs in CI.
//
// Shells and tools that are not installed are skipped, except the ones listed
// in OPENTIG_REQUIRE_INSTALL_SHELLS (such as "dash,pwsh,shellcheck") or, when
// CI is set and that variable is not, the ones every CI runner of this system
// must have, so a changed runner image cannot skip them unnoticed.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const windows = process.platform === 'win32';
const installSh = fileURLToPath(new URL('../public/install.sh', import.meta.url));
const installPs1 = fileURLToPath(new URL('../public/install.ps1', import.meta.url));
const shScript = readFileSync(installSh, 'utf8');
const psScript = readFileSync(installPs1, 'utf8');
const ciTools = { linux: 'sh,dash,bash,pwsh,shellcheck', darwin: 'sh,bash,zsh', win32: 'powershell,pwsh' };
const requiredList = process.env.OPENTIG_REQUIRE_INSTALL_SHELLS ?? (process.env.CI ? ciTools[process.platform] ?? '' : '');
const requiredTools = new Set(requiredList.split(',').map(name => name.trim()).filter(Boolean));
// Spaces in every path: the stand-in Node.js lives in a folder with a space, like C:\Program Files\nodejs.
const root = mkdtempSync(path.join(tmpdir(), 'opentig install scripts '));
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
  if (!found && requiredTools.has(name)) throw new Error(`${name} is required (${process.env.OPENTIG_REQUIRE_INSTALL_SHELLS === undefined ? 'CI is set' : 'OPENTIG_REQUIRE_INSTALL_SHELLS'}) but is not on PATH.`);
  return { path: found, skip: found ? false : `${name} is not installed` };
}

// Windows stand-ins must be real programs: the script runs node.exe directly.
// One small console program, copied under each name, logs its arguments and
// prints <name>.out and exits with <name>.code from its own folder.
let fakeProgram;
function windowsFake() {
  if (fakeProgram) return fakeProgram;
  const source = path.join(root, 'fake.cs');
  fakeProgram = path.join(root, 'fake.exe');
  writeFileSync(source, `using System;
using System.IO;
public static class Fake {
  public static int Main(string[] args) {
    string exe = System.Reflection.Assembly.GetEntryAssembly().Location;
    string directory = Path.GetDirectoryName(exe);
    string name = Path.GetFileNameWithoutExtension(exe);
    string line = name;
    foreach (string argument in args) line += " [" + argument + "]";
    string cut = Environment.GetEnvironmentVariable("OPENTIG_TEST_CUT");
    if (!String.IsNullOrEmpty(cut)) line = "cut " + cut + ": " + line;
    File.AppendAllText(Path.Combine(directory, "calls.log"), line + "\\n");
    string output = Path.Combine(directory, name + ".out");
    if (File.Exists(output)) Console.WriteLine(File.ReadAllText(output).Trim());
    string code = Path.Combine(directory, name + ".code");
    return File.Exists(code) ? int.Parse(File.ReadAllText(code).Trim()) : 0;
  }
}
`);
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Add-Type -Path '${source}' -OutputAssembly '${fakeProgram}' -OutputType ConsoleApplication`], { stdio: 'inherit' });
  return fakeProgram;
}

let directories = 0;
// A folder of stand-in programs; each one records its call in calls.log as
// "name [argument] [argument]".
function fakePath(programs, extra = []) {
  const directory = path.join(root, `Program Files ${directories++}`);
  mkdirSync(directory);
  const log = path.join(directory, 'calls.log');
  for (const name of extra) programs = { ...programs, [name]: programs[name] ?? {} };
  for (const [name, { output = '', code = 0 }] of Object.entries(programs)) {
    if (windows) {
      if (name === 'npx') {
        // Never run: the script starts npm's npx-cli.js with node.exe instead.
        writeFileSync(path.join(directory, 'npx.cmd'), `@echo off\r\necho npx.cmd %*>>"${log}"\r\nexit /b 1\r\n`);
        if (programs.npx.script !== false) {
          mkdirSync(path.join(directory, 'node_modules', 'npm', 'bin'), { recursive: true });
          writeFileSync(path.join(directory, 'node_modules', 'npm', 'bin', 'npx-cli.js'), '');
        }
        // npx's exit code is node.exe's here.
        if (code) writeFileSync(path.join(directory, 'node.code'), String(code));
        continue;
      }
      copyFileSync(windowsFake(), path.join(directory, `${name}.exe`));
      if (output) writeFileSync(path.join(directory, `${name}.out`), output);
      if (code) writeFileSync(path.join(directory, `${name}.code`), String(code));
    } else {
      const file = path.join(directory, name);
      const stdin = name === 'npx' ? `if read -r line; then echo "stdin: $line" >>'${log}'; else echo 'stdin: empty' >>'${log}'; fi\n` : '';
      writeFileSync(file, `#!/bin/sh\n{ [ -z "\${OPENTIG_TEST_CUT:-}" ] || printf 'cut %s: ' "$OPENTIG_TEST_CUT"; printf '%s' '${name}'; for argument do printf ' [%s]' "$argument"; done; printf '\\n'; } >>'${log}'\n${stdin}${output ? `echo '${output}'\n` : ''}exit ${code}\n`);
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

// The arguments npx received, as "[argument] [argument]", whichever way the script started it.
function npxArguments(calls) {
  return calls.match(/^(?:npx|node \[[^\]]*npx-cli\.js\])((?: \[[^\]]*\])*)$/m)?.[1].trim() ?? null;
}
const bracketed = (...values) => values.map(value => `[${value}]`).join(' ');
const serviceInstall = (pkg, ...options) => bracketed('--yes', `--package=${pkg}`, 'opentig', 'service', 'install', ...options);

const environment = (directory, extra = {}) => {
  if (!windows) return { PATH: directory, HOME: root, NO_COLOR: '1', ...extra };
  // Windows programs, the stand-ins included, need the system's own variables
  // to start, so only PATH is doctored: the stand-ins first, then the Windows
  // folders, which hold neither Node.js nor Git.
  const system = process.env.SystemRoot ?? 'C:\\Windows';
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(path|home|homedrive|homepath|userprofile|no_color|opentig_.*)$/i.test(name)));
  // The stand-in home is what ~ means to PowerShell and npm on Windows.
  return { ...inherited, PATH: [directory, `${system}\\System32`, system, `${system}\\System32\\WindowsPowerShell\\v1.0`].join(';'), HOME: root, USERPROFILE: root, NO_COLOR: '1', ...extra };
};

// Runs a program to completion in a new session on macOS and Linux: without a
// controlling terminal, the script cannot read /dev/tty even when the tests
// run from one.
function execute(command, args, { input, env, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, cwd, detached: !windows, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
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

const posixShells = windows ? [] : ['sh', 'dash', 'bash', 'zsh'].map(name => ({ name, ...tool(name) }));
const powerShells = (windows ? ['powershell', 'pwsh'] : ['pwsh']).map(name => ({ name, ...tool(name) }));

// install.sh piped into the shell, as `curl ... | sh` does.
async function runSh(shell, programs, { args = [], env = {}, cwd } = {}) {
  const fake = fakePath(programs);
  const result = await execute(shell.path, ['-s', '--', ...args], { input: shScript, env: environment(fake.directory, env), cwd });
  return { ...result, output: result.stdout + result.stderr, calls: fake.calls() };
}

// install.ps1 piped into Invoke-Expression, as `irm ... | iex` does.
async function runPs(shell, programs, { env = {}, cwd } = {}) {
  const fake = fakePath(programs);
  const file = path.join(fake.directory, 'install.ps1.txt');
  writeFileSync(file, psScript);
  const result = await execute(shell.path, ['-NoProfile', '-NonInteractive', '-Command', `Get-Content -Raw -LiteralPath '${file}' | iex`], {
    env: environment(fake.directory, { DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1', ...env }), cwd,
  });
  return { ...result, output: result.stdout + result.stderr, calls: fake.calls() };
}

const failures = [
  { name: 'Node.js is missing', programs: { npx: {}, git: working.git }, message: 'Node.js 24 or later is required, but no node command was found on PATH.' },
  { name: 'Node.js is too old', programs: { ...working, node: { output: 'v22.12.0' } }, message: /Node\.js 24 or later is required; found Node\.js 22\.12\.0 at .*Program Files \d+.node/ },
  { name: 'npx is missing', programs: { node: working.node, git: working.git }, message: /npx, which comes with npm, was not found on PATH \(Node\.js 24\.11\.0 is at / },
  { name: 'Git is missing', programs: { node: working.node, npx: {} }, message: 'Git 2.31 or later is required, but no git command was found on PATH.' },
  { name: 'Git is too old', programs: { ...working, git: { output: 'git version 2.30.9' } }, message: /Git 2\.30\.9 at .*git/ },
];

// A folder with a space, holding dist/opentig cli.tgz, and a tarball in the stand-in home.
const work = path.join(root, 'my work');
mkdirSync(path.join(work, 'dist'), { recursive: true });
writeFileSync(path.join(work, 'dist', 'opentig cli.tgz'), '');
writeFileSync(path.join(root, 'home.tgz'), '');
const absoluteTarball = path.join(work, 'dist', 'opentig cli.tgz');

// [OPENTIG_PACKAGE, OPENTIG_VERSION, the package npx gets]; a relative path gets the system's ./ or .\.
const allowedPackages = [
  [undefined, undefined, '@opentig/cli@latest'],
  [undefined, '1.0.0', '@opentig/cli@1.0.0'],
  [undefined, '1.1.0-rc.1', '@opentig/cli@1.1.0-rc.1'],
  [undefined, 'next', '@opentig/cli@next'],
  ['@opentig/cli@1.0.0', undefined, '@opentig/cli@1.0.0'],
  ['@opentig/cli', '1.2.3', '@opentig/cli@1.2.3'],
  [absoluteTarball, '1.0.0', absoluteTarball],
  ['dist/opentig cli.tgz', undefined, `.${path.sep}dist/opentig cli.tgz`],
  ['./dist/opentig cli.tgz', undefined, './dist/opentig cli.tgz'],
  ['~/home.tgz', undefined, '~/home.tgz'],
];
// [OPENTIG_PACKAGE, OPENTIG_VERSION, message]
const refusedPackages = [
  [undefined, '^1.0.0', /OPENTIG_VERSION must be a version such as 1\.0\.0 or a tag such as latest, not "\^1\.0\.0"/],
  [undefined, '1.0', /OPENTIG_VERSION must be/],
  [undefined, 'latest && echo', /OPENTIG_VERSION must be/],
  [undefined, '../x', /OPENTIG_VERSION must be/],
  ['dist/missing.tgz', undefined, /OPENTIG_PACKAGE names dist\/missing\.tgz, but there is no such file/],
  ['user/repository', undefined, /OPENTIG_PACKAGE must be @opentig\/cli, optionally.*not "user\/repository"/],
  ['github:user/repository', undefined, /OPENTIG_PACKAGE must be @opentig\/cli,/],
  ['https://example.com/opentig.git', undefined, /OPENTIG_PACKAGE must be @opentig\/cli,/],
  ['other-package', undefined, /OPENTIG_PACKAGE must be @opentig\/cli,/],
  ['opentig', undefined, /OPENTIG_PACKAGE must be @opentig\/cli,.*not "opentig"/],
  ['opentig@latest', undefined, /OPENTIG_PACKAGE must be @opentig\/cli,.*not "opentig@latest"/],
  ['@opentig/cli@^1', undefined, /OPENTIG_PACKAGE must end in a version such as 1\.0\.0 or a tag such as latest, not "\^1"/],
  ['@opentig/cli@1.0.0&calc', undefined, /OPENTIG_PACKAGE must end in a version/],
  ['dist/opentig"cli.tgz', undefined, /OPENTIG_PACKAGE must not contain quotes or line breaks/],
];
const variables = (pkg, version) => ({ ...pkg === undefined ? {} : { OPENTIG_PACKAGE: pkg }, ...version === undefined ? {} : { OPENTIG_VERSION: version } });

// How many prefixes of a script lack its final closing brace: cuts at bytes
// 0 to this length minus one must run nothing.
function cutLength(script) {
  return Buffer.byteLength(script.trimEnd());
}
// Every proper prefix of install.sh as its own file, shared by the shells.
let cutsDirectory;
function shCuts() {
  if (cutsDirectory) return cutsDirectory;
  cutsDirectory = path.join(root, 'install.sh cuts');
  mkdirSync(cutsDirectory);
  const bytes = Buffer.from(shScript);
  for (let cut = 0; cut < cutLength(shScript); cut++) writeFileSync(path.join(cutsDirectory, String(cut)), bytes.subarray(0, cut));
  return cutsDirectory;
}
// The words a cut inside the function's name or its call could leave behind.
const cutWords = ['opentig', ...Array.from('opentig_install', (_, index) => 'opentig_install'.slice(0, index + 1))];

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
          assert.equal(npxArguments(result.calls), null, 'npx must not run');
        });
      }

      test('refuses systems other than macOS and Linux', async () => {
        const windowsShell = await runSh(shell, { ...working, uname: { output: 'MINGW64_NT-10.0-26100' } });
        assert.equal(windowsShell.status, 1);
        assert.match(windowsShell.stderr, /irm https:\/\/opentig\.com\/install\.ps1 \| iex/);
        const other = await runSh(shell, { ...working, uname: { output: 'FreeBSD' } });
        assert.equal(other.status, 1);
        assert.match(other.stderr, /this system reports "FreeBSD"/);
        assert.equal(npxArguments(windowsShell.calls + other.calls), null);
      });

      test('runs service install from the published CLI with nothing on standard input', async () => {
        const result = await runSh(shell, working);
        assert.equal(result.status, 0, result.output);
        assert.equal(npxArguments(result.calls), serviceInstall('@opentig/cli@latest'));
        assert.match(result.calls, /^stdin: empty$/m);
        assert.match(result.stdout, /Package {2}@opentig\/cli@latest/);
        assert.ok(!result.stdout.includes('\u001b['), 'no color when the output is not a terminal');
      });

      test('passes options with spaces through unchanged', async () => {
        const result = await runSh(shell, working, { args: ['--home', '/srv/open tig', '--no-modify-path'] });
        assert.equal(npxArguments(result.calls), serviceInstall('@opentig/cli@latest', '--home', '/srv/open tig', '--no-modify-path'));
      });

      test('turns the allowed package and version values into an unambiguous npm package', async () => {
        for (const [pkg, version, expected] of allowedPackages) {
          const result = await runSh(shell, working, { env: variables(pkg, version), cwd: work });
          assert.equal(result.status, 0, `${pkg} ${version}: ${result.output}`);
          assert.equal(npxArguments(result.calls), serviceInstall(expected), `${pkg} ${version}`);
        }
      });

      test('refuses any other value before anything runs', async () => {
        for (const [pkg, version, message] of refusedPackages) {
          const result = await runSh(shell, working, { env: variables(pkg, version), cwd: work });
          assert.equal(result.status, 1, `${pkg} ${version}: ${result.output}`);
          assert.match(result.stderr, message);
          assert.equal(result.calls, '', `${pkg} ${version}: nothing may run`);
        }
      });

      test('returns the exit code of a failed service install', async () => {
        const result = await runSh(shell, { ...working, npx: { code: 3 } });
        assert.equal(result.status, 3);
        assert.match(result.stderr, /OpenTig service install stopped with exit code 3\./);
      });

      test('a copy cut short at any byte runs nothing', async () => {
        const fake = fakePath(working, cutWords);
        const report = path.join(fake.directory, 'printed.log');
        // One driver per range of cuts; each cut costs one process.
        const driver = path.join(fake.directory, 'cuts.sh');
        writeFileSync(driver, [
          'shell=$1 cuts=$2 from=$3 to=$4 report=$5',
          'i=$from',
          'while [ "$i" -lt "$to" ]; do',
          '  out=$(OPENTIG_TEST_CUT=$i "$shell" <"$cuts/$i" 2>/dev/null)',
          '  [ -z "$out" ] || printf \'cut %s printed: %s\\n\' "$i" "$out" >>"$report"',
          '  i=$((i + 1))',
          'done',
        ].join('\n'));
        const length = cutLength(shScript);
        const workers = Math.max(2, Math.min(8, availableParallelism()));
        const size = Math.ceil(length / workers);
        // The driver's own environment is the stand-ins' PATH and home, nothing else.
        await Promise.all(Array.from({ length: workers }, (_, worker) => execute('/bin/sh', [driver, shell.path, shCuts(), String(worker * size), String(Math.min(length, (worker + 1) * size)), report],
          { env: { PATH: fake.directory, HOME: root } })));
        assert.equal(fake.calls(), '', 'a copy cut short ran a program');
        assert.equal(existsSync(report) ? readFileSync(report, 'utf8') : '', '', 'a copy cut short printed something');
        // The same stand-ins notice a complete copy.
        await execute(shell.path, ['-s'], { input: shScript, env: environment(fake.directory) });
        assert.notEqual(npxArguments(fake.calls()), null);
      });
    });
  }

  const shellcheck = tool('shellcheck');
  test('passes shellcheck as a POSIX sh script', { skip: shellcheck.skip }, async () => {
    const result = await execute(shellcheck.path, ['--shell=sh', '--severity=style', installSh], {});
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
          assert.equal(npxArguments(result.calls), null, 'npx must not run');
        });
      }

      test('runs service install from the published CLI with a Node.js in a folder with spaces', async () => {
        const result = await runPs(shell, working);
        assert.equal(result.status, 0, result.output);
        assert.equal(npxArguments(result.calls), serviceInstall('@opentig/cli@latest'));
        // On Windows, node.exe starts npm's npx-cli.js; nothing goes through npx.cmd and cmd.exe.
        if (windows) assert.match(result.calls, /^node \[[^\]]*Program Files \d+\\node_modules\\npm\\bin\\npx-cli\.js\] /m);
        assert.doesNotMatch(result.calls, /npx\.cmd/);
      });

      if (windows) {
        test('stops when npm\'s npx-cli.js is not beside npx.cmd or node.exe', async () => {
          const result = await runPs(shell, { ...working, npx: { script: false } });
          assert.equal(result.status, 1, result.output);
          assert.match(result.output, /npx was found at .*npx\.cmd, but not npm's npx-cli\.js/);
          assert.equal(npxArguments(result.calls), null);
        });
      }

      test('turns the allowed package and version values into an unambiguous npm package', async () => {
        for (const [pkg, version, expected] of allowedPackages) {
          const result = await runPs(shell, working, { env: variables(pkg, version), cwd: work });
          assert.equal(result.status, 0, `${pkg} ${version}: ${result.output}`);
          assert.equal(npxArguments(result.calls), serviceInstall(expected), `${pkg} ${version}`);
        }
      });

      test('refuses any other value before anything runs', async () => {
        for (const [pkg, version, message] of refusedPackages) {
          const result = await runPs(shell, working, { env: variables(pkg, version), cwd: work });
          assert.equal(result.status, 1, `${pkg} ${version}: ${result.output}`);
          assert.match(result.output, message);
          assert.equal(result.calls, '', `${pkg} ${version}: nothing may run`);
        }
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

      test('a copy cut short at any character runs nothing', async () => {
        const fake = fakePath(working);
        const file = path.join(fake.directory, 'install.ps1.txt');
        writeFileSync(file, psScript);
        const result = await execute(shell.path, ['-NoProfile', '-NonInteractive', '-Command', [
          `$text = [IO.File]::ReadAllText('${file}')`,
          `for ($cut = 0; $cut -lt ${cutLength(psScript)}; $cut++) { $env:OPENTIG_TEST_CUT = "$cut"; try { $null = Invoke-Expression $text.Substring(0, $cut) } catch { } }`,
          "Write-Output 'all cuts tried'",
        ].join('\n')], { env: environment(fake.directory, { DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1' }) });
        assert.equal(result.stdout.trim(), 'all cuts tried', 'a copy cut short printed something or failed');
        assert.equal(fake.calls(), '', 'a copy cut short ran a program');
        assert.notEqual(npxArguments((await runPs(shell, working)).calls), null, 'the stand-ins notice a complete copy');
      });
    });
  }
});
