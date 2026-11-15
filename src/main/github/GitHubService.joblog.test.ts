import { describe, expect, it, vi } from 'vitest';
import type { CliProcessRunner, CliRunOptions, CliRunResult } from '../ai/CliProcessRunner';
import type { CliResolver } from '../ai/CliResolver';
import type { GitProcess } from '../git/GitProcess';
import type { RepositoryService } from '../git/RepositoryService';
import { ACTION_JOB_LOG_LIMITS } from '../../shared/contracts';
import type { GitHubAccountsService } from './GitHubAccountsService';
import { GitHubService } from './GitHubService';

const ok = (value: unknown): CliRunResult => ({ exitCode: 0, stdout: JSON.stringify(value), stderr: '' });
const job = (overrides: Record<string, unknown> = {}) => ({
  id: 77, name: 'test', status: 'completed', conclusion: 'failure', started_at: '2026-11-13T21:57:38Z', completed_at: '2026-11-13T21:58:00Z',
  html_url: 'https://github.com/example/demo/actions/runs/5/job/77', runner_name: 'runner',
  steps: [
    { number: 1, name: 'Set up job', status: 'completed', conclusion: 'success', started_at: '2026-11-13T21:57:38Z', completed_at: '2026-11-13T21:57:39Z' },
    { number: 2, name: 'Run npm test', status: 'completed', conclusion: 'failure', started_at: '2026-11-13T21:57:39Z', completed_at: '2026-11-13T21:58:00Z' },
  ],
  ...overrides,
});
const LOG = [
  '2026-11-13T21:57:38.1000000Z Current runner version: \'2.338.2\'',
  '2026-11-13T21:57:39.5000000Z ##[group]Run npm test',
  '2026-11-13T21:57:39.6000000Z ##[endgroup]',
  '2026-11-13T21:57:59.9000000Z ##[error]Process completed with exit code 1.',
  '',
].join('\n');

/** The real service over a stubbed `gh`: `logs` answers the log download, given its arguments. */
function fixture(options: { job?: Record<string, unknown>; logs?: (args: string[], runOptions: CliRunOptions) => CliRunResult } = {}) {
  const run = vi.fn(async (_exe: string, args: string[], runOptions: CliRunOptions = {}): Promise<CliRunResult> => {
    if (runOptions.signal?.aborted) throw new Error('cancelled');
    if (args[0] === 'api' && args.at(-1)?.endsWith('/logs')) return options.logs?.(args, runOptions) ?? { exitCode: 0, stdout: LOG, stderr: '' };
    if (args[0] === 'api' && /actions\/jobs\/\d+$/.test(args[1] ?? '')) return ok(job(options.job));
    return ok({});
  });
  const accounts = { revisionFor: () => 3, authRevision: 1, onChange: () => () => undefined, context: () => ({ state: 'ready', login: 'sample', revision: 3 }), verifiedLogin: () => 'sample', refreshAuthentication: () => undefined, authenticate: async () => ({ auth: { env: {} }, executable: { executable: 'gh', alias: 'gh', source: 'process-path', env: {} }, context: { login: 'sample', revision: 3 } }) } as unknown as GitHubAccountsService;
  const service = new GitHubService(
    { discover: async () => [], warning: async () => undefined } as unknown as CliResolver,
    { run } as unknown as CliProcessRunner,
    { onInvalidate: () => undefined, readScope: (cwd: string) => cwd, run: async () => ({ stdout: Buffer.from('https://github.com/example/demo.git') }) } as unknown as GitProcess,
    { get: () => ({ path: '/work/demo', commonDir: '/work/demo/.git', id: 'repo' }) } as unknown as RepositoryService,
    accounts,
  );
  const logReads = () => run.mock.calls.filter(([, args]) => args.at(-1)?.endsWith('/logs'));
  return { service, run, logReads };
}

