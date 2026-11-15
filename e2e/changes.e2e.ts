import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { colorPreview, colorSwatches, hoverCenter, openRepository } from './support/app';
import { expect, test, type GitRepository } from './support/fixtures';

/** A list of changes: the unlabeled one when nothing is staged, or "Staged" / "Not staged". */
function changeGroup(page: Page, name: 'Changes' | 'Staged' | 'Not staged') {
  return page.getByRole('tree', { name, exact: true });
}

/** A file's row in a change group. Its accessible name starts with the row's main button. */
function changeRow(page: Page, group: 'Changes' | 'Staged' | 'Not staged', file: string) {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return changeGroup(page, group).getByRole('treeitem', { name: new RegExp(`^View changes for ${escaped} `) });
}

/**
 * Clicks one of a row's hover controls. They replace the status letter only
 * while the pointer is over the row, as a user would see them.
 */
async function clickRowAction(row: Locator, name: string): Promise<void> {
  await row.hover();
  await row.getByRole('button', { name, exact: true }).click();
}

async function openChanges(page: Page, count: number): Promise<void> {
  const views = page.getByRole('navigation', { name: 'Repository views' });
  await views.getByRole('button', { name: /^Changes/ }).click();
  await expect(views.getByRole('button', { name: `Changes ${count}` })).toBeVisible();
}

async function write(repository: GitRepository, file: string, content: string): Promise<void> {
  await writeFile(path.join(repository.path, file), content);
}

async function stagedFiles(repository: GitRepository): Promise<string> {
  return repository.git('diff', '--cached', '--name-only');
}

test('a modified file opens as a diff, and the split view choice is remembered', async ({ pairedPage: page, repository }) => {
  await repository.commit('src/app.js', 'const a = 1;\nconst b = 2;\n', 'Add app');
  await write(repository, 'src/app.js', 'const a = 1;\nconst b = 3;\n');
  await openRepository(page, repository);
  await openChanges(page, 1);

  await expect(changeRow(page, 'Changes', 'src/app.js')).toContainText('M');
  await page.getByRole('button', { name: 'View changes for src/app.js' }).click();
  const code = page.getByRole('code');
  await expect(code).toHaveCount(1);
  await expect(code).toContainText('const b = 2;');
  await expect(code).toContainText('const b = 3;');

  // Split mode shows the old and new sides next to each other.
  await page.getByRole('button', { name: 'Use split diff' }).click();
  await expect(page.getByRole('button', { name: 'Use unified diff' })).toHaveAttribute('aria-pressed', 'true');
  await expect(code).toHaveCount(2);
  await expect(code.first()).toContainText('const b = 2;');
  await expect(code.first()).not.toContainText('const b = 3;');
  await expect(code.last()).toContainText('const b = 3;');

  await page.reload();
  await openChanges(page, 1);
  await page.getByRole('button', { name: 'View changes for src/app.js' }).click();
  await expect(page.getByRole('button', { name: 'Use unified diff' })).toBeVisible();
  await expect(code).toHaveCount(2);
});

