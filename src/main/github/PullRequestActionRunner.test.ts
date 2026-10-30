import { describe, expect, it, vi } from 'vitest';
import type { CliProcessRunner, CliRunResult } from '../ai/CliProcessRunner';
import type { CliResolver } from '../ai/CliResolver';
import type { GitProcess } from '../git/GitProcess';
import type { RepositoryService } from '../git/RepositoryService';
import type { GitHubAccountsService } from './GitHubAccountsService';
import type { PullRequestActionInput } from '../../shared/contracts';
import { GitHubService } from './GitHubService';

const oid = 'a'.repeat(40);
const ok = (value: unknown): CliRunResult => ({ exitCode: 0, stdout: JSON.stringify(value), stderr: '' });
const fail = (stderr: string): CliRunResult => ({ exitCode: 1, stdout: '', stderr });
const pull = {
  id: 'PR_1', number: 12, state: 'OPEN', isDraft: false, headRefOid: oid, headRefName: 'feature', baseRefName: 'main', updatedAt: '2026-01-01T00:00:00Z', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
  isCrossRepository: false, isMergeQueueEnabled: false, isInMergeQueue: false, viewerCanUpdate: true, viewerDidAuthor: false, viewerCanUpdateBranch: true,
  headRef: { target: { oid } }, headRepositoryOwner: { login: 'example' }, headRepository: { id: 'R_1', viewerPermission: 'WRITE', defaultBranchRef: { name: 'main' } }, baseRef: { compare: { behindBy: 0 } },
};
const repository = { viewerPermission: 'WRITE', mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: false, autoMergeAllowed: true, deleteBranchOnMerge: false, viewerDefaultMergeMethod: 'MERGE' };
const liveResponse = (overrides: object = {}, repositoryOverrides: object = {}) => ok({ data: { repository: { ...repository, ...repositoryOverrides, pullRequest: { ...pull, ...overrides } } } });

