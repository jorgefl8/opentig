import { describe, expect, it } from 'vitest';
import type { PullRequestCheck, PullRequestLiveState } from './contracts';
import { pullRequestBlockReason, pullRequestStatusLine } from './pull-request-actions';

const check = (result: PullRequestCheck['result'], required: boolean): PullRequestCheck => ({ name: `${result}-${required}`, workflow: null, result, required, url: null });
function live(overrides: Partial<PullRequestLiveState> = {}): PullRequestLiveState {
  return {
    id: 'PR', number: 1, state: 'OPEN', isDraft: false, headRefOid: 'a', headRefName: 'feature', baseRefName: 'main', updatedAt: '', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: null,
    isCrossRepository: false, stack: 'none', autoMerge: null, mergeQueue: { enabled: false, queued: false }, behindBy: 0, checks: { rollup: 'NONE', items: [], truncated: false, partial: false },
    head: { repositoryId: null, owner: null, defaultBranch: null, refOid: null }, repository: { methods: ['MERGE'], defaultMethod: 'MERGE', autoMergeAllowed: false, deleteBranchOnMerge: false },
    viewer: { canWrite: true, canUpdate: true, didAuthor: false, canUpdateBranch: true, canDeleteBranch: true }, ...overrides,
  };
}
const items = (...checks: PullRequestCheck[]) => ({ checks: { rollup: 'PENDING' as const, items: checks, truncated: false, partial: false } });

describe('pullRequestStatusLine', () => {
  it.each([
    ['ready', { mergeStateStatus: 'CLEAN' }, 'ready', 'Ready to merge', undefined],
    ['hooks', { mergeStateStatus: 'HAS_HOOKS' }, 'ready', 'Ready to merge', undefined],
    ['optional checks not passing', { mergeStateStatus: 'UNSTABLE' }, 'ready', 'Ready to merge', "Some optional checks haven't passed"],
    ['behind', { mergeStateStatus: 'BEHIND', behindBy: 2 }, 'attention', '2 commits behind main', undefined],
    ['one commit behind', { mergeStateStatus: 'BEHIND', behindBy: 1 }, 'attention', '1 commit behind main', undefined],
    ['behind by an unknown amount', { mergeStateStatus: 'BEHIND', behindBy: null }, 'attention', 'Behind main', undefined],
    ['conflicting', { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }, 'danger', 'Conflicts with main', undefined],
    ['conflicting while mergeable state is computing', { mergeable: 'CONFLICTING', mergeStateStatus: 'UNKNOWN' }, 'danger', 'Conflicts with main', undefined],
    ['a conflicting draft', { isDraft: true, mergeable: 'CONFLICTING', mergeStateStatus: 'DRAFT' }, 'danger', 'Conflicts with main', undefined],
    ['computing mergeable', { mergeable: 'UNKNOWN' }, 'progress', 'Checking mergeability…', undefined],
    ['computing merge state', { mergeStateStatus: 'UNKNOWN' }, 'progress', 'Checking mergeability…', undefined],
    ['queued', { mergeStateStatus: 'BLOCKED', mergeQueue: { enabled: true, queued: true } }, 'progress', 'In merge queue', undefined],
    ['blocked', { mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' }, 'attention', 'Review required', undefined],
  ] as const)('describes %s', (_name, overrides, tone, label, detail) => {
    const line = pullRequestStatusLine(live(overrides as Partial<PullRequestLiveState>));
    expect(line).toEqual({ tone, label, ...(detail ? { detail } : {}) });
  });

  it.each([
    ['merged', { state: 'MERGED', mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' }],
    ['closed', { state: 'CLOSED', mergeable: 'CONFLICTING' }],
    ['a draft', { isDraft: true, mergeStateStatus: 'DRAFT' }],
    ['a draft still computing', { isDraft: true, mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' }],
  ] as const)('says nothing for %s, whose badge already does', (_name, overrides) => {
    expect(pullRequestStatusLine(live(overrides as Partial<PullRequestLiveState>))).toBeNull();
  });

  it('describes a PR with armed auto-merge by what it is waiting for', () => {
    expect(pullRequestStatusLine(live({ mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED', autoMerge: { method: 'SQUASH' } }))?.label).toBe('Review required');
  });
});

describe('pullRequestBlockReason', () => {
  it('names reviews before checks', () => {
    expect(pullRequestBlockReason({ reviewDecision: 'REVIEW_REQUIRED', ...items(check('fail', true)) })).toBe('Review required');
    expect(pullRequestBlockReason({ reviewDecision: 'CHANGES_REQUESTED', ...items(check('fail', true)) })).toBe('Changes requested');
  });

  it('names failing required checks before pending ones, ignoring optional checks', () => {
    expect(pullRequestBlockReason({ reviewDecision: 'APPROVED', ...items(check('pending', true), check('fail', true)) })).toBe('Required checks failing');
    expect(pullRequestBlockReason({ reviewDecision: null, ...items(check('action-required', true)) })).toBe('Required checks failing');
    expect(pullRequestBlockReason({ reviewDecision: null, ...items(check('pending', true), check('fail', false)) })).toBe('Required checks pending');
  });

  it('falls back to the branch rule it cannot see', () => {
    expect(pullRequestBlockReason({ reviewDecision: 'APPROVED', ...items(check('pass', true), check('fail', false)) })).toBe('A branch rule blocks merging');
  });
});
