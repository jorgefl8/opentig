import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getSingularPatch } from '@pierre/diffs';
import { describe, expect, it } from 'vitest';
import { buildDiffFileEntries } from '../../renderer/features/viewer/patch-utils';
import { standaloneRepository, git } from './test-support/repository-fixtures';

describe('GitRepositoryOperations commit diffs', () => {
  it('renders merge resolution files as unified first-parent diffs without inherited files', async () => {
    const fixture = await standaloneRepository();
    await git(fixture.work, ['switch', '-c', 'feature']);
    await writeFile(path.join(fixture.work, 'file.txt'), 'feature\n');
    await writeFile(path.join(fixture.work, 'feature-only.txt'), 'inherited feature\n');
    await git(fixture.work, ['add', '.']);
    await git(fixture.work, ['commit', '-m', 'Feature change']);
    await git(fixture.work, ['switch', 'main']);
    await writeFile(path.join(fixture.work, 'file.txt'), 'main\n');
    await writeFile(path.join(fixture.work, 'main-only.txt'), 'inherited main\n');
    await git(fixture.work, ['add', '.']);
    await git(fixture.work, ['commit', '-m', 'Main change']);
    await expect(git(fixture.work, ['merge', '--no-ff', 'feature', '-m', 'Merge feature'])).rejects.toThrow();
    await writeFile(path.join(fixture.work, 'file.txt'), 'resolved\n');
    await git(fixture.work, ['add', '.']);
    await git(fixture.work, ['commit', '--no-edit']);
    const { commits } = await fixture.operations.listCommits(fixture.repositoryId);
    const merge = commits[0]!;
    expect(merge.parentCount).toBe(2);
    const files = await fixture.operations.commitFiles(fixture.repositoryId, merge.oid);
    expect(files).toMatchObject([{ path: 'file.txt', additions: 1, deletions: 1 }]);
    expect(files).toHaveLength(1);
    const full = await fixture.operations.commitDiff(fixture.repositoryId, merge.oid);
    const single = await fixture.operations.commitFileDiff(fixture.repositoryId, merge.oid, files[0]!.path);
    expect(full.patch).toBe(single.patch);
    expect(full.patch).toContain('-main\n+resolved\n');
    expect(full.patch).not.toContain('inherited');
    expect(full.patch).not.toContain('diff --cc');
    expect(getSingularPatch(single.patch).name).toBe('file.txt');
    expect(buildDiffFileEntries(full.patch)).toMatchObject([{ path: 'file.txt', additions: 1, deletions: 1 }]);
  });

  it('preserves files and first-parent rename metadata for a combined RM merge status', async () => {
    const fixture = await standaloneRepository();
    await writeFile(path.join(fixture.work, 'file.txt'), 'one\ntwo\nthree\nfour\nfive\n');
    await git(fixture.work, ['commit', '-am', 'Longer base']);
    await git(fixture.work, ['switch', '-c', 'feature']);
    await git(fixture.work, ['mv', 'file.txt', 'renamed.txt']);
    await git(fixture.work, ['commit', '-m', 'Rename on feature']);
    await git(fixture.work, ['switch', 'main']);
    await writeFile(path.join(fixture.work, 'file.txt'), 'one\ntwo\nthree\nfour\nmain\n');
    await git(fixture.work, ['commit', '-am', 'Edit on main']);
    await git(fixture.work, ['merge', '--no-ff', 'feature', '-m', 'Merge rename']);
    const { commits } = await fixture.operations.listCommits(fixture.repositoryId);
    expect(await git(fixture.work, ['show', '--format=', '-M', '--diff-merges=dense-combined', '--name-status', 'HEAD'])).toBe('RM\trenamed.txt');
    const files = await fixture.operations.commitFiles(fixture.repositoryId, commits[0]!.oid);
    expect(files).toMatchObject([{ path: 'renamed.txt', oldPath: 'file.txt', kind: 'renamed', additions: 0, deletions: 0 }]);
    expect(files).toHaveLength(1);
    const full = await fixture.operations.commitDiff(fixture.repositoryId, commits[0]!.oid);
    const single = await fixture.operations.commitFileDiff(fixture.repositoryId, commits[0]!.oid, files[0]!.path, files[0]!.oldPath!);
    expect(full.patch).toBe(single.patch);
    expect(getSingularPatch(single.patch)).toMatchObject({ name: 'renamed.txt', prevName: 'file.txt', type: 'rename-pure' });
  });

  it('keeps clean merges and empty commits empty while retaining their messages in history', async () => {
    const fixture = await standaloneRepository();
    await git(fixture.work, ['switch', '-c', 'feature']);
    await writeFile(path.join(fixture.work, 'feature.txt'), 'feature\n');
    await git(fixture.work, ['add', '.']);
    await git(fixture.work, ['commit', '-m', 'Feature change']);
    await git(fixture.work, ['switch', 'main']);
    await git(fixture.work, ['merge', '--no-ff', 'feature', '-m', 'Clean merge', '-m', 'Full merge description']);
    await git(fixture.work, ['commit', '--allow-empty', '-m', 'Empty commit', '-m', 'Full empty description']);
    const { commits } = await fixture.operations.listCommits(fixture.repositoryId);
    for (const commit of commits.slice(0, 2)) {
      expect(await fixture.operations.commitFiles(fixture.repositoryId, commit.oid)).toEqual([]);
      expect((await fixture.operations.commitDiff(fixture.repositoryId, commit.oid)).patch).toBe('');
    }
    expect(commits[0]).toMatchObject({ subject: 'Empty commit', body: 'Full empty description' });
    expect(commits[1]).toMatchObject({ subject: 'Clean merge', body: 'Full merge description', parentCount: 2 });
  });

  it('supports the initial commit with no parent', async () => {
    const fixture = await standaloneRepository();
    const { commits } = await fixture.operations.listCommits(fixture.repositoryId);
    const diff = await fixture.operations.commitDiff(fixture.repositoryId, commits[0]!.oid);
    expect(getSingularPatch(diff.patch)).toMatchObject({ name: 'file.txt', type: 'new' });
    expect(diff.patch).toContain('+content');
  });

  it('keeps a renamed file separate from other files matched by its old path', async () => {
    const fixture = await standaloneRepository();
    await git(fixture.work, ['mv', 'file.txt', 'renamed.txt']);
    // Reusing the source path can make Git represent the move as modification
    // plus addition. A two-path request must still return only the destination.
    await writeFile(path.join(fixture.work, 'file.txt'), 'unrelated replacement\n');
    await git(fixture.work, ['add', '.']);
    await git(fixture.work, ['commit', '-m', 'Move and replace source']);
    const { commits } = await fixture.operations.listCommits(fixture.repositoryId);
    const diff = await fixture.operations.commitFileDiff(fixture.repositoryId, commits[0]!.oid, 'renamed.txt', 'file.txt');
    expect(getSingularPatch(diff.patch).name).toBe('renamed.txt');
    expect(diff.patch).toContain('+content');
    expect(diff.patch).not.toContain('unrelated replacement');
    expect(buildDiffFileEntries((await fixture.operations.commitDiff(fixture.repositoryId, commits[0]!.oid)).patch)).toHaveLength(2);
  });

  it('preserves rename metadata and literal paths with spaces and non-ASCII characters', async () => {
    const fixture = await standaloneRepository();
    await git(fixture.work, ['mv', 'file.txt', 'moved é file.txt']);
    await git(fixture.work, ['commit', '-m', 'Rename file']);
    const { commits } = await fixture.operations.listCommits(fixture.repositoryId);
    const files = await fixture.operations.commitFiles(fixture.repositoryId, commits[0]!.oid);
    expect(files).toMatchObject([{ path: 'moved é file.txt', oldPath: 'file.txt', kind: 'renamed' }]);
    const diff = await fixture.operations.commitFileDiff(fixture.repositoryId, commits[0]!.oid, files[0]!.path, files[0]!.oldPath!);
    expect(getSingularPatch(diff.patch)).toMatchObject({ prevName: 'file.txt', type: 'rename-pure' });
    expect(buildDiffFileEntries(diff.patch)).toHaveLength(1);
  });
});
