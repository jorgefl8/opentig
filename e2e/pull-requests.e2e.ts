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
