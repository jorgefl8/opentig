import type { Browser, Locator, Page } from '@playwright/test';
import { openRepository } from './support/app';
import { expect, test } from './support/fixtures';

const REJECTED = 'This code is invalid, expired, or already used. Create a new one from OpenTig.';

/** Opens Settings → Web access; the toolbar needs an open repository. */
async function openWebAccessSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Close settings' }) });
  await settings.getByRole('button', { name: 'Web access' }).click();
  await expect(page.getByRole('heading', { name: 'Web access', level: 2 })).toBeVisible();
  return page.getByRole('dialog', { name: 'Web access' });
}

/** Creates a pairing link in Settings and returns it. */
async function createPairingLink(settings: Locator): Promise<string> {
  const pairing = settings.getByRole('region', { name: 'Pair a browser' });
  await pairing.getByRole('button', { name: 'Create pairing link' }).click();
  const ready = pairing.getByRole('status').filter({ hasText: 'Pairing link ready' });
  const link = ready.getByText(/\/pair#token=/);
  await expect(link).toBeVisible();
  return (await link.textContent())!.trim();
}

/** Pairs a fresh browser context through `link` under `deviceName`; the server already has `repositoryName` open. */
async function pairNewBrowser(browser: Browser, link: string, deviceName: string, repositoryName: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(link);
  await expect(page.getByRole('textbox', { name: 'Pairing code' })).not.toBeEmpty();
  await page.getByRole('textbox', { name: 'Device name' }).fill(deviceName);
  await page.getByRole('button', { name: 'Pair browser' }).click();
  await expect(page.getByRole('combobox', { name: 'Select project or repository' })).toContainText(repositoryName, { timeout: 20_000 });
  return page;
}

test('an unpaired browser is asked to authenticate and can reach the pairing form', async ({ page, server }) => {
  await page.goto(server.origin);

  const notice = page.getByRole('status').filter({ has: page.getByRole('heading', { name: 'Authentication required' }) });
  await expect(notice).toBeVisible();
  await expect(notice.getByText('opentig pair', { exact: true })).toBeVisible();

  await notice.getByRole('button', { name: 'Check browser access' }).click();
  await expect(page).toHaveURL(/\/pair$/);
  await expect(page.getByRole('heading', { name: 'Pair this browser', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pair browser' })).toBeDisabled();
});

test('a wrong pairing code is rejected with the documented message', async ({ page, server }) => {
  await page.goto(`${server.origin}/pair`);
  await page.getByRole('textbox', { name: 'Pairing code' }).fill('not-a-real-pairing-code');
  await page.getByRole('button', { name: 'Pair browser' }).click();

  await expect(page.getByRole('alert')).toHaveText(REJECTED);
  await expect(page).toHaveURL(/\/pair$/);
  await expect(page.getByRole('heading', { name: 'Pair this browser' })).toBeVisible();
});

test('a pairing link works only once and its secret leaves the address bar', async ({ pairedPage, server, browser }) => {
  // pairedPage already used the startup link.
  await expect(pairedPage.getByRole('heading', { name: 'OpenTig', level: 1 })).toBeVisible();

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(server.pairingLink);
  await expect(page.getByRole('textbox', { name: 'Pairing code' })).not.toBeEmpty();
  expect(page.url()).not.toContain('token=');

  await page.getByRole('button', { name: 'Pair browser' }).click();
  await expect(page.getByRole('alert')).toHaveText(REJECTED);
  await context.close();
});

test('a paired browser stays signed in after a reload and skips the pairing form', async ({ pairedPage: page, server }) => {
  await expect(page.getByRole('heading', { name: 'OpenTig', level: 1 })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'OpenTig', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Authentication required' })).toBeHidden();

  // Opening /pair checks the saved session first and returns to the app.
  await page.goto(`${server.origin}/pair`);
  await expect(page).not.toHaveURL(/\/pair/);
  await expect(page.getByRole('heading', { name: 'OpenTig', level: 1 })).toBeVisible();
});

test('a link created in Settings pairs another browser, which then appears in the session list', async ({ pairedPage: page, repository, browser }) => {
  await openRepository(page, repository);
  const settings = await openWebAccessSettings(page);
  const link = await createPairingLink(settings);

  const phone = await pairNewBrowser(browser, link, 'E2E Phone', repository.name);

  const sessions = settings.getByRole('region', { name: 'Owner sessions' });
  await expect(sessions.getByRole('button', { name: 'Revoke E2E Phone session' })).toBeVisible();
  await expect(sessions.getByText('This session')).toHaveCount(1);
  await phone.context().close();
});

test('a paired browser can be renamed from Settings', async ({ pairedPage: page, repository }) => {
  await openRepository(page, repository);
  const settings = await openWebAccessSettings(page);
  const sessions = settings.getByRole('region', { name: 'Owner sessions' });
  const current = sessions.getByRole('button', { name: /^Rename / });
  await current.click();

  const rename = page.getByRole('dialog', { name: 'Rename paired device' });
  await rename.getByRole('textbox', { name: 'Device name' }).fill('Work laptop');
  await rename.getByRole('button', { name: 'Save' }).click();
  await expect(rename).toBeHidden();

  await expect(sessions.getByRole('button', { name: 'Rename Work laptop' })).toBeVisible();
  await page.reload();
  const reopened = await openWebAccessSettings(page);
  await expect(reopened.getByRole('region', { name: 'Owner sessions' }).getByRole('button', { name: 'Rename Work laptop' })).toBeVisible();
});

test('revoking a browser from Settings signs only that browser out', async ({ pairedPage: page, repository, browser }) => {
  await openRepository(page, repository);
  const settings = await openWebAccessSettings(page);
  const phone = await pairNewBrowser(browser, await createPairingLink(settings), 'E2E Phone', repository.name);

  const sessions = settings.getByRole('region', { name: 'Owner sessions' });
  await sessions.getByRole('button', { name: 'Revoke E2E Phone session' }).click();
  const confirm = page.getByRole('dialog', { name: /Revoke/ });
  await confirm.getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(sessions.getByRole('button', { name: 'Revoke E2E Phone session' })).toBeHidden();

  await phone.reload();
  await expect(phone.getByRole('heading', { name: 'Authentication required' })).toBeVisible();

  // The browser that revoked it keeps working.
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Select project or repository' })).toContainText(repository.name);
  await phone.context().close();
});

test('pausing Web access asks first and then disconnects paired browsers', async ({ pairedPage: page, repository, server }) => {
  await openRepository(page, repository);
  const settings = await openWebAccessSettings(page);
  const webAccess = settings.getByRole('switch', { name: 'Web access' });

  await webAccess.click();
  const confirm = page.getByRole('dialog', { name: 'Disable Web access?' });
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  await expect(webAccess).toBeChecked();

  await webAccess.click();
  await confirm.getByRole('button', { name: 'Disable Web access' }).click();

  await page.goto(`${server.origin}/pair`);
  await expect(page.getByRole('heading', { name: 'Web access is paused', level: 1 })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Pairing code' })).toBeHidden();
});
