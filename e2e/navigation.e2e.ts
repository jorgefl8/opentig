import { writeFile } from 'node:fs/promises';
import path from 'node:path';
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
  // A commit opens as the list of its files, which is all resting on it reads.
  const restedOnCommit = await requestsDuring(page, () => commit.hover());
  expect(restedOnCommit, JSON.stringify(restedOnCommit)).toEqual({ 'commits:files': 1 });
  const openedCommit = await requestsDuring(page, async () => {
    await commit.click();
    await expect(page.getByText('notes.txt').last()).toBeVisible();
  });
  expect(openedCommit, JSON.stringify(openedCommit)).toEqual({});
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

test('a section shows what it was left with: the open commit, the scroll position and the search text', async ({ pairedPage: page, repository }) => {
  // Enough commits for the history to scroll.
  for (let index = 1; index <= 60; index++) await repository.git('commit', '--allow-empty', '-q', '-m', `Step ${index}`);
  await openRepository(page, repository);
  const sidebar = page.getByRole('complementary');
  const viewer = page.getByRole('main');

  await section(page, 'Search').click();
  const search = sidebar.getByRole('textbox', { name: 'Search in repository' });
  await search.fill('Step');

  await section(page, 'History').click();
  const history = sidebar.getByRole('list', { name: 'Commit history' });
  await expect(history.getByRole('button', { name: 'Step 60', exact: true })).toBeVisible();
  await history.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const commit = history.getByRole('button', { name: 'Step 5', exact: true });
  await commit.click();
  await expect(viewer.getByRole('heading', { name: 'Step 5', level: 2 })).toBeVisible();
  const scrolled = await history.evaluate((element) => element.scrollTop);
  expect(scrolled).toBeGreaterThan(0);

  await section(page, 'Changes').click();
  await expect(sidebar.getByText('No changes')).toBeVisible();
  await expect(viewer.getByRole('heading', { name: 'Step 5', level: 2 })).toBeHidden();

  const back = await requestsDuring(page, async () => {
    await section(page, 'History').click();
    await expect(viewer.getByRole('heading', { name: 'Step 5', level: 2 })).toBeVisible();
  });
  await expect(commit).toHaveAttribute('aria-pressed', 'true');
  expect(await history.evaluate((element) => element.scrollTop)).toBe(scrolled);
  // Neither the history nor the commit is read again.
  expect(back['commits:list'], JSON.stringify(back)).toBeUndefined();
  expect(back['commits:files'], JSON.stringify(back)).toBeUndefined();

  await section(page, 'Search').click();
  await expect(search).toHaveValue('Step');
});

test('a file, a change or a commit opened again asks for nothing until it changes, and a commit reads only the files unfolded', async ({ pairedPage: page, repository }) => {
  await repository.commit('notes.txt', 'First line\n', 'Add the notes');
  await repository.commit('other.txt', 'Other line\n', 'Add another file');
  await openRepository(page, repository);
  const sidebar = page.getByRole('complementary');
  const viewer = page.getByRole('main');

  // Files: the second visit to a file reads nothing; a change on disk is read and shown.
  const tree = sidebar.getByRole('tree', { name: 'Files' });
  const openFile = async (name: string, text: string) => {
    await tree.getByRole('treeitem', { name }).click();
    await expect(page.getByRole('textbox', { name })).toContainText(text);
  };
  await openFile('notes.txt', 'First line');
  await openFile('other.txt', 'Other line');
  const fileAgain = await requestsDuring(page, () => openFile('notes.txt', 'First line'));
  expect(fileAgain['repository:read-file'], JSON.stringify(fileAgain)).toBeUndefined();
  await writeFile(path.join(repository.path, 'notes.txt'), 'Changed on disk\n');
  await expect(page.getByRole('textbox', { name: 'notes.txt' })).toContainText('Changed on disk');
  await openFile('other.txt', 'Other line');
  await openFile('notes.txt', 'Changed on disk');

  // Changes: going back to a change already shown reads nothing.
  await writeFile(path.join(repository.path, 'other.txt'), 'Other line, edited\n');
  // The tab counts the changed files.
  await page.getByRole('navigation', { name: 'Repository views' }).getByRole('button', { name: 'Changes 2', exact: true }).click();
  const change = (name: string) => sidebar.getByRole('treeitem', { name: new RegExp(`^View changes for ${name.replace('.', '\\.')} `) });
  await change('notes.txt').click();
  await expect(viewer.getByText('Changed on disk')).toBeVisible();
  await change('other.txt').click();
  await expect(viewer.getByText('Other line, edited')).toBeVisible();
  const diffAgain = await requestsDuring(page, async () => {
    await change('notes.txt').click();
    await expect(viewer.getByText('Changed on disk')).toBeVisible();
  });
  expect(diffAgain['diff:get'], JSON.stringify(diffAgain)).toBeUndefined();

  // History: a commit reads its files' list, then one diff per file unfolded, once.
  await section(page, 'History').click();
  const history = sidebar.getByRole('list', { name: 'Commit history' });
  const opened = await requestsDuring(page, async () => {
    await history.getByRole('button', { name: 'Add the notes', exact: true }).click();
    await expect(viewer.getByRole('heading', { name: 'Add the notes', level: 2 })).toBeVisible();
  });
  expect(opened['diff:commit'], JSON.stringify(opened)).toBeUndefined();
  expect(opened['diff:commit-file'], JSON.stringify(opened)).toBeUndefined();
  const file = viewer.getByRole('button', { name: /^notes\.txt$/ });
  const unfolded = await requestsDuring(page, async () => {
    await file.click();
    await expect(viewer.getByRole('code').filter({ hasText: 'First line' })).toBeVisible();
  });
  expect(unfolded, JSON.stringify(unfolded)).toEqual({ 'diff:commit-file': 1 });
  await history.getByRole('button', { name: 'Add another file', exact: true }).click();
  await expect(viewer.getByRole('heading', { name: 'Add another file', level: 2 })).toBeVisible();
  const reopened = await requestsDuring(page, async () => {
    await history.getByRole('button', { name: 'Add the notes', exact: true }).click();
    await file.click();
    await expect(viewer.getByRole('code').filter({ hasText: 'First line' })).toBeVisible();
  });
  expect(reopened['commits:files'], JSON.stringify(reopened)).toBeUndefined();
  expect(reopened['diff:commit-file'], JSON.stringify(reopened)).toBeUndefined();
});
