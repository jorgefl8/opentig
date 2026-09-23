import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileService } from '../files/FileService';
import { SettingsStore } from '../persistence/SettingsStore';
import { GitProcess } from './GitProcess';
import { GitRepositoryOperations } from './GitRepositoryOperations';
import { RepositoryService } from './RepositoryService';

const execFileAsync = promisify(execFile);
const directories: string[] = [];

afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 3 }))));

describe('GitRepositoryOperations local history', () => {
  it('marks commits relative to the configured upstream', async () => {
    const fixture = await repositoryWithUpstream();
    const baseOid = await git(fixture.work, ['rev-parse', 'HEAD']);
    await writeFile(path.join(fixture.work, 'committed.txt'), 'base\nlocal\n');
    await git(fixture.work, ['add', 'committed.txt']);
    await git(fixture.work, ['commit', '-m', 'Local change']);
    const localOid = await git(fixture.work, ['rev-parse', 'HEAD']);

    const page = await fixture.operations.listCommits(fixture.repositoryId);
    expect(page.commits.find((commit) => commit.oid === localOid)).toMatchObject({ upstreamState: 'local-only', isHead: true });
    expect(page.commits.find((commit) => commit.oid === baseOid)).toMatchObject({ upstreamState: 'published', isHead: false });
  });

  it('uses unknown rather than guessing when no upstream exists', async () => {
    const fixture = await standaloneRepository();
    const page = await fixture.operations.listCommits(fixture.repositoryId);
    expect(page.commits).toHaveLength(1);
    expect(page.commits[0]).toMatchObject({ upstreamState: 'unknown', isHead: true });
  });

  it('undoes only the expected local HEAD while preserving index and worktree changes', async () => {
    const fixture = await repositoryWithUpstream();
    const baseOid = await git(fixture.work, ['rev-parse', 'HEAD']);
    await writeFile(path.join(fixture.work, 'committed.txt'), 'base\nlocal\n');
    await git(fixture.work, ['add', 'committed.txt']);
    await git(fixture.work, ['commit', '-m', 'Local subject', '-m', 'Local body']);
    const localOid = await git(fixture.work, ['rev-parse', 'HEAD']);

    await writeFile(path.join(fixture.work, 'staged.txt'), 'base\nstaged later\n');
    await git(fixture.work, ['add', 'staged.txt']);
    await writeFile(path.join(fixture.work, 'unstaged.txt'), 'base\nunstaged later\n');
    const stagedBefore = await gitRaw(fixture.work, ['diff', '--cached', '--', 'staged.txt']);
    const unstagedBefore = await gitRaw(fixture.work, ['diff', '--', 'unstaged.txt']);

    const result = await fixture.operations.undoLatestCommit(fixture.repositoryId, localOid);
    expect(result).toMatchObject({ status: 'success', undoneOid: localOid, newHeadOid: baseOid, message: 'Local subject\n\nLocal body', stagedCount: 2 });
    expect(await git(fixture.work, ['rev-parse', 'HEAD'])).toBe(baseOid);
    expect(await git(fixture.work, ['rev-parse', 'ORIG_HEAD'])).toBe(localOid);
    expect(await gitRaw(fixture.work, ['diff', '--cached', '--', 'staged.txt'])).toBe(stagedBefore);
    expect(await gitRaw(fixture.work, ['diff', '--', 'unstaged.txt'])).toBe(unstagedBefore);
    expect(await gitRaw(fixture.work, ['diff', '--cached', '--', 'committed.txt'])).toContain('+local');
  });

  it('rejects a stale expected OID without moving HEAD', async () => {
    const fixture = await repositoryWithUpstream();
    const baseOid = await git(fixture.work, ['rev-parse', 'HEAD']);
    await writeFile(path.join(fixture.work, 'committed.txt'), 'base\nlocal\n');
    await git(fixture.work, ['add', 'committed.txt']);
    await git(fixture.work, ['commit', '-m', 'Local change']);
    const localOid = await git(fixture.work, ['rev-parse', 'HEAD']);
    expect(await fixture.operations.undoLatestCommit(fixture.repositoryId, baseOid)).toEqual({ status: 'stale-head' });
    expect(await git(fixture.work, ['rev-parse', 'HEAD'])).toBe(localOid);
  });

  it('does not undo without an upstream', async () => {
    const fixture = await standaloneRepository();
    const oid = await git(fixture.work, ['rev-parse', 'HEAD']);
    expect(await fixture.operations.undoLatestCommit(fixture.repositoryId, oid)).toEqual({ status: 'no-upstream' });
    expect(await git(fixture.work, ['rev-parse', 'HEAD'])).toBe(oid);
  });

  it('does not undo a commit that is already in the upstream', async () => {
    const fixture = await repositoryWithUpstream();
    const oid = await git(fixture.work, ['rev-parse', 'HEAD']);
    expect(await fixture.operations.undoLatestCommit(fixture.repositoryId, oid)).toEqual({ status: 'not-local' });
    expect(await git(fixture.work, ['rev-parse', 'HEAD'])).toBe(oid);
  });

  it('protects a local merge commit', async () => {
    const fixture = await repositoryWithUpstream();
    await git(fixture.work, ['switch', '-c', 'feature']);
    await writeFile(path.join(fixture.work, 'feature.txt'), 'feature\n');
    await git(fixture.work, ['add', 'feature.txt']);
    await git(fixture.work, ['commit', '-m', 'Feature change']);
    await git(fixture.work, ['switch', 'main']);
    await writeFile(path.join(fixture.work, 'main.txt'), 'main\n');
    await git(fixture.work, ['add', 'main.txt']);
    await git(fixture.work, ['commit', '-m', 'Main change']);
    await git(fixture.work, ['merge', '--no-ff', 'feature', '-m', 'Merge feature']);
    const mergeOid = await git(fixture.work, ['rev-parse', 'HEAD']);
    expect(await fixture.operations.undoLatestCommit(fixture.repositoryId, mergeOid)).toEqual({ status: 'unsupported-merge' });
    expect(await git(fixture.work, ['rev-parse', 'HEAD'])).toBe(mergeOid);
  });
});

