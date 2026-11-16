import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { addRepository, addressRepositoryId, openRepository, otherRepository, repositoryPicker as picker } from './support/app';
import { expect, test } from './support/fixtures';

// Every page has its own open repository, and hears of changes to it as they happen: switching
// in one page, by the selector or by Back, moves no other, and each sees its own files change.

const views = (page: Page) => page.getByRole('navigation', { name: 'Repository views' });

/** Opens a saved repository from the selector. */
async function choose(page: Page, name: string): Promise<void> {
  await picker(page).click();
  await page.getByRole('listbox', { name: 'Select project or repository' }).getByRole('option', { name: new RegExp(`^${name}`) }).click();
  await expect(picker(page)).toContainText(name);
}

test('two pages on two repositories each keep theirs, and each sees its own files change on disk', async ({ pairedPage: page, repository }) => {
  const second = await otherRepository('second-project');
  const third = await otherRepository('third-project');
  try {
    await openRepository(page, repository);
    await addRepository(page, second);
    const secondId = addressRepositoryId(page);
    await addRepository(page, third);
    await choose(page, repository.name);

    const other = await page.context().newPage();
    await other.goto(`${new URL(page.url()).origin}/r/${secondId}/changes`);
    await expect(picker(other)).toContainText('second-project');

    // One page switches; the other stays where it is.
    await choose(page, 'third-project');
    await other.waitForTimeout(500);
    await expect(picker(other)).toContainText('second-project');
    await expect(other).toHaveURL(new RegExp(`/r/${secondId}/changes$`));

    await views(page).getByRole('button', { name: /^Changes/ }).click();
    await expect(page.getByText('No changes')).toBeVisible();
    await expect(other.getByText('No changes')).toBeVisible();

    // Neither page is reloaded or refreshed by hand: each hears of its own repository only.
    await writeFile(path.join(third.path, 'third-notes.txt'), 'Third.\n');
    await expect(page.getByRole('treeitem', { name: /third-notes\.txt/ })).toBeVisible();
    await writeFile(path.join(second.path, 'second-notes.txt'), 'Second.\n');
    await expect(other.getByRole('treeitem', { name: /second-notes\.txt/ })).toBeVisible();
    await expect(views(page).getByRole('button', { name: 'Changes 1' })).toBeVisible();
    await expect(views(other).getByRole('button', { name: 'Changes 1' })).toBeVisible();
    await expect(page.getByRole('treeitem', { name: /second-notes\.txt/ })).toHaveCount(0);
    await expect(other.getByRole('treeitem', { name: /third-notes\.txt/ })).toHaveCount(0);
    await other.close();
  } finally {
    await second.dispose();
    await third.dispose();
  }
});

test('going Back across repositories in one page leaves another page where it is', async ({ pairedPage: page, repository }) => {
  const second = await otherRepository('second-project');
  try {
    await openRepository(page, repository);
    await addRepository(page, second);
    await expect(page).toHaveURL(/\/files$/);
    const secondAddress = page.url();

    const other = await page.context().newPage();
    await other.goto(secondAddress);
    await expect(picker(other)).toContainText('second-project');

    await page.getByRole('banner').getByRole('button', { name: 'Back', exact: true }).click();
    await expect(picker(page)).toContainText(repository.name);
    await other.waitForTimeout(500);
    await expect(picker(other)).toContainText('second-project');
    await expect(other).toHaveURL(secondAddress);
    await other.close();
  } finally {
    await second.dispose();
  }
});

