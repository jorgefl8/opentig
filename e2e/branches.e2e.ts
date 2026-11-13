import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { openRepository } from './support/app';
import { expect, test, type GitRepository } from './support/fixtures';

// Branches and worktrees (docs/features.md, "Branches and worktrees").

const branchPicker = (page: Page) => page.getByRole('combobox', { name: 'Select branch' });

/** Picks a branch from the top bar's "Select branch" menu by its exact label. */
async function selectBranch(page: Page, label: string): Promise<void> {
  await branchPicker(page).click();
  await page.getByRole('listbox', { name: 'Select branch' }).getByRole('option', { name: new RegExp(`^${label}(?: |$)`) }).click();
}

/** Opens "Manage branches…" from the branch menu. */
async function openBranchManager(page: Page) {
  await branchPicker(page).click();
  await page.getByRole('button', { name: 'Manage branches…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Branches and worktrees' });
  await expect(dialog).toBeVisible();
  return dialog;
}

const currentBranch = (repository: GitRepository) => repository.git('rev-parse', '--abbrev-ref', 'HEAD');
const localBranches = async (repository: GitRepository) => (await repository.git('branch', '--format=%(refname:short)')).split('\n').sort();

test('choosing another local branch checks it out', async ({ pairedPage: page, repository }) => {
  await repository.git('switch', '-q', '-c', 'feature');
  await repository.commit('feature.txt', 'feature work\n', 'Add feature');
  await repository.git('switch', '-q', 'main');
  await openRepository(page, repository);
  await expect(branchPicker(page)).toContainText('main');

  await selectBranch(page, 'feature');

  await expect(branchPicker(page)).toContainText('feature');
  await expect.poll(() => currentBranch(repository)).toBe('feature');
  await expect(page.getByRole('tree', { name: 'Files' }).getByRole('treeitem', { name: 'feature.txt' })).toBeVisible();
});

test('choosing a remote branch creates and checks out its local tracking branch', async ({ pairedPage: page, repository }) => {
  const { other } = await repository.addRemote();
  await other.git('switch', '-q', '-c', 'from-remote');
  await other.commit('remote.txt', 'remote work\n', 'Add remote work');
  await other.git('push', '-q', 'origin', 'from-remote');
  await repository.git('fetch', '-q', 'origin');
  await openRepository(page, repository);

  await selectBranch(page, 'origin/from-remote');

  await expect(branchPicker(page)).toContainText('from-remote');
  await expect.poll(() => currentBranch(repository)).toBe('from-remote');
  expect(await repository.git('rev-parse', '--abbrev-ref', 'from-remote@{upstream}')).toBe('origin/from-remote');
  expect(await repository.git('rev-parse', 'HEAD')).toBe(await other.git('rev-parse', 'HEAD'));
});

