import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { openRepository } from './support/app';
import { expect, test, type GitRepository } from './support/fixtures';

// The keys every list shares, the viewer's keys beside it, and g followed by a section's letter.

const section = (page: Page, name: string) => page.getByRole('navigation', { name: 'Repository views' }).getByRole('button', { name, exact: true });
const history = (page: Page) => page.getByRole('list', { name: 'Commit history' });
const commit = (page: Page, subject: string) => history(page).getByRole('button', { name: subject, exact: true });
const heading = (page: Page, subject: string) => page.getByRole('main').getByRole('heading', { name: subject, level: 2 });

async function openLoadedRepository(page: Page, repository: GitRepository): Promise<void> {
  await openRepository(page, repository);
  await expect(page.getByRole('combobox', { name: 'Select branch' })).toContainText('main');
  await expect(page.getByRole('dialog', { name: 'Open a repository' })).toBeHidden();
}

test('j, k and Enter move through History, and the open viewer follows each commit', async ({ pairedPage: page, repository }) => {
  await repository.commit('one.txt', '1\n', 'First change');
  await repository.commit('two.txt', '2\n', 'Second change');
  await repository.commit('three.txt', '3\n', 'Third change');
  await openLoadedRepository(page, repository);
  await section(page, 'History').click();

  // Nothing is open yet: the keys only move the focus.
  await commit(page, 'Third change').focus();
  await page.keyboard.press('j');
  await expect(commit(page, 'Second change')).toBeFocused();
  await expect(heading(page, 'Second change')).toBeHidden();

  // Enter opens the commit and hands the keys to the viewer.
  await page.keyboard.press('Enter');
  await expect(heading(page, 'Second change')).toBeVisible();
  await expect(commit(page, 'Second change')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.viewer-pane-body')).toBeFocused();

  // In the viewer, j and k open the list's next and previous commit without going back to it.
  await page.keyboard.press('j');
  await expect(heading(page, 'First change')).toBeVisible();
  await expect(commit(page, 'First change')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('k');
  await page.keyboard.press('k');
  await expect(heading(page, 'Third change')).toBeVisible();

  // Back in the list, the arrows move and the viewer follows, as a click would.
  await commit(page, 'Third change').focus();
  await page.keyboard.press('ArrowDown');
  await expect(commit(page, 'Second change')).toBeFocused();
  await expect(heading(page, 'Second change')).toBeVisible();

  // Esc closes the viewer.
  await page.keyboard.press('Escape');
  await expect(heading(page, 'Second change')).toBeHidden();
  await expect(commit(page, 'Second change')).toHaveAttribute('aria-pressed', 'false');
  await expect(commit(page, 'Second change')).toBeFocused();
});

test('n and p move between the files of a commit, and Esc in the viewer returns to the commit’s row', async ({ pairedPage: page, repository }) => {
  // One commit that changes three files.
  for (const name of ['alpha', 'beta', 'gamma']) await writeFile(path.join(repository.path, `${name}.txt`), `${name}\n`);
  await repository.git('add', '.');
  await repository.git('commit', '-q', '-m', 'Add three files');
  await openLoadedRepository(page, repository);
  await section(page, 'History').click();

  await commit(page, 'Add three files').focus();
  await page.keyboard.press('Enter');
  await expect(heading(page, 'Add three files')).toBeVisible();
  const viewer = page.getByRole('main');
  const file = (name: string) => viewer.getByRole('button', { name: new RegExp(`^${name}\\.txt$`) });
  await expect(file('gamma')).toBeVisible();

  await page.keyboard.press('n');
  await expect(file('alpha')).toBeFocused();
  await page.keyboard.press('n');
  await expect(file('beta')).toBeFocused();
  await page.keyboard.press('n');
  await expect(file('gamma')).toBeFocused();
  await page.keyboard.press('p');
  await expect(file('beta')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(heading(page, 'Add three files')).toBeHidden();
  await expect(commit(page, 'Add three files')).toBeFocused();
});

test('g and a letter change section, and the focus lands in its list', async ({ pairedPage: page, repository }) => {
  await repository.commit('notes.txt', 'First line\n', 'Add the notes');
  await openLoadedRepository(page, repository);
  await expect(section(page, 'Files')).toHaveAttribute('aria-current', 'page');

  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('g');
  await page.keyboard.press('h');
  await expect(section(page, 'History')).toHaveAttribute('aria-current', 'page');
  await expect(commit(page, 'Add the notes')).toBeFocused();

  await page.keyboard.press('g');
  await page.keyboard.press('c');
  await expect(section(page, 'Changes')).toHaveAttribute('aria-current', 'page');
});

test('letters typed in a filter field are only text', async ({ pairedPage: page, repository }) => {
  await repository.commit('notes.txt', 'First line\n', 'Add the notes');
  await openLoadedRepository(page, repository);
  await section(page, 'History').click();

  const find = page.getByRole('searchbox', { name: 'Search loaded commits' });
  await find.click();
  await page.keyboard.type('gjkhnp?');
  await expect(find).toHaveValue('gjkhnp?');
  await expect(section(page, 'History')).toHaveAttribute('aria-current', 'page');
  await expect(heading(page, 'Add the notes')).toBeHidden();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(find).toBeFocused();
});

test('Enter opens a file from the Files tree, and the arrows move through it', async ({ pairedPage: page, repository }) => {
  await repository.commit('notes.txt', 'First line\n', 'Add the notes');
  await openLoadedRepository(page, repository);
  const tree = page.getByRole('tree', { name: 'Files' });

  // Files sorts names without regard to case: notes.txt, then README.md.
  await tree.getByRole('treeitem', { name: 'notes.txt' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(tree.getByRole('treeitem', { name: 'README.md' })).toBeFocused();
  await page.keyboard.press('k');
  await expect(tree.getByRole('treeitem', { name: 'notes.txt' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'notes.txt' })).toContainText('First line');
});
