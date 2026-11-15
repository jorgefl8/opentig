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

  const measured: Record<string, Record<string, number>> = {};
  const visit = async (label: string, name: string, shown: () => Promise<void>) => {
    measured[label] = await requestsDuring(page, async () => {
      await section(page, name).click();
      await shown();
    });
  };
  await visit('first History', 'History', () => expect(sidebar.getByRole('list', { name: 'Commit history' })).toBeVisible());
  await visit('first Changes', 'Changes', () => expect(sidebar.getByText('No changes')).toBeVisible());
  await visit('first Files', 'Files', () => expect(sidebar.getByRole('tree', { name: 'Files' })).toBeVisible());
  await visit('first Search', 'Search', () => expect(sidebar.getByRole('textbox', { name: 'Search in repository' })).toBeVisible());
  await visit('back to Changes', 'Changes', () => expect(sidebar.getByText('No changes')).toBeVisible());
  await visit('back to History', 'History', () => expect(sidebar.getByRole('list', { name: 'Commit history' })).toBeVisible());
  await visit('back to Search', 'Search', () => expect(sidebar.getByRole('textbox', { name: 'Search in repository' })).toBeVisible());
  await testInfo.attach('requests-per-navigation', { body: JSON.stringify(measured, null, 2), contentType: 'application/json' });

  for (const [label, requested] of Object.entries(measured)) {
    expect(requestTotal(requested), `${label}: ${JSON.stringify(requested)}`).toBeLessThanOrEqual(10);
  }
});
