import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
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
  return { root, work, repositories, repositoryId: repositoryInfo.id };
}
