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
