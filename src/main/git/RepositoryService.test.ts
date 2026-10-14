import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsStore } from '../persistence/SettingsStore';
import { GitProcess } from './GitProcess';
import { RepositoryService } from './RepositoryService';

const execFileAsync = promisify(execFile);
const directories: string[] = [];

afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 3 }))));

describe('RepositoryService change stats', () => {
  it('shares complete status and stats for four simultaneous readers, with independent results', async () => {
    const fixture = await repository();
    await writeFile(path.join(fixture.work, 'untracked.txt'), 'one\ntwo\n');
    const run = vi.spyOn(fixture.git, 'run');
    const statuses = await Promise.all(Array.from({ length: 4 }, () => fixture.repositories.status(fixture.repositoryId)));
    expect(statuses.every(status => status.insertions === 2)).toBe(true);
    expect(run.mock.calls.map(([, , options]) => options.operation)).toEqual(['status', 'operation-state', 'change-stats']);
    statuses[0]!.changes.length = 0;
    expect(statuses[1]!.changes).toHaveLength(1);
    await fixture.repositories.status(fixture.repositoryId);
    expect(run.mock.calls.filter(([, , options]) => options.operation === 'status')).toHaveLength(2);
  });

  it('keeps status-only reads separate from line totals and isolates sibling worktrees', async () => {
    const fixture = await repository();
    const linked = path.join(fixture.root, 'linked');
    await execFileAsync('git', ['worktree', 'add', '-b', 'linked', linked], { cwd: fixture.work });
    const sibling = await fixture.repositories.openPath(linked);
    await writeFile(path.join(fixture.work, 'untracked.txt'), 'one\ntwo\n');
    const [full, light, other] = await Promise.all([
      fixture.repositories.status(fixture.repositoryId), fixture.repositories.status(fixture.repositoryId, false), fixture.repositories.status(sibling.id),
    ]);
    expect(full.insertions).toBe(2);
    expect(light.insertions).toBe(0);
    expect(other.changes).toEqual([]);
    expect(other.branch).toBe('linked');
  });

  it('retries a status snapshot that crossed a Git mutation', async () => {
    const fixture = await repository();
    const original = fixture.git.run.bind(fixture.git);
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const snapshot = new Promise<void>(resolve => { started = resolve; });
    let first = true;
    const run = vi.spyOn(fixture.git, 'run').mockImplementation(async (cwd, args, options) => {
      const result = await original(cwd, args, options);
      if (options.operation === 'status' && first) { first = false; started(); await gate; }
      return result;
    });
    const readers = Array.from({ length: 4 }, () => fixture.repositories.status(fixture.repositoryId, false));
    await snapshot;
    await fixture.git.runWrite(fixture.work, ['checkout', '-b', 'updated'], { operation: 'checkout' });
    release();
    expect((await Promise.all(readers)).every(status => status.branch === 'updated')).toBe(true);
    expect(run.mock.calls.filter(([, , options]) => options.operation === 'status')).toHaveLength(2);
  });
  it('prepares candidates without changing saved repositories, including across restart', async () => {
    const fixture = await repository();
    const candidatePath = path.join(fixture.root, 'candidate');
    await execFileAsync('git', ['init', candidatePath]);
    const before = fixture.repositories.recents();
    const prepared = await fixture.repositories.preparePath(candidatePath);
    expect(fixture.repositories.get(prepared.id)).toEqual(prepared);
    expect(fixture.repositories.recents()).toEqual(before);
    expect(fixture.settings.activeRepositoryId).toBe(fixture.repositoryId);
    const restarted = new SettingsStore(path.join(fixture.root, 'settings.json'));
    await restarted.load();
    expect(restarted.recentRepositories).toEqual(before);
    expect(restarted.activeRepositoryId).toBe(fixture.repositoryId);
    await expect(fixture.repositories.completeSetup(prepared.id, () => { throw new Error('Stale account'); })).rejects.toThrow('Stale account');
    expect(fixture.repositories.recents()).toEqual(before);
    expect(fixture.settings.activeRepositoryId).toBe(fixture.repositoryId);
    await fixture.repositories.completeSetup(prepared.id);
    expect(fixture.settings.activeRepositoryId).toBe(prepared.id);
    expect(fixture.repositories.recents()).toHaveLength(2);
  });

  it('does not activate a candidate whose folder disappeared during setup', async () => {
    const fixture = await repository();
    const candidatePath = path.join(fixture.root, 'candidate');
    await execFileAsync('git', ['init', candidatePath]);
    const prepared = await fixture.repositories.preparePath(candidatePath);
    await rename(candidatePath, path.join(fixture.root, 'moved'));
    await expect(fixture.repositories.completeSetup(prepared.id)).rejects.toThrow();
    expect(fixture.repositories.recents()).toHaveLength(1);
    expect(fixture.settings.activeRepositoryId).toBe(fixture.repositoryId);
  });
  it('counts untracked lines and keeps the total stable across refreshes', async () => {
    const fixture = await repository();
    await writeFile(path.join(fixture.work, 'untracked.txt'), 'uno\ndos\ntres\n');

    const first = await fixture.repositories.status(fixture.repositoryId);
    expect(first.insertions).toBe(3);

    const second = await fixture.repositories.status(fixture.repositoryId);
    expect(second.insertions).toBe(3);
  });

  it('recounts when an untracked file changes', async () => {
    const fixture = await repository();
    const target = path.join(fixture.work, 'untracked.txt');
    await writeFile(target, 'uno\n');
    expect((await fixture.repositories.status(fixture.repositoryId)).insertions).toBe(1);

    await writeFile(target, 'uno\ndos\n');
    expect((await fixture.repositories.status(fixture.repositoryId)).insertions).toBe(2);
  });

  it('forgets a repository and all its worktrees without deleting files, and allows reopening', async () => {
    const fixture = await repository();
    const linked = path.join(fixture.root, 'linked');
    await execFileAsync('git', ['worktree', 'add', '-b', 'linked', linked], { cwd: fixture.work });
    // Git may check out CRLF on Windows. Forgetting must preserve the exact
    // bytes already on disk in each worktree, regardless of autocrlf settings.
    const mainContents = await readFile(path.join(fixture.work, 'file.txt'));
    const linkedContents = await readFile(path.join(linked, 'file.txt'));
    const main = fixture.repositories.get(fixture.repositoryId);
    const worktree = await fixture.repositories.openPath(linked);
    const project = (await fixture.settings.createRepositoryProject('Keep group')).repositoryProjects[0]!;
    await fixture.settings.assignRepositoryProject(main.commonDir, project.id);
    fixture.settings.setOpenFilesState(main.id, [{ path: 'file.txt', pinned: true }], 'file.txt', null);
    fixture.settings.setFilesTreeExpandedPaths(worktree.id, ['src']);
    const other = path.join(fixture.root, 'other');
    await execFileAsync('git', ['init', other]);
    const unrelated = await fixture.repositories.openPath(other);
    await fixture.repositories.openRecent(worktree.id);

    const organization = await fixture.repositories.forget(main.commonDir);

    expect(organization.recentRepositories.map((item) => item.id)).toEqual([unrelated.id]);
    expect(organization.repositoryProjects).toEqual([{ ...project, repositoryKeys: [] }]);
    expect(fixture.settings.activeRepositoryId).toBeNull();
    expect(fixture.settings.openFilesStates).toEqual([]);
    expect(fixture.settings.filesTreeStates).toEqual([]);
    expect(() => fixture.repositories.get(main.id)).toThrow('Unknown repository');
    expect(() => fixture.repositories.get(worktree.id)).toThrow('Unknown repository');
    expect(await readFile(path.join(fixture.work, 'file.txt'))).toEqual(mainContents);
    expect(await readFile(path.join(linked, 'file.txt'))).toEqual(linkedContents);
    await fixture.settings.flush();
    const restarted = new SettingsStore(path.join(fixture.root, 'settings.json'));
    await restarted.load();
    expect(restarted.recentRepositories.map((item) => item.id)).toEqual([unrelated.id]);
    expect(restarted.activeRepositoryId).toBeNull();
    expect((await fixture.repositories.openPath(fixture.work)).id).toBe(main.id);
  });

  it('keeps another active repository when forgetting an inactive one', async () => {
    const fixture = await repository();
    const main = fixture.repositories.get(fixture.repositoryId);
    const other = path.join(fixture.root, 'other');
    await execFileAsync('git', ['init', other]);
    const active = await fixture.repositories.openPath(other);
    await fixture.repositories.forget(main.commonDir);
    expect(fixture.settings.activeRepositoryId).toBe(active.id);
    expect(fixture.repositories.get(active.id)).toEqual(active);
  });

  it('leaves saved paths unchanged when relocation fails validation', async () => {
    const fixture = await repository();
    const before = fixture.repositories.recents();
    await expect(fixture.repositories.relocateRecent(fixture.repositoryId, fixture.root)).rejects.toThrow();
    expect(fixture.repositories.recents()).toEqual(before);
    expect(fixture.settings.activeRepositoryId).toBe(fixture.repositoryId);
  });

  it('does not overwrite another saved repository during relocation', async () => {
    const fixture = await repository();
    const other = path.join(fixture.root, 'other');
    await execFileAsync('git', ['init', other]);
    const active = await fixture.repositories.openPath(other);
    const before = fixture.repositories.recents();
    await expect(fixture.repositories.relocateRecent(fixture.repositoryId, other)).rejects.toThrow('already in OpenTig');
    expect(fixture.repositories.recents()).toEqual(before);
    expect(fixture.settings.activeRepositoryId).toBe(active.id);
  });

  it('restores the manually relocated repository as active after restart', async () => {
    const fixture = await repository();
    const other = path.join(fixture.root, 'other');
    await execFileAsync('git', ['init', other]);
    await fixture.repositories.openPath(other);
    const moved = path.join(fixture.root, 'moved');
    await rename(fixture.work, moved);
    const relocated = await fixture.repositories.relocateRecent(fixture.repositoryId, moved);
    const restarted = new SettingsStore(path.join(fixture.root, 'settings.json'));
    await restarted.load();
    expect(restarted.activeRepositoryId).toBe(relocated.id);
  });

  it('rebinds a recent repository after its directory moves', async () => {
    const fixture = await repository();
    const previousId = fixture.repositoryId;
    const moved = path.join(fixture.root, 'moved');
    await rename(fixture.work, moved);

    await expect(fixture.repositories.openRecent(previousId)).rejects.toThrow();
    const relocated = await fixture.repositories.relocateRecent(previousId, moved);

    expect(relocated.path).toBe(await realpath(moved));
    expect(relocated.id).not.toBe(previousId);
    expect(fixture.repositories.recents()).toEqual([expect.objectContaining({ id: relocated.id, path: relocated.path })]);
    expect(await fixture.repositories.openRecent(relocated.id)).toMatchObject({ id: relocated.id, path: relocated.path });
  });
});

async function repository() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opentig-status-'));
  directories.push(root);
  const work = path.join(root, 'work');
  await execFileAsync('git', ['init', '-b', 'main', work], { windowsHide: true });
  await execFileAsync('git', ['config', 'user.name', 'OpenTig Test'], { cwd: work, windowsHide: true });
  await execFileAsync('git', ['config', 'user.email', 'opentig@example.invalid'], { cwd: work, windowsHide: true });
  await writeFile(path.join(work, 'file.txt'), 'content\n');
  await execFileAsync('git', ['add', '.'], { cwd: work, windowsHide: true });
  await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: work, windowsHide: true });
  const settings = new SettingsStore(path.join(root, 'settings.json'));
  await settings.load();
  const git = new GitProcess();
  const repositories = new RepositoryService(git, settings);
  const repositoryInfo = await repositories.openPath(work);
  return { root, work, settings, git, repositories, repositoryId: repositoryInfo.id };
}
