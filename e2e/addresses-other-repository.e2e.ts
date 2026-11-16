import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Page } from '@playwright/test';
import { openRepository } from './support/app';
import { expect, test } from './support/fixtures';

// The server has one open repository, shared by every page and device. Opening a page,
// by its address or by a reload, never switches it: the page offers to.

const execFileAsync = promisify(execFile);
const picker = (page: Page) => page.getByRole('combobox', { name: 'Select project or repository' });
const section = (page: Page, name: string) => page.getByRole('navigation', { name: 'Repository views' }).getByRole('button', { name, exact: true });

/** Another repository with one commit, in its own folder. */
async function otherRepository(name: string): Promise<{ path: string; name: string; dispose(): Promise<void> }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opentig-e2e-other-'));
  const work = path.join(root, name);
  await execFileAsync('git', ['init', '-q', '-b', 'main', work]);
  await execFileAsync('git', ['-c', 'user.name=E2E Tester', '-c', 'user.email=e2e@example.com', '-c', 'commit.gpgsign=false',
    'commit', '-q', '--allow-empty', '-m', `Start ${name}`], { cwd: work });
  return { path: work, name, dispose: () => rm(root, { recursive: true, force: true, maxRetries: 3 }) };
}

/** Adds a repository with the open dialog once another one is open, and waits for it to show. */
async function addRepository(page: Page, repository: { path: string; name: string }): Promise<void> {
  await page.keyboard.press('Control+o');
  const dialog = page.getByRole('dialog', { name: 'Open a repository' });
  await dialog.getByRole('button', { name: 'Enter a folder path' }).click();
  const folderPath = dialog.getByRole('textbox', { name: 'Folder path' });
  await folderPath.fill(repository.path);
  await folderPath.press('Enter');
  await expect(dialog.getByText('This folder is a Git repository')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add repository' }).click();
  await expect(dialog).toBeHidden();
  await expect(picker(page)).toContainText(repository.name);
}

const idOf = (page: Page) => new URL(page.url()).pathname.split('/')[2]!;

/** Takes a notice's action. A notice opens up to show it when the pointer is on it. */
async function takeOffer(page: Page, title: string): Promise<void> {
  const notice = page.locator('[data-sileo-toast]').filter({ hasText: title });
  await notice.hover();
  await notice.locator('[data-sileo-button]').filter({ hasText: /^Open$/ }).click();
}

test('an address for another repository leaves every page where it is until its offer is taken', async ({ pairedPage: page, repository }) => {
  const second = await otherRepository('second-project');
  try {
    await openRepository(page, repository);
    await addRepository(page, second);
    await expect(page).toHaveURL(/\/r\/[A-Za-z0-9_-]+\/files$/);
    const secondId = idOf(page);
    await addRepository(page, { path: repository.path, name: repository.name });
    await expect(picker(page)).toContainText(repository.name);

    const other = await page.context().newPage();
    await other.goto(`${new URL(page.url()).origin}/r/${secondId}/history`);
    const offer = other.getByText('Open second-project?');
    await expect(offer).toBeVisible();
    // Nothing switched: this page shows the open repository, and so does the first one.
    await expect(picker(other)).toContainText(repository.name);
    await expect(other).not.toHaveURL(new RegExp(`/r/${secondId}/`));
    await page.waitForTimeout(500);
    await expect(picker(page)).toContainText(repository.name);

    await takeOffer(other, 'Open second-project?');
    await expect(picker(other)).toContainText('second-project');
    await expect(other).toHaveURL(new RegExp(`/r/${secondId}/history$`));
    await expect(section(other, 'History')).toHaveAttribute('aria-current', 'page');
    await other.close();
  } finally {
    await second.dispose();
  }
});

test('a page reopened on a repository that is no longer the open one stays on the open one and offers it', async ({ pairedPage: page, repository }) => {
  const second = await otherRepository('second-project');
  try {
    await openRepository(page, repository);
    await section(page, 'History').click();
    await expect(page).toHaveURL(/\/history$/);
    const firstAddress = page.url();
    // The page goes away, as a discarded tab does, and another one opens a different repository.
    await page.goto('about:blank');
    const other = await page.context().newPage();
    await other.goto(new URL(firstAddress).origin);
    await expect(picker(other)).toContainText(repository.name);
    await addRepository(other, second);

    // Back to the first page's entry: the page loads again with its step in the history.
    await page.goBack();
    await expect(page.getByText(`Open ${repository.name}?`)).toBeVisible();
    await expect(picker(page)).toContainText('second-project');
    await page.waitForTimeout(500);
    await expect(picker(other)).toContainText('second-project');

    await takeOffer(page, `Open ${repository.name}?`);
    await expect(picker(page)).toContainText(repository.name);
    await expect(page).toHaveURL(firstAddress);
    await expect(section(page, 'History')).toHaveAttribute('aria-current', 'page');
    await other.close();
  } finally {
    await second.dispose();
  }
});

test('two quick Backs across repositories land on the second step back and keep the steps ahead', async ({ pairedPage: page, repository }) => {
  const second = await otherRepository('second-project');
  const third = await otherRepository('third-project');
  try {
    await openRepository(page, repository);
    await page.getByRole('tree', { name: 'Files' }).getByRole('treeitem', { name: 'README.md' }).click();
    await expect(page).toHaveURL(/\/file\/README\.md$/);
    const readme = page.url();
    await addRepository(page, second);
    const secondFiles = page.url();
    await addRepository(page, third);
    await expect(page).toHaveURL(/\/files$/);

    // The second Back comes while the first one is still opening its repository.
    await page.evaluate(async () => {
      const back = [...document.querySelectorAll<HTMLButtonElement>('header button')].find((button) => button.getAttribute('aria-label') === 'Back')!;
      const moved = new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
      back.click();
      await moved;
      back.click();
    });
    await expect(picker(page)).toContainText(repository.name);
    await expect(page).toHaveURL(readme);
    await expect(page.getByRole('tablist', { name: 'Open files' }).getByRole('tab', { name: /README\.md/, selected: true })).toBeVisible();
    const forward = page.getByRole('banner').getByRole('button', { name: 'Forward', exact: true });
    await expect(forward).toBeEnabled();
    await forward.click();
    await expect(picker(page)).toContainText('second-project');
    await expect(page).toHaveURL(secondFiles);
    await forward.click();
    await expect(picker(page)).toContainText('third-project');
  } finally {
    await second.dispose();
    await third.dispose();
  }
});

test('opening a file address saves no tab for a file that does not exist', async ({ pairedPage: page, repository }) => {
  await openRepository(page, repository);
  const id = idOf(page);
  const other = await page.context().newPage();
  const saved: string[] = [];
  other.on('websocket', (socket) => socket.on('framesent', (frame) => {
    const text = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf8');
    if (text.includes('open-files')) saved.push(text);
  }));
  await other.goto(`${new URL(page.url()).origin}/r/${id}/file/made/up/elsewhere.txt`);
  await expect(other.getByRole('tree', { name: 'Files' }).getByRole('treeitem', { name: 'README.md' })).toBeVisible();
  await other.waitForTimeout(1_000);
  expect(saved.filter((text) => text.includes('made/up/elsewhere.txt'))).toEqual([]);
  await expect(other.getByText('That file no longer exists')).toBeVisible();
  await other.close();
});
