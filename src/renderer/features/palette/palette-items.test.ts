import { describe, expect, it, vi } from 'vitest';
import type { BranchInfo, FileChange, RepositoryStatus, WorktreeInfo } from '@shared/git-types';
import { branchItems, commandItems, repositoryChangeBlocked } from './palette-items';
import type { PaletteActions, PaletteState } from './palette-types';

const actions = new Proxy({}, { get: () => vi.fn() }) as PaletteActions;
const status = (overrides: Partial<RepositoryStatus> = {}): RepositoryStatus => ({
  branch: 'feature', oid: 'a'.repeat(40), upstream: 'origin/feature', ahead: 1, behind: 2, insertions: 0, deletions: 0,
  detached: false, unborn: false, operation: null, readOnly: false, changes: [], stagedCount: 0, unstagedCount: 0, ...overrides,
});
const state = (overrides: Partial<PaletteState> = {}): PaletteState => ({
  repositoryId: 'repo', repositoryName: 'sample', view: 'files', mobile: false, desktop: false, files: [], includeIgnored: false, activePath: null,
  status: status(), unconfirmed: false, busy: null, syncBusy: false, publishBranch: false, branches: [], worktrees: [], commits: null,
  github: { nameWithOwner: 'acme/sample' }, githubReady: true, pulls: null, pullsLoading: false, pullsError: null, createPullRequestBlocked: null,
  repositories: [], unavailableRepositories: new Set(), keys: { refresh: 'Ctrl+R', openRepository: 'Ctrl+O' }, ...overrides,
});
const command = (from: PaletteState, key: string) => commandItems(from, actions).find((item) => item.key === key);
const change = (path: string, unstaged: boolean): FileChange => ({ path, kind: 'modified', staged: !unstaged, unstaged, conflict: false } as FileChange);

describe('commands that change the repository', () => {
  it('wait for whatever the app is doing, as its own buttons do', () => {
    expect(repositoryChangeBlocked(state())).toBeNull();
    expect(repositoryChangeBlocked(state({ status: null }))).toMatch(/read/);
    expect(repositoryChangeBlocked(state({ unconfirmed: true }))).toMatch(/read/);
    expect(repositoryChangeBlocked(state({ status: status({ readOnly: true, operation: 'rebase' }) }))).toContain('rebase');
    expect(repositoryChangeBlocked(state({ busy: 'push' }))).toMatch(/finish/);
    expect(repositoryChangeBlocked(state({ syncBusy: true }))).toMatch(/finish/);
    for (const key of ['pull', 'push', 'discard']) expect(command(state({ busy: 'commit' }), key)?.disabled, key).toMatch(/finish/);
  });

  it('pull only with commits to pull from an upstream', () => {
    expect(command(state(), 'pull')).toMatchObject({ title: 'Pull 2 commits', disabled: null, verb: 'run' });
    expect(command(state({ status: status({ behind: 0 }) }), 'pull')?.disabled).toMatch(/Nothing to pull/);
    expect(command(state({ status: status({ upstream: null }) }), 'pull')?.disabled).toMatch(/no upstream/);
    expect(command(state({ status: status({ detached: true }) }), 'pull')?.disabled).toMatch(/Check out/);
  });

  it('push what is ahead, publish a branch without an upstream, and nothing on an unborn one', () => {
    expect(command(state(), 'push')).toMatchObject({ title: 'Push 1 commit', disabled: null });
    expect(command(state({ status: status({ ahead: 0 }) }), 'push')?.disabled).toBe('Nothing to push');
    expect(command(state({ publishBranch: true, status: status({ ahead: 0, upstream: null }) }), 'push')).toMatchObject({ title: 'Publish branch', disabled: null });
    expect(command(state({ status: status({ unborn: true }) }), 'push')?.disabled).toMatch(/first commit/);
  });

  it('discard asks first, and only with unstaged changes to discard', () => {
    expect(command(state(), 'discard')).toMatchObject({ verb: 'ask', disabled: 'There are no unstaged changes' });
    const changed = state({ status: status({ changes: [change('a.txt', true), change('b.txt', false)] }) });
    expect(command(changed, 'discard')).toMatchObject({ disabled: null, detail: 'Asks before discarding 1 file' });
  });

  it('runs the app’s own action when chosen', () => {
    const run = vi.fn();
    const own = { ...actions, pull: run } as PaletteActions;
    commandItems(state(), own).find((item) => item.key === 'pull')!.run();
    expect(run).toHaveBeenCalledOnce();
  });
});

describe('commands that depend on where OpenTig runs', () => {
  it('names the keys of each section that work there', () => {
    expect(command(state({ desktop: true }), 'section:history')?.keys).toEqual(['Ctrl', '3']);
    expect(command(state(), 'section:history')?.keys).toEqual(['G', 'H']);
  });

  it('leaves out GitHub commands away from GitHub, and Shortcuts on a phone', () => {
    const away = commandItems(state({ github: null }), actions).map((item) => item.key);
    expect(away).not.toContain('create-pull-request');
    expect(away).not.toContain('github');
    expect(commandItems(state({ mobile: true }), actions).map((item) => item.key)).not.toContain('shortcuts');
    expect(command(state({ createPullRequestBlocked: 'Check out a branch first' }), 'create-pull-request')?.disabled).toBe('Check out a branch first');
  });
});

describe('branches', () => {
  const branch = (name: string, overrides: Partial<BranchInfo> = {}): BranchInfo => ({
    name, fullName: `refs/heads/${name}`, current: false, remote: false, upstream: null, ahead: 0, behind: 0, worktreePath: null,
    oid: 'b'.repeat(40), shortOid: 'bbbbbbb', subject: '', author: '', date: '', ...overrides,
  } as BranchInfo);
  const worktree = (path: string, overrides: Partial<WorktreeInfo> = {}): WorktreeInfo => ({ path, oid: '', branch: null, bare: false, detached: false, locked: null, prunable: null, main: false, ...overrides });

  it('lists the current branch first, which only shows History', () => {
    const items = branchItems(state({ branches: [branch('main'), branch('feature', { current: true })] }), actions);
    expect(items.map((item) => item.title)).toEqual(['feature', 'main']);
    expect(items[0]).toMatchObject({ verb: 'current', disabled: null });
    expect(items[1]).toMatchObject({ verb: 'run', verbLabel: 'Switch' });
  });

  it('opens a branch checked out elsewhere in its worktree, and refuses one in a worktree it can’t open', () => {
    const elsewhere = branch('docs', { worktreePath: '/work/docs' });
    const gone = branch('old', { worktreePath: '/work/old' });
    const items = branchItems(state({ branches: [elsewhere, gone], worktrees: [worktree('/work/docs'), worktree('/work/old', { prunable: 'gone' })] }), actions);
    expect(items[0]).toMatchObject({ verb: 'open', verbLabel: 'Open worktree', disabled: null });
    expect(items[1]?.disabled).toBe('In use in old');
  });

  it('waits to switch while the repository is busy', () => {
    expect(branchItems(state({ branches: [branch('main')], busy: 'pull' }), actions)[0]?.disabled).toMatch(/finish/);
  });

  it('skips the remote HEAD alias', () => {
    const items = branchItems(state({ branches: [branch('origin/HEAD', { remote: true, fullName: 'refs/remotes/origin/HEAD' }), branch('origin/main', { remote: true, fullName: 'refs/remotes/origin/main' })] }), actions);
    expect(items.map((item) => item.title)).toEqual(['origin/main']);
  });
});
