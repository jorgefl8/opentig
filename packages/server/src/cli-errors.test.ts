import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { cliCommand, cliInvocation, CliError, diagnostic } from './cli-errors';
import { OPEN_TIG_APP_VERSION } from './version';

it('prints recovery commands that preserve literal home paths in the native shell', async () => {
  const windows = process.platform === 'win32';
  const home = windows ? "C:\\User Data\\O'Brien\\%PATH%\\$(Write-Output injected); & more"
    : "/tmp/O'Brien/$(echo injected); `echo injected` & more";
  const command = cliCommand(home, 'service', 'status');
  const execute = promisify(execFile);
  if (windows) {
    const powershell = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const script = `function opentig { ConvertTo-Json -InputObject @($args) -Compress }; ${command}`;
    const { stdout } = await execute(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true });
    expect(JSON.parse(stdout.trim())).toEqual(['service', 'status', '--home', home]);
  } else {
    const { stdout } = await execute('/bin/sh', ['-c', `opentig() { printf '%s\\0' "$@"; }; ${command}`]);
    expect(stdout.split('\0').slice(0, -1)).toEqual(['service', 'status', '--home', home]);
  }
});

it('redacts credentials and URL secrets from both the explanation and next steps', () => {
  const error = new CliError('FIXTURE', 'Authorization: Bearer very-private-credential', [
    'Open https://user:password@example.com/pair#token=private-token',
  ]);
  const text = diagnostic(error);
  expect(text).not.toContain('very-private-credential'); expect(text).not.toContain('password');
  expect(text).not.toContain('private-token');
});

it('prints runnable commands for npx installations that have no opentig command on PATH', () => {
  expect(cliInvocation('/Users/me/.npm/_npx/0123abcd/node_modules/@opentig/cli/dist/bin.mjs')).toBe(`npx -y @opentig/cli@${OPEN_TIG_APP_VERSION}`);
  expect(cliInvocation('C:\\Users\\me\\AppData\\Local\\npm-cache\\_npx\\0123abcd\\node_modules\\@opentig\\cli\\dist\\bin.mjs')).toMatch(/^npx -y /);
  expect(cliInvocation('/usr/local/lib/node_modules/@opentig/cli/dist/bin.mjs')).toBe('opentig');
  expect(cliInvocation('/Users/me/.opentig/service/app-1.2.3/dist/bin.mjs')).toBe('opentig');
});
