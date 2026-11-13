import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { openRepository } from './support/app';
import { expect, test, type GitRepository } from './support/fixtures';

/** Opens the repository and shows its Files tree. */
async function openFiles(page: Page, repository: GitRepository): Promise<void> {
  await openRepository(page, repository);
  await page.getByRole('navigation', { name: 'Repository views' }).getByRole('button', { name: 'Files' }).click();
  await expect(page.getByRole('tree', { name: 'Files' }).getByRole('treeitem', { name: 'README.md' })).toBeVisible();
}

function fileTree(page: Page) {
  return page.getByRole('tree', { name: 'Files' });
}

function readText(repository: GitRepository, file: string): Promise<string> {
  return readFile(path.join(repository.path, file), 'utf8');
}

test('the Files tree browses into folders and previews a file', async ({ pairedPage: page, repository }) => {
  await repository.commit('src/lib/util.ts', 'export const answer = 42;\n', 'Add a utility');
  await openFiles(page, repository);

  const tree = fileTree(page);
  await expect(tree.getByRole('treeitem', { name: 'util.ts' })).toBeHidden();
  await tree.getByRole('treeitem', { name: 'src' }).click();
  await expect(tree.getByRole('treeitem', { name: 'src' })).toHaveAttribute('aria-expanded', 'true');
  await tree.getByRole('treeitem', { name: 'lib' }).click();
  await tree.getByRole('treeitem', { name: 'util.ts' }).click();

  const tabs = page.getByRole('tablist', { name: 'Open files' });
  await expect(tabs.getByRole('tab', { name: 'src/lib/util.ts, preview' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('textbox', { name: 'src/lib/util.ts' })).toContainText('export const answer = 42;');
});

test('previewing another file replaces the preview tab', async ({ pairedPage: page, repository }) => {
  await repository.commit('notes.txt', 'Some notes\n', 'Add notes');
  await openFiles(page, repository);

  const tree = fileTree(page);
  const tabs = page.getByRole('tablist', { name: 'Open files' });
  await tree.getByRole('treeitem', { name: 'notes.txt' }).click();
  await expect(tabs.getByRole('tab', { name: 'notes.txt, preview' })).toBeVisible();
  await tree.getByRole('treeitem', { name: 'README.md' }).click();

  await expect(tabs.getByRole('tab', { name: 'README.md, preview' })).toBeVisible();
  await expect(tabs.getByRole('tab')).toHaveCount(1);
});

test('an edited file is saved to disk with Ctrl+S', async ({ pairedPage: page, repository }) => {
  await repository.commit('notes.txt', 'First line\n', 'Add notes');
  await openFiles(page, repository);

  await fileTree(page).getByRole('treeitem', { name: 'notes.txt' }).click();
  const editor = page.getByRole('textbox', { name: 'notes.txt' });
  await expect(editor).toContainText('First line');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('Second line\n');

  const tabs = page.getByRole('tablist', { name: 'Open files' });
  await expect(tabs.getByRole('tab', { name: 'notes.txt, unsaved changes' })).toBeVisible();
  const save = page.getByRole('button', { name: 'Save file (Ctrl+S)' });
  await expect(save).toBeVisible();
  // Nothing reaches the disk until the user saves.
  expect(await readText(repository, 'notes.txt')).toBe('First line\n');

  await page.keyboard.press('Control+s');

  await expect(save).toBeHidden();
  await expect(tabs.getByRole('tab', { name: 'notes.txt', exact: true })).toBeVisible();
  await expect.poll(() => readText(repository, 'notes.txt')).toBe('First line\nSecond line\n');
  expect(await repository.git('status', '--porcelain')).toBe('M notes.txt');
});

test('an open file without edits shows changes made outside OpenTig', async ({ pairedPage: page, repository }) => {
  await repository.commit('notes.txt', 'Before\n', 'Add notes');
  await openFiles(page, repository);

  await fileTree(page).getByRole('treeitem', { name: 'notes.txt' }).click();
  const editor = page.getByRole('textbox', { name: 'notes.txt' });
  await expect(editor).toContainText('Before');
  await writeFile(path.join(repository.path, 'notes.txt'), 'Changed on disk\n');

  await expect(editor).toContainText('Changed on disk');
  await expect(editor).not.toContainText('Before');
});

test('a new file is created inside a folder from the Files context menu', async ({ pairedPage: page, repository }) => {
  await repository.commit('docs/index.md', '# Docs\n', 'Add docs');
  await openFiles(page, repository);

  await fileTree(page).getByRole('treeitem', { name: 'docs' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New File…' }).click();
  const dialog = page.getByRole('dialog', { name: 'New file' });
  await expect(dialog.getByText('docs', { exact: true })).toBeVisible();
  const name = dialog.getByRole('textbox', { name: 'File name' });
  // Names are single path segments; the parent comes from the clicked folder.
  await name.fill('nested/guide.md');
  await expect(dialog.getByRole('button', { name: 'Create' })).toBeDisabled();
  await name.fill('guide.md');
  await dialog.getByRole('button', { name: 'Create' }).click();

  await expect(dialog).toBeHidden();
  await expect(fileTree(page).getByRole('treeitem', { name: 'guide.md' })).toBeVisible();
  await expect.poll(() => existsSync(path.join(repository.path, 'docs', 'guide.md'))).toBe(true);
  expect(await readText(repository, 'docs/guide.md')).toBe('');
});

test('a file is renamed from the Files context menu', async ({ pairedPage: page, repository }) => {
  await repository.commit('notes.txt', 'Keep me\n', 'Add notes');
  await openFiles(page, repository);

  await fileTree(page).getByRole('treeitem', { name: 'notes.txt' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename F2' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename' });
  const name = dialog.getByRole('textbox', { name: 'New name' });
  await expect(name).toHaveValue('notes.txt');
  await name.fill('journal.txt');
  await dialog.getByRole('button', { name: 'Rename' }).click();

  await expect(fileTree(page).getByRole('treeitem', { name: 'journal.txt' })).toBeVisible();
  await expect(fileTree(page).getByRole('treeitem', { name: 'notes.txt' })).toBeHidden();
  await expect.poll(() => existsSync(path.join(repository.path, 'notes.txt'))).toBe(false);
  expect(await readText(repository, 'journal.txt')).toBe('Keep me\n');
});

test('a file is deleted after confirmation and the deletion can be undone', async ({ pairedPage: page, repository }) => {
  await repository.commit('notes.txt', 'Recover me\n', 'Add notes');
  await openFiles(page, repository);

  const tree = fileTree(page);
  await tree.getByRole('treeitem', { name: 'notes.txt' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete Del' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete item' });
  await expect(dialog.getByText('notes.txt')).toBeVisible();
  await dialog.getByRole('button', { name: 'Move to Trash' }).click();

  await expect(tree.getByRole('treeitem', { name: 'notes.txt' })).toBeHidden();
  await expect.poll(() => existsSync(path.join(repository.path, 'notes.txt'))).toBe(false);

  await tree.getByRole('treeitem', { name: 'README.md' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Undo/ }).click();

  await expect(tree.getByRole('treeitem', { name: 'notes.txt' })).toBeVisible();
  expect(await readText(repository, 'notes.txt')).toBe('Recover me\n');
});

/** Commits `content` to `file` as another author, so blame names someone other than the default tester. */
async function commitAs(repository: GitRepository, author: string, email: string, file: string, content: string, message: string): Promise<void> {
  await writeFile(path.join(repository.path, file), content);
  await repository.git('add', file);
  await repository.git('-c', `user.name=${author}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', message);
}

/** A rendered line of the open editor; Playwright reaches into the editor's shadow root. */
function editorLine(page: Page, line: number) {
  return page.locator(`[data-content] > [data-line="${line}"]`);
}

test('line blame names the commit of a hovered line and opens it in History', async ({ pairedPage: page, repository }) => {
  await repository.commit('notes.txt', 'First line\n', 'Add notes');
  await commitAs(repository, 'Grace Hopper', 'grace@example.com', 'notes.txt', 'First line\nSecond line\n', 'Explain the second step');
  await openFiles(page, repository);

  await fileTree(page).getByRole('treeitem', { name: 'notes.txt' }).click();
  await expect(page.getByRole('textbox', { name: 'notes.txt' })).toContainText('Second line');
  await editorLine(page, 1).hover();
  const ghost = page.locator('.line-blame-ghost');
  await expect(ghost).toHaveText(/^E2E Tester, .+ • Add notes$/);
  await editorLine(page, 2).hover();
  await expect(ghost).toHaveText(/^Grace Hopper, .+ • Explain the second step$/);

  // The ghost text ignores the pointer; resting over it opens the card.
  const box = await ghost.boundingBox();
  if (!box) throw new Error('The blame text has no position.');
  await page.mouse.move(box.x + 8, box.y + box.height / 2);
  const card = page.getByRole('dialog', { name: 'Line blame' });
  await expect(card).toBeVisible();
  await expect(card.getByText('Grace Hopper', { exact: true })).toBeVisible();
  await expect(card.getByText('grace@example.com')).toBeVisible();
  await expect(card.getByText('Explain the second step')).toBeVisible();
  const oid = await repository.git('rev-parse', '--short=7', 'HEAD');
  await expect(card.getByRole('code').filter({ hasText: oid })).toBeVisible();
  await card.getByRole('button', { name: 'Open in History' }).click();

  const list = page.getByRole('list', { name: 'Commit history' });
  await expect(list.getByRole('button', { name: 'Explain the second step', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('main').getByRole('heading', { name: 'Explain the second step', level: 2 })).toBeVisible();
});

test('an edited line reads "Not committed yet" and line blame can be turned off', async ({ pairedPage: page, repository }) => {
  await repository.commit('notes.txt', 'First line\nSecond line\n', 'Add notes');
  await openFiles(page, repository);

  await fileTree(page).getByRole('treeitem', { name: 'notes.txt' }).click();
  const editor = page.getByRole('textbox', { name: 'notes.txt' });
  await expect(editor).toContainText('Second line');
  // The caret's line shows its blame while the editor has focus.
  await editorLine(page, 1).click();
  await page.keyboard.press('End');
  const ghost = page.locator('.line-blame-ghost');
  await expect(ghost).toHaveText(/^E2E Tester, .+ • Add notes$/);
  // Move the pointer away so the caret's line, not the hovered one, is blamed.
  await page.getByRole('tree', { name: 'Files' }).hover();
  await page.keyboard.type(' edited');

  await expect(page.getByRole('tablist', { name: 'Open files' }).getByRole('tab', { name: 'notes.txt, unsaved changes' })).toBeVisible();
  await expect(ghost).toHaveText('Not committed yet');

  await page.getByRole('button', { name: 'Hide line blame' }).click();
  await expect(ghost).toBeHidden();
  await expect(page.getByRole('button', { name: 'Show line blame' })).toHaveAttribute('aria-pressed', 'false');

  // The choice is saved with the other preferences.
  await page.reload();
  await fileTree(page).getByRole('treeitem', { name: 'notes.txt' }).click();
  await expect(page.getByRole('button', { name: 'Show line blame' })).toHaveAttribute('aria-pressed', 'false');
});