test('two pages on the same repository both see a commit made in one of them', async ({ pairedPage: page, repository }) => {
  await openRepository(page, repository);
  const id = addressRepositoryId(page);
  const other = await page.context().newPage();
  await other.goto(`${new URL(page.url()).origin}/r/${id}/history`);
  await expect(other.getByRole('list', { name: 'Commit history' })).toBeVisible();

  await writeFile(path.join(repository.path, 'README.md'), '# Sample project\n\nWritten in one page.\n');
  await views(page).getByRole('button', { name: /^Changes/ }).click();
  await expect(views(page).getByRole('button', { name: 'Changes 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Stage all' }).click();
  const commitBox = page.getByRole('group', { name: 'Create commit' });
  await commitBox.getByRole('textbox', { name: 'Commit message' }).fill('Commit from the first page');
  await commitBox.getByRole('button', { name: 'Commit 1 file' }).click();
  await expect.poll(() => repository.git('log', '-1', '--format=%s')).toBe('Commit from the first page');

  await expect(other.getByRole('list', { name: 'Commit history' }).getByText('Commit from the first page')).toBeVisible();
  await other.close();
});

test('removing a worktree another page shows takes that page to the main worktree', async ({ pairedPage: page, repository }) => {
  const worktreePath = `${repository.path}-spike`;
  await repository.commit('notes.txt', 'First line\n', 'Add notes');
  await repository.git('worktree', 'add', '-q', '-b', 'spike', worktreePath);
  await openRepository(page, repository);
  const branchPicker = (target: Page) => target.getByRole('combobox', { name: 'Select branch' });
  const openBranch = async (target: Page, name: string) => {
    await branchPicker(target).click();
    await target.getByRole('listbox', { name: 'Select branch' }).getByRole('option', { name: new RegExp(`^${name}(?: |$)`) }).click();
    await expect(branchPicker(target)).toContainText(name);
  };
  // The second page opens the worktree from its address; the first goes back to the main one.
  await openBranch(page, 'spike');
  const other = await page.context().newPage();
  await other.goto(page.url());
  await expect(branchPicker(other)).toContainText('spike');
  // An edit there, not saved yet, which goes with the worktree.
  await other.getByRole('navigation', { name: 'Repository views' }).getByRole('button', { name: 'Files', exact: true }).click();
  await other.getByRole('tree', { name: 'Files' }).getByRole('treeitem', { name: 'notes.txt' }).click();
  const editor = other.getByRole('textbox', { name: 'notes.txt' });
  await expect(editor).toContainText('First line');
  await editor.click();
  await other.keyboard.press('Control+End');
  await other.keyboard.type('Not saved\n');
  await expect(other.getByRole('tablist', { name: 'Open files' }).getByRole('tab', { name: 'notes.txt, unsaved changes' })).toBeVisible();
  await openBranch(page, 'main');

  await branchPicker(page).click();
  await page.getByRole('button', { name: 'Manage branches…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Branches and worktrees' });
  await dialog.getByRole('tab', { name: /^Worktrees/ }).click();
  await dialog.getByRole('listbox', { name: 'Worktrees' }).getByRole('option', { name: /sample-project-spike/ }).click();
  await dialog.getByRole('button', { name: 'Remove worktree' }).click();
  await dialog.getByRole('button', { name: 'Remove worktree' }).click();
  await expect(dialog.getByRole('listbox', { name: 'Worktrees' }).getByRole('option', { name: /sample-project-spike/ })).toBeHidden({ timeout: 20_000 });
  expect(existsSync(worktreePath)).toBe(false);

  await expect(branchPicker(other)).toContainText('main');
  await expect(other.getByRole('button', { name: 'Locate folder…' })).toHaveCount(0);
  await expect(other.getByText('sample-project-spike was removed')).toBeVisible();
  await expect(other.getByText(/Unsaved changes in one file were lost with it/)).toBeVisible();
  // Nothing of it is left to hold up closing the page or installing an update.
  expect(await other.evaluate(() => {
    const update = new Event('opentig:before-update', { cancelable: true });
    window.dispatchEvent(update);
    return update.defaultPrevented;
  })).toBe(false);

  // Back to where it was: the worktree is gone, which a notice says, and the page stays; nothing asks for a folder.
  const prompts: string[] = [];
  other.on('dialog', (shown) => { prompts.push(shown.message()); void shown.dismiss(); });
  await other.getByRole('banner').getByRole('button', { name: 'Back', exact: true }).click();
  await expect(other.getByText('That repository is no longer available')).toBeVisible();
  await expect(branchPicker(other)).toContainText('main');
  expect(prompts).toEqual([]);
  await other.close();
});

test('going Back while another repository is opening still shows what changed on disk in the one on screen meanwhile', async ({ pairedPage: page, repository }) => {
  const second = await otherRepository('second-project');
  try {
    await openRepository(page, repository);
    await addRepository(page, second);
    const secondId = addressRepositoryId(page);
    await choose(page, repository.name);
    // The address follows the choice once the repository shows.
    await expect(page).not.toHaveURL(new RegExp(`/r/${secondId}/`));
    const address = page.url();

    // A page whose answer to opening the second repository is held back until it picks the first again.
    const other = await page.context().newPage();
    let release: (() => void) | null = null;
    const opening = new Set<string>();
    await other.routeWebSocket(/\/ws$/, (client) => {
      const server = client.connectToServer();
      client.onMessage((message) => {
        const request = JSON.parse(String(message)) as { type?: string; id?: string; command?: string; args?: unknown[] };
        if (request.type === 'request' && request.command === 'repository:open-recent' && request.id && JSON.stringify(request.args).includes(addressRepositoryIdOf(address)) === false) opening.add(request.id);
        server.send(message);
      });
      server.onMessage((message) => {
        const answer = JSON.parse(String(message)) as { type?: string; id?: string };
        if (answer.type === 'result' && answer.id && opening.has(answer.id) && !release) {
          opening.delete(answer.id);
          new Promise<void>((resolve) => { release = resolve; }).then(() => client.send(message), () => undefined);
          return;
        }
        client.send(message);
      });
    });
    await other.goto(address);
    await expect(picker(other)).toContainText(repository.name);
    await views(other).getByRole('button', { name: /^Changes/ }).click();
    await expect(other.getByText('No changes')).toBeVisible();

    await picker(other).click();
    await other.getByRole('listbox', { name: 'Select project or repository' }).getByRole('option', { name: /^second-project/ }).click();
    await expect.poll(() => release !== null).toBe(true);
    // The server has the page on the second repository now: this change does not reach it.
    await writeFile(path.join(repository.path, 'edited-meanwhile.txt'), 'Changed while away.\n');
    await other.waitForTimeout(1_000);
    // Back, to a step in the repository on screen, gives up the choice; the server opened it all the same.
    await other.getByRole('banner').getByRole('button', { name: 'Back', exact: true }).click();
    release!();

    await expect(picker(other)).toContainText(repository.name);
    // Told of its watch again by a new id, the page reads what it missed, well before any timed read.
    await expect(views(other).getByRole('button', { name: 'Changes 1' })).toBeVisible();
    await other.close();
  } finally {
    await second.dispose();
  }
});

/** The repository id in an address. */
function addressRepositoryIdOf(address: string): string {
  return new URL(address).pathname.split('/')[2]!;
}

