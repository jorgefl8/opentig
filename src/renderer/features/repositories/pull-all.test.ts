import { describe, expect, it } from 'vitest';
import { joinsPullAll, pullAllButtonCopy, pullAllOutcome, pullAllSettled, pullAllSummary, startPullAll, stopPullAll, withPullAllRow } from './pull-all';
import type { RepositorySyncCounts } from './project-sync';

const behind: RepositorySyncCounts = { ahead: 0, behind: 3, branch: 'main', detached: false, upstream: 'origin/main', unborn: false, readOnly: false, operation: null };
const free = { running: false, unavailable: false, openAndBusy: false };

describe('Pull all', () => {
  it('takes rows with commits to bring in and none of their own, and leaves out what its own Pull has to handle', () => {
    expect(joinsPullAll(behind, free)).toBe(true);
    expect(joinsPullAll({ ...behind, behind: 0 }, free)).toBe(false);
    // A diverged branch would be rebased by its own Pull; that is looked at one by one.
    expect(joinsPullAll({ ...behind, ahead: 1 }, free)).toBe(false);
    expect(joinsPullAll({ ...behind, upstream: null }, free)).toBe(false);
    expect(joinsPullAll({ ...behind, detached: true }, free)).toBe(false);
    expect(joinsPullAll({ ...behind, readOnly: true }, free)).toBe(false);
    expect(joinsPullAll({ ...behind, operation: 'merge' }, free)).toBe(false);
    expect(joinsPullAll(undefined, free)).toBe(false);
    expect(joinsPullAll(behind, { ...free, running: true })).toBe(false);
    expect(joinsPullAll(behind, { ...free, unavailable: true })).toBe(false);
    expect(joinsPullAll(behind, { ...free, openAndBusy: true })).toBe(false);
    // Skipped by the run on screen: a second run would skip it again.
    expect(joinsPullAll(behind, { ...free, previous: { phase: 'skipped', reason: 'local-changes' } })).toBe(false);
    expect(joinsPullAll(behind, { ...free, previous: { phase: 'failed', message: 'Could not pull' } })).toBe(true);
  });

  it('reads a fast-forward-only answer as pulled, skipped, or failed', () => {
    expect(pullAllOutcome({ status: 'success', commits: 2, restoredLocalChanges: false, rebased: false, localCommits: 0, keptLocalChanges: true }))
      .toEqual({ phase: 'pulled', commits: 2, keptLocalChanges: true });
    expect(pullAllOutcome({ status: 'blocked-local-changes', files: ['a.txt'] })).toEqual({ phase: 'skipped', reason: 'local-changes' });
    expect(pullAllOutcome({ status: 'diverged', ahead: 1, behind: 2 })).toEqual({ phase: 'skipped', reason: 'diverged' });
  });

  it('stops the repositories still waiting and lets the ones pulling finish before the run ends', () => {
    let run = startPullAll([{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }, { id: 'c', label: 'c' }]);
    run = withPullAllRow(run, 'a', { phase: 'running' });
    run = stopPullAll(run);
    expect([...run.rows.values()].map((state) => state.phase)).toEqual(['running', 'not-pulled', 'not-pulled']);
    expect(pullAllSettled(run)).toBe(false);
    run = withPullAllRow(run, 'a', { phase: 'pulled', commits: 1, keptLocalChanges: false });
    expect(pullAllSettled(run)).toBe(true);
    expect(pullAllSummary(run)).toEqual({ type: 'warning', title: 'Stopped: pulled 1 of 3 repositories', lines: ['2 not pulled.'], duration: 10_000 });
  });

  it('sums a run up in one notice, saying why each repository left was not pulled', () => {
    let run = startPullAll([{ id: 'a', label: 'Web · app' }, { id: 'b', label: 'docs' }, { id: 'c', label: 'mobile' }]);
    run = withPullAllRow(run, 'a', { phase: 'pulled', commits: 4, keptLocalChanges: false });
    run = withPullAllRow(run, 'b', { phase: 'skipped', reason: 'local-changes' });
    run = withPullAllRow(run, 'c', { phase: 'failed', message: 'Couldn\'t reach the remote' });
    expect(pullAllSummary(run)).toEqual({
      type: 'warning', title: 'Pulled 1 of 3 repositories', duration: 10_000,
      lines: ['docs: local changes are in the way, so nothing changed.', 'mobile: couldn\'t reach the remote.'],
    });
    const pulled = withPullAllRow(withPullAllRow(withPullAllRow(run, 'b', { phase: 'up-to-date' }), 'c', { phase: 'pulled', commits: 1, keptLocalChanges: true }), 'a', { phase: 'pulled', commits: 1, keptLocalChanges: false });
    expect(pullAllSummary(pulled)).toMatchObject({ type: 'success', title: 'Pulled 3 repositories', lines: [] });
  });

  it('says it pulls only the rows shown once the search narrows the list', () => {
    expect(pullAllButtonCopy(6, false, ['infra']).label).toBe('Pull all 6');
    expect(pullAllButtonCopy(3, true, []).label).toBe('Pull 3 shown');
    expect(pullAllButtonCopy(6, false, ['infra', 'api']).tooltip).toBe('Fast-forwards 6 repositories, keeping local changes Git doesn\'t need to touch. infra and api need their own Pull.');
  });
});
