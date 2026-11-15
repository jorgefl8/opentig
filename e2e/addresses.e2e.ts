import type { Page } from '@playwright/test';
import { openRepository } from './support/app';
import { expect, test } from './support/fixtures';

// In a browser, every place has an address: it survives a reload, opens in another
// page, and the browser's own Back and Forward walk the same trail as the app's arrows.

const section = (page: Page, name: string) => page.getByRole('navigation', { name: 'Repository views' }).getByRole('button', { name, exact: true });
const LONG_FILE = Array.from({ length: 300 }, (_, index) => `line ${index + 1} of the notes`).join('\n') + '\n';

/** The repository's id, as its addresses name it. */
async function repositoryId(page: Page): Promise<string> {
  await expect(page).toHaveURL(/\/r\/[A-Za-z0-9_-]+\//);
  return new URL(page.url()).pathname.split('/')[2]!;
}

test('a commit reloads where it was, and the browser’s Back and Forward walk the same trail', async ({ pairedPage: page, repository }) => {
  await repository.commit('src/app.js', 'const total = 1;\n', 'Add app');
  await repository.commit('docs/guide.md', '# Guide\n', 'Write the guide');
  const oid = await repository.git('rev-parse', 'HEAD~1');
  await openRepository(page, repository);
  const id = await repositoryId(page);
  await expect(page).toHaveURL(new RegExp(`/r/${id}/files$`));

  await section(page, 'History').click();
  await expect(page).toHaveURL(new RegExp(`/r/${id}/history$`));
  const list = page.getByRole('list', { name: 'Commit history' });
  await list.getByRole('button', { name: 'Add app', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/r/${id}/commit/${oid}$`));

  await page.reload();
  const viewer = page.getByRole('main');
  await expect(viewer.getByRole('heading', { name: 'Add app', level: 2 })).toBeVisible();
  await expect(section(page, 'History')).toHaveAttribute('aria-current', 'page');

  // The browser's Back is the app's Back: one step, to History's list.
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/r/${id}/history$`));
  await expect(viewer.getByRole('heading', { name: 'Add app', level: 2 })).toBeHidden();
  await expect(page.getByRole('banner').getByRole('button', { name: 'Forward', exact: true })).toBeEnabled();
  await page.goForward();
  await expect(viewer.getByRole('heading', { name: 'Add app', level: 2 })).toBeVisible();
  // Scrolling and unfolding change the step, not the trail.
  await page.getByRole('main').getByRole('button', { name: /^src\/\s*app\.js$/ }).click();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/r/${id}/history$`));
});

test('an address pasted into another page opens the file at its line', async ({ pairedPage: page, repository }) => {
  await repository.commit('notes.txt', LONG_FILE, 'Add the notes');
  await openRepository(page, repository);
  const id = await repositoryId(page);

  const other = await page.context().newPage();
  await other.goto(`${new URL(page.url()).origin}/r/${id}/file/notes.txt#L200`);
  await expect(other.getByRole('tablist', { name: 'Open files' }).getByRole('tab', { name: /notes\.txt/, selected: true })).toBeVisible();
  await expect(other.getByText('line 200 of the notes', { exact: true })).toBeInViewport();
  await expect(other).toHaveURL(new RegExp(`/r/${id}/file/notes\\.txt#L200$`));
  // At the start of its trail there is nothing to go back to.
  await expect(other.getByRole('banner').getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
  await other.close();
});

test('an address that leads nowhere says so and opens the app, without an error page', async ({ pairedPage: page, repository }) => {
  await repository.commit('src/app.js', 'const total = 1;\n', 'Add app');
  await openRepository(page, repository);
  const id = await repositoryId(page);
  const origin = new URL(page.url()).origin;

  await page.goto(`${origin}/r/${id}/file/..%2F..%2Fetc%2Fpasswd`);
  await expect(page.getByText('That address doesn’t lead anywhere')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Select project or repository' })).toContainText(repository.name);

  await page.goto(`${origin}/r/0123456789abcdef/history`);
  await expect(page.getByText('OpenTig here doesn’t know that repository')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Select project or repository' })).toContainText(repository.name);
  await expect(page).toHaveURL(new RegExp(`/r/${id}/`));

  await page.goto(`${origin}/r/${id}/commit/${'0'.repeat(40)}`);
  await expect(page.getByText('That commit isn’t in this repository')).toBeVisible();
  await expect(section(page, 'History')).toHaveAttribute('aria-current', 'page');

  // Opening an address changed nothing in the repository.
  expect(await repository.git('status', '--porcelain')).toBe('');
});

test('a browser without a session pairs first, then lands on the address it was opened on', async ({ pairedPage: owner, repository, browser }) => {
  await openRepository(owner, repository);
  const id = await repositoryId(owner);
  const origin = new URL(owner.url()).origin;
  // A pairing link from Settings, as the owner would send it to another browser.
  await owner.getByRole('button', { name: 'Settings' }).click();
  const settings = owner.getByRole('dialog').filter({ has: owner.getByRole('button', { name: 'Close settings' }) });
  await settings.getByRole('button', { name: 'Web access' }).click();
  const pairing = owner.getByRole('dialog', { name: 'Web access' }).getByRole('region', { name: 'Pair a browser' });
  await pairing.getByRole('button', { name: 'Create pairing link' }).click();
  const shown = pairing.getByRole('status').filter({ hasText: 'Pairing link ready' }).getByText(/\/pair#token=/);
  await expect(shown).toBeVisible();
  const link = (await shown.textContent())!.trim();

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/r/${id}/history`);
  await expect(page.getByRole('heading', { name: 'Authentication required' })).toBeVisible();
  await page.goto(link);
  await page.getByRole('button', { name: 'Pair browser' }).click();
  await expect(page).toHaveURL(new RegExp(`/r/${id}/history$`), { timeout: 20_000 });
  await expect(section(page, 'History')).toHaveAttribute('aria-current', 'page');
  await context.close();
});

test('on a phone, an opened address starts the trail, so the arrow returns to the list', async ({ pairedPage: page, repository }) => {
  await repository.commit('src/app.js', 'const total = 1;\n', 'Add app');
  const oid = await repository.git('rev-parse', 'HEAD');
  await openRepository(page, repository);
  const id = await repositoryId(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${new URL(page.url()).origin}/r/${id}/commit/${oid}`);
  await expect(page.getByRole('main').getByRole('heading', { name: 'Add app', level: 2 })).toBeVisible();
  await page.getByRole('banner').getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Commit history' })).toBeVisible();
});
