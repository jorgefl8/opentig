import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, standaloneRepository } from './test-support/repository-fixtures';

async function commitFile(work: string, file: string, content: string, message: string) {
  await mkdir(path.dirname(path.join(work, file)), { recursive: true });
  await writeFile(path.join(work, file), content);
  await git(work, ['add', '-A']);
  await git(work, ['commit', '-m', message]);
}

describe("a file's history", () => {
  it('follows the file across a rename, newest first, under the name it had in each commit', async () => {
    const fixture = await standaloneRepository();
    await commitFile(fixture.work, 'src/tasks.js', 'one\n', 'Add tasks');
    await commitFile(fixture.work, 'src/tasks.js', 'one\ntwo\n', 'Extend tasks');
    await commitFile(fixture.work, 'other.txt', 'unrelated\n', 'Touch another file');
    await git(fixture.work, ['mv', 'src/tasks.js', 'src/filter-tasks.js']);
    await git(fixture.work, ['commit', '-m', 'Rename tasks']);
    await commitFile(fixture.work, 'src/filter-tasks.js', 'one\ntwo\nthree\n', 'Filter tasks');

    const page = await fixture.operations.fileHistory(fixture.repositoryId, 'src/filter-tasks.js');
    expect(page.entries.map((entry) => [entry.commit.subject, entry.path, entry.oldPath, entry.kind, entry.additions, entry.deletions])).toEqual([
      ['Filter tasks', 'src/filter-tasks.js', null, 'modified', 1, 0],
      ['Rename tasks', 'src/filter-tasks.js', 'src/tasks.js', 'renamed', 0, 0],
      ['Extend tasks', 'src/tasks.js', null, 'modified', 1, 0],
      ['Add tasks', 'src/tasks.js', null, 'added', 1, 0],
    ]);
    expect(page.entries[0]!.commit.isHead).toBe(true);
    expect(page.nextCursor).toBeNull();

    // Each listed commit opens on this file's diff, under the name it had there.
    const older = page.entries[2]!;
    const diff = await fixture.operations.commitFileDiff(fixture.repositoryId, older.commit.oid, older.path);
    expect(diff.patch).toContain('+two');
    expect(diff.patch).not.toContain('unrelated');
  });

  it('lists a file that no longer exists, ending with the commit that deleted it', async () => {
    const fixture = await standaloneRepository();
    await commitFile(fixture.work, 'notes.md', 'draft\n', 'Add notes');
    await git(fixture.work, ['rm', '-q', 'notes.md']);
    await git(fixture.work, ['commit', '-m', 'Drop notes']);

    const page = await fixture.operations.fileHistory(fixture.repositoryId, 'notes.md');
    expect(page.entries.map((entry) => [entry.commit.subject, entry.kind])).toEqual([['Drop notes', 'deleted'], ['Add notes', 'added']]);
  });

  it('has nothing for a file Git never recorded, such as one in an ignored folder', async () => {
    const fixture = await standaloneRepository();
    await commitFile(fixture.work, '.gitignore', 'build/\n', 'Ignore build');
    await mkdir(path.join(fixture.work, 'build'));
    await writeFile(path.join(fixture.work, 'build/out.js'), 'generated\n');
    expect(await fixture.operations.fileHistory(fixture.repositoryId, 'build/out.js')).toEqual({ path: 'build/out.js', entries: [], nextCursor: null, limited: false });
  });

  it('pages a long history from where the first page started, across a rename, even after HEAD moves', async () => {
    const fixture = await standaloneRepository();
    for (let index = 0; index < 60; index++) await commitFile(fixture.work, 'old.txt', `${index}\n`, `Old ${index}`);
    await git(fixture.work, ['mv', 'old.txt', 'new.txt']);
    await git(fixture.work, ['commit', '-m', 'Rename']);
    for (let index = 0; index < 60; index++) await commitFile(fixture.work, 'new.txt', `${index}\n`, `New ${index}`);

    const first = await fixture.operations.fileHistory(fixture.repositoryId, 'new.txt');
    expect(first.entries).toHaveLength(100);
    expect(first.entries[0]!.commit.subject).toBe('New 59');
    await commitFile(fixture.work, 'new.txt', 'later\n', 'After the first page');

    const second = await fixture.operations.fileHistory(fixture.repositoryId, 'new.txt', first.nextCursor!);
    expect(second.entries.map((entry) => entry.commit.subject)).toEqual(Array.from({ length: 21 }, (_, index) => `Old ${20 - index}`));
    expect(second.entries.every((entry) => entry.path === 'old.txt')).toBe(true);
    expect(second.nextCursor).toBeNull();
    const subjects = [...first.entries, ...second.entries].map((entry) => entry.commit.subject);
    expect(new Set(subjects).size).toBe(121);
  }, 30_000);

  it('refuses a folder, a path outside the worktree and a cursor it did not give', async () => {
    const fixture = await standaloneRepository();
    await expect(fixture.operations.fileHistory(fixture.repositoryId, '.')).rejects.toMatchObject({ detail: { code: 'INVALID_ARGUMENT' } });
    await expect(fixture.operations.fileHistory(fixture.repositoryId, '../outside.txt')).rejects.toMatchObject({ detail: { code: 'INVALID_ARGUMENT' } });
    await expect(fixture.operations.fileHistory(fixture.repositoryId, 'file.txt', '--output=/tmp/x:0')).rejects.toMatchObject({ detail: { code: 'INVALID_ARGUMENT' } });
  });

  it('stops when the request is cancelled', async () => {
    const fixture = await standaloneRepository();
    const controller = new AbortController();
    controller.abort();
    await expect(fixture.operations.fileHistory(fixture.repositoryId, 'file.txt', undefined, controller.signal)).rejects.toThrow();
  });
});
