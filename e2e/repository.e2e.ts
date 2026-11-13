import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openRepository } from './support/app';
import { expect, test } from './support/fixtures';

test('a paired browser opens a repository from a folder path', async ({ pairedPage: page, repository }) => {
  await expect(page.getByRole('heading', { name: 'OpenTig', level: 1 })).toBeVisible();

  await openRepository(page, repository);

  await expect(page.getByRole('combobox', { name: 'Select branch' })).toContainText('main');
  await expect(page.getByRole('navigation', { name: 'Repository views' })).toBeVisible();
});

test('a change made on disk can be staged and committed', async ({ pairedPage: page, repository }) => {
  await openRepository(page, repository);
  await writeFile(path.join(repository.path, 'README.md'), '# Sample project\n\nNow with docs.\n');

  const views = page.getByRole('navigation', { name: 'Repository views' });
  await views.getByRole('button', { name: /^Changes/ }).click();
  await expect(views.getByRole('button', { name: 'Changes 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Stage all' }).click();
  await expect(page.getByRole('tree', { name: 'Staged' }).getByRole('treeitem', { name: /README\.md/ })).toBeVisible();

  const commitBox = page.getByRole('group', { name: 'Create commit' });
  await commitBox.getByRole('textbox', { name: 'Commit message' }).fill('Document the sample project');
  await commitBox.getByRole('button', { name: 'Commit 1 file' }).click();

  await expect(page.getByRole('tree', { name: 'Staged' })).toBeHidden();
  await expect.poll(() => repository.git('log', '-1', '--format=%s')).toBe('Document the sample project');
  expect(await repository.git('status', '--porcelain')).toBe('');

  await views.getByRole('button', { name: 'History' }).click();
  await expect(page.getByText('Document the sample project').first()).toBeVisible();
});
