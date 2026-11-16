import type { Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { openRepository, requestsDuring, requestTotal } from './support/app';
import { expect, test } from './support/fixtures';

// What opening a repository and switching between two ask of the server, as request counts.
// The budgets are what the app asked when the server watched one repository for every client:
// 21 to open one, and 26 to 31 to switch. A page now asks 19 and 16: it reads a repository again
// only when its watch started after the page's reads, not when it joins a watch already running.

test.use({ countRequests: true });

const execFileAsync = promisify(execFile);
const picker = (page: Page) => page.getByRole('combobox', { name: 'Select project or repository' });
const branch = (page: Page) => page.getByRole('combobox', { name: 'Select branch' });

/** Opening one: the dialog, the setup and every read that follows, until the app is quiet. */
const OPEN_BUDGET = 21;
/** Switching to a repository opened before, until the app is quiet. */
const SWITCH_BUDGET = 26;

async function choose(page: Page, name: string): Promise<void> {
  await picker(page).click();
  await page.getByRole('listbox', { name: 'Select project or repository' }).getByRole('option', { name: new RegExp(`^${name}`) }).click();
  await expect(picker(page)).toContainText(name);
  await expect(branch(page)).toContainText('main');
}

test('opening a repository, and switching between two, stay within their request budgets', async ({ pairedPage: page, repository }, testInfo) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opentig-e2e-budget-'));
  const second = path.join(root, 'second-project');
  try {
    await execFileAsync('git', ['init', '-q', '-b', 'main', second]);
    await execFileAsync('git', ['-c', 'user.name=E2E Tester', '-c', 'user.email=e2e@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'Start'], { cwd: second });

    await expect(page.getByRole('button', { name: /Open a folder/ })).toBeVisible();
    const opened = await requestsDuring(page, async () => {
      await openRepository(page, repository);
      await expect(branch(page)).toContainText('main');
    });
    await page.keyboard.press('Control+o');
    const dialog = page.getByRole('dialog', { name: 'Open a repository' });
    await dialog.getByRole('button', { name: 'Enter a folder path' }).click();
    await dialog.getByRole('textbox', { name: 'Folder path' }).fill(second);
    await dialog.getByRole('textbox', { name: 'Folder path' }).press('Enter');
    await expect(dialog.getByText('This folder is a Git repository')).toBeVisible();
    await dialog.getByRole('button', { name: 'Add repository' }).click();
    await expect(picker(page)).toContainText('second-project');

    const back = await requestsDuring(page, () => choose(page, repository.name));
    const again = await requestsDuring(page, () => choose(page, 'second-project'));
    await testInfo.attach('requests', { body: JSON.stringify({ opened, back, again }, null, 2), contentType: 'application/json' });

    expect(requestTotal(opened), JSON.stringify(opened)).toBeLessThanOrEqual(OPEN_BUDGET);
    expect(requestTotal(back), JSON.stringify(back)).toBeLessThanOrEqual(SWITCH_BUDGET);
    expect(requestTotal(again), JSON.stringify(again)).toBeLessThanOrEqual(SWITCH_BUDGET);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
});
