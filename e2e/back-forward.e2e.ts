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
  // The wheel's scroll goes on for a moment: the place being read is where it stops.
  let readAt = -1;
  await expect.poll(async () => {
    const at = await diffScroller(page).evaluate((element) => element.scrollTop);
    const stopped = at === readAt;
    readAt = at;
    return stopped;
  }, { intervals: [200] }).toBe(true);
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

  await back(page).click();
  await expect(section(page, 'History')).toHaveAttribute('aria-current', 'page');
  await back(page).click();
  await expect(section(page, 'Files')).toHaveAttribute('aria-current', 'page');
  // Nothing before the first step: the arrow is off, and the app stays where it is.
  await expect(back(page)).toBeDisabled();
  await expect(forward(page)).toBeEnabled();

  await forward(page).click();
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

test('right-clicking or holding Back lists the steps behind, and choosing one goes straight there', async ({ pairedPage: page, repository }) => {
  await repository.commit('src/app.js', 'const total = 1;\n', 'Add app');
  await repository.commit('notes.md', '# Notes\n', 'Write the notes');
  const oid = await repository.git('rev-parse', 'HEAD~1');
  await openRepository(page, repository);

  await section(page, 'History').click();
  const list = page.getByRole('list', { name: 'Commit history' });
  await list.getByRole('button', { name: 'Add app', exact: true }).click();
  const viewer = page.getByRole('main');
  await expect(viewer.getByRole('heading', { name: 'Add app', level: 2 })).toBeVisible();
  await section(page, 'Changes').click();
  await section(page, 'Search').click();

  // Enter takes a step, so the button is not announced as opening a menu; how to list the steps is its description.
  await expect(back(page)).not.toHaveAttribute('aria-haspopup');
  await expect(back(page)).toHaveAccessibleDescription('Press Down, right-click or hold to list every step');
  // A plain click would take one step: a right click lists them all, nearest first.
  await back(page).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Go back to' });
  await expect(menu.getByRole('menuitem')).toHaveText([/^Changes/, /^Add app.*History · Commit/, /^History/, /^Files/]);
  await expect(section(page, 'Search')).toHaveAttribute('aria-current', 'page');
  await menu.getByRole('menuitem', { name: /^Add app/ }).click();

  // Two steps at once, to the commit as it was, with its address.
  await expect(viewer.getByRole('heading', { name: 'Add app', level: 2 })).toBeVisible();
  await expect(section(page, 'History')).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveURL(new RegExp(`/commit/${oid}$`));

  // Held down, Forward lists what is ahead; letting go does not take a step.
  await forward(page).hover();
  await page.mouse.down();
  const ahead = page.getByRole('menu', { name: 'Go forward to' });
  await expect(ahead).toBeVisible();
  await page.mouse.up();
  await expect(ahead.getByRole('menuitem')).toHaveText([/^Changes/, /^Search/]);
  await expect(page).toHaveURL(new RegExp(`/commit/${oid}$`));
  // Escape gives the focus back to the button it came from.
  await page.keyboard.press('Escape');
  await expect(ahead).toBeHidden();
  await expect(forward(page)).toBeFocused();

  // From the keyboard: the down arrow opens the list, and Enter takes the highlighted step.
  await page.keyboard.press('ArrowDown');
  await expect(ahead.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(section(page, 'Search')).toHaveAttribute('aria-current', 'page');
  await expect(forward(page)).toBeDisabled();

  // The menu key opens the list as the down arrow does, on its first step.
  await back(page).focus();
  await page.keyboard.press('Shift+F10');
  const behind = page.getByRole('menu', { name: 'Go back to' });
  await expect(behind.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(back(page)).toBeFocused();

  // The browser's own Back walks the same steps: one step behind Search is Changes.
  await page.goBack();
  await expect(section(page, 'Changes')).toHaveAttribute('aria-current', 'page');
});

test('on a phone, holding the back arrow lists the steps behind in a sheet', async ({ pairedPage: page, repository }) => {
  await repository.commit('docs/guide.md', '# Guide\n\nRead me first.\n', 'Write the guide');
  await openRepository(page, repository);
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.getByRole('navigation', { name: 'Repository views' });
  await nav.getByRole('button', { name: 'History' }).click();
  const list = page.getByRole('list', { name: 'Commit history' });
  await list.getByRole('button', { name: 'Write the guide', exact: true }).click();
  const viewer = page.getByRole('main');
  await viewer.getByRole('button', { name: 'Open file' }).first().click();
  await expect(viewer.getByRole('heading', { name: 'Write the guide', level: 2 })).toBeHidden();

  const arrow = page.getByRole('banner').getByRole('button', { name: 'Back', exact: true });
  await arrow.hover();
  await page.mouse.down();
  const sheet = page.getByRole('dialog', { name: 'Go back to' });
  await expect(sheet).toBeVisible();
  await page.mouse.up();
  await expect(sheet.getByRole('button', { name: /^(Write the guide|History|Files)/ })).toHaveText([/^Write the guide/, /^History/, /^Files/]);
  // Holding did not take a step: the file is still open behind the sheet.
  await expect(viewer.getByRole('heading', { name: 'Write the guide', level: 2 })).toBeHidden();
  await sheet.getByRole('button', { name: /^History/ }).click();
  await expect(sheet).toBeHidden();
  await expect(list).toBeVisible();
});

test.describe('with a touch screen', () => {
  test.use({ hasTouch: true });

  test('on a phone, a finger held on the back arrow lists the steps behind without taking one', async ({ pairedPage: page, repository }) => {
    await repository.commit('docs/guide.md', '# Guide\n\nRead me first.\n', 'Write the guide');
    await openRepository(page, repository);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('navigation', { name: 'Repository views' }).getByRole('button', { name: 'History' }).click();
    await page.getByRole('list', { name: 'Commit history' }).getByRole('button', { name: 'Write the guide', exact: true }).click();
    const viewer = page.getByRole('main');
    await viewer.getByRole('button', { name: 'Open file' }).first().click();
    await expect(viewer.getByRole('heading', { name: 'Write the guide', level: 2 })).toBeHidden();

    // A finger, through the browser's own touch input: down, held, then lifted.
    const box = (await page.getByRole('banner').getByRole('button', { name: 'Back', exact: true }).boundingBox())!;
    const touch = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] });
    const sheet = page.getByRole('dialog', { name: 'Go back to' });
    await expect(sheet).toBeVisible();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(sheet.getByRole('button', { name: /^Write the guide/ })).toBeVisible();
    // Lifting the finger took no step: the file is still open behind the sheet.
    await expect(viewer.getByRole('heading', { name: 'Write the guide', level: 2 })).toBeHidden();
    await sheet.getByRole('button', { name: /^Write the guide/ }).tap();
    await expect(viewer.getByRole('heading', { name: 'Write the guide', level: 2 })).toBeVisible();
  });
});
