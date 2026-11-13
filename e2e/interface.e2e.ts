import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { openRepository } from './support/app';
import { expect, test } from './support/fixtures';

const PHONE = { width: 390, height: 844 };

/** Opens Settings on `section`; Settings otherwise reopens on the last section shown. */
async function openSettings(page: Page, section = 'General') {
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Close settings' }) });
  await settings.getByRole('button', { name: section, exact: true }).click();
  const opened = page.getByRole('dialog', { name: section });
  await expect(opened.getByRole('heading', { name: section, level: 2 })).toBeVisible();
  return opened;
}

/** What each sidebar section shows first, so a test can tell which one is open. */
function sectionContent(page: Page) {
  const sidebar = page.getByRole('complementary');
  return {
    changes: sidebar.getByText('No changes'),
    files: sidebar.getByRole('tree', { name: 'Files' }),
    history: sidebar.getByRole('list', { name: 'Commit history' }),
    github: sidebar.getByText(/pull requests are unavailable here/),
    search: sidebar.getByRole('textbox', { name: 'Search in repository' }),
  };
}

/** The text a drag or double-click left selected on the page. */
function selectedText(page: Page) {
  return page.evaluate(() => window.getSelection()?.toString() ?? '');
}

test('dragging or double-clicking app chrome selects nothing, while diff text stays selectable', async ({ pairedPage: page, repository }) => {
  await repository.commit('src/app.js', 'const a = 1;\nconst total = 2;\n', 'Add app');
  await writeFile(path.join(repository.path, 'src/app.js'), 'const a = 1;\nconst total = 3;\n');
  await openRepository(page, repository);
  const sidebar = page.getByRole('complementary');
  await page.getByRole('navigation', { name: 'Repository views' }).getByRole('button', { name: 'Changes 1' }).click();
  const row = sidebar.getByRole('treeitem', { name: /^View changes for src\/app\.js / });
  await row.getByRole('button', { name: 'View changes for src/app.js' }).click();
  const code = page.getByRole('code');
  await expect(code).toContainText('const total = 3;');

  // A drag from the summary above the list of changes across the list.
  const summary = sidebar.getByText('1 change', { exact: true });
  const from = (await summary.boundingBox())!;
  const to = (await row.boundingBox())!;
  await page.mouse.move(from.x + 4, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width - 4, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
  expect(await selectedText(page)).toBe('');
  await summary.dblclick();
  expect(await selectedText(page)).toBe('');

  // The diff is content to read and copy.
  await code.getByText('total', { exact: true }).last().dblclick();
  expect(await selectedText(page)).toBe('total');
});

test('the theme chosen in Settings applies at once and is kept after a reload', async ({ pairedPage: page, repository }) => {
  await openRepository(page, repository);
  const html = page.locator('html');
  await expect(html).toHaveClass(/\blight\b/);

  const settings = await openSettings(page);
  const theme = settings.getByRole('radiogroup', { name: 'Theme' });
  await expect(theme.getByRole('radio', { name: 'System' })).toBeChecked();
  await theme.getByRole('radio', { name: 'Dark' }).click();
  await expect(html).toHaveClass(/\bdark\b/);

  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Select project or repository' })).toContainText(repository.name);
  await expect(html).toHaveClass(/\bdark\b/);
  const reopened = await openSettings(page);
  await expect(reopened.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Dark' })).toBeChecked();

  await reopened.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Light' }).click();
  await expect(html).toHaveClass(/\blight\b/);
  await expect(html).not.toHaveClass(/\bdark\b/);
});

test('the System theme follows the device color scheme', async ({ pairedPage: page, repository }) => {
  await openRepository(page, repository);
  const html = page.locator('html');

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html).toHaveClass(/\bdark\b/);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(html).toHaveClass(/\blight\b/);
  await expect(html).not.toHaveClass(/\bdark\b/);
});

test('the sidebar collapses to a rail with its button and Ctrl+B, and stays collapsed after a reload', async ({ pairedPage: page, repository }) => {
  await openRepository(page, repository);
  const views = page.getByRole('navigation', { name: 'Repository views' });
  await page.keyboard.press('Control+3');
  await expect(sectionContent(page).history).toBeVisible();

  await views.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(views.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  await expect(sectionContent(page).history).toBeHidden();

  await page.keyboard.press('Control+b');
  await expect(views.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();
  await expect(sectionContent(page).history).toBeVisible();

  await page.keyboard.press('Control+b');
  await expect(views.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  await page.reload();
  await expect(views.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();

  // A rail icon opens the sidebar on that section.
  await views.getByRole('button', { name: 'Search' }).click();
  await expect(views.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();
  await expect(sectionContent(page).search).toBeVisible();
});

test('Ctrl+1 to Ctrl+5 open each sidebar section, and the last one is reopened after a reload', async ({ pairedPage: page, repository }) => {
  await openRepository(page, repository);
  const sections = sectionContent(page);

  await page.keyboard.press('Control+1');
  await expect(sections.changes).toBeVisible();
  await page.keyboard.press('Control+2');
  await expect(sections.files).toBeVisible();
  await page.keyboard.press('Control+3');
  await expect(sections.history).toBeVisible();
  await page.keyboard.press('Control+4');
  await expect(sections.github).toBeVisible();
  await page.keyboard.press('Control+5');
  await expect(sections.search).toBeVisible();

  await page.keyboard.press('Control+3');
  await expect(sections.history).toBeVisible();
  await page.reload();
  await expect(sections.history).toBeVisible();
});

test('a shortcut rebound in Settings replaces the default one', async ({ pairedPage: page, repository }) => {
  await openRepository(page, repository);
  const settings = await openSettings(page, 'Shortcuts');
  const general = settings.getByRole('region', { name: 'General' }).first();

  await general.getByRole('button', { name: 'Ctrl B' }).click();
  await expect(general.getByRole('button', { name: 'Press a key…' })).toBeVisible();
  await page.keyboard.press('Control+Shift+K');
  await expect(general.getByRole('button', { name: 'Ctrl Shift K' })).toBeVisible();

  await settings.getByRole('button', { name: 'Close settings' }).click();
  await expect(settings).toBeHidden();
  const views = page.getByRole('navigation', { name: 'Repository views' });

  await page.keyboard.press('Control+b');
  await expect(views.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();
  await page.keyboard.press('Control+Shift+K');
  await expect(views.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();

  // Resetting restores the default.
  const reopened = await openSettings(page, 'Shortcuts');
  await reopened.getByRole('region', { name: 'General' }).first().getByRole('button', { name: 'Reset to default' }).click();
  await expect(reopened.getByRole('region', { name: 'General' }).first().getByRole('button', { name: 'Ctrl B' })).toBeVisible();
  await reopened.getByRole('button', { name: 'Close settings' }).click();
  await page.keyboard.press('Control+b');
  await expect(views.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();
});

test('a phone shows one pane at a time with bottom tabs and a back arrow in viewers', async ({ pairedPage: page, repository }) => {
  await repository.commit('src/app.js', 'const a = 1;\n', 'Add the app entry point');
  await openRepository(page, repository);
  await page.setViewportSize(PHONE);

  const tabs = page.getByRole('navigation', { name: 'Repository views' });
  await expect(page.getByRole('button', { name: 'Repository and branch' })).toContainText(repository.name);
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeHidden();

  await tabs.getByRole('button', { name: 'History' }).click();
  const list = page.getByRole('list', { name: 'Commit history' });
  await list.getByRole('button', { name: 'Add the app entry point', exact: true }).click();

  // The viewer replaces the list, and focus moves to its back arrow.
  const back = page.getByRole('button', { name: 'Back' });
  await expect(back).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Add the app entry point', level: 2 })).toBeVisible();
  await expect(list).toBeHidden();

  await back.click();
  await expect(list).toBeVisible();
  await expect(page.getByRole('button', { name: 'Repository and branch' })).toBeVisible();

  await tabs.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('textbox', { name: 'Search in repository' })).toBeVisible();
});

test('on a phone the repository sheet shows the repository and branch', async ({ pairedPage: page, repository }) => {
  await openRepository(page, repository);
  await page.setViewportSize(PHONE);

  await page.getByRole('button', { name: 'Repository and branch' }).click();
  const sheet = page.getByRole('dialog', { name: 'Repository' });
  await expect(sheet.getByRole('combobox', { name: 'Select project or repository' })).toContainText(repository.name);
  await expect(sheet.getByRole('combobox', { name: 'Select branch' })).toContainText('main');
  await expect(sheet.getByRole('button', { name: 'Open another repository' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('on a phone Settings opens as a sheet that drills into sections and hides Shortcuts', async ({ pairedPage: page, repository }) => {
  await openRepository(page, repository);
  await page.setViewportSize(PHONE);

  await page.getByRole('button', { name: 'Settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Settings' });
  // General settings lead, followed by a row for each other section.
  await expect(sheet.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
  const sections = sheet.getByRole('navigation', { name: 'Settings sections' });
  await expect(sections.getByRole('button', { name: 'Web access' })).toBeVisible();
  await expect(sections.getByRole('button', { name: 'Shortcuts' })).toHaveCount(0);

  await sections.getByRole('button', { name: 'Web access' }).click();
  const webAccess = page.getByRole('dialog', { name: 'Web access' });
  await expect(webAccess.getByRole('switch', { name: 'Web access' })).toBeChecked();
  await webAccess.getByRole('button', { name: 'Back to Settings' }).click();
  await expect(sheet.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();

  // Sheets close with Escape, a downward drag, or a press outside.
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});
