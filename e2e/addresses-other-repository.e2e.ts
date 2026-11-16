import type { Page } from '@playwright/test';
import { addRepository, addressRepositoryId as idOf, openRepository, otherRepository, repositoryPicker as picker } from './support/app';
import { expect, test } from './support/fixtures';

// Each page has its own open repository: an address or a reload opens its repository in that
// page alone. Against a server older than that, where every page shares one, it offers to.

const section = (page: Page, name: string) => page.getByRole('navigation', { name: 'Repository views' }).getByRole('button', { name, exact: true });

/** Takes a notice's action. A notice opens up to show it when the pointer is on it. */
async function takeOffer(page: Page, title: string): Promise<void> {
  const notice = page.locator('[data-sileo-toast]').filter({ hasText: title });
  await notice.hover();
  await notice.locator('[data-sileo-button]').filter({ hasText: /^Open$/ }).click();
}

/** Makes a page take the server for one that has a single repository for every client, as older servers do. */
async function asOlderServer(page: Page): Promise<void> {
  await page.routeWebSocket(/\/ws$/, (client) => {
    const server = client.connectToServer();
    // An older server ignores the repository the page asks for at start.
    client.onMessage((message) => {
      const request = JSON.parse(String(message)) as { type?: string; command?: string; args?: unknown[] };
      server.send(request.type === 'request' && request.command === 'app:bootstrap' ? JSON.stringify({ ...request, args: [] }) : message);
    });
    server.onMessage((message) => {
      const parsed = JSON.parse(String(message)) as { type?: string; result?: { ok?: boolean; value?: { server?: Record<string, unknown> } } };
      if (parsed.type !== 'result' || !parsed.result?.value?.server) return client.send(message);
      delete parsed.result.value.server.repositoryPerClient;
      client.send(JSON.stringify(parsed));
    });
  });
}

test('an address for another repository opens it in that page alone', async ({ pairedPage: page, repository }) => {
  const second = await otherRepository('second-project');
  try {
    await openRepository(page, repository);
    await addRepository(page, second);
    await expect(page).toHaveURL(/\/r\/[A-Za-z0-9_-]+\/files$/);
    const secondId = idOf(page);
    await addRepository(page, { path: repository.path, name: repository.name });
    await expect(picker(page)).toContainText(repository.name);

    const other = await page.context().newPage();
    await other.goto(`${new URL(page.url()).origin}/r/${secondId}/history`);
    await expect(picker(other)).toContainText('second-project');
    await expect(other).toHaveURL(new RegExp(`/r/${secondId}/history$`));
    await expect(section(other, 'History')).toHaveAttribute('aria-current', 'page');
    await expect(other.getByText('Open second-project?')).toHaveCount(0);
    // The first page stays where it was, and so does what a new page opens: the one chosen last.
    await other.waitForTimeout(500);
    await expect(picker(page)).toContainText(repository.name);
    await expect(page).not.toHaveURL(new RegExp(`/r/${secondId}/`));
    await other.close();
  } finally {
    await second.dispose();
  }
});

test('a page reloaded or reopened comes back to its own repository while another page has a different one', async ({ pairedPage: page, repository }) => {
  const second = await otherRepository('second-project');
  try {
    await openRepository(page, repository);
    await section(page, 'History').click();
    await expect(page).toHaveURL(/\/history$/);
    const firstAddress = page.url();
    const other = await page.context().newPage();
    await other.goto(new URL(firstAddress).origin);
    await expect(picker(other)).toContainText(repository.name);
    await addRepository(other, second);
    await expect(picker(page)).toContainText(repository.name);

    await page.reload();
    await expect(picker(page)).toContainText(repository.name);
    await expect(page).toHaveURL(firstAddress);
    await expect(section(page, 'History')).toHaveAttribute('aria-current', 'page');
    await other.reload();
    await expect(picker(other)).toContainText('second-project');

    // The page goes away, as a discarded tab does, and comes back from its history entry.
    await page.goto('about:blank');
    await page.goBack();
    await expect(picker(page)).toContainText(repository.name);
    await expect(page).toHaveURL(firstAddress);
    await expect(page.getByText(`Open ${repository.name}?`)).toHaveCount(0);
    await page.waitForTimeout(500);
    await expect(picker(other)).toContainText('second-project');
    await other.close();
  } finally {
    await second.dispose();
  }
});

test('against a server with one repository for every page, an address offers its repository instead of opening it', async ({ pairedPage: page, repository }) => {
  const second = await otherRepository('second-project');
  try {
    await openRepository(page, repository);
    await addRepository(page, second);
    const secondId = idOf(page);
    await addRepository(page, { path: repository.path, name: repository.name });

    const other = await page.context().newPage();
    await asOlderServer(other);
    await other.goto(`${new URL(page.url()).origin}/r/${secondId}/history`);
    // This server would have opened it; the page, told nothing, behaves as it does with an older one.
    await expect(other.getByText('Open second-project?')).toBeVisible();
    await expect(picker(other)).toContainText(repository.name);
    await takeOffer(other, 'Open second-project?');
    await expect(picker(other)).toContainText('second-project');
    await expect(other).toHaveURL(new RegExp(`/r/${secondId}/history$`));
    await other.close();
  } finally {
    await second.dispose();
  }
});

test('two quick Backs across repositories land on the second step back and keep the steps ahead', async ({ pairedPage: page, repository }) => {
  const second = await otherRepository('second-project');
  const third = await otherRepository('third-project');
  try {
    await openRepository(page, repository);
    await page.getByRole('tree', { name: 'Files' }).getByRole('treeitem', { name: 'README.md' }).click();
    await expect(page).toHaveURL(/\/file\/README\.md$/);
    const readme = page.url();
    await addRepository(page, second);
    const secondFiles = page.url();
    await addRepository(page, third);
    await expect(page).toHaveURL(/\/files$/);

    // The second Back comes while the first one is still opening its repository.
    await page.evaluate(async () => {
      const back = [...document.querySelectorAll<HTMLButtonElement>('header button')].find((button) => button.getAttribute('aria-label') === 'Back')!;
      const moved = new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
      back.click();
      await moved;
      back.click();
    });
    await expect(picker(page)).toContainText(repository.name);
    await expect(page).toHaveURL(readme);
    await expect(page.getByRole('tablist', { name: 'Open files' }).getByRole('tab', { name: /README\.md/, selected: true })).toBeVisible();
    const forward = page.getByRole('banner').getByRole('button', { name: 'Forward', exact: true });
    await expect(forward).toBeEnabled();
    await forward.click();
    await expect(picker(page)).toContainText('second-project');
    await expect(page).toHaveURL(secondFiles);
    await forward.click();
    await expect(picker(page)).toContainText('third-project');
  } finally {
    await second.dispose();
    await third.dispose();
  }
});

test('opening a file address saves no tab for a file that does not exist', async ({ pairedPage: page, repository }) => {
  await openRepository(page, repository);
  const id = idOf(page);
  const other = await page.context().newPage();
  const saved: string[] = [];
  other.on('websocket', (socket) => socket.on('framesent', (frame) => {
    const text = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf8');
    if (text.includes('open-files')) saved.push(text);
  }));
  await other.goto(`${new URL(page.url()).origin}/r/${id}/file/made/up/elsewhere.txt`);
  await expect(other.getByRole('tree', { name: 'Files' }).getByRole('treeitem', { name: 'README.md' })).toBeVisible();
  await other.waitForTimeout(1_000);
  expect(saved.filter((text) => text.includes('made/up/elsewhere.txt'))).toEqual([]);
  await expect(other.getByText('That file no longer exists')).toBeVisible();
  await other.close();
});
