import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, standaloneRepository } from './test-support/repository-fixtures';

type Fixture = Awaited<ReturnType<typeof standaloneRepository>>;

/** Files committed with Windows line endings, which Git stores with Unix ones and checks out as they were written. */
async function crlfRepository(conversion: 'autocrlf' | 'attributes') {
  const fixture = await standaloneRepository();
  if (conversion === 'autocrlf') await git(fixture.work, ['config', 'core.autocrlf', 'true']);
  else await writeFile(path.join(fixture.work, '.gitattributes'), '*.txt text eol=crlf\n');
  await writeFile(path.join(fixture.work, 'a.txt'), 'one\r\ntwo\r\n');
  await writeFile(path.join(fixture.work, 'b.txt'), 'three\r\nfour\r\n');
  await git(fixture.work, ['add', '--', '.']);
  await git(fixture.work, ['commit', '-q', '-m', 'Add text']);
  return fixture;
}

/** What a tool that writes Unix line endings does: same content once Git converts it, but smaller than the index recorded. */
async function rewriteWithLf(fixture: Fixture, name: string): Promise<void> {
  const content = await readFile(path.join(fixture.work, name), 'utf8');
  await writeFile(path.join(fixture.work, name), content.replace(/\r\n/g, '\n'));
}

const listed = async (fixture: Fixture) => (await fixture.repositories.status(fixture.repositoryId, false)).changes
  .map((change) => `${change.path}:${[change.staged && 'staged', change.unstaged && 'unstaged'].filter(Boolean).join('+')}`).sort();
const index = (fixture: Fixture) => git(fixture.work, ['ls-files', '-s']);
const unstagedDiff = (fixture: Fixture, filePath: string) => fixture.operations.diff({ repositoryId: fixture.repositoryId, path: filePath, kind: 'unstaged' });

describe('GitRepositoryOperations stat-only changes', () => {
  it.each(['autocrlf', 'attributes'] as const)('explains and clears a file whose line endings Git converts (%s), and no other', async (conversion) => {
    const fixture = await crlfRepository(conversion);
    await rewriteWithLf(fixture, 'a.txt');
    await rewriteWithLf(fixture, 'b.txt');
    expect(await listed(fixture)).toEqual(['a.txt:unstaged', 'b.txt:unstaged']);
    const diff = await unstagedDiff(fixture, 'a.txt');
    expect(diff).toMatchObject({ patch: '', emptyReason: 'stat-only' });
    const before = await index(fixture);

    await fixture.operations.refreshIndexEntry(fixture.repositoryId, 'a.txt');

    expect(await listed(fixture)).toEqual(['b.txt:unstaged']);
    expect(await index(fixture)).toBe(before);
    expect(await git(fixture.work, ['diff', '--cached', '--name-only'])).toBe('');
    expect(await readFile(path.join(fixture.work, 'a.txt'), 'utf8')).toBe('one\ntwo\n');
  });

  it('keeps what is staged when the working file is that staged version', async () => {
    const fixture = await crlfRepository('autocrlf');
    await writeFile(path.join(fixture.work, 'a.txt'), 'one\r\ntwo\r\nthree\r\n');
    await git(fixture.work, ['add', '--', 'a.txt']);
    await rewriteWithLf(fixture, 'a.txt');
    expect(await listed(fixture)).toEqual(['a.txt:staged+unstaged']);
    expect(await unstagedDiff(fixture, 'a.txt')).toMatchObject({ patch: '', emptyReason: 'stat-only' });
    const staged = await git(fixture.work, ['diff', '--cached']);

    await fixture.operations.refreshIndexEntry(fixture.repositoryId, 'a.txt');

    expect(await listed(fixture)).toEqual(['a.txt:staged']);
    expect(await git(fixture.work, ['diff', '--cached'])).toBe(staged);
    // Pressed again, from a window that still showed it: nothing is left to clear, and nothing fails.
    await fixture.operations.refreshIndexEntry(fixture.repositoryId, 'a.txt');
    expect(await git(fixture.work, ['diff', '--cached'])).toBe(staged);
  });

  it('shows a real change, line endings Git does not convert included, and refuses to clear it without staging anything', async () => {
    const fixture = await standaloneRepository();
    // Git for Windows converts line endings unless told not to.
    await git(fixture.work, ['config', 'core.autocrlf', 'false']);
    await writeFile(path.join(fixture.work, 'file.txt'), 'content\r\n');
    const lineEndings = await unstagedDiff(fixture, 'file.txt');
    expect(lineEndings.patch).toContain('+content\r');
    expect(lineEndings.emptyReason).toBeUndefined();

    await writeFile(path.join(fixture.work, 'file.txt'), 'changed\n');
    const diff = await unstagedDiff(fixture, 'file.txt');
    expect(diff.patch).toContain('+changed');
    expect(diff.emptyReason).toBeUndefined();
    const before = await index(fixture);

    await expect(fixture.operations.refreshIndexEntry(fixture.repositoryId, 'file.txt')).rejects.toThrow('no longer the same as the staged version');

    expect(await index(fixture)).toBe(before);
    expect(await listed(fixture)).toEqual(['file.txt:unstaged']);
  });

  it.skipIf(process.platform === 'win32')('shows a change of mode alone, and does not clear it', async () => {
    const fixture = await standaloneRepository();
    await git(fixture.work, ['config', 'core.fileMode', 'true']);
    await chmod(path.join(fixture.work, 'file.txt'), 0o755);
    const diff = await unstagedDiff(fixture, 'file.txt');
    expect(diff.patch).toContain('old mode 100644\nnew mode 100755');
    expect(diff.emptyReason).toBeUndefined();

    await expect(fixture.operations.refreshIndexEntry(fixture.repositoryId, 'file.txt')).rejects.toThrow('no longer the same as the staged version');

    expect(await git(fixture.work, ['ls-files', '-s', '--', 'file.txt'])).toMatch(/^100644 /);
    expect(await listed(fixture)).toEqual(['file.txt:unstaged']);
  });
});
