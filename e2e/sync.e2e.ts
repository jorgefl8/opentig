import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { openRepository } from './support/app';
import { expect, test, type GitRepository } from './support/fixtures';

// Safe pull and push against a local bare `origin` (docs/features.md, "Safe pull and push").

const toolbar = (page: Page) => page.getByRole('banner');
const pullButton = (page: Page, commits: number) => toolbar(page).getByRole('button', { name: `Pull ${commits} commits` });
const pushButton = (page: Page, commits: number) => toolbar(page).getByRole('button', { name: `Push ${commits} commits` });
const syncButtons = (page: Page) => toolbar(page).getByRole('button', { name: /^(Pull|Push) \d+ commits$|^Publish branch$/ });

/** Commits in `other` and pushes, so `origin` is one commit ahead of the repository. */
async function pushFromOtherClone(other: GitRepository, file: string, content: string, message: string): Promise<string> {
  await other.commit(file, content, message);
  await other.git('push', '-q', 'origin', 'main');
  return other.git('rev-parse', 'HEAD');
}

/** The branch tip stored in the bare `origin` itself, not the local remote-tracking ref. */
function remoteTip(repository: GitRepository, bare: string, branch: string): Promise<string> {
  return repository.git('--git-dir', bare, 'rev-parse', `refs/heads/${branch}`);
}

/** Fetches through the toolbar, as the user would, until the behind count is visible. */
async function fetchFromToolbar(page: Page, behind: number): Promise<void> {
  await toolbar(page).getByRole('button', { name: 'Refresh' }).click();
  await expect(pullButton(page, behind)).toBeVisible();
}

test('publishing a branch without an upstream creates it on origin and tracks it', async ({ pairedPage: page, repository }) => {
  const { bare } = await repository.addRemote();
  await repository.git('switch', '-q', '-c', 'feature');
  await writeFile(path.join(repository.path, 'draft.txt'), 'not committed yet\n');
  await openRepository(page, repository);

  await toolbar(page).getByRole('button', { name: 'Publish branch' }).click();

  await expect(page.getByText('sample-project: branch published')).toBeVisible();
  await expect(toolbar(page).getByRole('button', { name: 'Publish branch' })).toBeHidden();
  await expect.poll(() => repository.git('rev-parse', '--abbrev-ref', 'feature@{upstream}')).toBe('origin/feature');
  expect(await remoteTip(repository, bare, 'feature')).toBe(await repository.git('rev-parse', 'HEAD'));
  // Publishing leaves uncommitted files untouched.
  expect(await repository.git('status', '--porcelain')).toBe('?? draft.txt');
});

test('pushing sends local commits to the remote and clears the push indicator', async ({ pairedPage: page, repository }) => {
  const { bare } = await repository.addRemote();
  await repository.commit('notes.txt', 'first\n', 'Add notes');
  await repository.commit('notes.txt', 'first\nsecond\n', 'Extend notes');
  await openRepository(page, repository);

  await pushButton(page, 2).click();

  await expect(page.getByText('sample-project: 2 commits pushed')).toBeVisible();
  await expect(syncButtons(page)).toHaveCount(0);
  expect(await remoteTip(repository, bare, 'main')).toBe(await repository.git('rev-parse', 'HEAD'));
  expect(await repository.git('rev-list', '--count', 'origin/main..main')).toBe('0');
});

test('fetching shows how far behind the branch is and pulling fast-forwards it', async ({ pairedPage: page, repository }) => {
  const { other } = await repository.addRemote();
  const remoteHead = await pushFromOtherClone(other, 'remote.txt', 'from the remote\n', 'Add remote file');
  await openRepository(page, repository);

  await fetchFromToolbar(page, 1);
  // Fetching only updates the remote-tracking branch.
  expect(await repository.git('rev-parse', 'HEAD')).not.toBe(remoteHead);

  await pullButton(page, 1).click();

  await expect(page.getByText('1 commit pulled')).toBeVisible();
  await expect(syncButtons(page)).toHaveCount(0);
  expect(await repository.git('rev-parse', 'HEAD')).toBe(remoteHead);
  await expect(page.getByRole('tree', { name: 'Files' }).getByRole('treeitem', { name: 'remote.txt' })).toBeVisible();
});

