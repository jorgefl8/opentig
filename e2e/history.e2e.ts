import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Locator, Page } from '@playwright/test';
import { openRepository } from './support/app';
import { expect, test, type GitRepository } from './support/fixtures';

const execFileAsync = promisify(execFile);

/** Opens the repository and switches the sidebar to History. */
async function openHistory(page: Page, repository: GitRepository) {
  await openRepository(page, repository);
  await page.getByRole('navigation', { name: 'Repository views' }).getByRole('button', { name: 'History' }).click();
  const list = page.getByRole('list', { name: 'Commit history' });
  await expect(list).toBeVisible();
  return list;
}

function commitRow(list: Locator, subject: string) {
  return list.getByRole('listitem').filter({ has: list.page().getByRole('button', { name: subject, exact: true }) });
}

/** Appends `count` empty commits to main in one `git fast-import` run. */
async function appendEmptyCommits(repository: GitRepository, count: number, subject: (index: number) => string) {
  const now = Math.floor(Date.now() / 1000);
  let stream = '';
  for (let index = 1; index <= count; index++) {
    const message = `${subject(index)}\n`;
    stream += `commit refs/heads/main\ncommitter E2E Tester <e2e@example.com> ${now} +0000\ndata ${Buffer.byteLength(message)}\n${message}`;
    stream += index === 1 ? 'from refs/heads/main^0\n\n' : '\n';
  }
  const child = execFileAsync('git', ['fast-import', '--quiet'], { cwd: repository.path });
  child.child.stdin!.end(stream);
  await child;
}

test('history lists commits newest first with their branch and tag names', async ({ pairedPage: page, repository }) => {
  await repository.commit('src/app.js', 'const a = 1;\n', 'Add the app entry point');
  await repository.git('tag', 'v0.1.0');
  await repository.commit('docs/guide.md', '# Guide\n', 'Write the user guide');

  const list = await openHistory(page, repository);

  const subjects = list.getByRole('listitem').getByRole('button', { name: /^(Write the user guide|Add the app entry point|Initial commit)$/ });
  await expect(subjects).toHaveText(['Write the user guide', 'Add the app entry point', 'Initial commit']);

  const head = await repository.git('rev-parse', '--short=7', 'HEAD');
  const latest = commitRow(list, 'Write the user guide');
  await expect(latest.getByRole('button', { name: `Copy hash ${head}` })).toBeVisible();
  await expect(latest).toContainText('main');
  await expect(latest).toContainText('E2E Tester');
  await expect(commitRow(list, 'Add the app entry point')).toContainText('v0.1.0');
});

test('opening a commit shows its message, changed files, and diff', async ({ pairedPage: page, repository }) => {
  await repository.commit('src/app.js', 'const a = 1;\n', 'Add the app entry point');
  await repository.commit('src/app.js', 'const a = 2;\nconst b = 3;\n', 'Tune the app constants\n\nFirst body line.\nSecond body line.\nThird body line.\nFourth body line.\nFifth body line.');
  await repository.commit('docs/guide.md', '# Guide\n', 'Write the user guide');
  const oid = await repository.git('rev-parse', '--short=7', 'HEAD~1');

  const list = await openHistory(page, repository);
  await list.getByRole('button', { name: 'Tune the app constants', exact: true }).click();
  await expect(list.getByRole('button', { name: 'Tune the app constants', exact: true })).toHaveAttribute('aria-pressed', 'true');

  const viewer = page.getByRole('main');
  await expect(viewer.getByRole('heading', { name: 'Tune the app constants', level: 2 })).toBeVisible();
  await expect(viewer.getByRole('code').filter({ hasText: new RegExp(`^${oid}$`) })).toBeVisible();
  await expect(viewer.getByText(/First body line\./)).toBeVisible();
  // A long message starts folded and opens on request.
  await viewer.getByRole('button', { name: 'Show full description' }).click();
  await expect(viewer.getByText(/Fifth body line\./)).toBeVisible();

  // The commit's only file starts folded; its header unfolds the diff.
  const file = viewer.getByRole('button', { name: /^src\/\s*app\.js$/ });
  await expect(file).toBeVisible();
  await expect(viewer.getByText(/^\+2−1$/)).toBeVisible();
  if (await file.getAttribute('aria-expanded') !== 'true') await file.click();
  await expect(file).toHaveAttribute('aria-expanded', 'true');
  await expect(viewer.getByRole('code').filter({ hasText: 'const b = 3;' })).toBeVisible();
  await file.click();
  await expect(file).toHaveAttribute('aria-expanded', 'false');
  await expect(viewer.getByRole('code').filter({ hasText: 'const b = 3;' })).toBeHidden();
});

