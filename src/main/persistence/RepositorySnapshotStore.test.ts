import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPOSITORY_SNAPSHOT_LIMITS, RepositorySnapshotStore } from './RepositorySnapshotStore';

const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))); });

async function store(known: Set<string> = new Set(['a1b2c3d4e5f60718'])) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'opentig-snapshots-'));
  folders.push(folder);
  const directory = path.join(folder, 'repository-snapshots');
  return { directory, known, store: new RepositorySnapshotStore(directory, (id) => known.has(id)) };
}

const id = 'a1b2c3d4e5f60718';
const status = { branch: 'main', changes: [{ path: 'notes.txt' }] };

describe('saved repository snapshots', () => {
  it('saves what was read, privately, and gives it back only for the same folder', async () => {
    const { directory, store: first } = await store();
    first.record(id, '/work/demo', 'status', status);
    first.record(id, '/work/demo', 'files', [{ path: 'notes.txt' }]);
    await first.close();
    if (process.platform !== 'win32') expect((await stat(path.join(directory, `${id}.json`))).mode & 0o777).toBe(0o600);

    const restarted = new RepositorySnapshotStore(directory, () => true);
    expect(await restarted.get(id, '/work/demo')).toMatchObject({ status, files: [{ path: 'notes.txt' }], branches: null, worktrees: null });
    // A repository relocated since is not painted with what another folder held.
    expect(await restarted.get(id, '/work/moved')).toBeNull();
    expect(await readdir(directory)).toEqual([]);
  });

  it('keeps a saved part the next run has not read yet', async () => {
    const { directory, store: first } = await store();
    first.record(id, '/work/demo', 'status', status);
    first.record(id, '/work/demo', 'worktrees', [{ path: '/work/demo' }]);
    await first.close();
    const second = new RepositorySnapshotStore(directory, () => true);
    second.record(id, '/work/demo', 'status', { ...status, branch: 'feature' });
    await second.close();
    expect(await new RepositorySnapshotStore(directory, () => true).get(id, '/work/demo')).toMatchObject({ status: { branch: 'feature' }, worktrees: [{ path: '/work/demo' }] });
  });

  it('leaves out a file tree too large to keep, and keeps the rest', async () => {
    const { directory, store: first } = await store();
    first.record(id, '/work/demo', 'status', status);
    first.record(id, '/work/demo', 'files', ['x'.repeat(REPOSITORY_SNAPSHOT_LIMITS.fileBytes)]);
    await first.close();
    expect(await new RepositorySnapshotStore(directory, () => true).get(id, '/work/demo')).toMatchObject({ status, files: null });
  });

  it('deletes the snapshots of repositories that are no longer known', async () => {
    const other = '0f0e0d0c0b0a0908';
    const { directory, known, store: snapshots } = await store(new Set([id, other]));
    snapshots.record(id, '/work/demo', 'status', status);
    snapshots.record(other, '/work/other', 'status', status);
    await snapshots.close();
    known.delete(other);
    const next = new RepositorySnapshotStore(directory, (repositoryId) => known.has(repositoryId));
    next.forgetUnknown();
    expect(await next.get(other, '/work/other')).toBeNull();
    expect(await readdir(directory)).toEqual([`${id}.json`]);
  });

  it('keeps only the most recently saved repositories', async () => {
    const ids = Array.from({ length: REPOSITORY_SNAPSHOT_LIMITS.repositories + 2 }, (_, index) => index.toString(16).padStart(16, '0'));
    const { directory, store: snapshots } = await store(new Set(ids));
    for (const repositoryId of ids) {
      snapshots.record(repositoryId, `/work/${repositoryId}`, 'status', status);
      // One write at a time, so their modification times follow the order.
      await snapshots.flush();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect((await readdir(directory)).length).toBe(REPOSITORY_SNAPSHOT_LIMITS.repositories);
    expect(await new RepositorySnapshotStore(directory, () => true).get(ids[0]!, `/work/${ids[0]}`)).toBeNull();
  });

  it.each([
    ['corrupt', '{"format":1,'],
    ['of an older format', JSON.stringify({ format: 0 })],
    ['changed outside OpenTig', JSON.stringify({ format: 1, repositoryId: id, path: '/work/demo', savedAt: '2026-11-15T10:00:00.000Z', checksum: '0'.repeat(64), parts: '{}' })],
  ])('deletes a snapshot file that is %s instead of painting it', async (_case, contents) => {
    const { directory } = await store();
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${id}.json`), contents);
    expect(await new RepositorySnapshotStore(directory, () => true).get(id, '/work/demo')).toBeNull();
    expect(await readdir(directory)).toEqual([]);
  });
});
