import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsStore } from '../persistence/SettingsStore';
import { GitProcess } from './GitProcess';
import { RepositoryService } from './RepositoryService';

const execFileAsync = promisify(execFile);
const directories: string[] = [];

afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

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
});

async function repository() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'justgit-status-'));
  directories.push(root);
  const work = path.join(root, 'work');
  await execFileAsync('git', ['init', '-b', 'main', work], { windowsHide: true });
  await execFileAsync('git', ['config', 'user.name', 'JustGit Test'], { cwd: work, windowsHide: true });
  await execFileAsync('git', ['config', 'user.email', 'justgit@example.invalid'], { cwd: work, windowsHide: true });
  await writeFile(path.join(work, 'file.txt'), 'content\n');
  await execFileAsync('git', ['add', '.'], { cwd: work, windowsHide: true });
  await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: work, windowsHide: true });
  const settings = new SettingsStore(path.join(root, 'settings.json'));
  await settings.load();
  const repositories = new RepositoryService(new GitProcess(), settings);
  const repositoryInfo = await repositories.openPath(work);
  return { work, repositories, repositoryId: repositoryInfo.id };
}
