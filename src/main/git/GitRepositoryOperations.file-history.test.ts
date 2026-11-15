import { execFile, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { parseFileHistoryWalk } from './FileHistoryParser';
import { git, standaloneRepository } from './test-support/repository-fixtures';

const run = promisify(execFile);
const hasSshKeygen = (() => { try { execFileSync('ssh-keygen', ['-?'], { stdio: 'ignore' }); return true; } catch (error) { return (error as { status?: number }).status !== undefined; } })();

/** Appends `count` commits that each change `file`, in one `git fast-import` run. */
async function fastCommits(work: string, file: string, count: number) {
  const now = Math.floor(Date.now() / 1000);
  let stream = '';
  for (let index = 0; index < count; index++) {
    const content = `${index}\n`;
    stream += `commit refs/heads/main\ncommitter OpenTig Test <opentig@example.invalid> ${now} +0000\ndata 7\nchange\n${index === 0 ? 'from refs/heads/main^0\n' : ''}M 100644 inline ${file}\ndata ${Buffer.byteLength(content)}\n${content}\n`;
  }
  const child = run('git', ['fast-import', '--quiet'], { cwd: work, maxBuffer: 16 * 1024 * 1024 });
  child.child.stdin!.end(stream);
  await child;
  await git(work, ['reset', '-q', '--hard']);
}

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

  // Windows refuses control characters in a file name, so its working tree cannot hold this one.
  it.skipIf(process.platform === 'win32')('reads a file name that looks like another commit as a name', async () => {
    const fixture = await standaloneRepository();
    const unrelated = await git(fixture.work, ['rev-parse', 'HEAD']);
    const hostile = `\x1e${unrelated}\x1fforged`;
    await commitFile(fixture.work, hostile, 'one\n', 'Add under a strange name');
    await git(fixture.work, ['mv', hostile, 'clean.txt']);
    await git(fixture.work, ['commit', '-m', 'Rename to a clean name']);
    await commitFile(fixture.work, 'clean.txt', 'one\ntwo\n', 'Edit the clean name');

    const page = await fixture.operations.fileHistory(fixture.repositoryId, 'clean.txt');
    expect(page.entries.map((entry) => [entry.commit.subject, entry.path, entry.oldPath])).toEqual([
      ['Edit the clean name', 'clean.txt', null],
      ['Rename to a clean name', 'clean.txt', hostile],
      ['Add under a strange name', hostile, null],
    ]);
    expect(page.entries.map((entry) => entry.commit.oid)).not.toContain(unrelated);
  });

  it('lists only the changes of the file when the path was once a folder, and refuses a folder', async () => {
    const fixture = await standaloneRepository();
    await commitFile(fixture.work, 'docs/a.md', 'a\n', 'Add a');
    await commitFile(fixture.work, 'docs/b.md', 'b\n', 'Add b');
    await commitFile(fixture.work, 'docs/a.md', 'a\nmore\n', 'Edit a');
    await expect(fixture.operations.fileHistory(fixture.repositoryId, 'docs')).rejects.toMatchObject({ detail: { code: 'INVALID_ARGUMENT' } });
    await git(fixture.work, ['rm', '-rq', 'docs']);
    await writeFile(path.join(fixture.work, 'docs'), 'x\ny\nz\n');
    await git(fixture.work, ['add', 'docs']);
    await git(fixture.work, ['commit', '-m', 'Make docs a file']);
    await commitFile(fixture.work, 'docs', 'x\n', 'Trim docs');

    const page = await fixture.operations.fileHistory(fixture.repositoryId, 'docs');
    expect(page.entries.map((entry) => [entry.commit.subject, entry.path, entry.kind, entry.additions, entry.deletions])).toEqual([
      ['Trim docs', 'docs', 'modified', 0, 2],
      ['Make docs a file', 'docs', 'added', 3, 0],
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it('ends at the commit that created the file, without walking the folder the path was before', async () => {
    const fixture = await standaloneRepository();
    // More commits than a history lists: walking them all would report the history as cut short.
    await fastCommits(fixture.work, 'x/a', 10_100);
    await git(fixture.work, ['rm', '-rq', 'x']);
    await writeFile(path.join(fixture.work, 'x'), 'now a file\n');
    await git(fixture.work, ['add', 'x']);
    await git(fixture.work, ['commit', '-qm', 'Make x a file']);
    for (let index = 0; index < 5; index++) await commitFile(fixture.work, 'x', `${index}\n`, `Edit x ${index}`);

    const walks = vi.spyOn(fixture.gitProcess, 'run');
    const page = await fixture.operations.fileHistory(fixture.repositoryId, 'x');
    expect(page.entries.map((entry) => entry.commit.subject)).toEqual(['Edit x 4', 'Edit x 3', 'Edit x 2', 'Edit x 1', 'Edit x 0', 'Make x a file']);
    expect(page).toMatchObject({ nextCursor: null, limited: false });
    expect(walks.mock.calls.filter(([, args]) => args.includes('--follow'))).toHaveLength(1);
  }, 60_000);

  it('keeps what a walk cut at the output limit read, and says the history is cut', async () => {
    const oid = (digit: string) => digit.repeat(40);
    const output = [
      `\x1e${oid('a')}\x1f`, '\n:100644 100644 1111111 2222222 M', 'notes.txt', '1\t0\tnotes.txt',
      `\x1e${oid('b')}\x1f`, '\n:100644 100644 3333333 1111111 M', 'notes.txt', '2\t1\tnotes.txt',
      `\x1e${oid('c')}\x1f`, '\n:100644 100644 4444444 3333333 M', 'not',
    ].join('\0');
    const walk = await parseFileHistoryWalk(output, 'notes.txt', { truncated: true });
    expect(walk.records.map((record) => record.oid)).toEqual([oid('a'), oid('b')]);
    expect(walk).toMatchObject({ cut: true, ended: false });
  });

  it.skipIf(!hasSshKeygen)('reads signed commits when Git is set to show signatures', async () => {
    const fixture = await standaloneRepository();
    const keys = await mkdtemp(path.join(os.tmpdir(), 'opentig-signing-'));
    await run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', path.join(keys, 'key')]);
    for (const [key, value] of [['gpg.format', 'ssh'], ['user.signingkey', path.join(keys, 'key')], ['commit.gpgsign', 'true']]) await git(fixture.work, ['config', key!, value!]);
    await commitFile(fixture.work, 'notes.txt', 'one\n', 'Add notes');
    await commitFile(fixture.work, 'notes.txt', 'one\ntwo\n', 'Extend notes');
    await git(fixture.work, ['config', 'log.showSignature', 'true']);

    expect((await fixture.operations.listCommits(fixture.repositoryId)).commits.map((commit) => commit.subject)).toEqual(['Extend notes', 'Add notes', 'Initial commit']);
    const page = await fixture.operations.fileHistory(fixture.repositoryId, 'notes.txt');
    expect(page.entries.map((entry) => entry.commit.subject)).toEqual(['Extend notes', 'Add notes']);
    expect((await fixture.operations.commitFileDiff(fixture.repositoryId, page.entries[0]!.commit.oid, 'notes.txt')).patch).toContain('+two');
    expect((await fixture.operations.commitFiles(fixture.repositoryId, page.entries[0]!.commit.oid)).map((file) => file.path)).toEqual(['notes.txt']);
  });

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
