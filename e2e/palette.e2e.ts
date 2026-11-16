import type { Page } from '@playwright/test';
import { openRepository } from './support/app';
import { expect, test, type GitRepository } from './support/fixtures';

// The command palette: Ctrl+P on files, Ctrl+K on commands, and a tab for each other kind of thing.

const section = (page: Page, name: string) => page.getByRole('navigation', { name: 'Repository views' }).getByRole('button', { name, exact: true });
const back = (page: Page) => page.getByRole('banner').getByRole('button', { name: 'Back', exact: true });
const palette = (page: Page) => page.getByRole('dialog', { name: 'Command palette' });
const field = (page: Page) => palette(page).getByRole('combobox');
const tab = (page: Page, name: string) => palette(page).getByRole('tablist', { name: 'What to search' }).getByRole('tab', { name: new RegExp(`^${name}`) });

/** Opens the repository and waits until its status has loaded and no dialog is left. */
async function openLoadedRepository(page: Page, repository: GitRepository): Promise<void> {
  await openRepository(page, repository);
  await expect(page.getByRole('combobox', { name: 'Select branch' })).toContainText('main');
  await expect(page.getByRole('dialog', { name: 'Open a repository' })).toBeHidden();
}

const LONG_FILE = Array.from({ length: 300 }, (_, index) => `line ${index + 1} of the long file`).join('\n') + '\n';

test('Ctrl+P opens a file at the line written after its name', async ({ pairedPage: page, repository }) => {
  await repository.commit('src/long.txt', LONG_FILE, 'Add the long file');
  await openLoadedRepository(page, repository);

  await page.keyboard.press('Control+p');
  await expect(tab(page, 'Files')).toHaveAttribute('aria-selected', 'true');
  await field(page).fill('long.txt:250');
  const option = palette(page).getByRole('option', { name: /long\.txt/ });
  await expect(option).toContainText('Open at line 250');
  await field(page).press('Enter');

  await expect(palette(page)).toBeHidden();
  await expect(page.getByRole('tablist', { name: 'Open files' }).getByRole('tab', { name: /^src\/long\.txt/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('line 250 of the long file', { exact: true })).toBeInViewport();
});

test('Ctrl+K runs a command that opens a section, and Back returns from it', async ({ pairedPage: page, repository }) => {
  await openLoadedRepository(page, repository);
  await expect(section(page, 'Files')).toHaveAttribute('aria-current', 'page');

  await page.keyboard.press('Control+k');
  await expect(tab(page, 'Commands')).toHaveAttribute('aria-selected', 'true');
  await field(page).fill('history');
  await expect(palette(page).getByRole('option').first()).toContainText('Go to History');
  await field(page).press('Enter');

  await expect(palette(page)).toBeHidden();
  await expect(section(page, 'History')).toHaveAttribute('aria-current', 'page');
  await back(page).click();
  await expect(section(page, 'Files')).toHaveAttribute('aria-current', 'page');
});

test('the kind of search changes by a sign typed first, by Tab, by a click, and back with Backspace', async ({ pairedPage: page, repository }) => {
  await openLoadedRepository(page, repository);
  await page.keyboard.press('Control+p');

  await field(page).pressSequentially('@');
  await expect(tab(page, 'Branches')).toHaveAttribute('aria-selected', 'true');
  await expect(field(page)).toHaveValue('');
  await expect(field(page)).toHaveAttribute('placeholder', 'Search branches');
  await expect(palette(page).getByRole('option', { name: /^main/ })).toContainText('Show in History');

  await field(page).press('Tab');
  await expect(tab(page, 'Commits')).toHaveAttribute('aria-selected', 'true');
  // The field keeps the focus: Tab never leaves the palette.
  await expect(field(page)).toBeFocused();

  await tab(page, 'Repos').click();
  await expect(tab(page, 'Repos')).toHaveAttribute('aria-selected', 'true');
  await expect(field(page)).toBeFocused();
  await expect(palette(page).getByRole('option', { name: new RegExp(`^${repository.name}`) })).toContainText('Current');

  await field(page).press('Backspace');
  await expect(tab(page, 'Files')).toHaveAttribute('aria-selected', 'true');
  await field(page).press('Escape');
  await expect(palette(page)).toBeHidden();
});

test('a branch chosen in the palette is checked out, and a commit opens in History', async ({ pairedPage: page, repository }) => {
  await repository.git('branch', 'feature/palette');
  await repository.commit('notes.txt', 'First line\n', 'Add the notes');
  await openLoadedRepository(page, repository);

  await page.keyboard.press('Control+p');
  await field(page).pressSequentially('@feature');
  const branch = palette(page).getByRole('option', { name: /^feature\/palette/ });
  await expect(branch).toContainText('Switch');
  await field(page).press('Enter');
  await expect(palette(page)).toBeHidden();
  await expect(page.getByRole('combobox', { name: 'Select branch' })).toContainText('feature/palette');
  await expect.poll(() => repository.git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature/palette');

  // feature/palette began before the notes, so its newest commit is the first one.
  await page.keyboard.press('Control+p');
  await field(page).pressSequentially('~initial');
  await expect(palette(page).getByRole('option', { name: /^Initial commit/ })).toBeVisible();
  await field(page).press('Enter');
  await expect(palette(page)).toBeHidden();
  await expect(section(page, 'History')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('main').getByRole('heading', { name: 'Initial commit', level: 2 })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Commit history' }).getByRole('button', { name: 'Initial commit', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('a command that can’t run now says why, and choosing it does nothing', async ({ pairedPage: page, repository }) => {
  // Without a remote there is no upstream to pull from.
  await openLoadedRepository(page, repository);
  const head = await repository.git('rev-parse', 'HEAD');

  await page.keyboard.press('Control+k');
  await field(page).fill('pull');
  const pull = palette(page).getByRole('option', { name: /^Pull/ });
  await expect(pull).toContainText('This branch has no upstream to pull from');
  await expect(pull).toHaveAttribute('aria-disabled', 'true');
  await field(page).press('Enter');
  // The pointer can't choose it either.
  await pull.click({ force: true });
  await expect(palette(page)).toBeVisible();
  expect(await repository.git('rev-parse', 'HEAD')).toBe(head);

  // A query that matches nothing says so.
  await field(page).fill('no such command');
  await expect(palette(page).getByRole('status')).toContainText('No commands match “no such command”');
  await expect(palette(page).getByRole('option')).toHaveCount(0);
});
