import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CliError } from './cli-errors';
import { readStartup, requestStartup, startupReporter } from './cli-startup';
import { runCli } from './cli';
const git = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('./cli-runtime', async original => ({ ...await original<typeof import('./cli-runtime')>(), assertGitAvailable: git }));
let home: string;
beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'opentig-startup-'));
  await mkdir(path.join(home, 'service'));
  git.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(home, { recursive: true, force: true }); });
it('records errors before Git succeeds or normal server logging is initialized', async () => {
  const attempt = await requestStartup(home);
  vi.stubEnv('OPENTIG_SERVICE_HOME', home);
  git.mockRejectedValueOnce(new CliError('GIT_UNAVAILABLE', 'Git could not start.', ['Install Git and retry.']));
  const errors: string[] = [];
  expect(await runCli(['serve', '--home', home], {}, { out: () => undefined, error: message => errors.push(message) })).toBe(1);
  expect(await readStartup(home)).toMatchObject({ attempt, phase: 'failed', code: 'GIT_UNAVAILABLE', message: expect.stringContaining('Install Git') });
  expect(await readFile(path.join(home, 'logs/server.log'), 'utf8')).toContain('Git could not start');
  expect(errors.join('\n')).toContain('Install Git');
});
it('does not let an earlier process overwrite a newer pending or ready attempt', async () => {
  vi.stubEnv('OPENTIG_SERVICE_HOME', home);
  await requestStartup(home); const first = await startupReporter(home);
  const secondId = await requestStartup(home); const second = await startupReporter(home);
  await second!.ready('a'.repeat(32));
  await first!.failed(new CliError('OLD_FAILURE', 'Must not replace the current record.'));
  expect(await readStartup(home)).toMatchObject({ attempt: secondId, phase: 'ready', instanceId: 'a'.repeat(32) });
});
it('replaces a previous failed record on supervisor retry and redacts secrets', async () => {
  vi.stubEnv('OPENTIG_SERVICE_HOME', home);
  const attempt = await requestStartup(home); const first = await startupReporter(home);
  await first!.failed(new CliError('FIXTURE', 'token=private-secret'));
  const second = await startupReporter(home); await second!.ready('b'.repeat(32));
  expect((await readStartup(home))?.attempt).not.toBe(attempt);
  expect(await readFile(path.join(home, 'service/startup.json'), 'utf8')).not.toContain('private-secret');
  if (process.platform !== 'win32') expect((await stat(path.join(home, 'service/startup.json'))).mode & 0o777).toBe(0o600);
});
it('does not write service state for foreground instances or another home', async () => {
  vi.stubEnv('OPENTIG_SERVICE_HOME', path.join(home, 'other'));
  expect(await startupReporter(home)).toBeNull(); expect(await readStartup(home)).toBeNull();
});
it('ignores malformed startup records without treating them as current failures', async () => {
  await writeFile(path.join(home, 'service/startup.json'), '{');
  expect(await readStartup(home)).toBeNull();
  const attempt = await requestStartup(home); expect(await readStartup(home)).toMatchObject({ attempt, phase: 'pending' });
});
