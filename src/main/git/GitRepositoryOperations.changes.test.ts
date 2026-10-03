import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { standaloneRepository, git } from './test-support/repository-fixtures';

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