describe('GitRepositoryOperations diff', () => {
  it('returns a synthetic all-added patch for untracked files without running a full status', async () => {
    const fixture = await standaloneRepository();
    await writeFile(path.join(fixture.work, 'nuevo.txt'), 'uno\ndos\n');
    const result = await fixture.operations.diff({ repositoryId: fixture.repositoryId, path: 'nuevo.txt', kind: 'unstaged' });
    expect(result.binary).toBe(false);
    expect(result.patch.startsWith('diff --git a/nuevo.txt b/nuevo.txt')).toBe(true);
    expect(result.patch).toContain('+uno');
    expect(result.patch).toContain('+dos');
  });

  it('uses a regular worktree diff for tracked files', async () => {
    const fixture = await standaloneRepository();
    await writeFile(path.join(fixture.work, 'file.txt'), 'content\nextra\n');
    const result = await fixture.operations.diff({ repositoryId: fixture.repositoryId, path: 'file.txt', kind: 'unstaged' });
    expect(result.patch).toContain('+extra');
    expect(result.patch).not.toContain('new file mode');
  });

  it('uses the index diff for staged changes', async () => {
    const fixture = await standaloneRepository();
    await writeFile(path.join(fixture.work, 'file.txt'), 'content\nstaged\n');
    await git(fixture.work, ['add', 'file.txt']);
    const result = await fixture.operations.diff({ repositoryId: fixture.repositoryId, path: 'file.txt', kind: 'staged' });
    expect(result.patch).toContain('+staged');
  });

  it('returns an empty staged diff for a fully untracked file', async () => {
    const fixture = await standaloneRepository();
    await writeFile(path.join(fixture.work, 'nuevo.txt'), 'uno\n');
    const result = await fixture.operations.diff({ repositoryId: fixture.repositoryId, path: 'nuevo.txt', kind: 'staged' });
    expect(result.patch).toBe('');
  });

  it('treats a newly staged file as tracked', async () => {
    const fixture = await standaloneRepository();
    await writeFile(path.join(fixture.work, 'nuevo.txt'), 'uno\n');
    await git(fixture.work, ['add', 'nuevo.txt']);
    const result = await fixture.operations.diff({ repositoryId: fixture.repositoryId, path: 'nuevo.txt', kind: 'staged' });
    expect(result.patch).toContain('new file mode');
    expect(result.patch).toContain('+uno');
  });
});

describe('GitRepositoryOperations AI context', () => {
  it('gives pull-request drafts the same generous patch budget as commit generation', async () => {
    const fixture = await standaloneRepository();
    await git(fixture.work, ['switch', '-c', 'feature']);
    const content = Array.from({ length: 8_000 }, (_, index) => `branch change ${index}`).join('\n');
    await writeFile(path.join(fixture.work, 'large-change.txt'), `${content}\n`);
    await git(fixture.work, ['add', 'large-change.txt']);
    await git(fixture.work, ['commit', '-m', 'Add large branch change']);

    const context = await fixture.operations.getPullRequestDraftContext(fixture.repositoryId, 'main');

    expect(context.patch.length).toBeGreaterThan(40_000);
    expect(context.patch).toContain('+branch change 7999');
    expect(context.truncated).toBe(false);
  });
});

