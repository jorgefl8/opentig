import { describe, expect, it } from 'vitest';
import type { PullRequestCheck, PullRequestLiveState } from './contracts';
import { allowedPullRequestActions, canDeleteBranchWithMerge, pullRequestActionBlocked, pullRequestBlockReason, pullRequestStatusLine, resolvePullRequestPrimary } from './pull-request-actions';

const check = (result: PullRequestCheck['result'], required: boolean): PullRequestCheck => ({ name: `${result}-${required}`, workflow: null, result, required, url: null });
function live(overrides: Partial<PullRequestLiveState> = {}): PullRequestLiveState {
  return {
    id: 'PR', number: 1, state: 'OPEN', isDraft: false, headRefOid: 'a', headRefName: 'feature', baseRefName: 'main', updatedAt: '', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: null, latestReviews: [],
    isCrossRepository: false, stack: 'none', autoMerge: null, mergeQueue: { enabled: false, queued: false }, behindBy: 0, checks: { rollup: 'NONE', items: [], truncated: false, partial: false },
    head: { repositoryId: 'R', owner: 'sample', defaultBranch: 'main', refOid: 'a' }, repository: { methods: ['MERGE'], defaultMethod: 'MERGE', autoMergeAllowed: false, deleteBranchOnMerge: false },
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

const viewer = (overrides: Partial<PullRequestLiveState['viewer']>) => ({ ...live().viewer, ...overrides });
const repository = (overrides: Partial<PullRequestLiveState['repository']>) => ({ ...live().repository, ...overrides });
const queue = { mergeQueue: { enabled: true, queued: false } };

describe('resolvePullRequestPrimary', () => {
  it.each([
    ['merged', { state: 'MERGED', mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' }, { kind: 'none' }],
    ['closed', { state: 'CLOSED' }, { kind: 'none' }],
    ['a stack layer', { stack: 'member' }, { kind: 'github', label: 'Merge on GitHub' }],
    ['an unconfirmed stack', { stack: 'unknown' }, { kind: 'retry', label: "Couldn't confirm the stack" }],
    ['a conflict', { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }, { kind: 'text', label: 'Conflicts with main' }],
    ['a conflicting draft', { isDraft: true, mergeable: 'CONFLICTING' }, { kind: 'text', label: 'Conflicts with main' }],
    ['a draft', { isDraft: true, mergeStateStatus: 'DRAFT' }, { kind: 'action', action: 'ready', label: 'Ready for review' }],
    ['a draft the viewer cannot update', { isDraft: true, mergeStateStatus: 'DRAFT', viewer: viewer({ canUpdate: false }) }, { kind: 'text', label: 'Draft' }],
    ['a queued PR', { mergeQueue: { enabled: true, queued: true } }, { kind: 'github', label: 'Manage on GitHub' }],
    ['armed auto-merge', { autoMerge: { method: 'SQUASH' }, mergeStateStatus: 'BLOCKED' }, { kind: 'none' }],
    ['a reader', { viewer: viewer({ canWrite: false }) }, { kind: 'text', label: 'Merging requires write access' }],
    ['unknown mergeability', { mergeable: 'UNKNOWN' }, { kind: 'text', label: 'Checking mergeability…' }],
    ['unknown merge state', { mergeStateStatus: 'UNKNOWN' }, { kind: 'text', label: 'Checking mergeability…' }],
    ['a clean PR in a queue', { ...queue, mergeStateStatus: 'CLEAN' }, { kind: 'action', action: 'merge', label: 'Add to merge queue' }],
    ['a blocked PR in a queue', { ...queue, mergeStateStatus: 'BLOCKED' }, { kind: 'action', action: 'merge', label: 'Merge when ready' }],
    ['a behind PR in a queue', { ...queue, mergeStateStatus: 'BEHIND' }, { kind: 'action', action: 'merge', label: 'Merge when ready' }],
    ['a PR behind', { mergeStateStatus: 'BEHIND' }, { kind: 'action', action: 'update-branch', label: 'Update branch' }],
    ['a PR behind without permission', { mergeStateStatus: 'BEHIND', viewer: viewer({ canUpdateBranch: false }) }, { kind: 'text', label: 'Updating the branch requires write access' }],
    ['a clean PR', { mergeStateStatus: 'CLEAN' }, { kind: 'action', action: 'merge', label: 'Merge' }],
    ['a PR with hooks', { mergeStateStatus: 'HAS_HOOKS' }, { kind: 'action', action: 'merge', label: 'Merge' }],
    ['an unstable PR', { mergeStateStatus: 'UNSTABLE' }, { kind: 'action', action: 'merge', label: 'Merge' }],
    ['a blocked PR with auto-merge', { mergeStateStatus: 'BLOCKED', repository: repository({ autoMergeAllowed: true }) }, { kind: 'action', action: 'enable-auto-merge', label: 'Merge when ready' }],
    ['a blocked PR without auto-merge', { mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' }, { kind: 'text', label: 'Review required' }],
    ['anything else', { mergeStateStatus: 'DRAFT' }, { kind: 'none' }],
  ] as const)('for %s', (_name, overrides, expected) => {
    expect(resolvePullRequestPrimary(live(overrides as Partial<PullRequestLiveState>))).toEqual(expected);
  });
});

describe('allowedPullRequestActions', () => {
  it.each([
    ['a clean PR', {}, ['merge', 'draft', 'close']],
    ['a draft', { isDraft: true, mergeStateStatus: 'DRAFT' }, ['ready', 'close']],
    ['a conflicting draft, which can still become ready', { isDraft: true, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }, ['ready', 'close']],
    ['a PR behind', { mergeStateStatus: 'BEHIND', behindBy: 2 }, ['update-branch', 'draft', 'close']],
    ['a blocked PR that is behind, whose update stays available', { mergeStateStatus: 'BLOCKED', behindBy: 8 }, ['update-branch', 'draft', 'close']],
    ['a blocked PR with auto-merge available', { mergeStateStatus: 'BLOCKED', repository: repository({ autoMergeAllowed: true }) }, ['enable-auto-merge', 'draft', 'close']],
    ['armed auto-merge', { mergeStateStatus: 'BLOCKED', autoMerge: { method: 'SQUASH' }, repository: repository({ autoMergeAllowed: true }) }, ['disable-auto-merge', 'draft', 'close']],
    ['armed auto-merge on a conflict', { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', autoMerge: { method: 'SQUASH' } }, ['disable-auto-merge', 'draft', 'close']],
    ['a queue', { ...queue, mergeStateStatus: 'BLOCKED', repository: repository({ autoMergeAllowed: true }) }, ['merge', 'draft', 'close']],
    ['a queued PR', { mergeQueue: { enabled: true, queued: true }, mergeStateStatus: 'BLOCKED' }, ['close']],
    ['a stack layer', { stack: 'member' }, ['draft', 'close']],
    ['an unconfirmed stack', { stack: 'unknown' }, ['draft', 'close']],
    ['a reader', { viewer: viewer({ canWrite: false, canUpdate: false, canUpdateBranch: false, canDeleteBranch: false }), mergeStateStatus: 'BEHIND' }, []],
    ['a fork author', { viewer: viewer({ canWrite: false, canUpdate: true, canUpdateBranch: true, canDeleteBranch: true }), mergeStateStatus: 'BEHIND', behindBy: 1, isCrossRepository: true }, ['update-branch', 'draft', 'close']],
    ['a closed PR', { state: 'CLOSED' }, ['reopen', 'delete-branch']],
    ['a merged PR', { state: 'MERGED' }, ['delete-branch', 'revert']],
    ['a merged PR for a reader', { state: 'MERGED', viewer: viewer({ canWrite: false, canDeleteBranch: false }) }, []],
    ['a fork PR with workflows waiting', { isCrossRepository: true, checks: { rollup: 'PENDING', items: [{ name: 'CI', workflow: null, result: 'action-required', required: false, url: null }], truncated: false, partial: false } }, ['merge', 'draft', 'close', 'approve-workflows']],
    ['a same-repository PR with a check needing action', { checks: { rollup: 'PENDING', items: [{ name: 'CI', workflow: null, result: 'action-required', required: false, url: null }], truncated: false, partial: false } }, ['merge', 'draft', 'close']],
    ['a merged PR whose branch moved', { state: 'MERGED', head: { ...live().head, refOid: 'b' } }, ['revert']],
    ['a merged PR whose branch is gone', { state: 'MERGED', head: { ...live().head, refOid: null } }, ['revert']],
    ['a merged PR from the default branch', { state: 'MERGED', headRefName: 'main', baseRefName: 'release' }, ['revert']],
    ['a merged stack layer', { state: 'MERGED', stack: 'member' }, ['revert']],
    ['a merged PR with an unconfirmed stack', { state: 'MERGED', stack: 'unknown' }, ['revert']],
  ] as const)('for %s', (_name, overrides, expected) => {
    expect(allowedPullRequestActions(live(overrides as unknown as Partial<PullRequestLiveState>))).toEqual(expected);
  });

  it('never offers merging or auto-merge while mergeability is unknown', () => {
    for (const overrides of [{ mergeable: 'UNKNOWN' }, { mergeStateStatus: 'UNKNOWN' }, { ...queue, mergeStateStatus: 'UNKNOWN' }] as const) {
      const allowed = allowedPullRequestActions(live({ ...overrides, repository: repository({ autoMergeAllowed: true }) } as Partial<PullRequestLiveState>));
      expect(allowed).not.toContain('merge');
      expect(allowed).not.toContain('enable-auto-merge');
    }
  });

  it('never offers auto-merge on a PR GitHub would merge straight away', () => {
    for (const mergeStateStatus of ['CLEAN', 'HAS_HOOKS', 'UNSTABLE'] as const) {
      expect(allowedPullRequestActions(live({ mergeStateStatus, repository: repository({ autoMergeAllowed: true }) }))).not.toContain('enable-auto-merge');
    }
  });

  it('gives the concrete reason for a rejection', () => {
    expect(pullRequestActionBlocked(live({ stack: 'unknown' }), 'merge')).toContain("Couldn't confirm");
    expect(pullRequestActionBlocked(live({ stack: 'member' }), 'merge')).toContain('stack');
    expect(pullRequestActionBlocked(live({ viewer: viewer({ canWrite: false }) }), 'merge')).toContain('write access');
    expect(pullRequestActionBlocked(live({ mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' }), 'merge')).toBe('Review required');
    expect(pullRequestActionBlocked(live({ mergeStateStatus: 'BEHIND' }), 'merge')).toBe('Update the branch first.');
    expect(pullRequestActionBlocked(live({ repository: repository({ methods: [] }) }), 'merge')).toContain('merge method');
    expect(pullRequestActionBlocked(live(), 'merge')).toBeNull();
  });
});

describe('canDeleteBranchWithMerge', () => {
  it('offers removal only when nobody else will do it and this moment is the end', () => {
    expect(canDeleteBranchWithMerge(live())).toBe(true);
    expect(canDeleteBranchWithMerge(live({ repository: repository({ deleteBranchOnMerge: true }) }))).toBe(false);
    expect(canDeleteBranchWithMerge(live(queue))).toBe(false);
    expect(canDeleteBranchWithMerge(live({ viewer: viewer({ canDeleteBranch: false }) }))).toBe(false);
    expect(canDeleteBranchWithMerge(live({ head: { ...live().head, defaultBranch: 'feature' } }))).toBe(false);
  });
});
