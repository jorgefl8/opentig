import { expect, type Locator, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { GitRepository } from './fixtures';

const execFileAsync = promisify(execFile);

/** Adds a repository through the "Open a folder" dialog, as a user would. */
export async function openRepository(page: Page, repository: GitRepository): Promise<void> {
  await page.getByRole('button', { name: /Open a folder/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Open a repository' });
  await dialog.getByRole('button', { name: 'Enter a folder path' }).click();
  const folderPath = dialog.getByRole('textbox', { name: 'Folder path' });
  await folderPath.fill(repository.path);
  await folderPath.press('Enter');
  await expect(dialog.getByText('This folder is a Git repository')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add repository' }).click();
  // Shortcuts are ignored while any dialog is open, so wait for it to close.
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('combobox', { name: 'Select project or repository' })).toContainText(repository.name);
}

/** The repository selector in the top bar, which names the repository on screen. */
export const repositoryPicker = (page: Page): Locator => page.getByRole('combobox', { name: 'Select project or repository' });

/** Another repository with one commit, in its own folder. */
export async function otherRepository(name: string): Promise<{ path: string; name: string; dispose(): Promise<void> }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opentig-e2e-other-'));
  const work = path.join(root, name);
  await execFileAsync('git', ['init', '-q', '-b', 'main', work]);
  await execFileAsync('git', ['-c', 'user.name=E2E Tester', '-c', 'user.email=e2e@example.com', '-c', 'commit.gpgsign=false',
    'commit', '-q', '--allow-empty', '-m', `Start ${name}`], { cwd: work });
  return { path: work, name, dispose: () => rm(root, { recursive: true, force: true, maxRetries: 3 }) };
}

/** Adds a repository with the open dialog once another one is open, and waits for it to show. */
export async function addRepository(page: Page, repository: { path: string; name: string }): Promise<void> {
  await page.keyboard.press('Control+o');
  const dialog = page.getByRole('dialog', { name: 'Open a repository' });
  await dialog.getByRole('button', { name: 'Enter a folder path' }).click();
  const folderPath = dialog.getByRole('textbox', { name: 'Folder path' });
  await folderPath.fill(repository.path);
  await folderPath.press('Enter');
  await expect(dialog.getByText('This folder is a Git repository')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add repository' }).click();
  await expect(dialog).toBeHidden();
  await expect(repositoryPicker(page)).toContainText(repository.name);
}

/** The repository id in a page's address. */
export const addressRepositoryId = (page: Page): string => new URL(page.url()).pathname.split('/')[2]!;

/**
 * The color swatches drawn before color values. They are decorative and
 * hidden from assistive technology, so only their class finds them.
 */
export function colorSwatches(page: Page): Locator {
  return page.locator('.color-swatch > span');
}

/** The hover preview of a color, shown in a tooltip with its value. */
export function colorPreview(page: Page, value: string): Locator {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.getByRole('code').filter({ hasText: new RegExp(`^${escaped}$`) });
}

/** Swatches let clicks through to the code, so the pointer is moved over them instead. */
export async function hoverCenter(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('The target is not on screen.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * A stylesheet of one `:root` block of 100 custom properties, each set with `var()`, and `added` after
 * the 61st: its diff has a single hunk that starts deep inside the block, whose `{` is out of its sight.
 */
export function chartStylesheet(added: string[] = []): string {
  const lines = Array.from({ length: 100 }, (_, index) => `  --color-chart-${index + 1}: var(--chart-${index + 1});\n`);
  return `:root {\n${[...lines.slice(0, 61), ...added, ...lines.slice(61)].join('')}}\n`;
}

/**
 * Waits until the diff line holding `property` colors it unlike the `var` that sets it, as a stylesheet
 * read from its first line does. Read from its hunk alone, the line is outside any block and all one color.
 */
export async function expectHighlightedInContext(code: Locator, property: string): Promise<void> {
  const line = code.locator('[data-line]').filter({ hasText: `${property}:` }).first();
  await expect.poll(() => line.evaluate((element, name) => {
    const token = (text: string) => [...element.querySelectorAll('span')].find((span) => span.textContent?.trim() === text);
    const [named, call] = [token(name), token('var')];
    return Boolean(named && call && getComputedStyle(named).color !== getComputedStyle(call).color);
  }, property)).toBe(true);
}

type NavigationRequests = { requested: Record<string, number>; unanswered: number };

function readNavigationRequests(page: Page): Promise<NavigationRequests> {
  return page.evaluate(() => {
    const read = (window as unknown as { __opentigNavigationRequests?: () => NavigationRequests }).__opentigNavigationRequests;
    if (!read) throw new Error('Request counting is off. Set "test.use({ countRequests: true })".');
    return read();
  });
}

/** Waits until every request is answered and none has been made for `quietMs`. */
async function settledRequests(page: Page, quietMs: number, timeoutMs: number): Promise<Record<string, number>> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  let since = Date.now();
  for (;;) {
    const { requested, unanswered } = await readNavigationRequests(page);
    const now = JSON.stringify(requested);
    if (now !== last || unanswered > 0) { last = now; since = Date.now(); }
    else if (Date.now() - since >= quietMs) return requested;
    if (Date.now() > deadline) throw new Error(`The app kept asking the server for more than ${timeoutMs} ms: ${unanswered} unanswered, ${now}`);
    await page.waitForTimeout(50);
  }
}

/**
 * The requests `navigate` makes to the server, by command, counted until the app
 * has been quiet for `quietMs`. Requests the app repeats on a timer whatever is on
 * screen are left out, so the count is what the navigation itself cost. Needs
 * `test.use({ countRequests: true })`.
 */
export async function requestsDuring(page: Page, navigate: () => Promise<void>, { quietMs = 600, timeoutMs = 30_000 } = {}): Promise<Record<string, number>> {
  await settledRequests(page, quietMs, timeoutMs);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('opentig:performance-action', { detail: { type: 'mark' } })));
  await navigate();
  const requested = await settledRequests(page, quietMs, timeoutMs);
  // The agent check runs every ten seconds in any section.
  delete requested['refs:worktree-agents'];
  return requested;
}

export function requestTotal(requested: Record<string, number>): number {
  return Object.values(requested).reduce((sum, count) => sum + count, 0);
}

/**
 * Makes the repository look like a clone of `nameWithOwner` on GitHub. Nothing
 * reaches GitHub: fetching from `origin` goes to a proxy that refuses at once.
 */
export async function cloneOfGitHub(repository: GitRepository, nameWithOwner = 'e2e/sample-project'): Promise<void> {
  await repository.git('remote', 'add', 'origin', `https://github.com/${nameWithOwner}.git`);
  await repository.git('config', 'remote.origin.proxy', 'http://127.0.0.1:9');
}

/**
 * A branch off `main` with one commit per entry, each writing its files, as a
 * pull request's head; `main` stays checked out. Its commits are in the clone,
 * so OpenTig reads the pull request's code from Git without fetching.
 */
export async function pullRequestBranch(repository: GitRepository, branch: string, commits: Array<{ message: string; files: Record<string, string> }>): Promise<{
  baseRefOid: string; headRefOid: string; commits: Array<{ oid: string; messageHeadline: string }>;
}> {
  const baseRefOid = await repository.git('rev-parse', 'main');
  await repository.git('checkout', '-q', '-b', branch);
  const made: Array<{ oid: string; messageHeadline: string }> = [];
  for (const commit of commits) {
    for (const [file, content] of Object.entries(commit.files)) {
      await mkdir(path.dirname(path.join(repository.path, file)), { recursive: true });
      await writeFile(path.join(repository.path, file), content);
    }
    await repository.git('add', '-A');
    await repository.git('commit', '-q', '-m', commit.message);
    made.push({ oid: await repository.git('rev-parse', 'HEAD'), messageHeadline: commit.message });
  }
  await repository.git('checkout', '-q', 'main');
  return { baseRefOid, headRefOid: made.at(-1)!.oid, commits: made };
}
