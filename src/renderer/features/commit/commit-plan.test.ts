import { describe, expect, it } from 'vitest';
import type { CommitSplitProposal } from '@shared/contracts';
import type { FileChange } from '@shared/git-types';
import {
  activeStep, commitPlanReducer, NO_COMMIT_PLAN, pendingPaths, planFileDiffKind, planMessage, stagedMatches,
  type CommitPlanAction, type CommitPlanModel,
} from './commit-plan';

const proposal: CommitSplitProposal = {
  rationale: 'The filter, its tests and the guide are independent changes.',
  commits: [
    { subject: 'feat: add the filter', body: 'Filter by status.', message: 'feat: add the filter\n\nFilter by status.', reason: 'The behaviour', paths: ['src/filter.ts', 'src/types.ts'], fingerprint: 'a' },
    { subject: 'test: cover the filter', body: '', message: 'test: cover the filter', reason: 'Tests only', paths: ['test/filter.test.ts'], fingerprint: 'b' },
    { subject: 'docs: describe the filter', body: '', message: 'docs: describe the filter', reason: 'The guide', paths: ['README.md'], fingerprint: 'c' },
  ],
};
const SINGLE = 'feat: add a status filter';

const run = (...actions: CommitPlanAction[]): CommitPlanModel => actions.reduce(commitPlanReducer, NO_COMMIT_PLAN);
const proposed: CommitPlanAction = { type: 'proposed', proposal, message: SINGLE, kinds: {} };
const change = (path: string, state: Partial<FileChange> = {}): FileChange => ({
  path, indexStatus: 'M', worktreeStatus: '.', kind: 'modified', staged: true, unstaged: false, conflict: false, submodule: 'N...', ...state,
});

