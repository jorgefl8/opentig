import type { Locator, Page } from '@playwright/test';
import { openRepository } from './support/app';
import { expect, test } from './support/fixtures';

// Back and Forward walk the places the user went, and bring each back as it was left.

const section = (page: Page, name: string) => page.getByRole('navigation', { name: 'Repository views' }).getByRole('button', { name, exact: true });
const back = (page: Page) => page.getByRole('banner').getByRole('button', { name: 'Back', exact: true });
const forward = (page: Page) => page.getByRole('banner').getByRole('button', { name: 'Forward', exact: true });

const LONG_FILE = Array.from({ length: 400 }, (_, index) => `line ${index + 1} of the long file`).join('\n') + '\n';

/** The scrolling part of the diff on screen. */
function diffScroller(page: Page): Locator {
  return page.locator('.viewer-pane-body .diff-workspace-scroll');
}

test('Back from a file opened in a commit returns to the commit, its unfolded file and the line being read', async ({ pairedPage: page, repository }) => {
  await repository.commit('src/long.txt', LONG_FILE, 'Add the long file');
  await repository.commit('notes.md', '# Notes\n', 'Write the notes');
  await openRepository(page, repository);
  await expect(back(page)).toBeDisabled();

  await section(page, 'History').click();
  const list = page.getByRole('list', { name: 'Commit history' });
  const commit = list.getByRole('button', { name: 'Add the long file', exact: true });
  await commit.click();
  const viewer = page.getByRole('main');
  const file = viewer.getByRole('button', { name: /^src\/\s*long\.txt$/ });
  if (await file.getAttribute('aria-expanded') !== 'true') await file.click();
  await expect(viewer.getByText('line 1 of the long file', { exact: true })).toBeVisible();

  // Read down to the middle of the file, with the wheel, as a person would.
  await diffScroller(page).hover();
  for (let turn = 0; turn < 12; turn++) await page.mouse.wheel(0, 400);
  await expect.poll(() => diffScroller(page).evaluate((element) => element.scrollTop)).toBeGreaterThan(3000);
  await page.waitForTimeout(300);
  const readAt = await diffScroller(page).evaluate((element) => element.scrollTop);
  const lineHeld = viewer.getByText('line 200 of the long file', { exact: true });
  const lineInView = await lineHeld.isVisible() && await lineHeld.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.top >= 0 && box.bottom <= window.innerHeight;
  }).catch(() => false);

  await viewer.getByRole('button', { name: 'Open file' }).first().click();
  await expect(page.getByRole('tablist', { name: 'Open files' }).getByRole('tab', { name: /long\.txt/ })).toBeVisible();

  await back(page).click();
  await expect(list.getByRole('button', { name: 'Add the long file', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(file).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => diffScroller(page).evaluate((element) => element.scrollTop), { timeout: 5_000 }).toBeGreaterThan(readAt - 4);
  expect(await diffScroller(page).evaluate((element) => element.scrollTop)).toBeLessThan(readAt + 4);
  if (lineInView) await expect(lineHeld).toBeInViewport();

  // Forward goes to the file again, and the trail ends there.
  await expect(forward(page)).toBeEnabled();
  await forward(page).click();
  await expect(page.getByRole('tablist', { name: 'Open files' }).getByRole('tab', { name: /long\.txt/, selected: true })).toBeVisible();
  await expect(forward(page)).toBeDisabled();
});

test('Back at the start of the trail does nothing, and a new step drops what was ahead', async ({ pairedPage: page, repository }) => {
  await repository.commit('src/app.js', 'const total = 1;\n', 'Add app');
  await openRepository(page, repository);
  await expect(back(page)).toBeDisabled();
  await expect(forward(page)).toBeDisabled();

  await section(page, 'History').click();
  await section(page, 'Changes').click();
  await expect(back(page)).toBeEnabled();

  await page.keyboard.press('Alt+ArrowLeft');
  await expect(section(page, 'History')).toHaveAttribute('aria-current', 'page');
  await back(page).click();
  await expect(section(page, 'Files')).toHaveAttribute('aria-current', 'page');
  await expect(back(page)).toBeDisabled();
  // Nothing before the first step: the app stays where it is.
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(section(page, 'Files')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('banner')).toBeVisible();

  await page.keyboard.press('Alt+ArrowRight');
  await expect(section(page, 'History')).toHaveAttribute('aria-current', 'page');
  // Somewhere new from the middle of the trail: Changes, which was ahead, is gone.
  await section(page, 'Search').click();
  await expect(forward(page)).toBeDisabled();
  await back(page).click();
  await expect(section(page, 'History')).toHaveAttribute('aria-current', 'page');
});

test('on a phone, the back arrow walks the trail and only at its start returns to the list', async ({ pairedPage: page, repository }) => {
  await repository.commit('docs/guide.md', '# Guide\n\nRead me first.\n', 'Write the guide');
  await openRepository(page, repository);
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.getByRole('navigation', { name: 'Repository views' });
  await nav.getByRole('button', { name: 'History' }).click();
  const list = page.getByRole('list', { name: 'Commit history' });
  await list.getByRole('button', { name: 'Write the guide', exact: true }).click();
  const viewer = page.getByRole('main');
  await expect(viewer.getByRole('heading', { name: 'Write the guide', level: 2 })).toBeVisible();
  // From the commit to the file it changed.
  await viewer.getByRole('button', { name: 'Open file' }).first().click();
  await expect(viewer.getByRole('heading', { name: 'Write the guide', level: 2 })).toBeHidden();

  const arrow = page.getByRole('banner').getByRole('button', { name: 'Back', exact: true });
  await arrow.click();
  // One step back is the commit, still in the viewer.
  await expect(viewer.getByRole('heading', { name: 'Write the guide', level: 2 })).toBeVisible();
  await expect(list).toBeHidden();
  await arrow.click();
  // The step before it is History's list.
  await expect(list).toBeVisible();
  await expect(page.getByRole('button', { name: 'Repository and branch' })).toBeVisible();
});
