import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { colorPreview, colorSwatches, hoverCenter, openRepository } from './support/app';
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

test('a JSON syntax error is shown inline and clears once the file is fixed', async ({ pairedPage: page, repository }) => {
  await repository.commit('config/settings.json', '{\n  "name": "demo"\n}\nassa\n', 'Add settings');
  await openFiles(page, repository);

  const tree = fileTree(page);
  await tree.getByRole('treeitem', { name: 'config' }).click();
  await tree.getByRole('treeitem', { name: 'settings.json' }).click();
  const editor = page.getByRole('textbox', { name: 'config/settings.json' });
  await expect(editor).toContainText('assa');

  const problem = page.getByText('End of file expected.', { exact: true });
  await expect(problem).toBeVisible();
  await problem.hover();
  await expect(page.getByText('JSON error · Line 4, column 1')).toBeVisible();

  // Delete the stray last line by typing, then save.
  await editor.click();
  await page.keyboard.press('Control+End');
  for (let index = 0; index < 'assa\n'.length; index += 1) await page.keyboard.press('Backspace');
  await expect(problem).toBeHidden();
  await page.keyboard.press('Control+s');

  await expect(page.getByRole('button', { name: 'Save file (Ctrl+S)' })).toBeHidden();
  await expect.poll(() => readText(repository, 'config/settings.json')).toBe('{\n  "name": "demo"\n}\n');
  expect(JSON.parse(await readText(repository, 'config/settings.json'))).toEqual({ name: 'demo' });
});

test('a YAML file with a duplicate key shows the problem inline', async ({ pairedPage: page, repository }) => {
  await repository.commit('deploy.yml', 'name: build\nsteps: []\nname: again\n', 'Add deploy config');
  await openFiles(page, repository);

  await fileTree(page).getByRole('treeitem', { name: 'deploy.yml' }).click();
  await expect(page.getByRole('textbox', { name: 'deploy.yml' })).toContainText('name: again');

  const problem = page.getByText('Map keys must be unique.', { exact: true });
  await expect(problem).toBeVisible();
  await problem.hover();
  await expect(page.getByText('YAML error · Line 3, column 1')).toBeVisible();
});

test('comments are flagged in strict JSON but accepted in tsconfig.json', async ({ pairedPage: page, repository }) => {
  const withComment = '{\n  // Strict checks\n  "strict": true,\n}\n';
  await repository.commit('data.json', withComment, 'Add data');
  await repository.commit('tsconfig.json', withComment, 'Add tsconfig');
  await openFiles(page, repository);

  const tree = fileTree(page);
  await tree.getByRole('treeitem', { name: 'data.json' }).click();
  await expect(page.getByText('Comments are not permitted in JSON.', { exact: true })).toBeVisible();
  await expect(page.getByText('Trailing comma.', { exact: true })).toBeVisible();

  await tree.getByRole('treeitem', { name: 'tsconfig.json' }).click();
  await expect(page.getByRole('textbox', { name: 'tsconfig.json' })).toContainText('Strict checks');
  await expect(page.getByText('Comments are not permitted in JSON.', { exact: true })).toBeHidden();
  await expect(page.getByText('Trailing comma.', { exact: true })).toBeHidden();
});

test('a stylesheet shows a swatch before each color and previews the hovered color', async ({ pairedPage: page, repository }) => {
  await repository.commit('styles/theme.css', [
    ':root {',
    '  --brand: #3b82f6;',
    '  --ring: oklch(0.7 0.1 195);',
    '  --shadow: rgb(15 23 42 / 45%);',
    '  --accent: rebeccapurple;',
    '  --tight:#fff;',
    '  --gap: 4px;',
    '}',
    '',
  ].join('\n'), 'Add theme');
  await openFiles(page, repository);
  await fileTree(page).getByRole('treeitem', { name: 'styles' }).click();
  await fileTree(page).getByRole('treeitem', { name: 'theme.css' }).click();
  const editor = page.getByRole('textbox', { name: 'styles/theme.css' });
  await expect(editor).toContainText('--brand');

  // One swatch per color with a space before it; `--tight:#fff` has no room for one.
  const swatches = colorSwatches(page);
  await expect(swatches).toHaveCount(4);
  await expect(swatches.nth(0)).toHaveCSS('background-color', 'rgb(59, 130, 246)');
  await expect(swatches.nth(1)).toHaveCSS('background-color', 'oklch(0.7 0.1 195)');
  await expect(swatches.nth(2)).toHaveCSS('background-color', 'rgba(15, 23, 42, 0.45)');
  await expect(swatches.nth(3)).toHaveCSS('background-color', 'rgb(102, 51, 153)');

  // Resting on any part of a value previews the whole value.
  await editor.getByText('oklch', { exact: true }).hover();
  await expect(colorPreview(page, 'oklch(0.7 0.1 195)')).toBeVisible();

  // The swatch on the line above, under the open preview, switches it to its color.
  await hoverCenter(page, swatches.nth(0));
  await expect(colorPreview(page, '#3b82f6')).toBeVisible();
  await expect(colorPreview(page, 'oklch(0.7 0.1 195)')).toBeHidden();

  await fileTree(page).getByRole('treeitem', { name: 'README.md' }).hover();
  await expect(colorPreview(page, '#3b82f6')).toBeHidden();
});