describe('a suggested commit plan', () => {
  it('starts as one commit, so nothing is staged differently until the user chooses to split', () => {
    const { plan } = run(proposed);
    expect(plan).toMatchObject({ mode: 'one', activeIndex: null, paused: null });
    expect(activeStep(plan)).toBeNull();
    expect(planMessage(plan!, 'one')).toBe(SINGLE);
  });

  it('is dropped by a generation that suggests no split', () => {
    expect(run(proposed, { type: 'activated', index: 0, outgoing: SINGLE }, { type: 'proposed', proposal: null, message: 'fix: one thing', kinds: {} })).toEqual(NO_COMMIT_PLAN);
  });

  it('names the step by its place in the plan, not by how many are left', () => {
    const { plan } = run(proposed, { type: 'activated', index: 2, outgoing: SINGLE });
    expect(activeStep(plan)).toMatchObject({ index: 2, position: 3, total: 3, group: proposal.commits[2] });
  });

  it('keeps every message as it was left in the box when moving between the commits and back to one', () => {
    const { plan } = run(
      proposed,
      { type: 'activated', index: 0, outgoing: 'feat: my own single message' },
      { type: 'activated', index: 1, outgoing: 'feat: add the filter, reworded' },
      { type: 'single', outgoing: 'test: cover the filter, reworded' },
    );
    expect(planMessage(plan!, 'one')).toBe('feat: my own single message');
    expect(planMessage(plan!, 0)).toBe('feat: add the filter, reworded');
    expect(planMessage(plan!, 1)).toBe('test: cover the filter, reworded');
    expect(planMessage(plan!, 2)).toBe('docs: describe the filter');
  });

  it('records each commit against its group and waits for the next one to be staged', () => {
    const { plan } = run(proposed, { type: 'activated', index: 1, outgoing: SINGLE }, { type: 'committed', commit: { oid: 'b'.repeat(40), subject: 'test: cover the filter' } });
    expect(plan!.committed).toEqual({ 1: { oid: 'b'.repeat(40), subject: 'test: cover the filter' } });
    expect(activeStep(plan)).toBeNull();
    expect(pendingPaths(plan!)).toEqual(['src/filter.ts', 'src/types.ts', 'README.md']);
  });

  it('does not let a committed message overwrite the next draft, nor a committed group be staged again', () => {
    const afterFirst = run(proposed, { type: 'activated', index: 0, outgoing: SINGLE }, { type: 'committed', commit: { oid: 'a'.repeat(40), subject: 'feat: add the filter' } });
    const next = commitPlanReducer(afterFirst, { type: 'activated', index: 1, outgoing: 'feat: add the filter' });
    expect(planMessage(next.plan!, 1)).toBe('test: cover the filter');
    expect(commitPlanReducer(next, { type: 'activated', index: 0, outgoing: '' })).toBe(next);
  });

  it('cannot go back to one commit once a commit exists', () => {
    const afterFirst = run(proposed, { type: 'activated', index: 0, outgoing: SINGLE }, { type: 'committed', commit: { oid: 'a'.repeat(40), subject: 'feat: add the filter' } });
    expect(commitPlanReducer(afterFirst, { type: 'single', outgoing: '' })).toBe(afterFirst);
  });

  it('ends with its commits in plan order, whatever order they were made in', () => {
    const commit = (letter: string, subject: string) => ({ oid: letter.repeat(40), subject });
    const model = run(
      proposed,
      { type: 'activated', index: 2, outgoing: SINGLE }, { type: 'committed', commit: commit('c', 'docs: describe the filter') },
      { type: 'activated', index: 0, outgoing: '' }, { type: 'committed', commit: commit('a', 'feat: add the filter, reworded') },
      { type: 'activated', index: 1, outgoing: '' }, { type: 'committed', commit: commit('b', 'test: cover the filter') },
    );
    expect(model.plan).toBeNull();
    expect(model.outcome).toEqual({ kind: 'finished', commits: [commit('a', 'feat: add the filter, reworded'), commit('b', 'test: cover the filter'), commit('c', 'docs: describe the filter')] });
  });

  it('stays, paused with the reason, when the index is changed by hand, and goes on once a group is staged again', () => {
    const paused = run(proposed, { type: 'activated', index: 0, outgoing: SINGLE }, { type: 'paused', reason: 'You changed the staged files by hand.' });
    expect(paused.plan).toMatchObject({ paused: 'You changed the staged files by hand.', activeIndex: 0 });
    expect(activeStep(paused.plan)).toBeNull();
    const resumed = commitPlanReducer(paused, { type: 'activated', index: 0, outgoing: 'feat: add the filter' });
    expect(resumed.plan!.paused).toBeNull();
    expect(activeStep(resumed.plan)?.index).toBe(0);
  });

  it('says how much it staged back and how many commits stay when it is discarded', () => {
    const model = run(
      proposed, { type: 'activated', index: 0, outgoing: SINGLE }, { type: 'committed', commit: { oid: 'a'.repeat(40), subject: 'feat: add the filter' } },
      { type: 'activated', index: 1, outgoing: '' }, { type: 'discarded', restaged: 2 },
    );
    expect(model).toEqual({ plan: null, outcome: { kind: 'discarded', restaged: 2, committed: 1 } });
  });

  it('stops saying how the last plan ended once the index changes again', () => {
    const ended = run(proposed, { type: 'activated', index: 0, outgoing: SINGLE }, { type: 'discarded', restaged: 4 });
    expect(commitPlanReducer(ended, { type: 'paused', reason: 'You changed the staged files by hand.' })).toEqual(NO_COMMIT_PLAN);
  });
});

describe('a planned group against what is staged', () => {
  const group = proposal.commits[0]!;

  it('matches only when exactly its files are staged', () => {
    expect(stagedMatches(group, [change('src/types.ts'), change('src/filter.ts'), change('README.md', { staged: false, unstaged: true })])).toBe(true);
    expect(stagedMatches(group, [change('src/filter.ts'), change('src/types.ts'), change('README.md')])).toBe(false);
    expect(stagedMatches(group, [change('src/filter.ts'), change('src/types.ts', { staged: false, unstaged: true })])).toBe(false);
  });

  it('opens the diff that shows a file as it stands now', () => {
    const changes = [change('src/filter.ts'), change('README.md', { staged: false, unstaged: true, indexStatus: '.', worktreeStatus: 'M' })];
    expect(planFileDiffKind('src/filter.ts', changes)).toBe('staged');
    expect(planFileDiffKind('README.md', changes)).toBe('unstaged');
    // Committed or discarded since the plan was made: neither diff has it.
    expect(planFileDiffKind('src/types.ts', changes)).toBeNull();
  });
});
