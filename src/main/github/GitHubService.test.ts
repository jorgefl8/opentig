import { describe, expect, it, vi } from 'vitest';
import { GitHubService } from './GitHubService';
import type { CliProcessRunner, CliRunResult } from '../ai/CliProcessRunner';
import type { CliResolver } from '../ai/CliResolver';
import type { GitProcess } from '../git/GitProcess';
import type { RepositoryService } from '../git/RepositoryService';

const ok = (value: unknown): CliRunResult => ({ exitCode: 0, stdout: JSON.stringify(value), stderr: '' });
const fail = (stderr: string): CliRunResult => ({ exitCode: 1, stdout: '', stderr });
const stack = { number: 7, base: { ref: 'main' }, pull_requests: [{ number: 101, state: 'open', title: 'Model', head: { ref: 'model' } }] };
function fixture(reply: (args: string[]) => CliRunResult, remoteUrl = 'https://github.com/example/demo.git', sshResult: CliRunResult | Error = fail('SSH unavailable')) {
  const run = vi.fn(async (exe: string, args: string[]) => {
    if (exe === 'ssh') {
      if (sshResult instanceof Error) throw sshResult;
      if (args[0] === '-T' && sshResult.exitCode === 0) return { exitCode: 1, stdout: '', stderr: "Hi tester! You've successfully authenticated, but GitHub does not provide shell access.\n" };
      return sshResult;
    }
    if (args[0] === 'auth' && args[1] === 'token') return { exitCode: 0, stdout: 'gho_test_0000000000000000000000000', stderr: '' };
    if (args[0] === 'api' && args[1] === 'user') return { exitCode: 0, stdout: 'tester', stderr: '' };
    return args[0] === '--version' || args[0] === 'auth' ? ok('ready') : reply(args);
  });
  const service = new GitHubService(
    { discover: async () => [{ executable: 'gh', alias: 'gh', source: 'process-path', env: { PATH: '/fixture/bin' } }], warning: async () => undefined } as unknown as CliResolver,
    { run } as unknown as CliProcessRunner,
    { run: async (_cwd: string, args: string[]) => ({ stdout: Buffer.from(args.includes('core.sshCommand') ? '' : remoteUrl) }) } as unknown as GitProcess,
    { get: () => ({ path: '.', id: 'repo' }) } as unknown as RepositoryService,
  );
  return { service, run };
}
describe('GitHub SSH remote detection', () => {
  it.each([
    ['git@work-github:example/demo.git', ['-G', '--', 'git@work-github']],
    ['ssh://git@work-github:2222/example/demo.git', ['-G', '-p', '2222', '--', 'git@work-github']],
    ['ssh://work-github/example/demo.git', ['-G', '--', 'work-github']],
    ['work-github:example/demo.git', ['-G', '--', 'work-github']],
  ])('enables PR listing for %s when SSH resolves to GitHub', async (remoteUrl, sshArgs) => {
    const { service, run } = fixture((args) => ok(args[0] === 'pr' ? [{ number: 12, state: 'OPEN' }] : {}), remoteUrl,
      { exitCode: 0, stdout: 'user git\r\nhostname github.com\r\nport 22\r\n', stderr: '' });
    expect(await service.repositoryInfo('repo')).toEqual({ isGitHub: true, nameWithOwner: 'example/demo' });
    expect(run).toHaveBeenCalledWith('ssh', sshArgs, expect.objectContaining({ timeoutMs: 5_000 }));
    expect(run.mock.calls.every(([exe]) => exe === 'ssh')).toBe(true);
    expect(await service.listPullRequests('repo', ['OPEN'])).toEqual([expect.objectContaining({ number: 12 })]);
    expect(run.mock.calls.find(([, args]) => args[0] === 'pr')?.[1]).toEqual(expect.arrayContaining(['-R', 'example/demo']));
  });
  it.each(['gitlab.com', 'github.com.evil.com', 'work-github', ''])('rejects aliases whose resolved hostname is %s', async (hostname) => {
    const { service } = fixture(() => ok([]), 'git@work-github:example/demo.git',
      { exitCode: 0, stdout: `hostname ${hostname}\n`, stderr: '' });
    expect(await service.repositoryInfo('repo')).toEqual({ isGitHub: false, nameWithOwner: null });
  });
  it.each([fail('bad config'), new Error('SSH unavailable'), new Error('SSH timed out')])('handles failed SSH configuration lookup', async (result) => {
    expect(await fixture(() => ok([]), 'git@work-github:example/demo.git', result).service.repositoryInfo('repo'))
      .toEqual({ isGitHub: false, nameWithOwner: null });
  });
  it.each(['https://github.com/example/demo.git', 'git@github.com:example/demo.git'])('keeps direct GitHub URLs independent of SSH availability: %s', async (remoteUrl) => {
    const { service, run } = fixture(() => ok([]), remoteUrl);
    expect(await service.repositoryInfo('repo')).toEqual({ isGitHub: true, nameWithOwner: 'example/demo' });
    expect(run).not.toHaveBeenCalled();
  });
  it.each(['https://work-github/example/demo.git', 'git@work-github:example/demo/extra', 'git@work-github:example/..', '-oProxyCommand=bad:example/demo.git'])('does not resolve non-SSH or malformed remotes: %s', async (remoteUrl) => {
    const { service, run } = fixture(() => ok([]), remoteUrl);
    expect(await service.repositoryInfo('repo')).toEqual({ isGitHub: false, nameWithOwner: null });
    expect(run).not.toHaveBeenCalled();
  });
});
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
    expect(run.mock.calls.filter(([, args]) => args[0] === 'api' && args[1] !== 'user')).toHaveLength(2);
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
    expect(run.mock.calls.filter(([, args]) => args[0] === 'api' && args[1] !== 'user').map(([, args]) => args[1])).toEqual(['repos/example/demo/stacks?pull_request=101', 'repos/example/demo/stacks/7']);
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
