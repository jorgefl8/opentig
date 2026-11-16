import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { addRepository, addressRepositoryId, openRepository, otherRepository, repositoryPicker as picker } from './support/app';
import { expect, test } from './support/fixtures';

// Every page has its own open repository, and hears of changes to it as they happen: switching
// in one page, by the selector or by Back, moves no other, and each sees its own files change.

const views = (page: Page) => page.getByRole('navigation', { name: 'Repository views' });

/** Opens a saved repository from the selector. */
async function choose(page: Page, name: string): Promise<void> {
  await picker(page).click();
  await page.getByRole('listbox', { name: 'Select project or repository' }).getByRole('option', { name: new RegExp(`^${name}`) }).click();
  await expect(picker(page)).toContainText(name);
}

test('two pages on two repositories each keep theirs, and each sees its own files change on disk', async ({ pairedPage: page, repository }) => {
  const second = await otherRepository('second-project');
  const third = await otherRepository('third-project');
  try {
    await openRepository(page, repository);
    await addRepository(page, second);
    const secondId = addressRepositoryId(page);
    await addRepository(page, third);
    await choose(page, repository.name);

    const other = await page.context().newPage();
    await other.goto(`${new URL(page.url()).origin}/r/${secondId}/changes`);
    await expect(picker(other)).toContainText('second-project');

    // One page switches; the other stays where it is.
    await choose(page, 'third-project');
    await other.waitForTimeout(500);
    await expect(picker(other)).toContainText('second-project');
    await expect(other).toHaveURL(new RegExp(`/r/${secondId}/changes$`));

    await views(page).getByRole('button', { name: /^Changes/ }).click();
    await expect(page.getByText('No changes')).toBeVisible();
    await expect(other.getByText('No changes')).toBeVisible();

    // Neither page is reloaded or refreshed by hand: each hears of its own repository only.
    await writeFile(path.join(third.path, 'third-notes.txt'), 'Third.\n');
    await expect(page.getByRole('treeitem', { name: /third-notes\.txt/ })).toBeVisible();
    await writeFile(path.join(second.path, 'second-notes.txt'), 'Second.\n');
    await expect(other.getByRole('treeitem', { name: /second-notes\.txt/ })).toBeVisible();
    await expect(views(page).getByRole('button', { name: 'Changes 1' })).toBeVisible();
    await expect(views(other).getByRole('button', { name: 'Changes 1' })).toBeVisible();
    await expect(page.getByRole('treeitem', { name: /second-notes\.txt/ })).toHaveCount(0);
    await expect(other.getByRole('treeitem', { name: /third-notes\.txt/ })).toHaveCount(0);
    await other.close();
  } finally {
    await second.dispose();
    await third.dispose();
  }
});

test('going Back across repositories in one page leaves another page where it is', async ({ pairedPage: page, repository }) => {
  const second = await otherRepository('second-project');
  try {
    await openRepository(page, repository);
    await addRepository(page, second);
    await expect(page).toHaveURL(/\/files$/);
    const secondAddress = page.url();

    const other = await page.context().newPage();
    await other.goto(secondAddress);
    await expect(picker(other)).toContainText('second-project');

    await page.getByRole('banner').getByRole('button', { name: 'Back', exact: true }).click();
    await expect(picker(page)).toContainText(repository.name);
    await other.waitForTimeout(500);
    await expect(picker(other)).toContainText('second-project');
    await expect(other).toHaveURL(secondAddress);
    await other.close();
  } finally {
    await second.dispose();
  }
});

test('two pages on the same repository both see a commit made in one of them', async ({ pairedPage: page, repository }) => {
  await openRepository(page, repository);
  const id = addressRepositoryId(page);
  const other = await page.context().newPage();
  await other.goto(`${new URL(page.url()).origin}/r/${id}/history`);
  await expect(other.getByRole('list', { name: 'Commit history' })).toBeVisible();

  await writeFile(path.join(repository.path, 'README.md'), '# Sample project\n\nWritten in one page.\n');
  await views(page).getByRole('button', { name: /^Changes/ }).click();
  await expect(views(page).getByRole('button', { name: 'Changes 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Stage all' }).click();
  const commitBox = page.getByRole('group', { name: 'Create commit' });
  await commitBox.getByRole('textbox', { name: 'Commit message' }).fill('Commit from the first page');
  await commitBox.getByRole('button', { name: 'Commit 1 file' }).click();
  await expect.poll(() => repository.git('log', '-1', '--format=%s')).toBe('Commit from the first page');

  await expect(other.getByRole('list', { name: 'Commit history' }).getByText('Commit from the first page')).toBeVisible();
  await other.close();
});
