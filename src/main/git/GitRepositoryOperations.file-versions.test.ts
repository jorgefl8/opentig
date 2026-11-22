import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FILE_VERSION_MAX_BYTES } from '../../shared/contracts';
import { git, standaloneRepository } from './test-support/repository-fixtures';

const ALL = 2 * FILE_VERSION_MAX_BYTES;

async function commit(fixture: { work: string }, files: Record<string, string | null>, message: string): Promise<string> {
  for (const [name, content] of Object.entries(files)) {
    if (content === null) await git(fixture.work, ['rm', '-q', '--', name]);
    else {
      await mkdir(path.dirname(path.join(fixture.work, name)), { recursive: true });
      await writeFile(path.join(fixture.work, name), content);
      await git(fixture.work, ['add', '--', name]);
    }
  }
  await git(fixture.work, ['commit', '-q', '-m', message]);
  return git(fixture.work, ['rev-parse', 'HEAD']);
}

/** A repository whose commits the operations know, as History lists them. */
async function repository() {
  const fixture = await standaloneRepository();
  const known = async () => { await fixture.operations.listCommits(fixture.repositoryId); };
  return { ...fixture, known };
}

describe('GitRepositoryOperations file versions', () => {
  it('reads a commit’s file at its first parent and at the commit, naming each blob', async () => {
    const fixture = await repository();
    const before = await commit(fixture, { 'src/a.css': ':root {\n  --a: red;\n}\n' }, 'Add');
    const oid = await commit(fixture, { 'src/a.css': ':root {\n  --a: blue;\n}\n' }, 'Change');
    await fixture.known();
    const result = await fixture.operations.fileVersions({ kind: 'commit', repositoryId: fixture.repositoryId, oid, path: 'src/a.css' }, ALL);
    expect(result).toEqual({
      status: 'ready',
      old: { content: ':root {\n  --a: red;\n}\n', oid: await git(fixture.work, ['rev-parse', `${before}:src/a.css`]) },
      new: { content: ':root {\n  --a: blue;\n}\n', oid: await git(fixture.work, ['rev-parse', `${oid}:src/a.css`]) },
    });
  });

  it('reads a rename’s old path on the old side, and leaves out the side an added or deleted file is not on', async () => {
    const fixture = await repository();
    await commit(fixture, { 'old.txt': 'one\ntwo\nthree\nfour\nfive\n', 'gone.txt': 'bye\n' }, 'Base');
    await git(fixture.work, ['mv', 'old.txt', 'new.txt']);
    const oid = await commit(fixture, { 'new.txt': 'one\ntwo\nthree\nfour\nsix\n', 'gone.txt': null, 'added.txt': 'hi\n' }, 'Rename');
    await fixture.known();
    const request = { kind: 'commit' as const, repositoryId: fixture.repositoryId, oid };
    expect(await fixture.operations.fileVersions({ ...request, path: 'new.txt', oldPath: 'old.txt' }, ALL)).toMatchObject({
      status: 'ready', old: { content: 'one\ntwo\nthree\nfour\nfive\n' }, new: { content: 'one\ntwo\nthree\nfour\nsix\n' },
    });
    expect(await fixture.operations.fileVersions({ ...request, path: 'added.txt' }, ALL)).toMatchObject({ status: 'ready', old: null, new: { content: 'hi\n' } });
    expect(await fixture.operations.fileVersions({ ...request, path: 'gone.txt' }, ALL)).toMatchObject({ status: 'ready', old: { content: 'bye\n' }, new: null });
  });

  it('compares a root commit with nothing and a merge with its first parent', async () => {
    const fixture = await repository();
    const root = await git(fixture.work, ['rev-list', '--max-parents=0', 'HEAD']);
    await git(fixture.work, ['switch', '-q', '-c', 'feature']);
    await commit(fixture, { 'file.txt': 'feature\n' }, 'Feature');
    await git(fixture.work, ['switch', '-q', 'main']);
    const main = await commit(fixture, { 'other.txt': 'main\n' }, 'Main');
    await git(fixture.work, ['merge', '-q', '--no-ff', 'feature', '-m', 'Merge']);
    const merge = await git(fixture.work, ['rev-parse', 'HEAD']);
    await fixture.known();
    expect(await fixture.operations.fileVersions({ kind: 'commit', repositoryId: fixture.repositoryId, oid: root, path: 'file.txt' }, ALL))
      .toEqual({ status: 'ready', old: null, new: { content: 'content\n', oid: await git(fixture.work, ['rev-parse', `${root}:file.txt`]) } });
    expect(await fixture.operations.fileVersions({ kind: 'commit', repositoryId: fixture.repositoryId, oid: merge, path: 'file.txt' }, ALL))
      .toMatchObject({ status: 'ready', old: { content: 'content\n', oid: await git(fixture.work, ['rev-parse', `${main}:file.txt`]) }, new: { content: 'feature\n' } });
  });

  it('reads staged changes from HEAD and the index, and unstaged ones from the index and the working tree', async () => {
    const fixture = await repository();
    await writeFile(path.join(fixture.work, 'file.txt'), 'staged\n');
    await git(fixture.work, ['add', 'file.txt']);
    await writeFile(path.join(fixture.work, 'file.txt'), 'working\n');
    const request = { repositoryId: fixture.repositoryId, path: 'file.txt' };
    expect(await fixture.operations.fileVersions({ ...request, kind: 'staged' }, ALL)).toMatchObject({ status: 'ready', old: { content: 'content\n' }, new: { content: 'staged\n' } });
    expect(await fixture.operations.fileVersions({ ...request, kind: 'unstaged' }, ALL)).toEqual({
      status: 'ready', old: { content: 'staged\n', oid: await git(fixture.work, ['rev-parse', ':file.txt']) }, new: { content: 'working\n', oid: null },
    });
  });

  it('reads a staged file of a repository with no commit yet against nothing', async () => {
    const fixture = await repository();
    await git(fixture.work, ['update-ref', '-d', 'HEAD']);
    expect(await fixture.operations.fileVersions({ kind: 'staged', repositoryId: fixture.repositoryId, path: 'file.txt' }, ALL))
      .toMatchObject({ status: 'ready', old: null, new: { content: 'content\n' } });
  });

  it('takes a path literally, never as a pattern or a revision', async () => {
    const fixture = await repository();
    // As a pattern, `[x].txt` would name `x.txt`. Both names are valid on every system.
    const oid = await commit(fixture, { '[x].txt': 'bracket\n', 'x.txt': 'x\n', 'dir/a b[1].txt': 'odd\n', 'dir/x.txt': 'x\n' }, 'Odd names');
    await fixture.known();
    const read = (name: string) => fixture.operations.fileVersions({ kind: 'commit', repositoryId: fixture.repositoryId, oid, path: name }, ALL);
    expect(await read('[x].txt')).toMatchObject({ status: 'ready', new: { content: 'bracket\n' } });
    expect(await read('dir/a b[1].txt')).toMatchObject({ status: 'ready', new: { content: 'odd\n' } });
    // A directory is not a file, and a path the commit lacks reads as no version.
    expect(await read('dir')).toEqual({ status: 'unavailable' });
    expect(await read('dir/missing.txt')).toEqual({ status: 'ready', old: null, new: null });
  });

  it('refuses commits it was not shown and paths outside the repository', async () => {
    const fixture = await repository();
    const head = await git(fixture.work, ['rev-parse', 'HEAD']);
    await expect(fixture.operations.fileVersions({ kind: 'commit', repositoryId: fixture.repositoryId, oid: head, path: 'file.txt' }, ALL)).rejects.toThrow('Commit not recognized.');
    await fixture.known();
    await expect(fixture.operations.fileVersions({ kind: 'commit', repositoryId: fixture.repositoryId, oid: 'HEAD~1', path: 'file.txt' }, ALL)).rejects.toThrow('Commit not recognized.');
    await expect(fixture.operations.fileVersions({ kind: 'unstaged', repositoryId: fixture.repositoryId, path: '../outside.txt' }, ALL)).rejects.toThrow();
  });

  it('gives up on binary files, links, conflicts and anything past the limits', async () => {
    const fixture = await repository();
    const big = 'x'.repeat(FILE_VERSION_MAX_BYTES) + '\n';
    const oid = await commit(fixture, { 'big.txt': big, 'zero.txt': 'a\0b\n', 'small.txt': 'a\n'.repeat(100) }, 'Sizes');
    await fixture.known();
    const read = (name: string, maxBytes = ALL) => fixture.operations.fileVersions({ kind: 'commit', repositoryId: fixture.repositoryId, oid, path: name }, maxBytes);
    expect(await read('big.txt')).toEqual({ status: 'unavailable' });
    expect(await read('zero.txt')).toEqual({ status: 'unavailable' });
    expect(await read('small.txt', 199)).toEqual({ status: 'unavailable' });
    expect(await read('small.txt', 200)).toMatchObject({ status: 'ready' });

    await writeFile(path.join(fixture.work, 'big.txt'), big + 'more\n');
    expect(await fixture.operations.fileVersions({ kind: 'unstaged', repositoryId: fixture.repositoryId, path: 'big.txt' }, ALL)).toEqual({ status: 'unavailable' });
    await writeFile(path.join(fixture.work, 'small.txt'), 'b\n'.repeat(100));
    expect(await fixture.operations.fileVersions({ kind: 'unstaged', repositoryId: fixture.repositoryId, path: 'small.txt' }, 300)).toEqual({ status: 'unavailable' });
    expect(await fixture.operations.fileVersions({ kind: 'unstaged', repositoryId: fixture.repositoryId, path: 'small.txt' }, 400)).toMatchObject({ status: 'ready' });

    // Windows needs a privilege to make a symbolic link.
    if (process.platform !== 'win32') {
      await writeFile(path.join(fixture.work, 'target.txt'), 'target\n');
      await symlink('target.txt', path.join(fixture.work, 'link.txt'));
      await git(fixture.work, ['add', 'link.txt']);
      expect(await fixture.operations.fileVersions({ kind: 'staged', repositoryId: fixture.repositoryId, path: 'link.txt' }, ALL)).toEqual({ status: 'unavailable' });
      expect(await fixture.operations.fileVersions({ kind: 'unstaged', repositoryId: fixture.repositoryId, path: 'link.txt' }, ALL)).toEqual({ status: 'unavailable' });
    }

    await git(fixture.work, ['switch', '-q', '-c', 'other']);
    await commit(fixture, { 'file.txt': 'other\n' }, 'Other');
    await git(fixture.work, ['switch', '-q', 'main']);
    await commit(fixture, { 'file.txt': 'main\n' }, 'Main');
    await expect(git(fixture.work, ['merge', 'other'])).rejects.toThrow();
    expect(await fixture.operations.fileVersions({ kind: 'unstaged', repositoryId: fixture.repositoryId, path: 'file.txt' }, ALL)).toEqual({ status: 'unavailable' });
  });
});
