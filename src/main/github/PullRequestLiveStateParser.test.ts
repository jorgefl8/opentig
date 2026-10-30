import { describe, expect, it } from 'vitest';
import { parsePullRequestLiveState } from './PullRequestLiveStateParser';

const oid = 'a'.repeat(40);
const repository = { viewerPermission: 'WRITE', mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: false, autoMergeAllowed: true, deleteBranchOnMerge: true, viewerDefaultMergeMethod: 'SQUASH' };
const pull = {
  id: 'PR_1', number: 12, state: 'OPEN', isDraft: false, headRefOid: oid, headRefName: 'feature', baseRefName: 'main', updatedAt: '2026-01-01T00:00:00Z',
  mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED', isCrossRepository: true, isMergeQueueEnabled: true, isInMergeQueue: false,
  viewerCanUpdate: true, viewerDidAuthor: true, viewerCanUpdateBranch: false, autoMergeRequest: { mergeMethod: 'SQUASH' },
  headRef: { id: 'REF_1', target: { oid } }, headRepositoryOwner: { login: 'sample' },
  headRepository: { id: 'R_1', viewerPermission: 'ADMIN', defaultBranchRef: { name: 'trunk' } },
  baseRef: { compare: { behindBy: 3 } },
};
const run = (name: string, status: string, conclusion: string | null, extra: object = {}) => ({ __typename: 'CheckRun', name, status, conclusion, detailsUrl: `https://github.com/sample/demo/runs/${name}`, startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:01:00Z', isRequired: false, checkSuite: { workflowRun: { workflow: { name: 'CI' } } }, ...extra });
const rollup = (nodes: unknown[], state = 'SUCCESS', hasNextPage = false) => ({ commits: { nodes: [{ commit: { statusCheckRollup: { state, contexts: { pageInfo: { hasNextPage }, nodes } } } }] } });
const response = (overrides: object = {}, repositoryOverrides: object = {}, errors?: unknown[]) => JSON.stringify({ data: { repository: { ...repository, ...repositoryOverrides, pullRequest: { ...pull, ...overrides } } }, ...(errors ? { errors } : {}) });
function state(raw: string, stack: 'none' | 'member' | 'unknown' = 'none') {
  const read = parsePullRequestLiveState(raw, stack);
  if (read.status !== 'ok') throw new Error(`Expected a state, got ${read.status}`);
  return read.state;
}

describe('parsePullRequestLiveState', () => {
  it('reads GitHub\'s response into the live state', () => {
    expect(state(response(rollup([run('test', 'COMPLETED', 'SUCCESS', { isRequired: true })])), 'member')).toEqual({
      id: 'PR_1', number: 12, state: 'OPEN', isDraft: false, headRefOid: oid, headRefName: 'feature', baseRefName: 'main', updatedAt: '2026-01-01T00:00:00Z',
      mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED', isCrossRepository: true, stack: 'member',
      autoMerge: { method: 'SQUASH' }, mergeQueue: { enabled: true, queued: false }, behindBy: 3,
      checks: { rollup: 'PASSING', items: [{ name: 'test', workflow: 'CI', result: 'pass', required: true, url: 'https://github.com/sample/demo/runs/test' }], truncated: false, partial: false },
      head: { repositoryId: 'R_1', owner: 'sample', defaultBranch: 'trunk', refOid: oid },
      repository: { methods: ['MERGE', 'SQUASH'], defaultMethod: 'SQUASH', autoMergeAllowed: true, deleteBranchOnMerge: true },
      viewer: { canWrite: true, canUpdate: true, didAuthor: true, canUpdateBranch: false, canDeleteBranch: true },
    });
  });

  it.each([
    ['COMPLETED', 'SUCCESS', 'pass'], ['COMPLETED', 'FAILURE', 'fail'], ['COMPLETED', 'TIMED_OUT', 'fail'], ['COMPLETED', 'CANCELLED', 'fail'], ['COMPLETED', 'STARTUP_FAILURE', 'fail'],
    ['COMPLETED', 'ACTION_REQUIRED', 'action-required'], ['COMPLETED', 'SKIPPED', 'skipped'], ['COMPLETED', 'NEUTRAL', 'skipped'], ['COMPLETED', 'STALE', 'pending'],
    ['IN_PROGRESS', null, 'pending'], ['QUEUED', null, 'pending'],
  ])('maps a check run %s/%s to %s', (status, conclusion, result) => {
    expect(state(response(rollup([run('test', status, conclusion)]))).checks.items[0]?.result).toBe(result);
  });

  it.each([['SUCCESS', 'pass'], ['FAILURE', 'fail'], ['ERROR', 'fail'], ['PENDING', 'pending'], ['EXPECTED', 'pending']])('maps a commit status %s to %s', (value, result) => {
    expect(state(response(rollup([{ __typename: 'StatusContext', context: 'ci/external', state: value, targetUrl: 'https://ci.example/1', createdAt: '2026-01-01T00:00:00Z', isRequired: true }]))).checks.items).toEqual([
      { name: 'ci/external', workflow: null, result, required: true, url: 'https://ci.example/1' },
    ]);
  });

  it.each([['SUCCESS', 'PASSING'], ['FAILURE', 'FAILING'], ['ERROR', 'FAILING'], ['PENDING', 'PENDING'], ['EXPECTED', 'PENDING']])('maps a rollup %s to %s', (value, expected) => {
    expect(state(response(rollup([], value))).checks.rollup).toBe(expected);
  });

  it('reports no checks when the commit has no rollup', () => {
    expect(state(response({ commits: { nodes: [{ commit: { statusCheckRollup: null } }] } })).checks).toEqual({ rollup: 'NONE', items: [], truncated: false, partial: false });
  });

  it('keeps the newest run of a repeated check, and any unfinished run over a finished one', () => {
    const older = run('test', 'COMPLETED', 'FAILURE', { completedAt: '2026-01-01T00:00:00Z' });
    const newer = run('test', 'COMPLETED', 'SUCCESS', { completedAt: '2026-01-02T00:00:00Z' });
    expect(state(response(rollup([older, newer]))).checks.items.map(check => check.result)).toEqual(['pass']);
    expect(state(response(rollup([newer, older]))).checks.items.map(check => check.result)).toEqual(['pass']);
    expect(state(response(rollup([newer, run('test', 'IN_PROGRESS', null)]))).checks.items.map(check => check.result)).toEqual(['pending']);
    expect(state(response(rollup([run('test', 'IN_PROGRESS', null), newer]))).checks.items.map(check => check.result)).toEqual(['pending']);
    const otherWorkflow = run('test', 'COMPLETED', 'FAILURE', { checkSuite: { workflowRun: { workflow: { name: 'Nightly' } } } });
    expect(state(response(rollup([newer, otherWorkflow]))).checks.items.map(check => check.workflow)).toEqual(['CI', 'Nightly']);
  });

  it('marks a truncated list', () => {
    expect(state(response(rollup([run('test', 'COMPLETED', 'SUCCESS')], 'SUCCESS', true))).checks.truncated).toBe(true);
  });

  it('turns unknown enum values into UNKNOWN instead of failing', () => {
    expect(state(response({ mergeable: 'NEW_VALUE', mergeStateStatus: 'NEW_VALUE' }))).toMatchObject({ mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' });
  });

  it('treats a missing permission as no write access', () => {
    const viewer = state(response({ headRepository: { id: 'R_1', viewerPermission: null, defaultBranchRef: null } }, { viewerPermission: null })).viewer;
    expect(viewer).toMatchObject({ canWrite: false, canDeleteBranch: false });
    expect(state(response({}, { viewerPermission: 'TRIAGE' })).viewer.canWrite).toBe(false);
    expect(state(response({}, { viewerPermission: 'MAINTAIN' })).viewer.canWrite).toBe(true);
  });

  it('cannot delete a head branch that no longer exists', () => {
    expect(state(response({ headRef: null })).viewer.canDeleteBranch).toBe(false);
    expect(state(response({ headRef: null })).head.refOid).toBeNull();
  });

  it('falls back to the first allowed method when the preferred one is disabled', () => {
    expect(state(response({}, { viewerDefaultMergeMethod: 'REBASE' })).repository.defaultMethod).toBe('MERGE');
    expect(state(response({}, { mergeCommitAllowed: false, viewerDefaultMergeMethod: 'REBASE' })).repository).toMatchObject({ methods: ['SQUASH'], defaultMethod: 'SQUASH' });
  });

  it('keeps the data and marks it partial when a nested field was withheld', () => {
    const errors = [{ type: 'FORBIDDEN', path: ['repository', 'pullRequest', 'commits', 'nodes', 0, 'commit', 'statusCheckRollup'] }, { type: 'NOT_FOUND', path: ['repository', 'pullRequest', 'headRepository'] }];
    expect(state(response({ headRepository: null, commits: { nodes: [{ commit: { statusCheckRollup: null } }] } }, {}, errors))).toMatchObject({
      number: 12, checks: { partial: true, rollup: 'NONE' }, head: { repositoryId: null }, viewer: { canDeleteBranch: false },
    });
  });

  it('does not keep data alongside any other kind of error', () => {
    expect(parsePullRequestLiveState(response({}, {}, [{ type: 'INTERNAL', path: ['repository', 'pullRequest', 'mergeable'] }]), 'none')).toEqual({ status: 'unusable' });
    expect(parsePullRequestLiveState(response({}, {}, [{ type: 'FORBIDDEN', path: ['repository', 'viewerPermission'] }]), 'none')).toEqual({ status: 'unusable' });
    expect(parsePullRequestLiveState(response({}, {}, [{ type: 'FORBIDDEN' }]), 'none')).toEqual({ status: 'unusable' });
  });

  it('distinguishes a missing PR from a failed read', () => {
    const missing = JSON.stringify({ data: { repository: { ...repository, pullRequest: null } }, errors: [{ type: 'NOT_FOUND', path: ['repository', 'pullRequest'] }] });
    expect(parsePullRequestLiveState(missing, 'none')).toEqual({ status: 'missing' });
    expect(parsePullRequestLiveState(JSON.stringify({ data: { repository: { ...repository, pullRequest: null } }, errors: [{ type: 'FORBIDDEN', path: ['repository', 'pullRequest'] }] }), 'none')).toEqual({ status: 'unusable' });
    expect(parsePullRequestLiveState(JSON.stringify({ data: { repository: null }, errors: [{ type: 'NOT_FOUND', path: ['repository'] }] }), 'none')).toEqual({ status: 'unusable' });
  });

  it.each([
    ['', 'empty output'], ['not json', 'invalid JSON'], ['{}', 'no data'], [JSON.stringify({ message: 'Bad credentials' }), 'an HTTP error body'],
    [response({ id: undefined }), 'a PR without an id'], [response({ state: 'DRAFTED' }), 'an unknown PR state'],
    [response(rollup([{ __typename: 'CheckRun', status: 'COMPLETED' }])), 'a check without a name'],
  ])('reports %j (%s) as unusable', raw => {
    expect(parsePullRequestLiveState(raw, 'none')).toEqual({ status: 'unusable' });
  });
});
