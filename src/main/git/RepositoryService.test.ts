import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsStore } from '../persistence/SettingsStore';
import { GitProcess } from './GitProcess';
import { RepositoryService } from './RepositoryService';

const execFileAsync = promisify(execFile);
const directories: string[] = [];

afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 3 }))));

describe('RepositoryService change stats', () => {
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
  const repositories = new RepositoryService(new GitProcess(), settings);
  const repositoryInfo = await repositories.openPath(work);
  return { root, work, settings, repositories, repositoryId: repositoryInfo.id };
}
