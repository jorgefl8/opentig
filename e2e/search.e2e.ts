import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { openRepository } from './support/app';
import { expect, test, type GitRepository } from './support/fixtures';

/** Two files that mention "needle", one of them twice and in different cases. */
async function addSearchableFiles(repository: GitRepository): Promise<void> {
  await repository.commit('src/lib/util.ts', 'export const needle = 1;\n', 'Add a utility');
  await repository.commit('docs/guide.md', 'Find the needle here\nand Needle again\n', 'Add a guide');
}

/** Opens the repository and waits until its status has loaded. */
async function openLoadedRepository(page: Page, repository: GitRepository): Promise<void> {
  await openRepository(page, repository);
  await expect(page.getByRole('combobox', { name: 'Select branch' })).toContainText('main');
  // Ctrl+P is ignored while another dialog is still on screen, including one that is closing.
  await expect(page.getByRole('dialog', { name: 'Open a repository' })).toBeHidden();
}

async function openQuickOpen(page: Page) {
  await page.keyboard.press('Control+p');
  const dialog = page.getByRole('dialog', { name: 'Open file' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openSearch(page: Page) {
  await page.getByRole('navigation', { name: 'Repository views' }).getByRole('button', { name: 'Search' }).click();
  const query = page.getByRole('textbox', { name: 'Search in repository' });
  await expect(query).toBeVisible();
  return query;
}

function readText(repository: GitRepository, file: string): Promise<string> {
  return readFile(path.join(repository.path, file), 'utf8');
}

test('Ctrl+P finds a file by part of its name and opens it with Enter', async ({ pairedPage: page, repository }) => {
  await addSearchableFiles(repository);
  await openLoadedRepository(page, repository);

  const dialog = await openQuickOpen(page);
  const field = dialog.getByRole('combobox', { name: 'Search files by name or path' });
  await expect(field).toBeFocused();
  await field.fill('util');

  const results = dialog.getByRole('listbox', { name: 'Repository files' });
  await expect(results.getByRole('option')).toHaveCount(1);
  await expect(results.getByRole('option', { name: 'util.ts src/lib' })).toBeVisible();
  await field.press('Enter');

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('tablist', { name: 'Open files' }).getByRole('tab', { name: /^src\/lib\/util\.ts/ })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'src/lib/util.ts' })).toContainText('export const needle = 1;');
});

test('quick open results are chosen with the arrow keys', async ({ pairedPage: page, repository }) => {
  await addSearchableFiles(repository);
  await openLoadedRepository(page, repository);

  const dialog = await openQuickOpen(page);
  const field = dialog.getByRole('combobox', { name: 'Search files by name or path' });
  await field.fill('.md');
  const options = dialog.getByRole('listbox', { name: 'Repository files' }).getByRole('option');
  await expect(options).toHaveCount(2);
  const second = (await options.nth(1).textContent()) ?? '';
  // The ranking order is the app's choice; whichever file is second gets opened.
  const target = second.startsWith('README.md') ? /^README\.md/ : /^docs\/guide\.md/;

  await field.press('ArrowDown');
  await expect(field).toHaveAttribute('aria-activedescendant', (await options.nth(1).getAttribute('id')) ?? '');
  await field.press('Enter');

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('tablist', { name: 'Open files' }).getByRole('tab', { name: target })).toBeVisible();
});

test('quick open reports when no file matches', async ({ pairedPage: page, repository }) => {
  await openLoadedRepository(page, repository);

  const dialog = await openQuickOpen(page);
  await dialog.getByRole('combobox', { name: 'Search files by name or path' }).fill('does-not-exist');

  await expect(dialog.getByRole('status')).toContainText('Nothing matches does-not-exist in this repository.');
  await expect(dialog.getByRole('option')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('Search finds text across files, grouped by file with line numbers', async ({ pairedPage: page, repository }) => {
  await addSearchableFiles(repository);
  await openLoadedRepository(page, repository);

  const query = await openSearch(page);
  await query.fill('needle');

  await expect(page.getByText('3 results in 2 files')).toBeVisible();
  await expect(page.getByRole('button', { name: 'docs/guide.md 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: '1:10 Find the needle here' })).toBeVisible();
  await expect(page.getByRole('button', { name: '2:5 and Needle again' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'src/lib/util.ts 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: '1:14 export const needle = 1;' })).toBeVisible();
});

test('Search narrows results with match case and regular expressions', async ({ pairedPage: page, repository }) => {
  await addSearchableFiles(repository);
  await openLoadedRepository(page, repository);

  const query = await openSearch(page);
  await query.fill('Needle');
  await expect(page.getByText('3 results in 2 files')).toBeVisible();

  await page.getByRole('button', { name: 'Match case' }).click();
  await expect(page.getByText('1 result in 1 file')).toBeVisible();
  await expect(page.getByRole('button', { name: '2:5 and Needle again' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'src/lib/util.ts 1' })).toBeHidden();

  await page.getByRole('button', { name: 'Match case' }).click();
  await page.getByRole('button', { name: 'Use regular expression' }).click();
  await query.fill('^export const \\w+');
  await expect(page.getByText('1 result in 1 file')).toBeVisible();
  await expect(page.getByRole('button', { name: 'src/lib/util.ts 1' })).toBeVisible();
});

test('a search result opens its file in the code view', async ({ pairedPage: page, repository }) => {
  await addSearchableFiles(repository);
  await openLoadedRepository(page, repository);

  const query = await openSearch(page);
  await query.fill('needle');
  await page.getByRole('button', { name: '2:5 and Needle again' }).click();

  await expect(page.getByRole('tablist', { name: 'Open files' }).getByRole('tab', { name: /^docs\/guide\.md/ })).toHaveAttribute('aria-selected', 'true');
  // Markdown opens on its Code tab so the matching line is visible.
  await expect(page.getByRole('tablist', { name: 'Markdown view' }).getByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('textbox', { name: 'docs/guide.md' })).toContainText('and Needle again');
});

test('Replace all rewrites every match on disk', async ({ pairedPage: page, repository }) => {
  await addSearchableFiles(repository);
  await openLoadedRepository(page, repository);

  const query = await openSearch(page);
  await page.getByRole('button', { name: 'Match case' }).click();
  await query.fill('needle');
  await expect(page.getByText('2 results in 2 files')).toBeVisible();
  await page.getByRole('button', { name: 'More search options' }).click();
  await page.getByRole('menuitem', { name: 'Replace…' }).click();
  await page.getByRole('textbox', { name: 'Replace with' }).fill('thread');
  // Replacing everything asks for a native confirmation first.
  const confirmations: string[] = [];
  page.once('dialog', (dialog) => { confirmations.push(dialog.message()); void dialog.accept(); });
  await page.getByRole('button', { name: 'Replace all search results' }).click();
  await expect.poll(() => confirmations).toEqual(['Replace 2 occurrences in 2 files?']);

  await expect.poll(() => readText(repository, 'src/lib/util.ts')).toBe('export const thread = 1;\n');
  await expect.poll(() => readText(repository, 'docs/guide.md')).toBe('Find the thread here\nand Needle again\n');
  await expect(page.getByText('2 results in 2 files')).toBeHidden();
});
