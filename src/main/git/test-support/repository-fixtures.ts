import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach } from 'vitest';
import { FileService } from '../../files/FileService';
import { SettingsStore } from '../../persistence/SettingsStore';
import { GitProcess } from '../GitProcess';
import { GitRepositoryOperations } from '../GitRepositoryOperations';
import { RepositoryService } from '../RepositoryService';

const execFileAsync = promisify(execFile);
const directories: string[] = [];
const templateDirectories: string[] = [];
const templates = new Map<string, Promise<string>>();
const cleanup = (roots: string[]) => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 3 })));
afterEach(() => cleanup(directories));
afterAll(() => cleanup(templateDirectories));

// Each worker builds a seed once. Copy everything (including Git objects), so
// tests never share mutable refs, indexes, worktrees, settings, or bare remotes.
async function copyRepository(kind: string, prepare: (root: string, work: string) => Promise<void>) {
  let template = templates.get(kind);
  if (!template) {
    template = (async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'opentig-git-seed-'));
      templateDirectories.push(root);
      await prepare(root, path.join(root, 'work'));
      return root;
    })();
    templates.set(kind, template);
  }
  const root = await mkdtemp(path.join(os.tmpdir(), 'opentig-git-test-'));
  directories.push(root);
  await cp(await template, root, { recursive: true });
  return { root, work: path.join(root, 'work') };
}

export async function managementRepository() {
  const { root, work } = await copyRepository('management', async (root, work) => {
    await git(root, ['init', '-b', 'main', work]);
    await configure(work);
    await writeFile(path.join(work, 'file.txt'), 'base\n');
    await git(work, ['add', '.']);
    await git(work, ['commit', '-m', 'Base commit']);
  });
  return { root, ...await createOperations(root, work) };
}

export async function addRemote(fixture: { root: string; work: string }): Promise<string> {
  const remote = path.join(fixture.root, 'remote.git');
  await git(fixture.root, ['init', '-q', '--bare', remote]);
  await git(fixture.work, ['remote', 'add', 'origin', remote]);
  return remote;
}

/** Creates a linked worktree in a sibling directory and returns its path. */
export async function addWorktree(fixture: { root: string; work: string }, directory: string, branch: string): Promise<string> {
  const target = path.join(fixture.root, 'trees', directory);
  await git(fixture.work, ['worktree', 'add', '-b', branch, target]);
  return target;
}

/** Commits on `branch` without leaving the main worktree checked out elsewhere. */
export async function commitOnBranch(fixture: { work: string }, branch: string, content: string): Promise<void> {
  const existing = await git(fixture.work, ['for-each-ref', '--format=%(refname:short)', `refs/heads/${branch}`]);
  await git(fixture.work, existing ? ['switch', branch] : ['switch', '-c', branch]);
  await writeFile(path.join(fixture.work, `${branch}.txt`), `${content}\n`);
  await git(fixture.work, ['add', '.']);
  await git(fixture.work, ['commit', '-m', content]);
  await git(fixture.work, ['switch', 'main']);
}

export async function exists(target: string): Promise<boolean> {
  try { await stat(target); return true; } catch { return false; }
}

/** Temporary directories are symlinked on some platforms; compare real paths. */
export async function realPath(target: string): Promise<string> {
  try { return (await realpath(target)).toLowerCase(); } catch { return path.resolve(target).toLowerCase(); }
}

export async function repositoryWithUpstream() {
  const { root, work } = await copyRepository('upstream', async (root, work) => {
    const remote = path.join(root, 'remote.git');
    await git(root, ['init', '--bare', remote]);
    await git(root, ['init', '-b', 'main', work]);
    await configure(work);
    await writeFile(path.join(work, 'committed.txt'), 'base\n');
    await writeFile(path.join(work, 'staged.txt'), 'base\n');
    await writeFile(path.join(work, 'unstaged.txt'), 'base\n');
    await git(work, ['add', '.']);
    await git(work, ['commit', '-m', 'Base commit']);
    await git(work, ['remote', 'add', 'origin', remote]);
    await git(work, ['push', '-u', 'origin', 'main']);
    await git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  });
  const remote = path.join(root, 'remote.git');
  await git(work, ['remote', 'set-url', 'origin', remote]);
  return { root, remote, ...await createOperations(root, work) };
}

export async function commitOnRemote(
  fixture: { root: string; remote: string },
  filename: string,
  content: string,
  message: string,
): Promise<void> {
  const other = path.join(fixture.root, `remote-work-${filename.replace(/[^\w.-]+/g, '-')}`);
  await git(fixture.root, ['clone', fixture.remote, other]);
  await configure(other);
  await git(other, ['checkout', '-B', 'main', 'origin/main']);
  await writeFile(path.join(other, filename), content);
  await git(other, ['add', '.']);
  await git(other, ['commit', '-m', message]);
  await git(other, ['push', 'origin', 'main']);
}

export async function standaloneRepository() {
  const { root, work } = await copyRepository('standalone', async (root, work) => {
    await git(root, ['init', '-b', 'main', work]);
    await configure(work);
    await writeFile(path.join(work, 'file.txt'), 'content\n');
    await git(work, ['add', '.']);
    await git(work, ['commit', '-m', 'Initial commit']);
  });
  return createOperations(root, work);
}

async function createOperations(root: string, work: string) {
  const settings = new SettingsStore(path.join(root, 'settings.json'));
  await settings.load();
  const process = new GitProcess();
  const repositories = new RepositoryService(process, settings);
  const files = new FileService(process, repositories);
  const operations = new GitRepositoryOperations(process, repositories, files);
  const repository = await repositories.openPath(work);
  return { work, operations, repositoryId: repository.id, settings, repositories };
}

async function configure(work: string): Promise<void> {
  await git(work, ['config', 'user.name', 'OpenTig Test']);
  await git(work, ['config', 'user.email', 'opentig@example.invalid']);
}

export async function git(cwd: string, args: string[]): Promise<string> {
  return (await gitRaw(cwd, args)).trim();
}

export async function gitRaw(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  return String(result.stdout);
}
