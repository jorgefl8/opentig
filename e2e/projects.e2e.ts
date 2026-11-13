import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Locator, Page } from '@playwright/test';
import { openRepository } from './support/app';
import { expect, test } from './support/fixtures';

const execFileAsync = promisify(execFile);

/** A second, independent repository with one commit, removed after the test. */
async function createSecondRepository(name: string): Promise<{ path: string; name: string; dispose(): Promise<void> }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opentig-e2e-second-'));
  const work = path.join(root, name);
  await execFileAsync('git', ['init', '-q', '-b', 'main', work]);
  await execFileAsync('git', ['-c', 'user.name=E2E Tester', '-c', 'user.email=e2e@example.com', '-c', 'commit.gpgsign=false',
    'commit', '-q', '--allow-empty', '-m', 'Start the second project'], { cwd: work });
  return { path: work, name, dispose: () => rm(root, { recursive: true, force: true, maxRetries: 3 }) };
}

/**
 * Serves a bare repository over Git's "dumb" HTTP protocol (static files), so
 * the clone runs over a real network transport without leaving the machine.
 */
async function serveOverHttp(bare: string): Promise<{ url: string; server: Server }> {
  await execFileAsync('git', ['update-server-info'], { cwd: bare });
  const server = createServer((request, response) => {
    const relative = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname).replace(/^\/origin\.git\/?/, '');
    const file = path.resolve(bare, relative);
    if (!file.startsWith(bare + path.sep)) { response.writeHead(404).end(); return; }
    readFile(file).then(
      (content) => response.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(content),
      () => response.writeHead(404).end(),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/origin.git`, server };
}

function repositoryPicker(page: Page): Locator {
  return page.getByRole('combobox', { name: 'Select project or repository' });
}

/** Opens a further repository through Ctrl+O once one is already open. */
async function openAnotherRepository(page: Page, folder: string, name: string): Promise<void> {
  await page.keyboard.press('Control+o');
  const dialog = page.getByRole('dialog', { name: 'Open a repository' });
  await dialog.getByRole('button', { name: 'Enter a folder path' }).click();
  const folderPath = dialog.getByRole('textbox', { name: 'Folder path' });
  await folderPath.fill(folder);
  await folderPath.press('Enter');
  await expect(dialog.getByText('This folder is a Git repository')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add repository' }).click();
  await expect(dialog).toBeHidden();
  await expect(repositoryPicker(page)).toContainText(name);
}

async function openProjectManagement(page: Page): Promise<Locator> {
  await repositoryPicker(page).click();
  await page.getByRole('button', { name: 'Manage projects…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Manage projects' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('a repository is cloned from an HTTP URL and opened', async ({ pairedPage: page, repository }) => {
  await repository.commit('src/app.ts', 'export const answer = 42;\n', 'Add the app');
  const { bare } = await repository.addRemote();
  const { url, server } = await serveOverHttp(bare);
  const parent = await mkdtemp(path.join(os.tmpdir(), 'opentig-e2e-clone-'));
  try {
    await page.getByRole('button', { name: /Clone from URL/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Clone a repository' });
    await dialog.getByRole('textbox', { name: 'Repository URL' }).fill(url);
    await expect(dialog.getByText('127.0.0.1 · HTTP')).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Clone into' }).fill(parent);
    const destination = path.join(parent, 'origin');
    await expect(dialog.getByText(destination)).toBeVisible();
    await dialog.getByRole('button', { name: 'Clone', exact: true }).click();

    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(repositoryPicker(page)).toContainText('origin');
    await expect(page.getByRole('combobox', { name: 'Select branch' })).toContainText('main');
    expect(existsSync(path.join(destination, 'src', 'app.ts'))).toBe(true);
    const cloned = (await execFileAsync('git', ['log', '-1', '--format=%s'], { cwd: destination })).stdout.trim();
    expect(cloned).toBe('Add the app');
  } finally {
    server.close();
    await rm(parent, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('cloning rejects a local path instead of a network URL', async ({ pairedPage: page, repository }) => {
  const { bare } = await repository.addRemote();
  const parent = await mkdtemp(path.join(os.tmpdir(), 'opentig-e2e-clone-'));
  try {
    await page.getByRole('button', { name: /Clone from URL/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Clone a repository' });
    await dialog.getByRole('textbox', { name: 'Repository URL' }).fill(`file://${bare}`);
    await dialog.getByRole('textbox', { name: 'Clone into' }).fill(parent);
    await dialog.getByRole('button', { name: 'Clone', exact: true }).click();

    await expect(dialog.getByRole('alert')).toHaveText('Enter an HTTPS or SSH repository URL.');
    await expect(dialog).toBeVisible();
    expect(existsSync(path.join(parent, 'origin'))).toBe(false);
  } finally {
    await rm(parent, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('the repository selector switches between open repositories', async ({ pairedPage: page, repository }) => {
  const second = await createSecondRepository('second-project');
  try {
    await openRepository(page, repository);
    await openAnotherRepository(page, second.path, second.name);

    await repositoryPicker(page).click();
    const options = page.getByRole('listbox', { name: 'Select project or repository' });
    await expect(options.getByRole('option', { name: /^second-project/ })).toHaveAttribute('aria-selected', 'true');
    await options.getByRole('option', { name: /^sample-project/ }).click();

    await expect(repositoryPicker(page)).toContainText(repository.name);
    const views = page.getByRole('navigation', { name: 'Repository views' });
    await views.getByRole('button', { name: 'Files' }).click();
    await expect(page.getByRole('treeitem', { name: /README\.md/ })).toBeVisible();
  } finally {
    await second.dispose();
  }
});

test('repositories can be grouped into a project', async ({ pairedPage: page, repository }) => {
  const second = await createSecondRepository('second-project');
  try {
    await openRepository(page, repository);
    await openAnotherRepository(page, second.path, second.name);

    const dialog = await openProjectManagement(page);
    await dialog.getByRole('textbox', { name: 'Project name' }).fill('Work');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(dialog.getByRole('region', { name: 'Projects 1' })).toContainText('Work');
    await dialog.getByRole('combobox', { name: 'Project for sample-project' }).click();
    await page.getByRole('option', { name: 'Work' }).click();
    await expect(dialog.getByRole('combobox', { name: 'Project for sample-project' })).toContainText('Work');
    await expect(dialog.getByText('1 repository')).toBeVisible();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();

    await repositoryPicker(page).click();
    const options = page.getByRole('listbox', { name: 'Select project or repository' });
    await expect(options.getByRole('group', { name: 'Work' }).getByRole('option')).toHaveCount(1);
    await expect(options.getByRole('group', { name: 'Work' }).getByRole('option', { name: /^sample-project/ })).toBeVisible();
    await expect(options.getByRole('group', { name: 'Repositories' }).getByRole('option', { name: /^second-project/ })).toBeVisible();
  } finally {
    await second.dispose();
  }
});

test('removing a repository from OpenTig keeps its folder on disk', async ({ pairedPage: page, repository }) => {
  const second = await createSecondRepository('second-project');
  try {
    await openRepository(page, repository);
    await openAnotherRepository(page, second.path, second.name);

    const dialog = await openProjectManagement(page);
    await dialog.getByRole('button', { name: 'Remove sample-project from OpenTig' }).click();
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(dialog.getByRole('region', { name: 'Repositories 1' })).toBeVisible();
    await expect(dialog.getByText('sample-project', { exact: true })).toBeHidden();
    await dialog.getByRole('button', { name: 'Done' }).click();

    await repositoryPicker(page).click();
    const options = page.getByRole('listbox', { name: 'Select project or repository' });
    await expect(options.getByRole('option')).toHaveCount(1);
    await expect(options.getByRole('option', { name: /^second-project/ })).toBeVisible();
    expect((await stat(path.join(repository.path, '.git'))).isDirectory()).toBe(true);
  } finally {
    await second.dispose();
  }
});

test('a moved repository folder can be located again', async ({ pairedPage: page, repository }) => {
  await openRepository(page, repository);
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  // Stays inside the fixture's temporary folder, so the fixture cleans it up.
  const moved = path.join(path.dirname(repository.path), 'moved-project');
  await rename(repository.path, moved);

  // The repository watcher notices the missing folder without a manual refresh.
  await expect(page.getByRole('heading', { name: 'sample-project was not found', level: 1 })).toBeVisible();
  await expect(page.getByText(repository.path, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Locate folder…' }).click();

  const locate = page.getByRole('dialog', { name: 'Locate sample-project' });
  await locate.getByRole('button', { name: 'Enter a folder path' }).click();
  const folderPath = locate.getByRole('textbox', { name: 'Folder path' });
  await folderPath.fill(moved);
  await folderPath.press('Enter');
  await expect(locate.getByText('This folder is a Git repository')).toBeVisible();
  await locate.getByRole('button', { name: 'Use this folder' }).click();

  await expect(locate).toBeHidden();
  await expect(page.getByRole('heading', { name: 'sample-project was not found' })).toBeHidden();
  await expect(repositoryPicker(page)).toContainText('moved-project');
  await expect(page.getByRole('navigation', { name: 'Repository views' })).toBeVisible();
});

test('a missing repository can be removed from the not-found screen', async ({ pairedPage: page, repository }) => {
  await openRepository(page, repository);
  // Removal is refused while the opening refresh is still running.
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  await rm(repository.path, { recursive: true, force: true });

  await expect(page.getByRole('heading', { name: 'sample-project was not found', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Remove from OpenTig' }).click();

  await expect(page.getByRole('heading', { name: 'OpenTig', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: /Open a folder/ })).toBeVisible();
  await expect(page.getByText('sample-project')).toBeHidden();
});