describe("reading a job's log", () => {
  it('reads it by step, with colors allowed through GitHub CLI, and keeps none of it', async () => {
    const { service, logReads } = fixture();
    const log = await service.getActionJobLog('repo', 77);
    expect(log).toMatchObject({ state: 'ready', jobId: 77, readCut: false, displayCut: false });
    if (log.state !== 'ready') return;
    expect(log.steps.map((step) => step.lines.map((line) => line.kind))).toEqual([['output'], ['group', 'endgroup', 'error']]);
    const [[, args, runOptions]] = logReads() as [[string, string[], CliRunOptions]];
    expect(args).toEqual(['api', '--allow-escape-sequences', 'repos/example/demo/actions/jobs/77/logs']);
    expect(runOptions).toMatchObject({ maxOutputBytes: ACTION_JOB_LOG_LIMITS.readBytes, allowTruncatedOutput: true });
    // A log may hold what a workflow printed: it is not among the answers the server keeps or writes to disk.
    expect(service.cache.size).toBe(0);
  });

  it('does not ask for the log of a job that has not finished', async () => {
    const { service, logReads } = fixture({ job: { status: 'in_progress', conclusion: null, completed_at: null } });
    expect(await service.getActionJobLog('repo', 77)).toEqual({ state: 'pending', jobId: 77 });
    expect(logReads()).toHaveLength(0);
  });

  it('says a job that never ran has no log', async () => {
    const { service, logReads } = fixture({ job: { conclusion: 'skipped', started_at: null } });
    expect(await service.getActionJobLog('repo', 77)).toEqual({ state: 'unavailable', jobId: 77, reason: 'not-run' });
    expect(logReads()).toHaveLength(0);
  });

  it('reads it again without the flag from a GitHub CLI too old to know it', async () => {
    const { service, logReads } = fixture({ logs: (args) => args.includes('--allow-escape-sequences')
      ? { exitCode: 1, stdout: '', stderr: 'unknown flag: --allow-escape-sequences\n\nUsage:  gh api <endpoint> [flags]' }
      : { exitCode: 0, stdout: LOG, stderr: '' } });
    expect(await service.getActionJobLog('repo', 77)).toMatchObject({ state: 'ready' });
    expect(logReads().map(([, args]) => args)).toEqual([
      ['api', '--allow-escape-sequences', 'repos/example/demo/actions/jobs/77/logs'],
      ['api', 'repos/example/demo/actions/jobs/77/logs'],
    ]);
  });

  it('says the log is gone when GitHub answers 404 or 410 for a finished job', async () => {
    for (const status of ['404', '410']) {
      const { service } = fixture({ logs: () => ({ exitCode: 1, stdout: '{"message":"Not Found"}', stderr: `gh: Not Found (HTTP ${status})` }) });
      expect(await service.getActionJobLog('repo', 77)).toEqual({ state: 'unavailable', jobId: 77, reason: 'expired' });
    }
  });

  it('fails with what GitHub refused, and the account that asked', async () => {
    const { service } = fixture({ logs: () => ({ exitCode: 1, stdout: '', stderr: 'gh: Resource not accessible by integration (HTTP 403)' }) });
    await expect(service.getActionJobLog('repo', 77)).rejects.toMatchObject({ detail: { code: 'GH_ACCESS_DENIED' }, message: expect.stringContaining('@sample') });
  });

  it('shows the start of a log larger than it reads, and says so', async () => {
    const { service } = fixture({ logs: () => ({ exitCode: 0, stdout: `${LOG}2026-11-13T21:58:00.1Z partial li`, stderr: '', truncated: true }) });
    const log = await service.getActionJobLog('repo', 77);
    expect(log).toMatchObject({ state: 'ready', readCut: true, totalLines: 4 });
  });

  it('stops when the request is cancelled', async () => {
    const controller = new AbortController();
    const { service, logReads } = fixture({ logs: () => { controller.abort(); return { exitCode: 0, stdout: LOG, stderr: '' }; } });
    controller.abort();
    await expect(service.getActionJobLog('repo', 77, controller.signal)).rejects.toThrow();
    expect(logReads()).toHaveLength(0);
  });
});