test('a changed HTML file opens as a diff, and Open file shows its preview', async ({ pairedPage: page, repository }) => {
  await repository.commit('index.html', '<!doctype html>\n<title>Sample</title>\n<h1>Before</h1>\n', 'Add page');
  await write(repository, 'index.html', '<!doctype html>\n<title>Sample</title>\n<h1>After</h1>\n');
  await openRepository(page, repository);
  await openChanges(page, 1);

  // The row's main action is the diff, as for any other text file.
  await page.getByRole('button', { name: 'View changes for index.html' }).click();
  const code = page.getByRole('code');
  await expect(code).toContainText('<h1>Before</h1>');
  await expect(code).toContainText('<h1>After</h1>');
  await expect(page.getByTitle('Preview of index.html')).toBeHidden();

  // The rendered page stays one step away.
  await clickRowAction(changeRow(page, 'Changes', 'index.html'), 'Open file');
  // The file's own tab above is named "index.html, preview", so only the exact name is the viewer's.
  await expect(page.getByRole('tab', { name: 'Preview', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTitle('Preview of index.html')).toBeVisible();
});

test('a single file can be staged and unstaged without touching the others', async ({ pairedPage: page, repository }) => {
  await repository.commit('notes.txt', 'first\n', 'Add notes');
  await write(repository, 'README.md', '# Sample project\n\nEdited.\n');
  await write(repository, 'notes.txt', 'second\n');
  await openRepository(page, repository);
  await openChanges(page, 2);
  // With nothing staged there is one unlabeled list.
  await expect(changeGroup(page, 'Staged')).toBeHidden();

  await clickRowAction(changeRow(page, 'Changes', 'notes.txt'), 'Stage changes');

  await expect(changeRow(page, 'Staged', 'notes.txt')).toBeVisible();
  await expect(changeRow(page, 'Not staged', 'README.md')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Create commit' }).getByRole('button', { name: 'Commit 1 file' })).toBeVisible();
  await expect.poll(() => stagedFiles(repository)).toBe('notes.txt');

  await clickRowAction(changeRow(page, 'Staged', 'notes.txt'), 'Unstage changes');

  await expect(changeGroup(page, 'Staged')).toBeHidden();
  await expect(changeRow(page, 'Changes', 'notes.txt')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Create commit' })).toBeHidden();
  await expect.poll(() => stagedFiles(repository)).toBe('');
  // Unstaging keeps the edit in the working tree.
  expect(await readFile(path.join(repository.path, 'notes.txt'), 'utf8')).toBe('second\n');
});

test('staging a folder stages every file in it, and the Staged group can be unstaged at once', async ({ pairedPage: page, repository }) => {
  await repository.commit('src/a.js', 'export const a = 1;\n', 'Add a');
  await repository.commit('src/b.js', 'export const b = 1;\n', 'Add b');
  await write(repository, 'src/a.js', 'export const a = 2;\n');
  await write(repository, 'src/b.js', 'export const b = 2;\n');
  await write(repository, 'README.md', '# Sample project\n\nEdited.\n');
  await openRepository(page, repository);
  await openChanges(page, 3);

  const folder = changeGroup(page, 'Changes').getByRole('treeitem', { name: /^Collapse folder src / });
  await clickRowAction(folder, 'Stage changes');

  await expect(changeRow(page, 'Staged', 'src/a.js')).toBeVisible();
  await expect(changeRow(page, 'Staged', 'src/b.js')).toBeVisible();
  await expect(changeRow(page, 'Not staged', 'README.md')).toBeVisible();
  await expect.poll(() => stagedFiles(repository)).toBe('src/a.js\nsrc/b.js');

  // The top line still offers Stage all; the Staged label holds its own Unstage all.
  await expect(page.getByRole('button', { name: 'Stage all', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Unstage all' }).click();

  await expect(changeGroup(page, 'Staged')).toBeHidden();
  await expect.poll(() => stagedFiles(repository)).toBe('');
});

test('discarding a modified file asks first and then restores its committed content', async ({ pairedPage: page, repository }) => {
  await write(repository, 'README.md', '# Sample project\n\nA mistake.\n');
  await openRepository(page, repository);
  await openChanges(page, 1);

  const row = changeRow(page, 'Changes', 'README.md');
  await clickRowAction(row, 'Discard changes');
  const dialog = page.getByRole('dialog', { name: 'Discard changes' });
  await expect(dialog).toContainText('These local changes will be lost.');
  await expect(dialog).toContainText('README.md');

  // Cancelling leaves the change alone.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toBeVisible();
  expect(await readFile(path.join(repository.path, 'README.md'), 'utf8')).toBe('# Sample project\n\nA mistake.\n');

  await clickRowAction(row, 'Discard changes');
  await dialog.getByRole('button', { name: 'Discard' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText('No changes', { exact: true })).toBeVisible();
  expect(await readFile(path.join(repository.path, 'README.md'), 'utf8')).toBe('# Sample project\n');
  expect(await repository.git('status', '--porcelain')).toBe('');
});

test('discarding a new untracked file removes it from the working tree', async ({ pairedPage: page, repository }) => {
  await write(repository, 'scratch.txt', 'temporary\n');
  await openRepository(page, repository);
  await openChanges(page, 1);

  const row = changeRow(page, 'Changes', 'scratch.txt');
  await expect(row).toContainText('U');
  await clickRowAction(row, 'Discard changes');
  const dialog = page.getByRole('dialog', { name: 'Discard changes' });
  await expect(dialog).toContainText('Untracked files will be moved to system Trash.');
  await dialog.getByRole('button', { name: 'Discard' }).click();

  await expect(page.getByText('No changes', { exact: true })).toBeVisible();
  expect(existsSync(path.join(repository.path, 'scratch.txt'))).toBe(false);
  expect(await repository.git('status', '--porcelain')).toBe('');
});

test('a deleted file can be staged and committed', async ({ pairedPage: page, repository }) => {
  await repository.commit('old.txt', 'obsolete\n', 'Add old file');
  await rm(path.join(repository.path, 'old.txt'));
  await openRepository(page, repository);
  await openChanges(page, 1);

  const row = changeRow(page, 'Changes', 'old.txt');
  await expect(row).toContainText('D');
  await clickRowAction(row, 'Stage changes');
  await expect(changeRow(page, 'Staged', 'old.txt')).toContainText('D');

  const commitBox = page.getByRole('group', { name: 'Create commit' });
  await commitBox.getByRole('textbox', { name: 'Commit message' }).fill('Remove the old file');
  await commitBox.getByRole('button', { name: 'Commit 1 file' }).click();

  await expect(page.getByText('No changes', { exact: true })).toBeVisible();
  await expect.poll(() => repository.git('log', '-1', '--format=%s')).toBe('Remove the old file');
  expect(await repository.git('ls-files', 'old.txt')).toBe('');
  expect(await repository.git('show', '--name-status', '--format=', 'HEAD')).toBe('D\told.txt');
});

test('the commit shortcut commits only staged files with a multi-line message', async ({ pairedPage: page, repository }) => {
  await write(repository, 'README.md', '# Sample project\n\nEdited.\n');
  await write(repository, 'feature.txt', 'new feature\n');
  await openRepository(page, repository);
  await openChanges(page, 2);

  await clickRowAction(changeRow(page, 'Changes', 'feature.txt'), 'Stage changes');
  await expect(changeRow(page, 'Staged', 'feature.txt')).toContainText('A');

  const commitBox = page.getByRole('group', { name: 'Create commit' });
  const message = commitBox.getByRole('textbox', { name: 'Commit message' });
  await message.fill('Add the feature\n\nExplain why it exists.\nAnd how to use it.');
  await message.press('ControlOrMeta+Enter');

  await expect(changeGroup(page, 'Staged')).toBeHidden();
  await expect(changeRow(page, 'Changes', 'README.md')).toBeVisible();
  await expect.poll(() => repository.git('log', '-1', '--format=%B')).toBe('Add the feature\n\nExplain why it exists.\nAnd how to use it.');
  expect(await repository.git('show', '--name-only', '--format=', 'HEAD')).toBe('feature.txt');
  // The unstaged edit stays out of the commit and in the working tree.
  expect(await repository.git('diff', '--name-only')).toBe('README.md');
  expect(await stagedFiles(repository)).toBe('');
});

test('choosing Commit and push only changes the button, which then commits and pushes', async ({ pairedPage: page, repository }) => {
  await repository.addRemote();
  await write(repository, 'README.md', '# Sample project\n\nShipped.\n');
  await openRepository(page, repository);
  await openChanges(page, 1);
  await page.getByRole('button', { name: 'Stage all' }).click();

  const commitBox = page.getByRole('group', { name: 'Create commit' });
  await commitBox.getByRole('textbox', { name: 'Commit message' }).fill('Ship the readme');
  await commitBox.getByRole('button', { name: 'Choose the commit action' }).click();
  const menu = page.getByRole('menu', { name: 'Choose the commit action' });
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Commit', exact: true })).toBeChecked();
  await menu.getByRole('menuitemcheckbox', { name: 'Commit and push' }).click();

  await expect(menu).toBeHidden();
  const button = commitBox.getByRole('button', { name: 'Commit and push' });
  await expect(button).toBeVisible();
  // Choosing the action runs nothing.
  expect(await repository.git('log', '-1', '--format=%s')).toBe('Initial commit');

  await button.click();

  await expect(page.getByText('Nothing to review or commit.')).toBeVisible();
  await expect.poll(() => repository.git('log', '-1', '--format=%s')).toBe('Ship the readme');
  const head = await repository.git('rev-parse', 'HEAD');
  await expect.poll(async () => (await repository.git('ls-remote', 'origin', 'refs/heads/main')).split('\t')[0]).toBe(head);
});

test.describe('a suggested split into several commits', () => {
  // No AI CLI is contacted: a stand-in answers with this plan for the two files the journeys stage.
  test.use({
    aiAnswer: {
      subject: 'feat: add search with its guide',
      body: '',
      rationale: 'The feature and its guide can be reviewed on their own.',
      commits: [
        { subject: 'feat: add search', body: 'Find tasks by title.', reason: 'The feature.', paths: ['search.js'] },
        { subject: 'docs: describe search', body: '', reason: 'The guide.', paths: ['guide.md'] },
      ],
    },
  });

  async function generatePlan(page: Page, repository: GitRepository): Promise<Locator> {
    await write(repository, 'search.js', 'export const search = () => [];\n');
    await write(repository, 'guide.md', '# Search\n');
    await openRepository(page, repository);
    await openChanges(page, 2);
    await page.getByRole('button', { name: 'Stage all', exact: true }).click();
    await expect.poll(() => stagedFiles(repository)).toBe('guide.md\nsearch.js');
    const commitBox = page.getByRole('group', { name: 'Create commit' });
    await commitBox.getByRole('button', { name: /^Generate with Codex/ }).click();
    // The suggestion changes nothing by itself: one commit stays chosen and everything stays staged.
    const mode = commitBox.getByRole('group', { name: 'How to commit the staged files' });
    await expect(mode.getByRole('button', { name: 'One commit' })).toHaveAttribute('aria-pressed', 'true');
    await expect(commitBox.getByRole('textbox', { name: 'Commit message' })).toHaveValue('feat: add search with its guide');
    await expect(commitBox.getByRole('button', { name: 'Commit 2 files' })).toBeEnabled();
    expect(await stagedFiles(repository)).toBe('guide.md\nsearch.js');
    return commitBox;
  }

  test('following the plan creates each commit with its own files and message', async ({ pairedPage: page, repository }) => {
    const commitBox = await generatePlan(page, repository);

    await commitBox.getByRole('button', { name: 'Split into 2' }).click();
    const first = commitBox.getByRole('button', { name: 'Commit 1 of 2 · 1 file' });
    await expect(first).toBeEnabled();
    await expect(commitBox.getByRole('textbox', { name: 'Message for commit 1 of 2' })).toHaveValue('feat: add search\n\nFind tasks by title.');
    expect(await stagedFiles(repository)).toBe('search.js');
    await expect(changeRow(page, 'Not staged', 'guide.md')).toBeVisible();

    // Committing one group stages the next, so the same place offers the next commit.
    await first.click();
    const second = commitBox.getByRole('button', { name: 'Commit 2 of 2 · 1 file' });
    await expect(second).toBeEnabled();
    await expect(commitBox.getByText('1 of 2 committed', { exact: true })).toBeVisible();
    await expect(commitBox.getByRole('button', { name: 'One commit' })).toBeDisabled();
    expect(await repository.git('log', '-1', '--format=%B')).toBe('feat: add search\n\nFind tasks by title.');
    expect(await stagedFiles(repository)).toBe('guide.md');

    await second.click();
    await expect(commitBox.getByText('2 commits created')).toBeVisible();
    expect(await repository.git('log', '-3', '--format=%s')).toBe('docs: describe search\nfeat: add search\nInitial commit');
    expect(await repository.git('show', '--name-only', '--format=', 'HEAD~1')).toBe('search.js');
    expect(await repository.git('show', '--name-only', '--format=', 'HEAD')).toBe('guide.md');
    expect(await repository.git('status', '--porcelain')).toBe('');
  });

  test('staging by hand pauses the plan with the reason, and discarding it stages everything back', async ({ pairedPage: page, repository }) => {
    const commitBox = await generatePlan(page, repository);
    await commitBox.getByRole('button', { name: 'Split into 2' }).click();
    await expect(commitBox.getByRole('button', { name: 'Commit 1 of 2 · 1 file' })).toBeEnabled();

    await clickRowAction(changeRow(page, 'Not staged', 'guide.md'), 'Stage changes');
    const paused = commitBox.getByRole('alert');
    await expect(paused).toContainText('Commit plan paused. You changed the staged files by hand.');
    await expect(commitBox.getByRole('button', { name: 'Commit 2 files' })).toBeVisible();

    await paused.getByRole('button', { name: 'Resume plan' }).click();
    await expect(commitBox.getByRole('button', { name: 'Commit 1 of 2 · 1 file' })).toBeEnabled();
    expect(await stagedFiles(repository)).toBe('search.js');

    await commitBox.getByRole('button', { name: 'Discard plan' }).click();
    await expect(commitBox.getByRole('alert')).toContainText('All 2 files will be staged again');
    await commitBox.getByRole('alert').getByRole('button', { name: 'Discard plan' }).click();
    await expect(commitBox.getByText('Plan discarded. All 2 files are staged again.')).toBeVisible();
    await expect(commitBox.getByRole('button', { name: 'Commit 2 files' })).toBeEnabled();
    expect(await stagedFiles(repository)).toBe('guide.md\nsearch.js');
    expect(await repository.git('log', '-1', '--format=%s')).toBe('Initial commit');
  });
});

test('undoing a commit keeps the draft in the commit box and offers the undone message', async ({ pairedPage: page, repository }) => {
  // Undo is offered only for a commit that its upstream doesn't have yet.
  await repository.addRemote();
  await repository.commit('notes.txt', 'remember this\n', 'Add notes');
  const shortOid = await repository.git('rev-parse', '--short', 'HEAD');
  await write(repository, 'draft.txt', 'work in progress\n');
  await openRepository(page, repository);
  await openChanges(page, 1);
  await clickRowAction(changeRow(page, 'Changes', 'draft.txt'), 'Stage changes');
  const message = page.getByRole('group', { name: 'Create commit' }).getByRole('textbox', { name: 'Commit message' });
  await message.fill('My draft');

  await page.getByRole('navigation', { name: 'Repository views' }).getByRole('button', { name: 'History' }).click();
  await page.getByRole('listitem').filter({ hasText: 'Add notes' }).hover();
  await page.getByRole('button', { name: `Undo commit ${shortOid}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Undo the last local commit?' });
  await dialog.getByRole('button', { name: 'Undo and stage changes' }).click();
  await expect(dialog).toBeHidden();

  // Changes opens with both the undone and the already staged files, and the draft untouched.
  await expect(changeRow(page, 'Staged', 'notes.txt')).toBeVisible();
  await expect(changeRow(page, 'Staged', 'draft.txt')).toBeVisible();
  await expect(message).toHaveValue('My draft');
  await expect.poll(() => repository.git('log', '-1', '--format=%s')).toBe('Initial commit');
  expect(await stagedFiles(repository)).toBe('draft.txt\nnotes.txt');

  await page.getByRole('button', { name: 'Use previous message' }).click();
  await expect(message).toHaveValue('Add notes');
});

test('a clean worktree says there are no changes and offers to push unpushed commits', async ({ pairedPage: page, repository }) => {
  await repository.addRemote();
  await repository.commit('notes.txt', 'local only\n', 'Add local notes');
  await openRepository(page, repository);
  await page.getByRole('navigation', { name: 'Repository views' }).getByRole('button', { name: /^Changes/ }).click();

  await expect(page.getByText('No changes', { exact: true })).toBeVisible();
  await expect(page.getByText('1 commit isn\'t pushed yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Push it' }).click();

  await expect(page.getByText('Nothing to review or commit.')).toBeVisible();
  const head = await repository.git('rev-parse', 'HEAD');
  await expect.poll(async () => (await repository.git('ls-remote', 'origin', 'refs/heads/main')).split('\t')[0]).toBe(head);
});

test('a stylesheet diff shows swatches on both sides of a changed color', async ({ pairedPage: page, repository }) => {
  await repository.commit('styles/button.css', '.button {\n  color: #3b82f6;\n}\n', 'Add button');
  await write(repository, 'styles/button.css', '.button {\n  color: rebeccapurple;\n}\n');
  await openRepository(page, repository);
  await openChanges(page, 1);

  await page.getByRole('button', { name: 'View changes for styles/button.css' }).click();
  const code = page.getByRole('code');
  await expect(code).toContainText('rebeccapurple');

  // The deleted and the added value each get a swatch; named colors count in stylesheets.
  const swatches = colorSwatches(page);
  await expect(swatches).toHaveCount(2);
  await expect(swatches.nth(0)).toHaveCSS('background-color', 'rgb(59, 130, 246)');
  await expect(swatches.nth(1)).toHaveCSS('background-color', 'rgb(102, 51, 153)');

  // Pierre redraws the lines once highlighting arrives; the preview follows them.
  await code.getByText('rebeccapurple', { exact: true }).hover();
  await expect(colorPreview(page, 'rebeccapurple')).toBeVisible();
  await hoverCenter(page, swatches.nth(0));
  await expect(colorPreview(page, '#3b82f6')).toBeVisible();
});