test('pulling a diverged branch rebases local commits on top of the remote without a merge commit', async ({ pairedPage: page, repository }) => {
  const { bare, other } = await repository.addRemote();
  const remoteHead = await pushFromOtherClone(other, 'remote.txt', 'from the remote\n', 'Add remote file');
  await repository.commit('local.txt', 'from this clone\n', 'Add local file');
  await openRepository(page, repository);
  await fetchFromToolbar(page, 1);
  await expect(pushButton(page, 1)).toBeVisible();

  await pullButton(page, 1).click();

  await expect(page.getByText('Your local commit was kept on top and is ready to push.')).toBeVisible();
  await expect(pullButton(page, 1)).toBeHidden();
  await expect(pushButton(page, 1)).toBeVisible();
  expect(await repository.git('rev-parse', 'HEAD~1')).toBe(remoteHead);
  expect(await repository.git('log', '-1', '--format=%s')).toBe('Add local file');
  expect(await repository.git('rev-list', '--merges', '--count', 'HEAD')).toBe('0');

  await pushButton(page, 1).click();

  await expect(page.getByText('sample-project: 1 commit pushed')).toBeVisible();
  expect(await remoteTip(repository, bare, 'main')).toBe(await repository.git('rev-parse', 'HEAD'));
});

test('a pull whose rebase would conflict is aborted and leaves the branch unchanged', async ({ pairedPage: page, repository }) => {
  const { other } = await repository.addRemote();
  await pushFromOtherClone(other, 'README.md', '# Remote title\n', 'Retitle on the remote');
  await repository.commit('README.md', '# Local title\n', 'Retitle locally');
  const localHead = await repository.git('rev-parse', 'HEAD');
  await openRepository(page, repository);
  await fetchFromToolbar(page, 1);

  await pullButton(page, 1).click();

  await expect(page.getByText('Could not rebase onto the remote')).toBeVisible();
  await expect(page.getByText('Your local commits overlap the remote changes in README.md. The branch was left unchanged.')).toBeVisible();
  expect(await repository.git('rev-parse', 'HEAD')).toBe(localHead);
  expect(await repository.git('status', '--porcelain')).toBe('');
  const gitDir = path.join(repository.path, '.git');
  expect(existsSync(path.join(gitDir, 'rebase-merge')) || existsSync(path.join(gitDir, 'rebase-apply'))).toBe(false);
  await expect(pullButton(page, 1)).toBeVisible();
});

test('pulling keeps uncommitted and untracked local changes', async ({ pairedPage: page, repository }) => {
  const { other } = await repository.addRemote();
  const remoteHead = await pushFromOtherClone(other, 'remote.txt', 'from the remote\n', 'Add remote file');
  await writeFile(path.join(repository.path, 'README.md'), '# Sample project\n\nWork in progress.\n');
  await writeFile(path.join(repository.path, 'scratch.txt'), 'untracked\n');
  await openRepository(page, repository);
  await fetchFromToolbar(page, 1);

  await pullButton(page, 1).click();

  await expect(page.getByText('Local and staged changes were restored.')).toBeVisible();
  expect(await repository.git('rev-parse', 'HEAD')).toBe(remoteHead);
  expect(await readFile(path.join(repository.path, 'README.md'), 'utf8')).toBe('# Sample project\n\nWork in progress.\n');
  expect(await repository.git('diff', '--name-only')).toBe('README.md');
  expect(await repository.git('diff', '--cached', '--name-only')).toBe('');
  expect(await repository.git('ls-files', '--others', '--exclude-standard')).toBe('scratch.txt');
  // The temporary safety stash is dropped once the changes are restored.
  expect(await repository.git('stash', 'list')).toBe('');
});

test('a push rejected because the remote moved offers Pull and never force-pushes', async ({ pairedPage: page, repository }) => {
  const { bare, other } = await repository.addRemote();
  await repository.commit('local.txt', 'from this clone\n', 'Add local file');
  await openRepository(page, repository);
  // The remote moves after the last fetch, so OpenTig still shows only a push.
  const remoteHead = await pushFromOtherClone(other, 'remote.txt', 'from the remote\n', 'Add remote file');

  await pushButton(page, 1).click();

  await expect(page.getByText('sample-project: the remote contains new changes')).toBeVisible();
  // Nothing is force-pushed: the remote keeps its own commit.
  expect(await remoteTip(repository, bare, 'main')).toBe(remoteHead);

  // Sileo renders a notification's action as a link.
  await page.getByRole('link', { name: 'Pull', exact: true }).click();
  await expect.poll(() => repository.git('log', '--format=%s', 'main')).toBe('Add local file\nAdd remote file\nInitial commit');
  await expect(pushButton(page, 1)).toBeVisible();
});