test('a single file picked from an expanded commit opens alone, including a rename', async ({ pairedPage: page, repository }) => {
  await repository.git('mv', 'README.md', 'README.txt');
  await repository.commit('docs/guide.md', '# Guide\n', 'Rename the readme and add a guide');

  const list = await openHistory(page, repository);
  const row = commitRow(list, 'Rename the readme and add a guide');
  // The chevron appears when the row is hovered or focused.
  await row.hover();
  await row.getByRole('button', { name: 'Expand commit' }).click();
  await expect(row.getByRole('button', { name: 'Collapse commit' })).toHaveAttribute('aria-expanded', 'true');
  await expect(row).toContainText('2 files');

  await row.getByRole('button', { name: 'Open the diff of docs/guide.md' }).click();
  const viewer = page.getByRole('main');
  await expect(viewer.getByRole('heading', { name: 'Rename the readme and add a guide', level: 2 })).toBeVisible();
  await expect(viewer.getByRole('button', { name: /^docs\/\s*guide\.md$/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(viewer.getByRole('code').filter({ hasText: '# Guide' })).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'README.txt', exact: true })).toBeHidden();

  await row.getByRole('button', { name: 'Open the diff of README.txt' }).click();
  await expect(viewer.getByRole('button', { name: 'README.txt', exact: true })).toBeVisible();
  await expect(viewer.getByText('from README.md')).toBeVisible();

  await viewer.getByRole('button', { name: 'All files' }).click();
  await expect(viewer.getByRole('button', { name: 'All files' })).toBeHidden();
  await expect(viewer.getByRole('button', { name: 'README.txt', exact: true })).toBeVisible();
  await expect(viewer.getByRole('button', { name: /^docs\/\s*guide\.md$/ })).toBeVisible();
});

test('searching history counts matches and moves between them', async ({ pairedPage: page, repository }) => {
  await repository.commit('src/app.js', 'const a = 1;\n', 'Add the app entry point');
  await repository.commit('docs/guide.md', '# Guide\n', 'Write the user guide');
  await repository.commit('src/app.js', 'const a = 2;\n', 'Tune the app constants');

  await openHistory(page, repository);
  const search = page.getByRole('searchbox', { name: 'Search loaded commits' });
  const count = page.getByRole('status').filter({ hasText: /match|of/ });

  await search.fill('app');
  await expect(count).toHaveText('2 matches');
  await search.press('Enter');
  await expect(count).toHaveText('1 of 2');
  await page.getByRole('button', { name: 'Next matching commit' }).click();
  await expect(count).toHaveText('2 of 2');
  await search.press('Enter');
  await expect(count).toHaveText('1 of 2');

  // Hashes are searchable too.
  await search.fill(await repository.git('rev-parse', '--short=7', 'HEAD~1'));
  await expect(count).toHaveText('1 match');

  await search.fill('no commit says this');
  await expect(count).toHaveText('0 matches');
  await expect(page.getByRole('button', { name: 'Next matching commit' })).toBeDisabled();
});

