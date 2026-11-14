import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { openRepository } from './support/app';
import { expect, test } from './support/fixtures';

const execFileAsync = promisify(execFile);

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

test('switching quickly between many saved repositories ends on the last one without errors', async ({ pairedPage: page }) => {
  test.slow();
  // A remote that takes its time to answer, as a real one does: every fetch
  // of a saved repository keeps a server request busy meanwhile.
  const remote = createServer((_request, response) => { setTimeout(() => response.writeHead(404).end(), 3_000); });
  remote.listen(0, '127.0.0.1');
  await once(remote, 'listening');
  const root = await mkdtemp(path.join(os.tmpdir(), 'opentig-e2e-many-'));
  try {
    const names = Array.from({ length: 12 }, (_, index) => `project-${String(index + 1).padStart(2, '0')}`);
    for (const name of names) {
      const work = path.join(root, name);
      const git = (...args: string[]) => execFileAsync('git', args, { cwd: work });
      await execFileAsync('git', ['init', '-q', '-b', `${name}-main`, work]);
      await git('-c', 'user.name=E2E Tester', '-c', 'user.email=e2e@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', `Start ${name}`);
      await git('remote', 'add', 'origin', `http://127.0.0.1:${(remote.address() as AddressInfo).port}/${name}.git`);
    }
    await writeFile(path.join(root, 'project-12', 'notes.txt'), 'Not committed yet.\n');

    const picker = page.getByRole('combobox', { name: 'Select project or repository' });
    for (const [index, name] of names.entries()) {
      if (index === 0) await page.getByRole('button', { name: /Open a folder/ }).click();
      else await page.keyboard.press('Control+o');
      const dialog = page.getByRole('dialog', { name: 'Open a repository' });
      await dialog.getByRole('button', { name: 'Enter a folder path' }).click();
      const folderPath = dialog.getByRole('textbox', { name: 'Folder path' });
      await folderPath.fill(path.join(root, name));
      await folderPath.press('Enter');
      // Adding this many this fast can go over the server's request rate, which delays requests for a moment.
      await expect(dialog.getByText('This folder is a Git repository')).toBeVisible({ timeout: 20_000 });
      await dialog.getByRole('button', { name: 'Add repository' }).click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });
      // The branch appears once the repository is open, not while the picker still says it is opening.
      await expect(picker).toContainText(name, { timeout: 20_000 });
      await expect(page.getByRole('combobox', { name: 'Select branch' })).toContainText(`${name}-main`, { timeout: 20_000 });
    }

    // No waiting between choices: each one starts while the previous repository is still loading.
    const options = page.getByRole('listbox', { name: 'Select project or repository' });
    for (const name of ['project-03', 'project-08', 'project-01', 'project-10', 'project-05', 'project-07', 'project-02', 'project-12']) {
      await picker.click();
      await options.getByRole('option', { name: new RegExp(`^${name}`) }).click();
    }

    await expect(picker).toContainText('project-12', { timeout: 30_000 });
    await expect(page.getByRole('combobox', { name: 'Select branch' })).toContainText('project-12-main', { timeout: 30_000 });
    const views = page.getByRole('navigation', { name: 'Repository views' });
    await expect(views.getByRole('button', { name: 'Changes 1' })).toBeVisible({ timeout: 30_000 });
    // An error toast stays up for ten seconds, so one raised by any of the switches would still be here.
    await expect(page.locator('[data-sileo-toast][data-state="error"]')).toHaveCount(0);
  } finally {
    remote.closeAllConnections();
    remote.close();
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
});
