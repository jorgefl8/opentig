import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { FileOperationHistory } from '../files/FileOperationHistory';
import { FileService } from '../files/FileService';
import { SettingsStore } from '../persistence/SettingsStore';
import { GitProcess } from './GitProcess';
import { RepositoryService } from './RepositoryService';
import { SearchService } from './SearchService';

const execFileAsync = promisify(execFile);
const directories: string[] = [];
const options = { query: 'foo', matchCase: false, wholeWord: false, regex: false, includeIgnored: false };

afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 3 }))));

describe('SearchService replacement', () => {
  it('reports exact occurrences and replaces one selected match', async () => {
    const fixture = await createFixture();
    const result = await fixture.search.search(fixture.repositoryId, options);
    const file = result.files.find((item) => item.path === 'tracked.txt')!;
    expect(file.matches.map(({ line, column }) => ({ line, column }))).toEqual([
      { line: 1, column: 1 }, { line: 1, column: 5 }, { line: 2, column: 1 },
    ]);

    const outcome = await fixture.history.serialize(fixture.repositoryId, () => fixture.search.replace(fixture.repositoryId, {
      options,
      replacement: 'bar',
      scope: { kind: 'match', path: file.path, revision: file.revision!, line: 1, column: 5 },
    }));
    expect(outcome).toMatchObject({ status: 'replaced', replacements: 1, files: ['tracked.txt'] });
    expect(await readFile(path.join(fixture.work, 'tracked.txt'), 'utf8')).toBe('foo bar\nFOO\n');
  });

  it('replaces the selected non-ignored files as one undoable operation', async () => {
    const fixture = await createFixture();
    const result = await fixture.search.search(fixture.repositoryId, options);
    const visible = result.files.filter((file) => !file.ignored).map((file) => ({ path: file.path, revision: file.revision! }));
    const outcome = await fixture.history.serialize(fixture.repositoryId, () => fixture.search.replace(fixture.repositoryId, {
      options,
      replacement: 'bar',
      scope: { kind: 'all', files: visible },
    }));
    expect(outcome).toMatchObject({ status: 'replaced', replacements: 4 });
    expect(await readFile(path.join(fixture.work, 'tracked.txt'), 'utf8')).toBe('bar bar\nbar\n');
    expect(await readFile(path.join(fixture.work, 'second.txt'), 'utf8')).toBe('bar\n');
    expect(await readFile(path.join(fixture.work, 'ignored.txt'), 'utf8')).toBe('foo\n');

    expect((await fixture.history.undo(fixture.repositoryId)).status).toBe('applied');
    expect(await readFile(path.join(fixture.work, 'tracked.txt'), 'utf8')).toBe('foo foo\nFOO\n');
    expect(await readFile(path.join(fixture.work, 'second.txt'), 'utf8')).toBe('foo\n');
  });

  it('rejects stale results without changing the file', async () => {
    const fixture = await createFixture();
    const result = await fixture.search.search(fixture.repositoryId, options);
    const file = result.files.find((item) => item.path === 'tracked.txt')!;
    await writeFile(path.join(fixture.work, file.path), 'external foo\n');

    const outcome = await fixture.search.replace(fixture.repositoryId, {
      options,
      replacement: 'bar',
      scope: { kind: 'file', path: file.path, revision: file.revision! },
    });
    expect(outcome).toEqual({ status: 'stale', paths: ['tracked.txt'] });
    expect(await readFile(path.join(fixture.work, file.path), 'utf8')).toBe('external foo\n');
  });
});

describe('SearchService ignored files', () => {
  it('skips ignored files unless they are asked for', async () => {
    const fixture = await createFixture();

    const excluded = await fixture.search.search(fixture.repositoryId, options);
    expect(excluded.files.map((file) => file.path)).not.toContain('ignored.txt');
    expect(excluded.ignoredMatches).toBe(0);

    const included = await fixture.search.search(fixture.repositoryId, { ...options, includeIgnored: true });
    const ignored = included.files.find((file) => file.path === 'ignored.txt')!;
    expect(ignored.ignored).toBe(true);
    expect(included.ignoredMatches).toBe(1);
  });
});

describe('SearchService result fidelity', () => {
  it('reports truncation instead of silently dropping a file it cannot decode', async () => {
    const fixture = await createFixture();
    // Text to `git grep` (no NUL byte) but not valid UTF-8, so the exact match
    // positions cannot be trusted and the file must not be listed silently.
    await writeFile(path.join(fixture.work, 'latin.txt'), Buffer.from([0x66, 0x6f, 0x6f, 0x20, 0xff, 0x0a]));

    const result = await fixture.search.search(fixture.repositoryId, options);
    expect(result.files.some((file) => file.path === 'latin.txt')).toBe(false);
    expect(result.truncated).toBe(true);
  });

  it('flags a file whose occurrences exceed the per-file listing limit', async () => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.work, 'many.txt'), `${Array.from({ length: 60 }, () => 'foo').join('\n')}\n`);

    const result = await fixture.search.search(fixture.repositoryId, options);
    const many = result.files.find((file) => file.path === 'many.txt')!;
    expect(many.matches).toHaveLength(50);
    expect(many.truncatedMatches).toBe(true);
    expect(result.truncated).toBe(true);

    const tracked = result.files.find((file) => file.path === 'tracked.txt')!;
    expect(tracked.truncatedMatches).toBe(false);
  });

  it('keeps git grep ordering when reading more files than one batch', async () => {
    const fixture = await createFixture();
    const names = Array.from({ length: 20 }, (_, index) => `batch-${index.toString().padStart(2, '0')}.txt`);
    await Promise.all(names.map((name) => writeFile(path.join(fixture.work, name), 'foo\n')));

    const result = await fixture.search.search(fixture.repositoryId, options);
    const listed = result.files.map((file) => file.path).filter((path) => path.startsWith('batch-'));
    expect(listed).toEqual(names);
    expect(result.files.every((file) => Boolean(file.revision))).toBe(true);
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opentig-search-'));
  directories.push(root);
  const work = path.join(root, 'work');
  await git(root, ['init', '-b', 'main', work]);
  await git(work, ['config', 'user.name', 'OpenTig Test']);
  await git(work, ['config', 'user.email', 'opentig@example.invalid']);
  await writeFile(path.join(work, '.gitignore'), 'ignored.txt\n');
  await writeFile(path.join(work, 'tracked.txt'), 'foo foo\nFOO\n');
  await writeFile(path.join(work, 'second.txt'), 'foo\n');
  await writeFile(path.join(work, 'ignored.txt'), 'foo\n');
  await git(work, ['add', '.']);
  await git(work, ['commit', '-m', 'Initial']);
  const settings = new SettingsStore(path.join(root, 'settings.json'));
  await settings.load();
  const process = new GitProcess();
  const repositories = new RepositoryService(process, settings);
  const files = new FileService(process, repositories);
  const repository = await repositories.openPath(work);
  const history = new FileOperationHistory(files, { available: true, trashItem: async () => {} });
  const search = new SearchService(process, repositories, files, history);
  return { work, search, history, repositoryId: repository.id };
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd, windowsHide: true });
}