describe('GitRepositoryOperations commit groups', () => {
  it('prepares proposed file groups without creating commits', async () => {
    const fixture = await standaloneRepository();
    await writeFile(path.join(fixture.work, 'file.txt'), 'content\napplication\n');
    await writeFile(path.join(fixture.work, 'README.md'), 'documentation\n');
    await git(fixture.work, ['add', 'file.txt', 'README.md']);
    const docs = await fixture.operations.commitGroupFingerprint(fixture.repositoryId, ['README.md']);
    const code = await fixture.operations.commitGroupFingerprint(fixture.repositoryId, ['file.txt']);

    await fixture.operations.prepareCommitGroup({
      repositoryId: fixture.repositoryId,
      paths: ['README.md'],
      expectedStagedPaths: ['README.md', 'file.txt'],
      expectedFingerprint: docs,
    });
    expect((await git(fixture.work, ['diff', '--cached', '--name-only'])).split(/\r?\n/)).toEqual(['README.md']);

    await fixture.operations.createCommit(fixture.repositoryId, 'Document the change');
    await fixture.operations.prepareCommitGroup({ repositoryId: fixture.repositoryId, paths: ['file.txt'], expectedStagedPaths: [], expectedFingerprint: code });
    expect((await git(fixture.work, ['diff', '--cached', '--name-only'])).split(/\r?\n/)).toEqual(['file.txt']);
  });

  it('refuses a stale generated plan before changing the index', async () => {
    const fixture = await standaloneRepository();
    await writeFile(path.join(fixture.work, 'file.txt'), 'changed\n');
    await writeFile(path.join(fixture.work, 'README.md'), 'docs\n');
    await git(fixture.work, ['add', 'file.txt', 'README.md']);
    await expect(fixture.operations.prepareCommitGroup({
      repositoryId: fixture.repositoryId,
      paths: ['README.md'],
      expectedStagedPaths: ['README.md', 'file.txt'],
      expectedFingerprint: '0'.repeat(64),
    })).rejects.toThrow(/These files changed/);
    expect((await git(fixture.work, ['diff', '--cached', '--name-only'])).split(/\r?\n/).sort()).toEqual(['README.md', 'file.txt']);
  });

  it('keeps each group of a plan protected after another group is committed', async () => {
    const fixture = await standaloneRepository();
    await writeFile(path.join(fixture.work, 'file.txt'), 'application\n');
    await writeFile(path.join(fixture.work, 'README.md'), 'documentation\n');
    await git(fixture.work, ['add', 'file.txt', 'README.md']);
    // Fingerprints are taken once, when the plan is generated.
    const docs = await fixture.operations.commitGroupFingerprint(fixture.repositoryId, ['README.md']);
    const code = await fixture.operations.commitGroupFingerprint(fixture.repositoryId, ['file.txt']);

    await fixture.operations.prepareCommitGroup({ repositoryId: fixture.repositoryId, paths: ['README.md'], expectedStagedPaths: ['README.md', 'file.txt'], expectedFingerprint: docs });
    await fixture.operations.createCommit(fixture.repositoryId, 'Document the change');
    // Committing the first group must not invalidate the second one.
    expect(await fixture.operations.commitGroupFingerprint(fixture.repositoryId, ['file.txt'])).toBe(code);

    // Editing the second group's file after the plan was made must be refused.
    await writeFile(path.join(fixture.work, 'file.txt'), 'edited after the plan\n');
    await expect(fixture.operations.prepareCommitGroup({
      repositoryId: fixture.repositoryId,
      paths: ['file.txt'],
      expectedStagedPaths: [],
      expectedFingerprint: code,
    })).rejects.toThrow(/These files changed/);
    expect(await git(fixture.work, ['diff', '--cached', '--name-only'])).toBe('');
  });

  it('fingerprints a group by content, independently of the index', async () => {
    const fixture = await standaloneRepository();
    await writeFile(path.join(fixture.work, 'file.txt'), 'application\n');
    const staged = await fixture.operations.commitGroupFingerprint(fixture.repositoryId, ['file.txt']);
    await git(fixture.work, ['add', 'file.txt']);
    expect(await fixture.operations.commitGroupFingerprint(fixture.repositoryId, ['file.txt'])).toBe(staged);

    await writeFile(path.join(fixture.work, 'file.txt'), 'different\n');
    expect(await fixture.operations.commitGroupFingerprint(fixture.repositoryId, ['file.txt'])).not.toBe(staged);

    // A deleted file still fingerprints instead of throwing.
    await rm(path.join(fixture.work, 'file.txt'));
    await expect(fixture.operations.commitGroupFingerprint(fixture.repositoryId, ['file.txt'])).resolves.toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('GitRepositoryOperations local refs snapshot', () => {
  it('returns only local branches, current first, with tip metadata', async () => {
    const fixture = await managementRepository();
    await git(fixture.work, ['branch', 'zeta']);
    await git(fixture.work, ['branch', 'alpha']);
    await addRemote(fixture);
    await git(fixture.work, ['push', '-q', 'origin', 'main']);
    const headOid = await git(fixture.work, ['rev-parse', 'HEAD']);

    const snapshot = await fixture.operations.localRefsSnapshot(fixture.repositoryId);
    expect(snapshot.branches.map((branch) => branch.name)).toEqual(['main', 'alpha', 'zeta']);
    expect(snapshot.branches.every((branch) => !branch.remote)).toBe(true);
    expect(snapshot.branches[0]).toMatchObject({ current: true, oid: headOid, subject: 'Base commit', author: 'OpenTig Test' });
    expect(snapshot.branches[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('identifies the main worktree and the one OpenTig currently has open', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');

    const snapshot = await fixture.operations.localRefsSnapshot(fixture.repositoryId);
    expect(snapshot.worktrees).toHaveLength(2);
    expect(snapshot.worktrees[0]).toMatchObject({ main: true, current: true, branch: 'main' });
    expect(snapshot.worktrees[1]).toMatchObject({ main: false, current: false, branch: 'review' });
    expect(await realPath(snapshot.worktrees[1]!.path)).toBe(await realPath(review));
  });
});

describe('GitRepositoryOperations branch switching', () => {
  it('offers blocked local changes and then moves them to the destination unstaged', async () => {
    const fixture = await standaloneRepository();
    await writeFile(path.join(fixture.work, 'file.txt'), 'first\nsecond\nthird\n');
    await git(fixture.work, ['commit', '-am', 'Expand fixture']);
    await git(fixture.work, ['switch', '-c', 'destination']);
    await writeFile(path.join(fixture.work, 'file.txt'), 'destination\nsecond\nthird\n');
    await git(fixture.work, ['commit', '-am', 'Change destination']);
    await git(fixture.work, ['switch', 'main']);
    await writeFile(path.join(fixture.work, 'file.txt'), 'first\nsecond\nlocal staged\n');
    await git(fixture.work, ['add', 'file.txt']);
    await writeFile(path.join(fixture.work, 'file.txt'), 'first\nsecond\nlocal staged\nlocal unstaged\n');
    await writeFile(path.join(fixture.work, 'untracked.txt'), 'untracked\n');

    expect(await fixture.operations.switchBranch(fixture.repositoryId, 'destination')).toEqual({
      status: 'blocked-local-changes', files: ['file.txt', 'untracked.txt'],
    });
    expect(await git(fixture.work, ['branch', '--show-current'])).toBe('main');

    expect(await fixture.operations.switchBranch(fixture.repositoryId, 'destination', true)).toEqual({
      status: 'switched', movedChanges: true,
    });
    expect(await git(fixture.work, ['branch', '--show-current'])).toBe('destination');
    expect(await gitRaw(fixture.work, ['diff', '--cached', '--name-only'])).toBe('');
    expect(await gitRaw(fixture.work, ['diff', '--name-only'])).toBe('file.txt\n');
    expect(await gitRaw(fixture.work, ['status', '--porcelain', '--', 'untracked.txt'])).toBe('?? untracked.txt\n');
    expect(await gitRaw(fixture.work, ['stash', 'list'])).toBe('');
    expect((await readFile(path.join(fixture.work, 'file.txt'), 'utf8')).replace(/\r\n/g, '\n'))
      .toBe('destination\nsecond\nlocal staged\nlocal unstaged\n');
  });

  it('keeps the safety stash when moved changes conflict on the destination', async () => {
    const fixture = await standaloneRepository();
    await git(fixture.work, ['switch', '-c', 'destination']);
    await writeFile(path.join(fixture.work, 'file.txt'), 'destination\n');
    await git(fixture.work, ['commit', '-am', 'Change destination']);
    await git(fixture.work, ['switch', 'main']);
    await writeFile(path.join(fixture.work, 'file.txt'), 'local\n');

    expect((await fixture.operations.switchBranch(fixture.repositoryId, 'destination')).status).toBe('blocked-local-changes');
    const result = await fixture.operations.switchBranch(fixture.repositoryId, 'destination', true);
    expect(result).toMatchObject({ status: 'moved-with-conflicts', files: ['file.txt'] });
    expect(await git(fixture.work, ['branch', '--show-current'])).toBe('destination');
    expect(await gitRaw(fixture.work, ['status', '--porcelain', '--', 'file.txt'])).toContain('UU file.txt');
    expect(await gitRaw(fixture.work, ['stash', 'list'])).toContain('OpenTig branch move to destination');
  });
});

describe('GitRepositoryOperations branch details', () => {
  it('reports a merged branch as safe against HEAD when no upstream is configured', async () => {
    const fixture = await managementRepository();
    await git(fixture.work, ['branch', 'merged']);
    expect(await fixture.operations.branchDetails(fixture.repositoryId, 'refs/heads/merged')).toMatchObject({
      name: 'merged', deletion: 'safe', comparisonKind: 'head', comparisonBase: 'HEAD', uniqueCommits: 0,
    });
  });

  it('reports an unmerged branch with the commits it would take with it', async () => {
    const fixture = await managementRepository();
    await commitOnBranch(fixture, 'feature', 'one');
    await commitOnBranch(fixture, 'feature', 'two');
    expect(await fixture.operations.branchDetails(fixture.repositoryId, 'refs/heads/feature')).toMatchObject({
      deletion: 'unmerged', comparisonKind: 'head', comparisonBase: 'HEAD', uniqueCommits: 2,
    });
  });

  it('prefers the configured upstream over HEAD', async () => {
    const fixture = await managementRepository();
    await addRemote(fixture);
    await commitOnBranch(fixture, 'tracked', 'shared');
    await git(fixture.work, ['push', '-q', '-u', 'origin', 'tracked']);
    // Merged into its upstream even though it is ahead of HEAD.
    expect(await fixture.operations.branchDetails(fixture.repositoryId, 'refs/heads/tracked')).toMatchObject({
      deletion: 'safe', comparisonKind: 'upstream', comparisonBase: 'origin/tracked', uniqueCommits: 0, upstream: 'origin/tracked',
    });

    await commitOnBranch(fixture, 'tracked', 'unpushed');
    expect(await fixture.operations.branchDetails(fixture.repositoryId, 'refs/heads/tracked')).toMatchObject({
      deletion: 'unmerged', comparisonKind: 'upstream', comparisonBase: 'origin/tracked', uniqueCommits: 1,
    });
  });

  it('reports current and checked-out states before analyzing merges', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    expect(await fixture.operations.branchDetails(fixture.repositoryId, 'refs/heads/main')).toMatchObject({
      deletion: 'current', comparisonKind: 'none', comparisonBase: null, uniqueCommits: 0,
    });
    const details = await fixture.operations.branchDetails(fixture.repositoryId, 'refs/heads/review');
    expect(details).toMatchObject({ deletion: 'checked-out', comparisonKind: 'none', comparisonBase: null });
    expect(await realPath(details.worktreePath!)).toBe(await realPath(review));
  });

  it('returns unknown rather than guessing when the upstream no longer resolves locally', async () => {
    const fixture = await managementRepository();
    await addRemote(fixture);
    await commitOnBranch(fixture, 'gone', 'work');
    await git(fixture.work, ['push', '-q', '-u', 'origin', 'gone']);
    await git(fixture.work, ['update-ref', '-d', 'refs/remotes/origin/gone']);
    expect(await fixture.operations.branchDetails(fixture.repositoryId, 'refs/heads/gone')).toMatchObject({
      deletion: 'unknown', comparisonKind: 'upstream', comparisonBase: 'origin/gone', uniqueCommits: 0,
    });
  });

  it('rejects a branch that no longer exists and never accepts a remote ref', async () => {
    const fixture = await managementRepository();
    await addRemote(fixture);
    await git(fixture.work, ['push', '-q', 'origin', 'main']);
    await expect(fixture.operations.branchDetails(fixture.repositoryId, 'refs/heads/never')).rejects.toThrow();
    await expect(fixture.operations.branchDetails(fixture.repositoryId, 'refs/remotes/origin/main')).rejects.toThrow();
  });
});

describe('GitRepositoryOperations safe branch deletion', () => {
  it('deletes a merged unused branch and leaves every other ref in place', async () => {
    const fixture = await managementRepository();
    await git(fixture.work, ['branch', 'merged']);
    const oid = await git(fixture.work, ['rev-parse', 'refs/heads/merged']);
    const headBefore = await git(fixture.work, ['rev-parse', 'HEAD']);

    expect(await fixture.operations.deleteLocalBranch(fixture.repositoryId, 'refs/heads/merged', oid))
      .toEqual({ status: 'deleted', fullName: 'refs/heads/merged', name: 'merged', oid });
    expect(await git(fixture.work, ['for-each-ref', '--format=%(refname)', 'refs/heads'])).toBe('refs/heads/main');
    expect(await git(fixture.work, ['rev-parse', 'HEAD'])).toBe(headBefore);
  });

  it('deletes branch names containing spaces and Unicode', async () => {
    const fixture = await managementRepository();
    await git(fixture.work, ['branch', 'función/ñandú']);
    const oid = await git(fixture.work, ['rev-parse', 'refs/heads/función/ñandú']);
    expect(await fixture.operations.deleteLocalBranch(fixture.repositoryId, 'refs/heads/función/ñandú', oid))
      .toMatchObject({ status: 'deleted', name: 'función/ñandú' });
    expect(await git(fixture.work, ['for-each-ref', '--format=%(refname)', 'refs/heads'])).toBe('refs/heads/main');
  });

  it('refuses the current branch without touching it', async () => {
    const fixture = await managementRepository();
    const oid = await git(fixture.work, ['rev-parse', 'refs/heads/main']);
    expect(await fixture.operations.deleteLocalBranch(fixture.repositoryId, 'refs/heads/main', oid)).toEqual({ status: 'current' });
    expect(await git(fixture.work, ['rev-parse', 'refs/heads/main'])).toBe(oid);
  });

  it('refuses a branch checked out in another worktree', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const oid = await git(fixture.work, ['rev-parse', 'refs/heads/review']);
    const result = await fixture.operations.deleteLocalBranch(fixture.repositoryId, 'refs/heads/review', oid);
    expect(result.status).toBe('checked-out');
    expect(await realPath((result as { worktreePath: string }).worktreePath)).toBe(await realPath(review));
    expect(await git(fixture.work, ['rev-parse', 'refs/heads/review'])).toBe(oid);
  });

  it('refuses an unmerged branch and reports the base it compared against', async () => {
    const fixture = await managementRepository();
    await commitOnBranch(fixture, 'feature', 'unmerged work');
    const oid = await git(fixture.work, ['rev-parse', 'refs/heads/feature']);
    expect(await fixture.operations.deleteLocalBranch(fixture.repositoryId, 'refs/heads/feature', oid))
      .toEqual({ status: 'unmerged', comparisonBase: 'HEAD', uniqueCommits: 1 });
    expect(await git(fixture.work, ['rev-parse', 'refs/heads/feature'])).toBe(oid);
  });

  it('force-deletes an unmerged branch after explicit confirmation', async () => {
    const fixture = await managementRepository();
    await commitOnBranch(fixture, 'temporary', 'unmerged work');
    const oid = await git(fixture.work, ['rev-parse', 'refs/heads/temporary']);

    expect(await fixture.operations.deleteLocalBranch(fixture.repositoryId, 'refs/heads/temporary', oid, true))
      .toEqual({ status: 'deleted', fullName: 'refs/heads/temporary', name: 'temporary', oid });
    expect(await git(fixture.work, ['for-each-ref', '--format=%(refname)', 'refs/heads/temporary'])).toBe('');
  });

  it('refuses a branch whose comparison base no longer resolves', async () => {
    const fixture = await managementRepository();
    await addRemote(fixture);
    await commitOnBranch(fixture, 'gone', 'work');
    await git(fixture.work, ['push', '-q', '-u', 'origin', 'gone']);
    await git(fixture.work, ['update-ref', '-d', 'refs/remotes/origin/gone']);
    const oid = await git(fixture.work, ['rev-parse', 'refs/heads/gone']);
    expect(await fixture.operations.deleteLocalBranch(fixture.repositoryId, 'refs/heads/gone', oid))
      .toEqual({ status: 'unknown', comparisonBase: 'origin/gone' });
    expect(await git(fixture.work, ['rev-parse', 'refs/heads/gone'])).toBe(oid);
  });

  it('refuses a stale expected OID and a missing branch', async () => {
    const fixture = await managementRepository();
    await git(fixture.work, ['branch', 'merged']);
    const staleOid = await git(fixture.work, ['rev-parse', 'refs/heads/merged']);
    await writeFile(path.join(fixture.work, 'file.txt'), 'base\nmore\n');
    await git(fixture.work, ['commit', '-qam', 'Move main']);
    await git(fixture.work, ['branch', '-f', 'merged', 'HEAD']);

    expect(await fixture.operations.deleteLocalBranch(fixture.repositoryId, 'refs/heads/merged', staleOid)).toEqual({ status: 'stale' });
    expect(await git(fixture.work, ['rev-parse', '--verify', 'refs/heads/merged'])).not.toBe(staleOid);
    expect(await fixture.operations.deleteLocalBranch(fixture.repositoryId, 'refs/heads/never', staleOid)).toEqual({ status: 'missing' });
  });
});

describe('GitRepositoryOperations safe worktree removal', () => {
  it.skipIf(process.platform !== 'linux')('distinguishes worktree paths differing only in case on Linux', async () => {
    const fixture = await managementRepository();
    const lower = await addWorktree(fixture, 'review', 'lower');
    const upper = await addWorktree(fixture, 'REVIEW', 'upper');
    expect(await fixture.operations.worktreeDetails(fixture.repositoryId, lower)).toMatchObject({ branch: 'lower' });
    expect(await fixture.operations.worktreeDetails(fixture.repositoryId, upper)).toMatchObject({ branch: 'upper' });
  });

  it('recognizes worktrees through a parent alias, including when the directory becomes prunable', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const alias = path.join(fixture.root, 'parent-alias');
    await symlink(fixture.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const aliasedReview = path.join(alias, path.relative(fixture.root, review));
    expect(await fixture.operations.worktreeDetails(fixture.repositoryId, aliasedReview)).toMatchObject({ branch: 'review', available: true });
    await rm(review, { recursive: true, force: true });
    expect(await fixture.operations.worktreeDetails(fixture.repositoryId, aliasedReview)).toMatchObject({ available: false });
    const oid = await git(fixture.work, ['rev-parse', 'HEAD']);
    expect(await fixture.operations.removeWorktree(fixture.repositoryId, aliasedReview, oid)).toMatchObject({ status: 'prunable' });
  });

  it('removes a clean linked worktree, keeps its branch, and forgets only its recent entry', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    // Open it, then return to the main worktree, exactly as the UI would.
    await fixture.repositories.openPath(review);
    await fixture.repositories.openPath(fixture.work);
    expect(fixture.settings.recentRepositories).toHaveLength(2);
    const oid = await git(review, ['rev-parse', 'HEAD']);

    const result = await fixture.operations.removeWorktree(fixture.repositoryId, review, oid);
    expect(result).toMatchObject({ status: 'removed', branch: 'review' });
    expect(await exists(review)).toBe(false);
    expect(await git(fixture.work, ['for-each-ref', '--format=%(refname)', 'refs/heads'])).toContain('refs/heads/review');
    const recents = (result as { recentRepositories: { path: string }[] }).recentRepositories;
    expect(recents).toHaveLength(1);
    expect(await realPath(recents[0]!.path)).toBe(await realPath(fixture.work));
  });

  it('removes a worktree whose path contains spaces and Unicode', async () => {
    const fixture = await managementRepository();
    const target = await addWorktree(fixture, 'mi revisión ñ', 'revisión');
    const oid = await git(target, ['rev-parse', 'HEAD']);
    expect(await fixture.operations.removeWorktree(fixture.repositoryId, target, oid)).toMatchObject({ status: 'removed', branch: 'revisión' });
    expect(await exists(target)).toBe(false);
  });

  it('refuses the main worktree and the one currently open', async () => {
    const fixture = await managementRepository();
    const oid = await git(fixture.work, ['rev-parse', 'HEAD']);
    expect(await fixture.operations.removeWorktree(fixture.repositoryId, fixture.work, oid)).toEqual({ status: 'main' });
    expect(await exists(fixture.work)).toBe(true);
  });

  it('refuses a linked worktree that OpenTig currently has open', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const opened = await fixture.repositories.openPath(review);
    expect(await fixture.operations.removeWorktree(opened.id, review, await git(review, ['rev-parse', 'HEAD']))).toEqual({ status: 'current' });
    expect(await exists(review)).toBe(true);
  });

  it('refuses a worktree in the middle of a Git operation', async () => {
    const fixture = await managementRepository();
    const conflicted = await addWorktree(fixture, 'conflicted', 'conflicted');
    await writeFile(path.join(conflicted, 'file.txt'), 'their side\n');
    await git(conflicted, ['commit', '-qam', 'Change on the worktree branch']);
    await writeFile(path.join(fixture.work, 'file.txt'), 'our side\n');
    await git(fixture.work, ['commit', '-qam', 'Change on main']);
    await expect(git(conflicted, ['merge', 'main'])).rejects.toThrow();

    const result = await fixture.operations.removeWorktree(fixture.repositoryId, conflicted, await git(conflicted, ['rev-parse', 'HEAD']));
    expect(result).toMatchObject({ status: 'dirty', conflictCount: 1, operation: 'merge' });
    expect(await exists(conflicted)).toBe(true);
  });

  it('refuses staged, unstaged, and untracked worktrees', async () => {
    const fixture = await managementRepository();
    const staged = await addWorktree(fixture, 'staged', 'staged');
    await writeFile(path.join(staged, 'file.txt'), 'staged change\n');
    await git(staged, ['add', 'file.txt']);
    const unstaged = await addWorktree(fixture, 'unstaged', 'unstaged');
    await writeFile(path.join(unstaged, 'file.txt'), 'unstaged change\n');
    const untracked = await addWorktree(fixture, 'untracked', 'untracked');
    await writeFile(path.join(untracked, 'extra.txt'), 'new\n');

    expect(await fixture.operations.removeWorktree(fixture.repositoryId, staged, await git(staged, ['rev-parse', 'HEAD'])))
      .toMatchObject({ status: 'dirty', stagedCount: 1, operation: null });
    expect(await fixture.operations.removeWorktree(fixture.repositoryId, unstaged, await git(unstaged, ['rev-parse', 'HEAD'])))
      .toMatchObject({ status: 'dirty', unstagedCount: 1 });
    expect(await fixture.operations.removeWorktree(fixture.repositoryId, untracked, await git(untracked, ['rev-parse', 'HEAD'])))
      .toMatchObject({ status: 'dirty', untrackedCount: 1 });
    for (const directory of [staged, unstaged, untracked]) expect(await exists(directory)).toBe(true);
  });

  it('force-removes a dirty linked worktree while keeping its branch', async () => {
    const fixture = await managementRepository();
    const target = await addWorktree(fixture, 'dirty', 'dirty');
    await writeFile(path.join(target, 'file.txt'), 'uncommitted change\n');
    await writeFile(path.join(target, 'untracked.txt'), 'lost forever\n');
    const oid = await git(target, ['rev-parse', 'HEAD']);

    expect(await fixture.operations.removeWorktree(fixture.repositoryId, target, oid, true))
      .toMatchObject({ status: 'removed', branch: 'dirty' });
    expect(await exists(target)).toBe(false);
    expect(await git(fixture.work, ['for-each-ref', '--format=%(refname)', 'refs/heads/dirty'])).toContain('refs/heads/dirty');
  });

  it('optionally force-deletes the branch after removing its worktree', async () => {
    const fixture = await managementRepository();
    const target = await addWorktree(fixture, 'temporary', 'temporary');
    await writeFile(path.join(target, 'untracked.txt'), 'discard me\n');
    const oid = await git(target, ['rev-parse', 'HEAD']);

    expect(await fixture.operations.removeWorktree(fixture.repositoryId, target, oid, true, true))
      .toMatchObject({ status: 'removed', branch: 'temporary' });
    expect(await exists(target)).toBe(false);
    expect(await git(fixture.work, ['for-each-ref', '--format=%(refname)', 'refs/heads/temporary'])).toBe('');
  });

  it('refuses a locked worktree', async () => {
    const fixture = await managementRepository();
    const locked = await addWorktree(fixture, 'locked', 'locked');
    await git(fixture.work, ['worktree', 'lock', '--reason', 'in use elsewhere', locked]);
    expect(await fixture.operations.removeWorktree(fixture.repositoryId, locked, await git(locked, ['rev-parse', 'HEAD'])))
      .toEqual({ status: 'locked', reason: 'in use elsewhere' });
    expect(await exists(locked)).toBe(true);
  });

  it('refuses a prunable worktree whose directory disappeared', async () => {
    const fixture = await managementRepository();
    const vanished = await addWorktree(fixture, 'vanished', 'vanished');
    const oid = await git(vanished, ['rev-parse', 'HEAD']);
    await rm(vanished, { recursive: true, force: true });
    const result = await fixture.operations.removeWorktree(fixture.repositoryId, vanished, oid);
    expect(result.status).toBe('prunable');
    expect(await git(fixture.work, ['for-each-ref', '--format=%(refname)', 'refs/heads'])).toContain('refs/heads/vanished');
  });

  it('refuses a stale expected OID and an unknown path without removing anything', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    const staleOid = await git(review, ['rev-parse', 'HEAD']);
    await writeFile(path.join(review, 'file.txt'), 'moved\n');
    await git(review, ['commit', '-qam', 'Move the worktree HEAD']);

    expect(await fixture.operations.removeWorktree(fixture.repositoryId, review, staleOid)).toEqual({ status: 'stale' });
    expect(await exists(review)).toBe(true);
    expect(await fixture.operations.removeWorktree(fixture.repositoryId, path.join(fixture.root, 'nowhere'), staleOid)).toEqual({ status: 'missing' });
  });

  it('keeps the recent entries untouched when removal is refused', async () => {
    const fixture = await managementRepository();
    const locked = await addWorktree(fixture, 'locked', 'locked');
    await fixture.repositories.openPath(locked);
    await fixture.repositories.openPath(fixture.work);
    await git(fixture.work, ['worktree', 'lock', locked]);
    await fixture.operations.removeWorktree(fixture.repositoryId, locked, await git(locked, ['rev-parse', 'HEAD']));
    expect(fixture.settings.recentRepositories).toHaveLength(2);
  });
});

describe('GitRepositoryOperations worktree details', () => {
  it('counts local changes and reports the last commit of the selected worktree only', async () => {
    const fixture = await managementRepository();
    const review = await addWorktree(fixture, 'review', 'review');
    await writeFile(path.join(review, 'file.txt'), 'changed\n');
    await writeFile(path.join(review, 'extra.txt'), 'new\n');
    await git(review, ['add', 'extra.txt']);

    const details = await fixture.operations.worktreeDetails(fixture.repositoryId, review);
    expect(details).toMatchObject({
      branch: 'review', main: false, current: false, available: true, detached: false,
      stagedCount: 1, unstagedCount: 1, untrackedCount: 0, conflictCount: 0, operation: null, readOnly: false,
    });
    expect(details.lastCommit).toMatchObject({ subject: 'Base commit', author: 'OpenTig Test' });
    expect(details.lastCommit?.oid).toBe(await git(review, ['rev-parse', 'HEAD']));
  });

  it('does not run Git inside a worktree whose directory disappeared', async () => {
    const fixture = await managementRepository();
    const vanished = await addWorktree(fixture, 'vanished', 'vanished');
    await rm(vanished, { recursive: true, force: true });
    const details = await fixture.operations.worktreeDetails(fixture.repositoryId, vanished);
    expect(details).toMatchObject({ available: false, stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictCount: 0, lastCommit: null });
    expect(details.prunable).toBeTruthy();
  });

  it('reports the main worktree as current while OpenTig has it open', async () => {
    const fixture = await managementRepository();
    expect(await fixture.operations.worktreeDetails(fixture.repositoryId, fixture.work))
      .toMatchObject({ main: true, current: true, branch: 'main', available: true });
  });
});

describe('GitRepositoryOperations fetch and pull', () => {
  it('fetches remote commits so behind counts become visible', async () => {
    const fixture = await repositoryWithUpstream();
    await commitOnRemote(fixture, 'incoming.txt', 'from origin\n', 'Remote commit');
    expect(await fixture.repositories.status(fixture.repositoryId, false)).toMatchObject({ ahead: 0, behind: 0 });
    expect(await fixture.operations.fetch(fixture.repositoryId)).toEqual({ status: 'success', ahead: 0, behind: 1 });
    expect(await fixture.repositories.status(fixture.repositoryId, false)).toMatchObject({ ahead: 0, behind: 1 });
  });

  it('fast-forwards when the branch has no local commits', async () => {
    const fixture = await repositoryWithUpstream();
    await commitOnRemote(fixture, 'incoming.txt', 'from origin\n', 'Remote commit');
    expect(await fixture.operations.pull(fixture.repositoryId)).toEqual({
      status: 'success', commits: 1, restoredLocalChanges: false, rebased: false, localCommits: 0,
    });
    expect(await fixture.repositories.status(fixture.repositoryId, false)).toMatchObject({ ahead: 0, behind: 0 });
  });

  it('rebases a local commit onto remote changes when there is no conflict', async () => {
    const fixture = await repositoryWithUpstream();
    await writeFile(path.join(fixture.work, 'local.txt'), 'mine\n');
    await git(fixture.work, ['add', 'local.txt']);
    await git(fixture.work, ['commit', '-m', 'Local commit']);
    const localOid = await git(fixture.work, ['rev-parse', 'HEAD']);
    await commitOnRemote(fixture, 'incoming.txt', 'from origin\n', 'Remote commit');

    expect(await fixture.operations.pull(fixture.repositoryId)).toEqual({
      status: 'success', commits: 1, restoredLocalChanges: false, rebased: true, localCommits: 1,
    });
    const status = await fixture.repositories.status(fixture.repositoryId, false);
    expect(status).toMatchObject({ ahead: 1, behind: 0 });
    expect(await git(fixture.work, ['rev-parse', 'HEAD'])).not.toBe(localOid);
    expect(await git(fixture.work, ['log', '-1', '--format=%s'])).toBe('Local commit');
    expect(await git(fixture.work, ['merge-base', '--is-ancestor', '@{upstream}', 'HEAD'])).toBe('');
  });

  it('aborts a conflicting rebase and leaves the local commit unchanged', async () => {
    const fixture = await repositoryWithUpstream();
    await writeFile(path.join(fixture.work, 'committed.txt'), 'local edit\n');
    await git(fixture.work, ['add', 'committed.txt']);
    await git(fixture.work, ['commit', '-m', 'Local edit']);
    const localOid = await git(fixture.work, ['rev-parse', 'HEAD']);
    await commitOnRemote(fixture, 'committed.txt', 'remote edit\n', 'Remote edit');

    const result = await fixture.operations.pull(fixture.repositoryId);
    expect(result.status).toBe('rebase-conflict');
    expect(await git(fixture.work, ['rev-parse', 'HEAD'])).toBe(localOid);
    expect(await fixture.repositories.status(fixture.repositoryId, false)).toMatchObject({ operation: null, ahead: 1, behind: 1 });
  });
});

async function managementRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opentig-manage-'));
  directories.push(root);
  const work = path.join(root, 'work');
  await git(root, ['init', '-b', 'main', work]);
  await configure(work);
  await writeFile(path.join(work, 'file.txt'), 'base\n');
  await git(work, ['add', '.']);
  await git(work, ['commit', '-m', 'Base commit']);
  return { root, ...await createOperations(root, work) };
}

async function addRemote(fixture: { root: string; work: string }): Promise<string> {
  const remote = path.join(fixture.root, 'remote.git');
  await git(fixture.root, ['init', '-q', '--bare', remote]);
  await git(fixture.work, ['remote', 'add', 'origin', remote]);
  return remote;
}

/** Creates a linked worktree in a sibling directory and returns its path. */
async function addWorktree(fixture: { root: string; work: string }, directory: string, branch: string): Promise<string> {
  const target = path.join(fixture.root, 'trees', directory);
  await git(fixture.work, ['worktree', 'add', '-b', branch, target]);
  return target;
}

/** Commits on `branch` without leaving the main worktree checked out elsewhere. */
async function commitOnBranch(fixture: { work: string }, branch: string, content: string): Promise<void> {
  const existing = await git(fixture.work, ['for-each-ref', '--format=%(refname:short)', `refs/heads/${branch}`]);
  await git(fixture.work, existing ? ['switch', branch] : ['switch', '-c', branch]);
  await writeFile(path.join(fixture.work, `${branch}.txt`), `${content}\n`);
  await git(fixture.work, ['add', '.']);
  await git(fixture.work, ['commit', '-m', content]);
  await git(fixture.work, ['switch', 'main']);
}

async function exists(target: string): Promise<boolean> {
  try { await stat(target); return true; } catch { return false; }
}

/** Temporary directories are symlinked on some platforms; compare real paths. */
async function realPath(target: string): Promise<string> {
  try { return (await realpath(target)).toLowerCase(); } catch { return path.resolve(target).toLowerCase(); }
}

async function repositoryWithUpstream() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opentig-history-'));
  directories.push(root);
  const remote = path.join(root, 'remote.git');
  const work = path.join(root, 'work');
  await git(root, ['init', '--bare', remote]);
  await git(root, ['init', '-b', 'main', work]);
  await configure(work);
  await writeFile(path.join(work, 'committed.txt'), 'base\n');
  await writeFile(path.join(work, 'staged.txt'), 'base\n');
  await writeFile(path.join(work, 'unstaged.txt'), 'base\n');
  await git(work, ['add', '.']);
  await git(work, ['commit', '-m', 'Base commit']);
  await git(work, ['remote', 'add', 'origin', remote]);
  await git(work, ['push', '-u', 'origin', 'main']);
  await git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  return { root, remote, ...await createOperations(root, work) };
}

