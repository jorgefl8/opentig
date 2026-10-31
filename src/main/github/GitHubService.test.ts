import { describe, expect, it, vi } from 'vitest';
import { GitHubService } from './GitHubService';
import type { CliProcessRunner, CliRunResult } from '../ai/CliProcessRunner';
import type { CliResolver } from '../ai/CliResolver';
import type { GitProcess } from '../git/GitProcess';
import type { RepositoryService } from '../git/RepositoryService';
import { GitOperationError } from '../../shared/errors';

const ok = (value: unknown): CliRunResult => ({ exitCode: 0, stdout: JSON.stringify(value), stderr: '' });
const fail = (stderr: string): CliRunResult => ({ exitCode: 1, stdout: '', stderr });
const stack = { number: 7, base: { ref: 'main' }, pull_requests: [{ number: 101, state: 'open', title: 'Model', head: { ref: 'model' } }] };
type GitReply = (args: string[], stdin?: string) => string | Error | undefined;
function fixture(reply: (args: string[]) => CliRunResult, remoteUrl = 'https://github.com/example/demo.git', sshResult: CliRunResult | Error = fail('SSH unavailable'), gitReply: GitReply = () => undefined) {
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
    { onInvalidate: () => undefined, readScope: (cwd: string) => cwd, run: async (_cwd: string, args: string[], options?: { stdin?: string }) => {
      const custom = gitReply(args, options?.stdin);
      if (custom instanceof Error) throw custom;
      return { stdout: Buffer.from(custom ?? (args.includes('core.sshCommand') ? '' : remoteUrl)) };
    } } as unknown as GitProcess,
    { get: () => ({ path: '.', commonDir: '.git', id: 'repo' }), status: async () => ({ branch: 'feature', upstream: 'origin/feature', ahead: 0, detached: false, unborn: false }) } as unknown as RepositoryService,
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
  it.each(['OPEN', 'MERGED'] as const)('includes native membership for the selected %s branch PR without fetching layers', async state => {
    const { service, run } = fixture(args => {
      if (args[1] === 'graphql') return ok({ data: { repository: { pr12: {
        stack: { number: 7, size: 3, baseRefName: 'main' }, stackEntry: { position: 2 },
      } } } });
      return ok(state === 'MERGED' && args.includes('open') ? [] : [
        { number: 12, state, headRefName: 'feature', headRepository: { nameWithOwner: 'example/demo' } },
      ]);
    });
    expect(await service.findPullRequestForBranch('repo', 'feature')).toMatchObject({
      number: 12, state, stack: { number: 7, size: 3, position: 2, base: 'main' },
    });
    expect(run.mock.calls.filter(([, args]) => args[1] === 'graphql')).toHaveLength(1);
    expect(run.mock.calls.some(([, args]) => args[1]?.includes('/stacks'))).toBe(false);
  });

  it('preserves the branch PR when optional stack metadata is unavailable', async () => {
    const { service } = fixture(args => args[1] === 'graphql' ? fail('HTTP 403: rate limit') : ok([
      { number: 12, state: 'OPEN', headRefName: 'feature', headRepository: { nameWithOwner: 'example/demo' } },
    ]));
    const pull = await service.findPullRequestForBranch('repo', 'feature');
    expect(pull?.number).toBe(12);
    expect(pull?.stack).toBeUndefined();
  });

  it('selects the most recently updated open PR when several PRs share a branch', async () => {
    const { service } = fixture(() => ok([
      { headRepository: { nameWithOwner: 'example/demo' }, headRefName: 'feature', number: 11, state: 'OPEN', updatedAt: '2026-09-01' },
      { headRepository: { nameWithOwner: 'example/demo' }, headRefName: 'feature', number: 12, state: 'OPEN', updatedAt: '2026-09-03' },
      { headRepository: { nameWithOwner: 'example/demo' }, headRefName: 'feature', number: 13, state: 'OPEN', updatedAt: '2026-09-02' },
    ]));
    expect(await service.findPullRequestForBranch('repo', 'feature')).toMatchObject({ number: 12, state: 'OPEN' });
  });
  it('finds an open draft even when a reused branch has newer closed history', async () => {
    const { service, run } = fixture((args) => ok(args.includes('open')
      ? [{ headRepository: { nameWithOwner: 'example/demo' }, headRefName: 'feature', number: 12, state: 'OPEN', isDraft: true, url: 'https://github.com/example/demo/pull/12' }]
      : [{ headRepository: { nameWithOwner: 'example/demo' }, headRefName: 'feature', number: 99, state: 'CLOSED' }]));
    expect(await service.findPullRequestForBranch('repo', 'feature')).toMatchObject({ number: 12, state: 'OPEN', isDraft: true });
    expect(run.mock.calls.filter(([, args]) => args[0] === 'pr').map(([, args]) => args)).toEqual([
      expect.arrayContaining(['--head', 'feature', '--state', 'open']),
    ]);
  });
  it('preserves closed and merged history for the branch details view', async () => {
    const { service } = fixture((args) => ok(args.includes('open') ? [] : [
      { headRepository: { nameWithOwner: 'example/demo' }, headRefName: 'feature', number: 12, state: 'CLOSED', updatedAt: '2026-09-01' },
      { headRepository: { nameWithOwner: 'example/demo' }, headRefName: 'feature', number: 13, state: 'MERGED', updatedAt: '2026-09-02' },
    ]));
    expect(await service.findPullRequestForBranch('repo', 'feature')).toMatchObject({ number: 13, state: 'MERGED' });
  });
  it.each(['OPEN', 'MERGED', 'CLOSED'])('does not associate another fork’s main PR (%s) with a clone of upstream', async (state) => {
    const { service } = fixture(() => ok([
      { number: 10662, state, headRefName: 'main', headRepository: { nameWithOwner: 'someone/demo' } },
    ]));
    expect(await service.findPullRequestForBranch('repo', 'main')).toBeNull();
  });
  it('keeps a matching main PR regardless of its author or the authenticated account', async () => {
    const { service, run } = fixture(() => ok([
      { number: 12, state: 'OPEN', author: { login: 'another-contributor' }, headRefName: 'main', headRepository: { nameWithOwner: 'Example/Demo' } },
    ]));
    expect(await service.findPullRequestForBranch('repo', 'main')).toMatchObject({ number: 12, author: 'another-contributor' });
    expect(run.mock.calls.find(([, args]) => args[0] === 'pr')?.[1].join(',')).toContain('headRepository');
  });
  it('does not let an unrelated open PR hide merged history from this repository', async () => {
    const { service } = fixture((args) => ok(args.includes('open')
      ? [{ number: 99, state: 'OPEN', headRefName: 'main', headRepository: { nameWithOwner: 'someone/demo' } }]
      : [{ number: 12, state: 'MERGED', headRefName: 'main', headRepository: { nameWithOwner: 'example/demo' } }]));
    expect(await service.findPullRequestForBranch('repo', 'main')).toMatchObject({ number: 12, state: 'MERGED' });
  });
  it('ignores missing head repositories and branches that only differ in case', async () => {
    const { service } = fixture(() => ok([
      { number: 10, state: 'OPEN', headRefName: 'main', headRepository: null },
      { number: 11, state: 'OPEN', headRefName: 'main' },
      { number: 12, state: 'OPEN', headRefName: 'Main', headRepository: { nameWithOwner: 'example/demo' } },
    ]));
    expect(await service.findPullRequestForBranch('repo', 'main')).toBeNull();
  });
  it('matches the cloned fork itself when origin is a fork', async () => {
    const { service } = fixture(() => ok([
      { number: 12, state: 'OPEN', headRefName: 'feature', headRepository: { nameWithOwner: 'someone/demo' } },
    ]), 'https://github.com/someone/demo.git');
    expect(await service.findPullRequestForBranch('repo', 'feature')).toMatchObject({ number: 12 });
  });
  it('returns null when the branch has no PR and propagates lookup errors', async () => {
    expect(await fixture(() => ok([])).service.findPullRequestForBranch('repo', 'feature')).toBeNull();
    await expect(fixture(() => fail('HTTP 403: rate limit')).service.findPullRequestForBranch('repo', 'feature')).rejects.toThrow();
  });
});
describe('pull request code', () => {
  const base = 'a'.repeat(40);
  const head = 'b'.repeat(40);
  const view = (args: string[]) => args[1] === 'graphql' ? fail('unavailable') : ok({ number: 12, state: 'MERGED', baseRefOid: base, headRefOid: head });

  it('diffs the PR locally once Git has its commits, without asking GitHub for the patch', async () => {
    const gitCalls: string[][] = [];
    const { service, run } = fixture(view, undefined, undefined, args => {
      gitCalls.push(args);
      if (args[0] === 'cat-file') return 'commit\ncommit\n';
      if (args[0] === 'diff') return 'diff --git a/one b/one\n';
      if (args[0] === 'show') return 'diff --git a/two b/two\n';
      return undefined;
    });
    expect(await service.getPullRequestDiff('repo', 12)).toMatchObject({ patch: 'diff --git a/one b/one\n', truncated: false });
    expect(gitCalls).toContainEqual(expect.arrayContaining(['diff', `${base}...${head}`]));
    expect(gitCalls.some(args => args[0] === 'fetch')).toBe(false);
    expect(await service.getPullRequestCommitDiff('repo', head)).toMatchObject({ patch: 'diff --git a/two b/two\n' });
    expect(run.mock.calls.some(([, args]) => args[0] === 'pr' && args[1] === 'diff')).toBe(false);
    expect(run.mock.calls.some(([, args]) => args[0] === 'api' && String(args[1]).includes('/commits/'))).toBe(false);
  });

  it('fetches the PR head ref when the commits are missing locally', async () => {
    let fetched = false;
    const fetches: string[][] = [];
    const { service } = fixture(view, undefined, undefined, (args, stdin = '') => {
      if (args[0] === 'cat-file') return stdin.split('\n').filter(Boolean).map(line => fetched || line.startsWith(base) ? 'commit' : 'missing').join('\n');
      if (args[0] === 'fetch') { fetches.push(args); fetched = true; return ''; }
      if (args[0] === 'diff') return 'diff --git a/one b/one\n';
      return undefined;
    });
    await service.getPullRequestDiff('repo', 12);
    expect(fetches).toEqual([expect.arrayContaining(['--no-write-fetch-head', 'origin', 'refs/pull/12/head'])]);
  });

  it('completes the commit list from the local clone only when GitHub returns a full first page', async () => {
    const ghCommit = (index: number) => ({ oid: index.toString(16).padStart(40, '0'), messageHeadline: `GitHub ${index}`, authors: [{ login: 'octo', name: 'Octo' }] });
    const reply = (count: number) => (args: string[]) => args[1] === 'graphql' ? fail('unavailable')
      : ok({ number: 12, state: 'OPEN', baseRefOid: base, headRefOid: head, commits: Array.from({ length: count }, (_, index) => ghCommit(index)) });
    const logged = Array.from({ length: 116 }, (_, index) => `${index.toString(16).padStart(40, '0')}\x1fLocal ${index}\x1f2026-10-01T00:00:00Z\x1fOcto`).join('\0');
    const gitCalls: string[][] = [];
    const local = (args: string[]) => { gitCalls.push(args); return args[0] === 'cat-file' ? 'commit\ncommit\n' : args[0] === 'log' ? logged : undefined; };

    const small = fixture(reply(3), undefined, undefined, local);
    expect(await small.service.getPullRequestCommits('repo', 12)).toMatchObject({ complete: true, commits: { length: 3 } });
    expect(gitCalls.some(args => args[0] === 'log')).toBe(false);

    const large = fixture(reply(100), undefined, undefined, local);
    const list = await large.service.getPullRequestCommits('repo', 12);
    expect(list.complete).toBe(true);
    expect(list.commits).toHaveLength(116);
    expect(list.commits[0]).toMatchObject({ messageHeadline: 'GitHub 0', authorAvatarUrl: expect.stringContaining('octo') });
    expect(list.commits[115]).toMatchObject({ messageHeadline: 'Local 115', authorAvatarUrl: null });
    expect(gitCalls).toContainEqual(expect.arrayContaining(['log', `${base}..${head}`]));

    const offline = fixture(reply(100), undefined, undefined, args => args[0] === 'cat-file' ? 'missing\nmissing\n' : args[0] === 'fetch' ? new GitOperationError({ code: 'UNKNOWN', operation: 'fetch', message: 'offline' }) : undefined);
    expect(await offline.service.getPullRequestCommits('repo', 12)).toMatchObject({ complete: false, commits: { length: 100 } });
  });

  it('falls back to GitHub when Git cannot download the commits, explaining oversized diffs', async () => {
    const offline = () => (args: string[]) => args[0] === 'cat-file' ? 'missing\nmissing\n' : args[0] === 'fetch' ? new GitOperationError({ code: 'UNKNOWN', operation: 'fetch', message: 'offline' }) : undefined;
    const working = fixture(args => args[0] === 'pr' && args[1] === 'diff' ? { exitCode: 0, stdout: 'diff --git a/x b/x\n', stderr: '' } : view(args), undefined, undefined, offline());
    expect((await working.service.getPullRequestDiff('repo', 12)).patch).toBe('diff --git a/x b/x\n');
    const tooLarge = fixture(args => args[0] === 'pr' && args[1] === 'diff'
      ? fail('could not find pull request diff: HTTP 406: Sorry, the diff exceeded the maximum number of files (300).') : view(args), undefined, undefined, offline());
    await expect(tooLarge.service.getPullRequestDiff('repo', 12)).rejects.toMatchObject({ message: expect.stringContaining('GitHub cannot produce a diff this large') });
  });

  it("adds Git's reason when it could not download what GitHub refuses to diff", async () => {
    const { service } = fixture(args => args[0] === 'pr' && args[1] === 'diff'
      ? fail('could not find pull request diff: HTTP 406: Sorry, the diff exceeded the maximum number of files (300).') : view(args), undefined, undefined, args => {
      if (args[0] === 'cat-file') return 'missing\nmissing\n';
      if (args[0] === 'fetch') return new GitOperationError({ code: 'UNKNOWN', operation: 'pr-local-fetch', message: 'Authentication failed for the remote.' });
      return undefined;
    });
    await expect(service.getPullRequestDiff('repo', 12)).rejects.toMatchObject({ message: expect.stringContaining('Git reported: Authentication failed for the remote.') });
  });
});
describe('forks with a GitHub CLI default repository', () => {
  const upstream = 'https://github.com/example/demo.git';
  const fork = 'https://github.com/contributor/demo.git';
  const forkGit = (extra: GitReply = () => undefined): GitReply => (args, stdin) => {
    const custom = extra(args, stdin);
    if (custom !== undefined) return custom;
    if (args[0] === 'config' && args[1] === '--get-regexp') return 'remote.upstream.gh-resolved base\n';
    if (args[0] === 'config' && args[2] === 'branch.feature.remote') return 'origin\n';
    if (args[0] === 'config' && args[2] === 'branch.feature.merge') return 'refs/heads/feature-remote\n';
    if (args[0] === 'remote' && args.at(-1) === 'upstream') return upstream;
    if (args[0] === 'remote' && args.at(-1) === 'origin') return fork;
    return undefined;
  };

  it('reads pull requests from the repository chosen with gh repo set-default', async () => {
    const { service, run } = fixture(() => ok([]), fork, undefined, forkGit());
    expect(await service.repositoryInfo('repo')).toEqual({ isGitHub: true, nameWithOwner: 'example/demo' });
    await service.listPullRequests('repo', ['OPEN']);
    expect(run.mock.calls.find(([, args]) => args[0] === 'pr')?.[1]).toEqual(expect.arrayContaining(['-R', 'example/demo']));
  });

  it('keeps origin when no default was chosen or the chosen remote is gone', async () => {
    const none = fixture(() => ok([]), fork, undefined, args => args[0] === 'config' ? new GitOperationError({ code: 'UNKNOWN', operation: 'config', message: '' }) : undefined);
    expect(await none.service.repositoryInfo('repo')).toEqual({ isGitHub: true, nameWithOwner: 'contributor/demo' });
    const gone = fixture(() => ok([]), fork, undefined, args => args[0] === 'config' ? 'remote.missing.gh-resolved base\n'
      : args[0] === 'remote' && args.at(-1) === 'missing' ? new GitOperationError({ code: 'UNKNOWN', operation: 'remote', message: 'No such remote' }) : undefined);
    expect(await gone.service.repositoryInfo('repo')).toEqual({ isGitHub: true, nameWithOwner: 'contributor/demo' });
  });

  it('matches branch PRs opened from the fork', async () => {
    const { service } = fixture(() => ok([
      { number: 12, state: 'OPEN', headRefName: 'feature', headRepository: { nameWithOwner: 'contributor/demo' } },
    ]), fork, undefined, forkGit());
    expect(await service.findPullRequestForBranch('repo', 'feature')).toMatchObject({ number: 12 });
  });

  it('creates the PR on upstream with the fork branch as owner:branch', async () => {
    const { service, run } = fixture(args => args[1] === 'create' ? { exitCode: 0, stdout: 'https://github.com/example/demo/pull/40\n', stderr: '' } : ok({}), fork, undefined, forkGit());
    await service.createPullRequest({ repositoryId: 'repo', title: 'Fork', body: 'Body', base: 'upstream/main', draft: false });
    const args = run.mock.calls.find(([, args]) => args[1] === 'create')?.[1] ?? [];
    expect(args).toEqual(expect.arrayContaining(['-R', 'example/demo', '--base', 'main', '--head', 'contributor:feature-remote']));
  });

  it('downloads PR commits from the chosen remote', async () => {
    const fetches: string[][] = [];
    let fetched = false;
    const { service } = fixture(args => args[1] === 'graphql' ? fail('unavailable') : ok({ number: 12, state: 'OPEN', baseRefOid: 'a'.repeat(40), headRefOid: 'b'.repeat(40) }), fork, undefined, forkGit(args => {
      if (args[0] === 'cat-file') return fetched ? 'commit\ncommit\n' : 'missing\nmissing\n';
      if (args[0] === 'fetch') { fetches.push(args); fetched = true; return ''; }
      if (args[0] === 'diff') return '';
      return undefined;
    }));
    await service.getPullRequestDiff('repo', 12);
    expect(fetches[0]).toEqual(expect.arrayContaining(['upstream', 'refs/pull/12/head']));
  });
});
describe('pull request live state', () => {
  const pull = { id: 'PR_1', number: 12, state: 'OPEN', isDraft: false, headRefOid: 'a'.repeat(40), headRefName: 'feature', baseRefName: 'main', updatedAt: '2026-01-01T00:00:00Z', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', isCrossRepository: false, viewerCanUpdate: true, viewerDidAuthor: false, viewerCanUpdateBranch: true,
    commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS', contexts: { pageInfo: { hasNextPage: false }, nodes: [{ __typename: 'CheckRun', name: 'network-tests', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/example/demo/runs/401' }] } } } }] } };
  const repository = { viewerPermission: 'WRITE', mergeCommitAllowed: true, squashMergeAllowed: false, rebaseMergeAllowed: false, autoMergeAllowed: true, deleteBranchOnMerge: false, viewerDefaultMergeMethod: 'MERGE' };
  const isStackRead = (args: string[]) => args.some(arg => arg.includes('stackEntry'));
  const withStack = (main: CliRunResult, stack: CliRunResult = ok({ data: { repository: { pr12: { stack: null, stackEntry: null } } } })) => (args: string[]) => isStackRead(args) ? stack : main;

  it('passes the repository as GraphQL variables and reads the head through the PR ref', async () => {
    const { service, run } = fixture(withStack(ok({ data: { repository: { ...repository, pullRequest: pull } } })));
    expect(await service.getPullRequestLiveState('repo', 12)).toMatchObject({ number: 12, stack: 'none', checks: { rollup: 'PASSING', partial: false } });
    const args = run.mock.calls.map(([, called]) => called).find(called => called.some(arg => arg.includes('mergeStateStatus')))!;
    expect(args).toEqual(expect.arrayContaining(['owner=example', 'name=demo', 'number=12', 'headRef=refs/pull/12/head']));
    expect(args).not.toContain('-R');
  });

  it('keeps the data when gh exits 1 because a nested field was withheld, without reading failures into check names', async () => {
    const response = { data: { repository: { ...repository, pullRequest: pull } }, errors: [{ type: 'FORBIDDEN', path: ['repository', 'pullRequest', 'headRepository'], message: 'Resource not accessible' }] };
    const { service } = fixture(withStack({ exitCode: 1, stdout: JSON.stringify(response), stderr: 'gh: Resource not accessible' }));
    expect(await service.getPullRequestLiveState('repo', 12)).toMatchObject({ number: 12, checks: { partial: true, items: [{ name: 'network-tests' }] } });
  });

  it('reports a missing PR as missing rather than as a connection problem', async () => {
    const response = { data: { repository: { ...repository, pullRequest: null } }, errors: [{ type: 'NOT_FOUND', path: ['repository', 'pullRequest'], message: 'Could not resolve to a PullRequest with the number of 12.' }] };
    const { service } = fixture(withStack({ exitCode: 1, stdout: JSON.stringify(response), stderr: 'gh: Could not resolve to a PullRequest with the number of 12.' }));
    await expect(service.getPullRequestLiveState('repo', 12)).rejects.toThrow('Pull request #12 was not found in this repository.');
  });

  it.each([
    ['gh: API rate limit exceeded for user', 'GH_RATE_LIMITED'],
    ['gh: You have exceeded a secondary rate limit (HTTP 403)', 'GH_RATE_LIMITED'],
    ['gh: Bad credentials (HTTP 401)', 'GH_AUTH_REQUIRED'],
    ['dial tcp: lookup api.github.com: no such host', 'GH_PROCESS_FAILED'],
  ])('classifies a failed read from stderr only: %s', async (stderr, code) => {
    const { service } = fixture(withStack({ exitCode: 1, stdout: JSON.stringify({ message: 'network 401 details' }), stderr }));
    await expect(service.getPullRequestLiveState('repo', 12)).rejects.toMatchObject({ detail: { code } });
  });

  it('does not treat stdout as the failure when stderr has nothing to classify', async () => {
    const { service } = fixture(withStack({ exitCode: 1, stdout: JSON.stringify({ data: null, errors: [{ type: 'INTERNAL', message: 'authentication 401' }] }), stderr: 'gh: Something went wrong' }));
    await expect(service.getPullRequestLiveState('repo', 12)).rejects.toMatchObject({ detail: { code: 'GH_PROCESS_FAILED', message: 'gh: Something went wrong' } });
  });

  it('rejects a malformed successful response instead of showing an empty state', async () => {
    const { service } = fixture(withStack(ok({ data: { repository: { pullRequest: { number: 12 } } } })));
    await expect(service.getPullRequestLiveState('repo', 12)).rejects.toMatchObject({ detail: { code: 'GH_INVALID_OUTPUT' } });
  });

  it('separates stack membership, its absence, and a failed membership read', async () => {
    const main = ok({ data: { repository: { ...repository, pullRequest: pull } } });
    const member = ok({ data: { repository: { pr12: { stack: { number: 7, size: 3, baseRefName: 'main' }, stackEntry: { position: 2 } } } } });
    expect(await fixture(withStack(main, member)).service.getPullRequestLiveState('repo', 12)).toMatchObject({ stack: 'member' });
    expect(await fixture(withStack(main)).service.getPullRequestLiveState('repo', 12)).toMatchObject({ stack: 'none' });
    expect(await fixture(withStack(main, fail('HTTP 403: forbidden'))).service.getPullRequestLiveState('repo', 12)).toMatchObject({ stack: 'unknown' });
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
