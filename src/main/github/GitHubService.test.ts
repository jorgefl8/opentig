import { describe, expect, it, vi } from 'vitest';
import { GitHubService } from './GitHubService';
import type { CliProcessRunner, CliRunResult } from '../ai/CliProcessRunner';
import type { CliResolver } from '../ai/CliResolver';
import type { GitProcess } from '../git/GitProcess';
import type { RepositoryService } from '../git/RepositoryService';

const ok = (value: unknown): CliRunResult => ({ exitCode: 0, stdout: JSON.stringify(value), stderr: '' });
const fail = (stderr: string): CliRunResult => ({ exitCode: 1, stdout: '', stderr });
const stack = { number: 7, base: { ref: 'main' }, pull_requests: [{ number: 101, state: 'open', title: 'Model', head: { ref: 'model' } }] };
function fixture(reply: (args: string[]) => CliRunResult) {
  const run = vi.fn(async (_exe: string, args: string[]) => args[0] === '--version' || args[0] === 'auth' ? ok('ready') : reply(args));
  const service = new GitHubService(
    { discover: async () => [{ executable: 'gh', alias: 'gh', source: 'process-path', env: { PATH: '/fixture/bin' } }], warning: async () => undefined } as unknown as CliResolver,
    { run } as unknown as CliProcessRunner,
    { run: async () => ({ stdout: Buffer.from('https://github.com/example/demo.git') }) } as unknown as GitProcess,
    { get: () => ({ path: '.', id: 'repo' }) } as unknown as RepositoryService,
  );
  return { service, run };
}
describe('current branch pull requests', () => {
  it('finds an open draft even when a reused branch has newer closed history', async () => {
    const { service, run } = fixture((args) => ok(args.includes('open')
      ? [{ number: 12, state: 'OPEN', isDraft: true, headRefName: 'feature', url: 'https://github.com/example/demo/pull/12' }]
      : [{ number: 99, state: 'CLOSED', headRefName: 'feature' }]));
    expect(await service.findPullRequestForBranch('repo', 'feature')).toMatchObject({ number: 12, state: 'OPEN', isDraft: true });
    expect(run.mock.calls.filter(([, args]) => args[0] === 'pr').map(([, args]) => args)).toEqual([
      expect.arrayContaining(['--head', 'feature', '--state', 'open']),
    ]);
  });
  it('preserves closed and merged history for the branch details view', async () => {
    const { service } = fixture((args) => ok(args.includes('open') ? [] : [
      { number: 12, state: 'CLOSED', updatedAt: '2026-09-01' },
      { number: 13, state: 'MERGED', updatedAt: '2026-09-02' },
    ]));
    expect(await service.findPullRequestForBranch('repo', 'feature')).toMatchObject({ number: 13, state: 'MERGED' });
  });
  it('returns null when the branch has no PR and propagates lookup errors', async () => {
    expect(await fixture(() => ok([])).service.findPullRequestForBranch('repo', 'feature')).toBeNull();
    await expect(fixture(() => fail('HTTP 403: rate limit')).service.findPullRequestForBranch('repo', 'feature')).rejects.toThrow();
  });
});
describe('GitHub native stacks', () => {
  it('enriches visible PRs in bounded batches and preserves list ordering', async () => {
    const { service, run } = fixture((args) => {
      if (args[0] === 'pr') return ok(Array.from({ length: 27 }, (_, i) => ({ number: i + 1, state: 'OPEN', updatedAt: '2026-09-01' })));
      const numbers = [...args.join(' ').matchAll(/pr(\d+):pullRequest/g)].map((m) => Number(m[1]));
      return ok({ data: { repository: Object.fromEntries(numbers.map((n) => [`pr${n}`, { stack: { number: 7, size: 27, baseRefName: 'main' }, stackEntry: { position: n } }])) } });
    });
    const list = await service.listPullRequests('repo', ['OPEN']);
    expect(list.map((p) => p.number)).toEqual(Array.from({ length: 27 }, (_, i) => 27 - i));
    expect(list[0]?.stack?.position).toBe(27);
    expect(run.mock.calls.filter(([, args]) => args[0] === 'api')).toHaveLength(2);
  });
  it('keeps normal PRs and details usable when optional metadata fails', async () => {
    const { service } = fixture((args) => args[0] === 'pr' ? ok(args[1] === 'list' ? [{ number: 101, state: 'OPEN' }] : { number: 101, state: 'OPEN', body: 'Description' }) : fail('HTTP 403: rate limit'));
    expect(await service.listPullRequests('repo', ['OPEN'])).toEqual([expect.objectContaining({ number: 101 })]);
    const details = await service.getPullRequest('repo', 101);
    expect(details.body).toBe('Description');
    expect(details.stack).toBeUndefined();
  });
  it('fetches full layers only through the explicit stack read', async () => {
    const { service, run } = fixture((args) => ok(args[1]?.includes('?') ? [stack] : stack));
    expect(await service.getPullRequestStack('repo', 101)).toMatchObject({ number: 7, layers: [{ title: 'Model' }] });
    expect(run.mock.calls.filter(([, args]) => args[0] === 'api').map(([, args]) => args[1])).toEqual(['repos/example/demo/stacks?pull_request=101', 'repos/example/demo/stacks/7']);
  });
  it('distinguishes confirmed absence and unsupported preview from transient or auth failures', async () => {
    for (const response of [ok([]), fail('gh: Not Found (HTTP 404)')]) {
      expect(await fixture(() => response).service.getPullRequestStack('repo', 101)).toBeNull();
    }
    for (const response of [fail('HTTP 401: Bad credentials'), fail('HTTP 403: rate limit'), fail('HTTP 502: gateway'), ok({ broken: true })]) {
      await expect(fixture(() => response).service.getPullRequestStack('repo', 101)).rejects.toThrow();
    }
  });
  it('does not erase saved layers when the detail lookup fails or the stack changes', async () => {
    for (const response of [fail('HTTP 404: Not Found'), ok({ ...stack, number: 8 })]) {
      await expect(fixture((args) => args[1]?.includes('?') ? ok([stack]) : response).service.getPullRequestStack('repo', 101)).rejects.toThrow();
    }
  });
});
