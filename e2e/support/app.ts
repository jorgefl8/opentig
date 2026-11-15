import { expect, type Locator, type Page } from '@playwright/test';
import type { GitRepository } from './fixtures';

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