test('load more adds older commits to the history that search covers', async ({ pairedPage: page, repository }) => {
  // One page holds 100 commits; these push the initial commit onto the second.
  await appendEmptyCommits(repository, 101, (index) => `Routine change ${index}`);

  const list = await openHistory(page, repository);
  await expect(list.getByRole('button', { name: 'Routine change 101', exact: true })).toBeVisible();
  const search = page.getByRole('searchbox', { name: 'Search loaded commits' });
  const count = page.getByRole('status').filter({ hasText: /match|of/ });
  await search.fill('Initial commit');
  await expect(count).toHaveText('0 matches');

  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(count).toHaveText('1 match');
  await search.press('Enter');
  await expect(list.getByRole('button', { name: 'Initial commit', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load more' })).toBeHidden();
});

test('group merges folds a merged side branch under its merge commit', async ({ pairedPage: page, repository }) => {
  await repository.git('checkout', '-q', '-b', 'feature');
  await repository.commit('feature.txt', 'feature\n', 'Build the feature');
  await repository.git('checkout', '-q', 'main');
  await repository.commit('main.txt', 'main\n', 'Keep main moving');
  await repository.git('merge', '-q', '--no-ff', '-m', 'Merge the feature branch', 'feature');

  const list = await openHistory(page, repository);
  await expect(list.getByRole('img', { name: /^Merge commit/ })).toBeVisible();
  await expect(list.getByRole('button', { name: 'Build the feature', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'History options' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Group merges' }).click();
  await page.keyboard.press('Escape');
  await expect(list.getByRole('button', { name: 'Build the feature', exact: true })).toBeHidden();
  await expect(list.getByRole('button', { name: 'Keep main moving', exact: true })).toBeVisible();

  await commitRow(list, 'Merge the feature branch').getByRole('button', { name: '1 grouped' }).click();
  await expect(list.getByRole('button', { name: 'Build the feature', exact: true })).toBeVisible();

  // The merge commit has no changes of its own and says so.
  await list.getByRole('button', { name: 'Merge the feature branch', exact: true }).click();
  await expect(page.getByText('This merge commit has no changes of its own.')).toBeVisible();
});

test('the latest local commit can be undone, leaving its changes staged', async ({ pairedPage: page, repository }) => {
  await repository.addRemote();
  await repository.commit('src/app.js', 'const a = 1;\n', 'Add the app entry point');
  const initial = await repository.git('rev-parse', 'HEAD~1');

  const list = await openHistory(page, repository);
  const local = commitRow(list, 'Add the app entry point');
  await expect(local.getByRole('img', { name: 'Not published' })).toBeVisible();
  // Published commits cannot be undone.
  await expect(commitRow(list, 'Initial commit').getByRole('button', { name: /^Undo commit/ })).toHaveCount(0);

  await local.hover();
  await local.getByRole('button', { name: /^Undo commit/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Undo the last local commit?' });
  await expect(dialog).toContainText('Add the app entry point');
  await dialog.getByRole('button', { name: 'Undo and stage changes' }).click();
  await expect(dialog).toBeHidden();

  // OpenTig moves to Changes with the file staged and the message restored.
  await expect(page.getByRole('tree', { name: 'Staged' }).getByRole('treeitem', { name: /src\/app\.js/ })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Create commit' }).getByRole('textbox', { name: 'Commit message' })).toHaveValue('Add the app entry point');
  await expect.poll(() => repository.git('rev-parse', 'HEAD')).toBe(initial);
  expect(await repository.git('diff', '--cached', '--name-status')).toBe('A\tsrc/app.js');
});

test('copying a commit hash from its menu puts the full hash on the clipboard', async ({ pairedPage: page, repository, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await repository.commit('src/app.js', 'const a = 1;\n', 'Add the app entry point');
  const oid = await repository.git('rev-parse', 'HEAD');

  const list = await openHistory(page, repository);
  await list.getByRole('button', { name: 'Add the app entry point', exact: true }).click();
  await page.getByRole('button', { name: 'More commit actions' }).click();
  await page.getByRole('menuitem', { name: 'Copy full hash' }).click();

  await expect(page.getByText('Hash copied')).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(oid);
});