async function commitOnRemote(
  fixture: { root: string; remote: string },
  filename: string,
  content: string,
  message: string,
): Promise<void> {
  const other = path.join(fixture.root, `remote-work-${filename.replace(/[^\w.-]+/g, '-')}`);
  await git(fixture.root, ['clone', fixture.remote, other]);
  await configure(other);
  await git(other, ['checkout', '-B', 'main', 'origin/main']);
  await writeFile(path.join(other, filename), content);
  await git(other, ['add', '.']);
  await git(other, ['commit', '-m', message]);
  await git(other, ['push', 'origin', 'main']);
}

async function standaloneRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opentig-history-'));
  directories.push(root);
  const work = path.join(root, 'work');
  await git(root, ['init', '-b', 'main', work]);
  await configure(work);
  await writeFile(path.join(work, 'file.txt'), 'content\n');
  await git(work, ['add', '.']);
  await git(work, ['commit', '-m', 'Initial commit']);
  return createOperations(root, work);
}

async function createOperations(root: string, work: string) {
  const settings = new SettingsStore(path.join(root, 'settings.json'));
  await settings.load();
  const process = new GitProcess();
  const repositories = new RepositoryService(process, settings);
  const files = new FileService(process, repositories);
  const operations = new GitRepositoryOperations(process, repositories, files);
  const repository = await repositories.openPath(work);
  return { work, operations, repositoryId: repository.id, settings, repositories };
}

async function configure(work: string): Promise<void> {
  await git(work, ['config', 'user.name', 'OpenTig Test']);
  await git(work, ['config', 'user.email', 'opentig@example.invalid']);
}

async function git(cwd: string, args: string[]): Promise<string> {
  return (await gitRaw(cwd, args)).trim();
}

async function gitRaw(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  return String(result.stdout);
}