/** Serves live-state reads in order, repeating the last, and treats everything else as a mutation. */
function fixture({ reads, stack = ok({ data: { repository: { pr12: { stack: null, stackEntry: null } } } }), mutate = () => ok({ data: {} }), login = 'sample', revision = 3 }: {
  reads: CliRunResult[];
  stack?: CliRunResult;
  mutate?: (args: string[]) => CliRunResult;
  login?: string;
  revision?: number;
}) {
  const mutations: string[][] = [];
  let read = 0;
  const run = vi.fn(async (_exe: string, args: string[]): Promise<CliRunResult> => {
    if (args.some(arg => arg.includes('stackEntry'))) return stack;
    if (args.some(arg => arg.includes('mergeStateStatus'))) return reads[Math.min(read++, reads.length - 1)]!;
    mutations.push(args);
    return mutate(args);
  });
  const accounts = { revisionFor: () => revision, authRevision: 1, authenticate: async () => ({ auth: { env: {} }, executable: { executable: 'gh', alias: 'gh', source: 'process-path', env: {} }, context: { login, revision } }) } as unknown as GitHubAccountsService;
  const service = new GitHubService(
    { discover: async () => [], warning: async () => undefined } as unknown as CliResolver,
    { run } as unknown as CliProcessRunner,
    { onInvalidate: () => undefined, readScope: (cwd: string) => cwd, run: async () => ({ stdout: Buffer.from('https://github.com/example/demo.git') }) } as unknown as GitProcess,
    { get: () => ({ path: '.', commonDir: '.git', id: 'repo' }) } as unknown as RepositoryService,
    accounts,
  );
  return { service, mutations };
}
const base = { repositoryId: 'repo', number: 12, expectedHeadOid: oid, expectedAccount: { login: 'sample', revision: 3 } };
const merge = { ...base, action: 'merge', method: 'SQUASH' } as const;
const mutationOf = (args: string[]) => args.find(arg => arg.startsWith('query='))?.slice('query='.length) ?? '';
const merged = liveResponse({ state: 'MERGED', mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' });

describe('runPullRequestAction', () => {
  it('merges through mergePullRequest with the head the user saw, and reports what GitHub then says', async () => {
    const { service, mutations } = fixture({ reads: [liveResponse(), merged] });
    const result = await service.runPullRequestAction(merge);
    expect(result.outcome).toBe('merged');
    expect(result.state?.state).toBe('MERGED');
    expect(mutations).toHaveLength(1);
    expect(mutationOf(mutations[0]!)).toContain('mergePullRequest');
    expect(mutationOf(mutations[0]!)).not.toContain('enablePullRequestAutoMerge');
    expect(mutations[0]).toEqual(expect.arrayContaining(['id=PR_1', 'method=SQUASH', `head=${oid}`]));
    expect(mutations[0]).not.toContain('-R');
  });

  it.each([
    ['the account changed its revision', { ...merge, expectedAccount: { login: 'sample', revision: 2 } }, {}, 'GH_ACCOUNT_UNRESOLVED'],
    ['another account is now in use', { ...merge, expectedAccount: { login: 'other', revision: 3 } }, {}, 'GH_ACCOUNT_UNRESOLVED'],
    ['the head moved', { ...merge, expectedHeadOid: 'b'.repeat(40) }, {}, 'GH_PR_STATE_CHANGED'],
    ['the viewer lost write access', merge, { repository: { viewerPermission: 'READ' } }, 'GH_PR_ACTION_NOT_ALLOWED'],
    ['the PR is blocked', merge, { pull: { mergeStateStatus: 'BLOCKED' } }, 'GH_PR_ACTION_NOT_ALLOWED'],
    ['the method is disabled', { ...merge, method: 'REBASE' }, {}, 'GH_PR_ACTION_NOT_ALLOWED'],
    ['auto-merge on a PR that can merge now', { ...base, action: 'enable-auto-merge', method: 'MERGE' }, {}, 'GH_PR_ACTION_NOT_ALLOWED'],
    ['closing a merged PR', { ...base, action: 'close' }, { pull: { state: 'MERGED' } }, 'GH_PR_ACTION_NOT_ALLOWED'],
  ] as const)('runs no mutation when %s', async (_name, input, state, code) => {
    const { service, mutations } = fixture({ reads: [liveResponse((state as { pull?: object }).pull, (state as { repository?: object }).repository)] });
    await expect(service.runPullRequestAction(input as PullRequestActionInput)).rejects.toMatchObject({ detail: { code } });
    expect(mutations).toEqual([]);
  });

  it('refuses a stack layer, and an unconfirmed stack with its own message', async () => {
    const member = ok({ data: { repository: { pr12: { stack: { number: 7, size: 3, baseRefName: 'main' }, stackEntry: { position: 2 } } } } });
    const layer = fixture({ reads: [liveResponse()], stack: member });
    await expect(layer.service.runPullRequestAction(merge)).rejects.toThrow('merged on GitHub');
    const unknown = fixture({ reads: [liveResponse()], stack: fail('HTTP 502') });
    await expect(unknown.service.runPullRequestAction(merge)).rejects.toThrow("Couldn't confirm");
    expect([...layer.mutations, ...unknown.mutations]).toEqual([]);
  });

  it('reports an applied action as unconfirmed, not failed, when GitHub cannot be read afterwards', async () => {
    const { service, mutations } = fixture({ reads: [liveResponse(), fail('gh: HTTP 502: Bad Gateway')] });
    expect(await service.runPullRequestAction(merge)).toEqual({ outcome: 'unconfirmed', state: null });
    expect(mutations).toHaveLength(1);
  });

  it('turns a head that moved at the last moment into a state change', async () => {
    const { service } = fixture({ reads: [liveResponse()], mutate: () => fail('gh: GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)') });
    await expect(service.runPullRequestAction(merge)).rejects.toMatchObject({ detail: { code: 'GH_PR_STATE_CHANGED' } });
  });

  it('does not read a PR number or title in the rejection as an account problem', async () => {
    const { service } = fixture({ reads: [liveResponse()], mutate: () => fail('gh: GraphQL: Pull request #401 (Fix authentication) is not mergeable (mergePullRequest)') });
    await expect(service.runPullRequestAction(merge)).rejects.toMatchObject({ detail: { code: 'GH_PROCESS_FAILED', message: 'Pull request #401 (Fix authentication) is not mergeable (mergePullRequest)' } });
  });

  it('adds to a merge queue through the auto-merge route', async () => {
    const { service, mutations } = fixture({ reads: [liveResponse({ isMergeQueueEnabled: true }), liveResponse({ isMergeQueueEnabled: true, isInMergeQueue: true })] });
    expect((await service.runPullRequestAction(merge)).outcome).toBe('queued');
    expect(mutationOf(mutations[0]!)).toContain('enablePullRequestAutoMerge');
  });

  it('arms auto-merge only when asked, with the expected head', async () => {
    const blocked = { mergeStateStatus: 'BLOCKED' };
    const { service, mutations } = fixture({ reads: [liveResponse(blocked), liveResponse({ ...blocked, autoMergeRequest: { mergeMethod: 'SQUASH' } })] });
    expect((await service.runPullRequestAction({ ...base, action: 'enable-auto-merge', method: 'SQUASH' })).outcome).toBe('auto-merge-enabled');
    expect(mutationOf(mutations[0]!)).toContain('enablePullRequestAutoMerge');
    expect(mutations[0]).toContain(`head=${oid}`);
  });

  it('disables auto-merge', async () => {
    const armed = { mergeStateStatus: 'BLOCKED', autoMergeRequest: { mergeMethod: 'SQUASH' } };
    const { service, mutations } = fixture({ reads: [liveResponse(armed), liveResponse({ mergeStateStatus: 'BLOCKED' })] });
    expect((await service.runPullRequestAction({ ...base, action: 'disable-auto-merge' })).outcome).toBe('auto-merge-disabled');
    expect(mutationOf(mutations[0]!)).toContain('disablePullRequestAutoMerge');
  });

  it('updates the branch with the chosen method and the head the user saw', async () => {
    const behind = { mergeStateStatus: 'BEHIND', baseRef: { compare: { behindBy: 2 } } };
    const { service, mutations } = fixture({ reads: [liveResponse(behind)] });
    expect((await service.runPullRequestAction({ ...base, action: 'update-branch', method: 'REBASE' })).outcome).toBe('updated');
    expect(mutationOf(mutations[0]!)).toContain('updatePullRequestBranch');
    expect(mutations[0]).toEqual(expect.arrayContaining(['method=REBASE', `head=${oid}`]));
  });

  it.each([
    ['ready', { isDraft: true, mergeStateStatus: 'DRAFT' }, ['pr', 'ready', '12', '-R', 'example/demo']],
    ['draft', {}, ['pr', 'ready', '12', '-R', 'example/demo', '--undo']],
    ['close', {}, ['pr', 'close', '12', '-R', 'example/demo']],
    ['reopen', { state: 'CLOSED' }, ['pr', 'reopen', '12', '-R', 'example/demo']],
  ] as const)('runs %s through gh pr with the repository', async (action, state, args) => {
    const { service, mutations } = fixture({ reads: [liveResponse(state)] });
    expect((await service.runPullRequestAction({ ...base, action })).outcome).toBe('done');
    expect(mutations).toEqual([args]);
  });

  describe('deleting the branch', () => {
    const closed = { state: 'CLOSED' };

    it('removes it in the head repository, only if it still points at the PR head', async () => {
      const { service, mutations } = fixture({ reads: [liveResponse(closed)] });
      expect((await service.runPullRequestAction({ ...base, action: 'delete-branch' })).outcome).toBe('done');
      expect(mutationOf(mutations[0]!)).toContain('updateRefs');
      expect(mutations[0]).toEqual(expect.arrayContaining(['repository=R_1', 'ref=refs/heads/feature', `before=${oid}`, `after=${'0'.repeat(40)}`]));
    });

    it('finishes without error when the branch is already gone', async () => {
      const { service, mutations } = fixture({ reads: [liveResponse({ ...closed, headRef: null })] });
      expect(await service.runPullRequestAction({ ...base, action: 'delete-branch' })).toMatchObject({ outcome: 'done', branchDeleted: true });
      expect(mutations).toEqual([]);
    });

    it.each([
      ['while the PR is open', {}],
      ['after the branch moved', { ...closed, headRef: { target: { oid: 'b'.repeat(40) } } }],
      ['when the head is the default branch', { ...closed, headRefName: 'main', baseRefName: 'release' }],
      ['when the head equals the base', { ...closed, baseRefName: 'feature' }],
      ['without write access to the head repository', { ...closed, headRepository: { id: 'R_1', viewerPermission: 'READ' } }],
    ])('refuses %s', async (_name, state) => {
      const { service, mutations } = fixture({ reads: [liveResponse(state)] });
      await expect(service.runPullRequestAction({ ...base, action: 'delete-branch' })).rejects.toMatchObject({ detail: { code: 'GH_PR_ACTION_NOT_ALLOWED' } });
      expect(mutations).toEqual([]);
    });
  });

  describe('merging and deleting the branch', () => {
    it('deletes the branch after a successful merge', async () => {
      const { service, mutations } = fixture({ reads: [liveResponse(), merged] });
      expect(await service.runPullRequestAction({ ...merge, deleteBranch: true })).toMatchObject({ outcome: 'merged', branchDeleted: true });
      expect(mutations.map(mutationOf).map(query => query.includes('updateRefs'))).toEqual([false, true]);
    });

    it('stays merged when the deletion fails', async () => {
      const { service } = fixture({ reads: [liveResponse(), merged], mutate: args => mutationOf(args).includes('updateRefs') ? fail('gh: Reference update failed') : ok({ data: {} }) });
      expect(await service.runPullRequestAction({ ...merge, deleteBranch: true })).toMatchObject({ outcome: 'merged', branchDeleted: false });
    });

    it('does not delete anything when the merge did not finish', async () => {
      const { service, mutations } = fixture({ reads: [liveResponse(), liveResponse()] });
      expect(await service.runPullRequestAction({ ...merge, deleteBranch: true })).toMatchObject({ outcome: 'unconfirmed', branchDeleted: false });
      expect(mutations).toHaveLength(1);
    });
  });

  describe('reverting', () => {
    it('reports the PR GitHub opened', async () => {
      const state = { state: 'MERGED', mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' };
      const { service, mutations } = fixture({ reads: [liveResponse(state)], mutate: () => ({ exitCode: 0, stdout: 'https://github.com/example/demo/pull/13\n', stderr: '' }) });
      expect(await service.runPullRequestAction({ ...base, action: 'revert' })).toMatchObject({ outcome: 'done', created: { url: 'https://github.com/example/demo/pull/13', number: 13 } });
      expect(mutations).toEqual([['pr', 'revert', '12', '-R', 'example/demo']]);
    });

    it('still reports the PR it opened when GitHub cannot be read afterwards', async () => {
      const state = { state: 'MERGED', mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' };
      const { service } = fixture({ reads: [liveResponse(state), fail('gh: HTTP 502: Bad Gateway')], mutate: () => ({ exitCode: 0, stdout: 'https://github.com/example/demo/pull/13\n', stderr: '' }) });
      expect(await service.runPullRequestAction({ ...base, action: 'revert' })).toEqual({ outcome: 'unconfirmed', state: null, created: { url: 'https://github.com/example/demo/pull/13', number: 13 } });
    });

    it('refuses a PR that was not merged', async () => {
      const { service, mutations } = fixture({ reads: [liveResponse()] });
      await expect(service.runPullRequestAction({ ...base, action: 'revert' })).rejects.toMatchObject({ detail: { code: 'GH_PR_ACTION_NOT_ALLOWED' } });
      expect(mutations).toEqual([]);
    });
  });

  describe('approving workflows', () => {
    const waiting = {
      isCrossRepository: true, headRepositoryOwner: { login: 'contributor' }, headRepository: { id: 'R_2', viewerPermission: 'READ' },
      commits: { nodes: [{ commit: { statusCheckRollup: { state: 'PENDING', contexts: { pageInfo: { hasNextPage: false }, nodes: [{ __typename: 'CheckRun', name: 'CI', status: 'COMPLETED', conclusion: 'ACTION_REQUIRED', detailsUrl: null }] } } } }] },
    };
    const heads = (...nodes: object[]) => ok({ data: { repository: { pullRequests: { pageInfo: { hasNextPage: false }, nodes } } } });
    const thisHead = { number: 12, headRefOid: oid, isCrossRepository: true, headRepositoryOwner: { login: 'contributor' } };
    const runs = (...ids: number[]) => ok({ workflow_runs: ids.map(id => ({ id, status: 'completed', conclusion: 'action_required', head_branch: 'feature' })) });
    const respond = (headsResult: CliRunResult, runsResult: CliRunResult) => (args: string[]) => {
      if (mutationOf(args).includes('pullRequests(')) return headsResult;
      if (args.some(arg => arg.includes('/actions/runs?'))) return runsResult;
      return ok({});
    };
    const approvals = (mutations: string[][]) => mutations.filter(args => args.includes('POST')).map(args => args.at(-1));

    it('approves runs that can only belong to this PR, filtered by commit, branch and event', async () => {
      const { service, mutations } = fixture({ reads: [liveResponse(waiting)], mutate: respond(heads(thisHead), runs(5, 6)) });
      expect((await service.runPullRequestAction({ ...base, action: 'approve-workflows' })).outcome).toBe('done');
      expect(approvals(mutations)).toEqual(['repos/example/demo/actions/runs/5/approve', 'repos/example/demo/actions/runs/6/approve']);
      const listing = mutations.flat().find(arg => arg.includes('/actions/runs?'))!;
      expect(listing).toContain(`head_sha=${oid}`);
      expect(listing).toContain('branch=feature');
      expect(listing).toContain('event=pull_request');
      expect(listing).toContain('status=action_required');
    });

    it.each([
      ['another open PR shares the commit from the same fork', () => heads(thisHead, { ...thisHead, number: 13 })],
      ['the PR is not the one with that head', () => heads({ ...thisHead, number: 13 })],
      ['the list of heads is incomplete', () => ok({ data: { repository: { pullRequests: { pageInfo: { hasNextPage: true }, nodes: [thisHead] } } } })],
    ])('approves nothing when %s', async (_name, headsResult) => {
      const { service, mutations } = fixture({ reads: [liveResponse(waiting)], mutate: respond(headsResult(), runs(5)) });
      await expect(service.runPullRequestAction({ ...base, action: 'approve-workflows' })).rejects.toMatchObject({ detail: { code: 'GH_PR_ACTION_NOT_ALLOWED' } });
      expect(approvals(mutations)).toEqual([]);
    });

    it('stops when the head moves between approvals', async () => {
      const moved = liveResponse({ ...waiting, headRefOid: 'c'.repeat(40) });
      const { service, mutations } = fixture({ reads: [liveResponse(waiting), moved], mutate: respond(heads(thisHead), runs(5)) });
      await expect(service.runPullRequestAction({ ...base, action: 'approve-workflows' })).rejects.toMatchObject({ detail: { code: 'GH_PR_STATE_CHANGED' } });
      expect(approvals(mutations)).toEqual([]);
    });

    it('skips a run that no longer waits, and one from another branch', async () => {
      let listings = 0;
      const { service, mutations } = fixture({ reads: [liveResponse(waiting)], mutate: args => {
        if (mutationOf(args).includes('pullRequests(')) return heads(thisHead);
        if (args.some(arg => arg.includes('/actions/runs?'))) return listings++ === 0
          ? ok({ workflow_runs: [{ id: 5, conclusion: 'action_required', head_branch: 'feature' }, { id: 6, conclusion: 'action_required', head_branch: 'other' }] })
          : runs();
        return ok({});
      } });
      await service.runPullRequestAction({ ...base, action: 'approve-workflows' });
      expect(approvals(mutations)).toEqual([]);
    });

    it('refuses a PR from the same repository', async () => {
      const sameRepository = { ...waiting, isCrossRepository: false };
      const { service, mutations } = fixture({ reads: [liveResponse(sameRepository)] });
      await expect(service.runPullRequestAction({ ...base, action: 'approve-workflows' })).rejects.toMatchObject({ detail: { code: 'GH_PR_ACTION_NOT_ALLOWED' } });
      expect(mutations).toEqual([]);
    });
  });
});

describe('updatePullRequest', () => {
  const edit = { ...base, title: 'New title', body: 'New body', expectedUpdatedAt: pull.updatedAt };
  const { expectedHeadOid: _unused, ...withoutHead } = edit;

  it('sends the title, and the body through a file', async () => {
    const { service, mutations } = fixture({ reads: [liveResponse()] });
    await service.updatePullRequest(withoutHead);
    expect(mutations[0]!.slice(0, 7)).toEqual(['pr', 'edit', '12', '-R', 'example/demo', '--title', 'New title']);
    expect(mutations[0]![7]).toBe('--body-file');
    expect(mutations[0]).not.toContain('New body');
  });

  it('refuses to overwrite a PR that changed since the edit started', async () => {
    const { service, mutations } = fixture({ reads: [liveResponse({ updatedAt: '2026-02-02T00:00:00Z' })] });
    await expect(service.updatePullRequest(withoutHead)).rejects.toMatchObject({ detail: { code: 'GH_PR_STATE_CHANGED' } });
    expect(mutations).toEqual([]);
  });

  it('refuses without permission or with another account', async () => {
    const reader = fixture({ reads: [liveResponse({ viewerCanUpdate: false })] });
    await expect(reader.service.updatePullRequest(withoutHead)).rejects.toMatchObject({ detail: { code: 'GH_PR_ACTION_NOT_ALLOWED' } });
    const other = fixture({ reads: [liveResponse()] });
    await expect(other.service.updatePullRequest({ ...withoutHead, expectedAccount: { login: 'other', revision: 3 } })).rejects.toMatchObject({ detail: { code: 'GH_ACCOUNT_UNRESOLVED' } });
    expect([...reader.mutations, ...other.mutations]).toEqual([]);
  });
});