test('switching with local changes that Git would overwrite moves them to the destination unstaged', async ({ pairedPage: page, repository }) => {
  const lines = ['# Sample project', '', 'one', 'two', 'three', 'four', 'last line'];
  await repository.commit('README.md', `${lines.join('\n')}\n`, 'Expand README');
  await repository.git('switch', '-q', '-c', 'feature');
  await repository.commit('README.md', `${['# Feature title', ...lines.slice(1)].join('\n')}\n`, 'Retitle README');
  await repository.git('switch', '-q', 'main');
  // A tracked edit far from the feature's change, plus an untracked file.
  await writeFile(path.join(repository.path, 'README.md'), `${[...lines.slice(0, -1), 'edited last line'].join('\n')}\n`);
  await writeFile(path.join(repository.path, 'scratch.txt'), 'untracked\n');
  await openRepository(page, repository);

  await selectBranch(page, 'feature');

  const dialog = page.getByRole('dialog', { name: 'Move local changes to feature?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('README.md')).toBeVisible();
  await dialog.getByRole('button', { name: 'Move changes to feature' }).click();

  await expect(page.getByText('Switched to feature')).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(branchPicker(page)).toContainText('feature');
  expect(await currentBranch(repository)).toBe('feature');
  expect(await readFile(path.join(repository.path, 'README.md'), 'utf8')).toBe(`${['# Feature title', ...lines.slice(1, -1), 'edited last line'].join('\n')}\n`);
  expect(await repository.git('diff', '--name-only')).toBe('README.md');
  expect(await repository.git('diff', '--cached', '--name-only')).toBe('');
  expect(await repository.git('ls-files', '--others', '--exclude-standard')).toBe('scratch.txt');
  expect(await repository.git('stash', 'list')).toBe('');
});

test('canceling a blocked switch keeps the branch and local changes as they were', async ({ pairedPage: page, repository }) => {
  await repository.git('switch', '-q', '-c', 'feature');
  await repository.commit('README.md', '# Feature title\n', 'Retitle README');
  await repository.git('switch', '-q', 'main');
  await writeFile(path.join(repository.path, 'README.md'), '# Local edit\n');
  await openRepository(page, repository);

  await selectBranch(page, 'feature');
  const dialog = page.getByRole('dialog', { name: 'Move local changes to feature?' });
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await expect(dialog).toBeHidden();
  await expect(branchPicker(page)).toContainText('main');
  expect(await currentBranch(repository)).toBe('main');
  expect(await readFile(path.join(repository.path, 'README.md'), 'utf8')).toBe('# Local edit\n');
});

test('a fully merged local branch can be deleted from Manage branches', async ({ pairedPage: page, repository }) => {
  await repository.git('branch', 'merged-work');
  await openRepository(page, repository);
  const dialog = await openBranchManager(page);
  const branches = dialog.getByRole('listbox', { name: 'Branches' });

  await branches.getByRole('option', { name: /^merged-work / }).click();
  await expect(dialog.getByRole('heading', { name: 'merged-work', level: 3 })).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete branch' }).click();
  await expect(dialog.getByText(/Git confirmed it is fully merged into/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete branch' }).click();

  await expect(branches.getByRole('option', { name: /^merged-work / })).toBeHidden();
  expect(await localBranches(repository)).toEqual(['main']);
});

test('a branch with unmerged commits can only be removed by an explicit force delete', async ({ pairedPage: page, repository }) => {
  await repository.git('switch', '-q', '-c', 'experiment');
  await repository.commit('experiment.txt', 'unmerged\n', 'Try an experiment');
  await repository.git('switch', '-q', 'main');
  await openRepository(page, repository);
  const dialog = await openBranchManager(page);
  const branches = dialog.getByRole('listbox', { name: 'Branches' });

  await branches.getByRole('option', { name: /^experiment / }).click();
  await expect(dialog.getByRole('button', { name: 'Delete branch', exact: true })).toBeHidden();
  await dialog.getByRole('button', { name: 'Force delete branch' }).click();
  await expect(dialog.getByText(/commits found only on this local branch may become inaccessible/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Permanently delete' }).click();

  await expect(branches.getByRole('option', { name: /^experiment / })).toBeHidden();
  expect(await localBranches(repository)).toEqual(['main']);
});

test('a remote branch gets a local tracking branch without switching the checkout', async ({ pairedPage: page, repository }) => {
  const { other } = await repository.addRemote();
  await other.git('switch', '-q', '-c', 'review-me');
  await other.commit('review.txt', 'please review\n', 'Add work to review');
  await other.git('push', '-q', 'origin', 'review-me');
  await repository.git('fetch', '-q', 'origin');
  await writeFile(path.join(repository.path, 'README.md'), '# Uncommitted edit\n');
  await openRepository(page, repository);
  const dialog = await openBranchManager(page);

  await dialog.getByRole('group', { name: 'Branch scope' }).getByRole('button', { name: 'Remote' }).click();
  await dialog.getByRole('listbox', { name: 'Branches' }).getByRole('option', { name: /^review-me / }).click();
  await dialog.getByRole('button', { name: 'Create local tracking branch…' }).click();
  const name = dialog.getByRole('textbox', { name: 'Local branch name' });
  await name.fill('local-review');
  await dialog.getByRole('button', { name: 'Create local branch' }).click();

  // The new branch is listed and selected, showing its upstream.
  await expect(dialog.getByRole('listbox', { name: 'Branches' }).getByRole('option', { name: /^local-review /, selected: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'local-review', level: 3 })).toBeVisible();
  await expect(dialog.getByText('origin/review-me · ↑0 ↓0')).toBeVisible();
  expect(await repository.git('rev-parse', '--abbrev-ref', 'local-review@{upstream}')).toBe('origin/review-me');
  expect(await repository.git('rev-parse', 'local-review')).toBe(await other.git('rev-parse', 'HEAD'));
  expect(await currentBranch(repository)).toBe('main');
  expect(await repository.git('diff', '--name-only')).toBe('README.md');
});

test('a remote branch can be deleted from origin while local branches stay', async ({ pairedPage: page, repository }) => {
  const { bare } = await repository.addRemote();
  await repository.git('push', '-q', '-u', 'origin', 'main:obsolete');
  await repository.git('branch', '-q', '--track', 'obsolete', 'origin/obsolete');
  await openRepository(page, repository);
  const dialog = await openBranchManager(page);

  await dialog.getByRole('group', { name: 'Branch scope' }).getByRole('button', { name: 'Remote' }).click();
  const remoteBranches = dialog.getByRole('listbox', { name: 'Branches' });
  await remoteBranches.getByRole('option', { name: /^obsolete / }).click();
  await dialog.getByRole('button', { name: 'Delete from origin' }).click();
  await expect(dialog.getByText(/This removes the branch on the remote server/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete from origin' }).click();

  await expect(remoteBranches.getByRole('option', { name: /^obsolete / })).toBeHidden();
  expect(await repository.git('--git-dir', bare, 'branch', '--list', 'obsolete')).toBe('');
  expect(await localBranches(repository)).toEqual(['main', 'obsolete']);
});

test('a branch already deleted on the server is cleaned up by fetching', async ({ pairedPage: page, repository }) => {
  const { other } = await repository.addRemote();
  await other.git('push', '-q', 'origin', 'main:stale');
  await repository.git('fetch', '-q', 'origin');
  await other.git('push', '-q', 'origin', '--delete', 'stale');
  await openRepository(page, repository);
  const dialog = await openBranchManager(page);

  await dialog.getByRole('group', { name: 'Branch scope' }).getByRole('button', { name: 'Remote' }).click();
  const remoteBranches = dialog.getByRole('listbox', { name: 'Branches' });
  await remoteBranches.getByRole('option', { name: /^stale / }).click();
  await expect(dialog.getByText(/This branch was already deleted from origin/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Fetch and clean up' }).click();

  await expect(remoteBranches.getByRole('option', { name: /^stale / })).toBeHidden();
  expect(await repository.git('branch', '--remotes', '--list', 'origin/stale')).toBe('');
});

test('choosing a branch checked out in another worktree opens that worktree', async ({ pairedPage: page, repository }) => {
  const worktreePath = `${repository.path}-hotfix`;
  await repository.git('worktree', 'add', '-q', '-b', 'hotfix', worktreePath);
  await openRepository(page, repository);
  await expect(page.getByRole('combobox', { name: /^Select worktree/ })).toContainText('2');

  await branchPicker(page).click();
  const option = page.getByRole('listbox', { name: 'Select branch' }).getByRole('option', { name: /^hotfix / });
  await expect(option).toContainText('Open');
  await option.click();

  await expect(branchPicker(page)).toContainText('hotfix');
  // The main checkout stays on its branch; nothing was switched.
  expect(await currentBranch(repository)).toBe('main');
  expect(await repository.git('-C', worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('hotfix');
});

test('a linked worktree can be removed together with its branch', async ({ pairedPage: page, repository }) => {
  const worktreePath = `${repository.path}-spike`;
  await repository.git('worktree', 'add', '-q', '-b', 'spike', worktreePath);
  await openRepository(page, repository);
  const dialog = await openBranchManager(page);

  await dialog.getByRole('tab', { name: /^Worktrees/ }).click();
  await dialog.getByRole('listbox', { name: 'Worktrees' }).getByRole('option', { name: /sample-project-spike/ }).click();
  await dialog.getByRole('checkbox', { name: /Also delete branch/ }).check();
  await dialog.getByRole('button', { name: 'Remove worktree' }).click();
  await expect(dialog.getByText(/The branch spike will also be force-deleted/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove worktree' }).click();

  await expect(dialog.getByRole('listbox', { name: 'Worktrees' }).getByRole('option', { name: /sample-project-spike/ })).toBeHidden({ timeout: 20_000 });
  expect(existsSync(worktreePath)).toBe(false);
  expect(await repository.git('worktree', 'list', '--porcelain')).not.toContain('spike');
  expect(await localBranches(repository)).toEqual(['main']);
});

test.describe('coding agents in worktrees', () => {
  // OpenTig finds agents through /proc on Linux; CI runs this suite on Linux.
  test.skip(process.platform !== 'linux', 'Agent detection by working folder is exercised on Linux.');

  test('switching the branch under an agent asks first, and Cancel keeps it', async ({ pairedPage: page, repository, startFakeAgent }) => {
    await repository.git('branch', 'feature');
    await startFakeAgent('claude', repository.path);
    await openRepository(page, repository);

    // The branch the agent works on is marked in the branch menu.
    await branchPicker(page).click();
    const menu = page.getByRole('listbox', { name: 'Select branch' });
    await expect(menu.getByRole('option', { name: /^main / })).toContainText('Claude Code');
    await expect(menu.getByRole('option', { name: /^feature(?: |$)/ })).not.toContainText('Claude Code');
    await menu.getByRole('option', { name: /^feature(?: |$)/ }).click();

    const dialog = page.getByRole('dialog', { name: 'Claude Code is working in this folder' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(branchPicker(page)).toContainText('main');
    expect(await currentBranch(repository)).toBe('main');

    await selectBranch(page, 'feature');
    await dialog.getByRole('button', { name: 'Switch to feature anyway' }).click();

    await expect(dialog).toBeHidden();
    await expect(branchPicker(page)).toContainText('feature');
    await expect.poll(() => currentBranch(repository)).toBe('feature');
  });

  test('an agent in another worktree is marked there and does not hold up switching here', async ({ pairedPage: page, repository, startFakeAgent }) => {
    await repository.git('branch', 'feature');
    const worktreePath = `${repository.path}-agent`;
    await repository.git('worktree', 'add', '-q', '-b', 'agent-work', worktreePath);
    await startFakeAgent('codex', worktreePath);
    await openRepository(page, repository);

    await page.getByRole('combobox', { name: /^Select worktree/ }).click();
    const worktrees = page.getByRole('listbox', { name: /^Select worktree/ });
    await expect(worktrees.getByRole('option', { name: /sample-project-agent/ })).toContainText('Codex');
    await expect(worktrees.getByRole('option', { name: /^sample-project(?: |$)/ })).not.toContainText('Codex');
    await page.keyboard.press('Escape');

    await selectBranch(page, 'feature');

    await expect(branchPicker(page)).toContainText('feature');
    await expect.poll(() => currentBranch(repository)).toBe('feature');
    await expect(page.getByRole('dialog', { name: /working in this folder/ })).toHaveCount(0);
    expect(await repository.git('-C', worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('agent-work');
  });
});
