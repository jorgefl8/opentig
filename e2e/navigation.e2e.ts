import type { Page } from '@playwright/test';
import { openRepository, requestsDuring, requestTotal } from './support/app';
import { expect, test } from './support/fixtures';

// What moving around the app asks of the server. The budgets are request counts,
// which are the same on any machine, rather than times.

test.use({ countRequests: true });

const section = (page: Page, name: string) => page.getByRole('navigation', { name: 'Repository views' }).getByRole('button', { name, exact: true });

test('switching between sections stays within its request budget', async ({ pairedPage: page, repository }, testInfo) => {
  // A remote makes the periodic fetch real, as it is for most repositories.
  await repository.addRemote();
  await repository.commit('src/app.js', 'const total = 1;\n', 'Add app');
  await openRepository(page, repository);
  const sidebar = page.getByRole('complementary');
  const shown = {
    History: sidebar.getByRole('list', { name: 'Commit history' }),
    Changes: sidebar.getByText('No changes'),
    Files: sidebar.getByRole('tree', { name: 'Files' }),
    Search: sidebar.getByRole('textbox', { name: 'Search in repository' }),
  };

  const measured: Record<string, Record<string, number>> = {};
  const visit = async (label: string, ...names: Array<keyof typeof shown>) => {
    measured[label] = await requestsDuring(page, async () => {
      for (const name of names) {
        await section(page, name).click();
        await expect(shown[name]).toBeVisible();
      }
    });
  };
  await visit('first History', 'History');
  await visit('first Changes', 'Changes');
  await visit('first Files', 'Files');
  await visit('first Search', 'Search');
  await visit('back to Changes', 'Changes');
  await visit('back to History', 'History');
  await visit('through every section', 'Search', 'Files', 'Changes', 'History', 'Search');
  await testInfo.attach('requests-per-navigation', { body: JSON.stringify(measured, null, 2), contentType: 'application/json' });

  const all = Object.entries(measured);
  for (const [label, requested] of all) {
    const told = `${label}: ${JSON.stringify(requested)}`;
    // A section change never reads the whole repository again or asks GitHub about it.
    expect(requested['refs:worktrees'], told).toBeUndefined();
    expect(requested['github:repository-info'], told).toBeUndefined();
    // The fetch every 30 seconds may land inside one navigation, with the two reads that follow it.
    expect(requestTotal(requested), told).toBeLessThanOrEqual(requested['refs:fetch'] ? 6 : 3);
  }
  // A click does not fetch: only the timer does, and this journey is shorter than two of its turns.
  expect(all.filter(([, requested]) => requested['refs:fetch']).length, JSON.stringify(measured)).toBeLessThanOrEqual(1);
  // History is read when it first opens, not on every visit; the fetch may read it once more.
  expect(all.reduce((sum, [, requested]) => sum + (requested['commits:list'] ?? 0), 0), JSON.stringify(measured)).toBeLessThanOrEqual(3);
});

test('resting the pointer on a file or a commit reads it, so the click has nothing left to load', async ({ pairedPage: page, repository }) => {
  await repository.commit('notes.txt', 'First line\n', 'Add the notes');
  await openRepository(page, repository);
  const sidebar = page.getByRole('complementary');

  // Files is the section a new repository opens on.
  const file = sidebar.getByRole('tree', { name: 'Files' }).getByRole('treeitem', { name: 'notes.txt' });
  const passedOver = await requestsDuring(page, async () => {
    // Crossing rows on the way somewhere else asks for nothing.
    await sidebar.getByRole('treeitem', { name: 'README.md' }).hover();
    await page.mouse.move(700, 400);
  });
  expect(passedOver['repository:read-file'], JSON.stringify(passedOver)).toBeUndefined();
  const rested = await requestsDuring(page, () => file.hover());
  expect(rested['repository:read-file'], JSON.stringify(rested)).toBe(1);
  const opened = await requestsDuring(page, async () => {
    await file.click();
    await expect(page.getByRole('textbox', { name: 'notes.txt' })).toContainText('First line');
  });
  expect(opened['repository:read-file'], JSON.stringify(opened)).toBeUndefined();

  await section(page, 'History').click();
  const commit = sidebar.getByRole('list', { name: 'Commit history' }).getByRole('button', { name: 'Add the notes', exact: true });
  const restedOnCommit = await requestsDuring(page, () => commit.hover());
  expect(restedOnCommit['diff:commit'], JSON.stringify(restedOnCommit)).toBe(1);
  const openedCommit = await requestsDuring(page, async () => {
    await commit.click();
    await expect(page.getByText('notes.txt').last()).toBeVisible();
  });
  expect(openedCommit['diff:commit'], JSON.stringify(openedCommit)).toBeUndefined();
});

test('the sections and viewers are downloaded while the app is idle, so a first click needs no more code', async ({ pairedPage: page, repository }) => {
  await repository.commit('notes.txt', 'First line\n', 'Add the notes');
  let scripts = 0;
  page.on('request', (request) => { if (request.resourceType() === 'script') scripts += 1; });
  await openRepository(page, repository);
  const sidebar = page.getByRole('complementary');
  // The app goes on downloading in its idle moments; wait until it has stopped.
  await expect.poll(async () => {
    const before = scripts;
    await page.waitForTimeout(1_500);
    return scripts === before;
  }, { timeout: 30_000 }).toBe(true);

  // From here on no code can be downloaded: whatever a click needs must already be there.
  await page.route('**/assets/**/*.js', (route) => route.abort());
  await section(page, 'History').click();
  const history = sidebar.getByRole('list', { name: 'Commit history' });
  await expect(history).toBeVisible();
  await history.getByRole('button', { name: 'Add the notes', exact: true }).click();
  await expect(page.getByText('notes.txt').last()).toBeVisible();
  await section(page, 'Search').click();
  await expect(sidebar.getByRole('textbox', { name: 'Search in repository' })).toBeVisible();
  await section(page, 'Files').click();
  await sidebar.getByRole('tree', { name: 'Files' }).getByRole('treeitem', { name: 'notes.txt' }).click();
  await expect(page.getByRole('textbox', { name: 'notes.txt' })).toContainText('First line');
  await section(page, 'Changes').click();
  await expect(sidebar.getByText('No changes')).toBeVisible();
});
