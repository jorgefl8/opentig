import type { Page } from '@playwright/test';
import { cloneOfGitHub, openRepository, pullRequestBranch } from './support/app';
import { expect, test } from './support/fixtures';

// Pull requests come from a stand-in GitHub CLI (see support/stand-in-gh.mjs); their code comes from Git in the clone.
test.use({ standInGitHub: true });

const section = (page: Page, name: string) => page.getByRole('navigation', { name: 'Repository views' }).getByRole('button', { name, exact: true });
const back = (page: Page) => page.getByRole('banner').getByRole('button', { name: 'Back', exact: true });

test('Back returns to a pull request with bots still hidden and its code still grouped by the commit chosen', async ({ pairedPage: page, repository, github }) => {
  await cloneOfGitHub(repository);
  const branch = await pullRequestBranch(repository, 'feature/status-filter', [
    { message: 'Split the store', files: { 'src/store/read.js': 'export const read = () => [];\n' } },
    { message: 'Filter tasks by status', files: { 'src/filter-tasks.js': 'export const filterTasks = (list) => list;\n' } },
  ]);
  await github({
    login: 'e2e-tester', nameWithOwner: 'e2e/sample-project', pulls: [{
      number: 24, title: 'Filter tasks by status', headRefName: 'feature/status-filter', baseRefName: 'main', ...branch, changedFiles: 2,
      conversation: [{ author: 'sam', body: 'Reloading keeps the filter now.' }, { author: 'github-actions', body: 'CI passed on the latest commit.', bot: true }],
    }],
  });
  await openRepository(page, repository);
  await section(page, 'GitHub').click();
  await page.getByRole('list', { name: /pull requests$/ }).getByRole('button', { name: /Filter tasks by status/ }).click();
  const viewer = page.getByRole('main');
  const tabs = viewer.getByRole('tablist', { name: 'Pull request view' });

  await tabs.getByRole('tab', { name: 'Comments' }).click();
  await expect(viewer.getByText('CI passed on the latest commit.')).toBeVisible();
  await viewer.getByRole('checkbox', { name: 'Hide bots' }).click();
  await expect(viewer.getByText('CI passed on the latest commit.')).toBeHidden();
  await expect(viewer.getByText('Reloading keeps the filter now.')).toBeVisible();

  await tabs.getByRole('tab', { name: 'Code' }).click();
  await viewer.getByRole('button', { name: 'By commit' }).click();
  // The commit picker moves from the loading view to the files' toolbar once the files arrive.
  await expect(viewer.getByRole('button', { name: /read\.js/ })).toBeVisible();
  await viewer.getByRole('combobox', { name: 'Commit' }).click();
  await page.getByRole('option', { name: /Split the store/ }).click();
  await expect(viewer.getByRole('combobox', { name: 'Commit' })).toContainText('Split the store');
  await expect(viewer.getByRole('button', { name: /read\.js/ })).toBeVisible();

  // Somewhere else, and back.
  await section(page, 'History').click();
  await expect(viewer.getByRole('tablist', { name: 'Pull request view' })).toBeHidden();
  await back(page).click();

  await expect(tabs.getByRole('tab', { name: 'Code', selected: true })).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'By commit' })).toHaveAttribute('aria-pressed', 'true');
  await expect(viewer.getByRole('combobox', { name: 'Commit' })).toContainText('Split the store');
  await tabs.getByRole('tab', { name: 'Comments' }).click();
  await expect(viewer.getByRole('checkbox', { name: 'Hide bots' })).toBeChecked();
  await expect(viewer.getByText('Reloading keeps the filter now.')).toBeVisible();
  await expect(viewer.getByText('CI passed on the latest commit.')).toBeHidden();
});

test('a pull request’s code lists its files at once, reads each one as it unfolds, and leaves a large one for when it is asked for', async ({ pairedPage: page, repository, github }) => {
  await cloneOfGitHub(repository);
  const files: Record<string, string> = {};
  for (let index = 0; index < 24; index++) files[`src/board/card-${String(index).padStart(2, '0')}.ts`] = `export const card${index} = ${index};\n`;
  files['package-lock.json'] = Array.from({ length: 12_000 }, (_, index) => `  "dependency-${index}": "1.0.${index}",`).join('\n') + '\n';
  const branch = await pullRequestBranch(repository, 'feature/new-store', [{ message: 'Move the board to the new store', files }]);
  await github({
    login: 'e2e-tester', nameWithOwner: 'e2e/sample-project',
    pulls: [{ number: 31, title: 'Move the board to the new store', headRefName: 'feature/new-store', baseRefName: 'main', ...branch, changedFiles: 25 }],
  });
  // The commands the page sends, from a connection made after this listener.
  const commands: string[] = [];
  page.on('websocket', (socket) => socket.on('framesent', (frame) => {
    try {
      const message = JSON.parse(typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf8')) as { type?: string; command?: string };
      if (message.type === 'request' && message.command) commands.push(message.command);
    } catch { /* not a request */ }
  }));
  await page.reload();
  await openRepository(page, repository);
  await section(page, 'GitHub').click();
  await page.getByRole('list', { name: /pull requests$/ }).getByRole('button', { name: /Move the board to the new store/ }).click();
  const viewer = page.getByRole('main');
  await viewer.getByRole('tablist', { name: 'Pull request view' }).getByRole('tab', { name: 'Code' }).click();

  // The list shows with every file folded, the large one saying so.
  const lock = viewer.getByRole('button', { name: 'package-lock.json', exact: true });
  await expect(viewer.getByText('25 files', { exact: true })).toBeVisible();
  await expect(lock).toHaveAttribute('aria-expanded', 'false');
  await expect(viewer.getByText(/^Large file · \d+ KB$/)).toBeVisible();
  expect(commands.filter((command) => command === 'github:pr-file-diff')).toEqual([]);

  const filter = viewer.getByRole('searchbox', { name: 'Filter files' });
  await filter.fill('card-1');
  await expect(viewer.getByText('10 of 25 files', { exact: true })).toBeVisible();
  await expect(viewer.getByRole('button', { name: /card-09\.ts$/ })).toBeHidden();
  await filter.fill('');

  // Expand all reads every file but the large one, which stays folded.
  await viewer.getByRole('button', { name: 'Expand all files' }).click();
  await expect(viewer.getByText('export const card0 = 0;', { exact: true })).toBeVisible();
  await expect(viewer.getByRole('button', { name: /card-23\.ts$/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(lock).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => commands.filter((command) => command === 'github:pr-file-diff').length).toBe(24);

  // Unfolded on its own, the large file is read.
  await lock.click();
  await expect(viewer.getByText('"dependency-0": "1.0.0",', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  expect(commands).toContain('github:pr-files');
  expect(commands).not.toContain('github:pr-diff');
});
