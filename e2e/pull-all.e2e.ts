import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Locator, Page } from '@playwright/test';
import { addRepository, openRepository, repositoryPicker } from './support/app';
import { expect, test } from './support/fixtures';

// Pull all in the repository list (docs/features.md, "Pull all").

const execFileAsync = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await execFileAsync('git', args, { cwd })).stdout.trim();
const identity = ['-c', 'user.name=E2E Tester', '-c', 'user.email=e2e@example.com', '-c', 'commit.gpgsign=false'];

/** A repository with a bare `origin` and a second clone of it that stands for a teammate. */
interface ClonedRepository {
  name: string;
  path: string;
  bare: string;
  /** Commits `content` to `file` in the teammate's clone and pushes it, so `origin` is one commit ahead. */
  pushFromTeammate(file: string, content: string): Promise<string>;
  commit(file: string, content: string): Promise<void>;
}

async function clonedRepository(root: string, name: string): Promise<ClonedRepository> {
  const bare = path.join(root, `${name}.git`);
  const work = path.join(root, name);
  const teammate = path.join(root, `${name}-teammate`);
  await execFileAsync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  await execFileAsync('git', ['clone', '-q', bare, work]);
  const commitIn = async (cwd: string, file: string, content: string) => {
    await writeFile(path.join(cwd, file), content);
    await git(cwd, 'add', file);
    await git(cwd, ...identity, 'commit', '-q', '-m', `Change ${file}`);
  };
  await git(work, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  await commitIn(work, 'shared.txt', 'base\n');
  await git(work, 'push', '-q', '-u', 'origin', 'main');
  await git(bare, 'update-server-info');
  await execFileAsync('git', ['clone', '-q', bare, teammate]);
  return {
    name, path: work, bare,
    pushFromTeammate: async (file, content) => {
      await commitIn(teammate, file, content);
      await git(teammate, 'push', '-q', 'origin', 'main');
      await git(bare, 'update-server-info');
      return git(teammate, 'rev-parse', 'HEAD');
    },
    commit: (file, content) => commitIn(work, file, content),
  };
}

const list = (page: Page) => page.getByRole('listbox', { name: 'Select project or repository' });
const row = (page: Page, name: string): Locator => list(page).getByRole('option', { name: new RegExp(`^${name}\\b`) });
const pullAllButton = (page: Page) => page.getByRole('button', { name: /^Pull \d+ (shown )?repositor(y|ies)$/ });

test('Pull all fast-forwards the repositories it can and says why it left the others', async ({ pairedPage: page, repository }) => {
  // Adding five repositories through the dialog takes most of an ordinary journey's time.
  test.slow();
  const root = await mkdtemp(path.join(os.tmpdir(), 'opentig-e2e-pull-all-'));
  try {
    const [ahead, diverging, blocked, kept, diverged] = await Promise.all([
      clonedRepository(root, 'ahead-only'), clonedRepository(root, 'diverging'), clonedRepository(root, 'blocked'),
      clonedRepository(root, 'kept-changes'), clonedRepository(root, 'diverged'),
    ]);
    await openRepository(page, repository);
    for (const item of [ahead, diverging, blocked, kept, diverged]) await addRepository(page, item);

    // Nothing to pull yet: no button.
    await repositoryPicker(page).click();
    await expect(row(page, 'diverged')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pull diverged' })).toBeHidden();
    await expect(pullAllButton(page)).toBeHidden();
    await page.keyboard.press('Escape');

    const aheadTip = await ahead.pushFromTeammate('incoming.txt', 'from the remote\n');
    await diverging.pushFromTeammate('incoming.txt', 'from the remote\n');
    await blocked.pushFromTeammate('shared.txt', 'remote edit\n');
    const keptTip = await kept.pushFromTeammate('incoming.txt', 'from the remote\n');
    await diverged.pushFromTeammate('incoming.txt', 'from the remote\n');
    // Its own commit makes this one need its own Pull, which rebases.
    await diverged.commit('mine.txt', 'local commit\n');
    // A change to the file the remote changed is in the way; others aren't.
    await writeFile(path.join(blocked.path, 'shared.txt'), 'local edit\n');
    await writeFile(path.join(kept.path, 'shared.txt'), 'local edit\n');
    await writeFile(path.join(kept.path, 'notes.txt'), 'untracked\n');

    // The button counts the rows whose fetch says they only need a fast-forward, and the search narrows it to the rows shown.
    await repositoryPicker(page).click();
    // The count grows as each fetch comes back, four at a time.
    await expect(pullAllButton(page)).toHaveText('Pull all 4', { timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Pull diverged' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Search repositories…' }).fill('blocked');
    await expect(pullAllButton(page)).toHaveText('Pull 1 shown');
    await page.getByRole('combobox', { name: 'Search repositories…' }).fill('');
    await expect(pullAllButton(page)).toHaveText('Pull all 4');

    // A commit made after the list read its counts: the pull finds the branch diverged and leaves it.
    await diverging.commit('mine.txt', 'local commit\n');
    const divergingHead = await git(diverging.path, 'rev-parse', 'HEAD');
    const blockedHead = await git(blocked.path, 'rev-parse', 'HEAD');
    const divergedHead = await git(diverged.path, 'rev-parse', 'HEAD');
    await pullAllButton(page).click();

    await expect(page.getByText('Pulled 2 of 4 repositories')).toBeVisible();
    await expect(page.getByText('diverging: it has commits of its own now; use its own Pull.')).toBeVisible();
    await expect(page.getByText('blocked: local changes are in the way, so nothing changed.')).toBeVisible();

    await expect(row(page, 'ahead-only').getByRole('img', { name: 'Pulled' })).toBeVisible();
    await expect(row(page, 'ahead-only')).toContainText('1 commit pulled');
    await expect(row(page, 'kept-changes')).toContainText('1 commit pulled, local changes kept');
    await expect(row(page, 'diverging').getByRole('img', { name: 'Skipped' })).toBeVisible();
    await expect(row(page, 'diverging')).toContainText('Has commits of its own');
    await expect(row(page, 'blocked').getByRole('img', { name: 'Skipped' })).toBeVisible();
    await expect(row(page, 'blocked')).toContainText('Local changes in the way');
    // Skipped rows keep their own Pull; the one left out was never touched.
    await expect(page.getByRole('button', { name: 'Pull blocked' })).toBeVisible();
    await expect(row(page, 'diverged').getByRole('img', { name: /^(Pulled|Skipped|Failed)$/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Pull diverged' })).toBeVisible();

    expect(await git(ahead.path, 'rev-parse', 'HEAD')).toBe(aheadTip);
    expect(await git(kept.path, 'rev-parse', 'HEAD')).toBe(keptTip);
    expect(await git(kept.path, 'status', '--porcelain')).toBe('M shared.txt\n?? notes.txt');
    expect(await readFile(path.join(kept.path, 'incoming.txt'), 'utf8')).toBe('from the remote\n');
    expect(await git(diverging.path, 'rev-parse', 'HEAD')).toBe(divergingHead);
    expect(await git(blocked.path, 'rev-parse', 'HEAD')).toBe(blockedHead);
    expect(await readFile(path.join(blocked.path, 'shared.txt'), 'utf8')).toBe('local edit\n');
    expect(await git(diverged.path, 'rev-parse', 'HEAD')).toBe(divergedHead);
    // No safety stash: a fast-forward never needs one.
    for (const item of [ahead, diverging, blocked, kept]) expect(await git(item.path, 'stash', 'list')).toBe('');

    // Closing the list once the run is over brings the rows back to their branches.
    await page.keyboard.press('Escape');
    await repositoryPicker(page).click();
    await expect(row(page, 'blocked')).toContainText('main');
    await expect(row(page, 'blocked').getByRole('img', { name: 'Skipped' })).toBeHidden();
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

/**
 * Serves bare repositories under `root` over Git's "dumb" HTTP protocol. While held, the first
 * request of a fetch waits, so pulls stay running until the journey lets them go.
 */
async function gatedRemotes(root: string): Promise<{ url(name: string): string; hold(): void; release(): void; server: Server }> {
  let gate: Promise<void> | null = null;
  let open = () => {};
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root + path.sep)) { response.writeHead(404).end(); return; }
    void (pathname.endsWith('/info/refs') && gate ? gate : Promise.resolve()).then(() => readFile(file)).then(
      (content) => response.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(content),
      () => response.writeHead(404).end(),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  return {
    url: (name) => `http://127.0.0.1:${port}/${name}.git`,
    hold: () => { gate = new Promise((resolve) => { open = resolve; }); },
    release: () => { gate = null; open(); },
    server,
  };
}

test('Stop leaves the repositories still waiting as they were and lets those pulling finish', async ({ pairedPage: page, repository }) => {
  // Adding five repositories through the dialog takes most of an ordinary journey's time.
  test.slow();
  const root = await mkdtemp(path.join(os.tmpdir(), 'opentig-e2e-pull-all-'));
  const remotes = await gatedRemotes(root);
  try {
    const names = ['one', 'two', 'three', 'four', 'five'];
    const repositories = await Promise.all(names.map((name) => clonedRepository(root, name)));
    for (const item of repositories) await git(item.path, 'remote', 'set-url', 'origin', remotes.url(item.name));
    const tips = await Promise.all(repositories.map((item) => item.pushFromTeammate('incoming.txt', 'from the remote\n')));
    const heads = await Promise.all(repositories.map((item) => git(item.path, 'rev-parse', 'HEAD')));
    await openRepository(page, repository);
    for (const item of repositories) await addRepository(page, item);

    await repositoryPicker(page).click();
    // The count grows as each fetch comes back, four at a time.
    await expect(pullAllButton(page)).toHaveText('Pull all 5', { timeout: 30_000 });
    remotes.hold();
    await pullAllButton(page).click();

    // Four pull at once; the fifth waits its turn.
    await expect(page.getByRole('status').filter({ hasText: '0 of 5 done' })).toBeVisible();
    await expect(list(page).getByText('Queued')).toHaveCount(1);
    await expect(page.getByText('Pulling 5 repositories…')).toBeVisible();
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(list(page).getByText('Not pulled')).toHaveCount(1);
    remotes.release();

    await expect(page.getByText('Stopped: pulled 4 of 5 repositories')).toBeVisible();
    await expect(page.getByText('1 not pulled.')).toBeVisible();
    const results = await Promise.all(repositories.map(async (item, index) => {
      const head = await git(item.path, 'rev-parse', 'HEAD');
      return head === tips[index] ? 'pulled' : head === heads[index] ? 'untouched' : 'other';
    }));
    expect(results.filter((result) => result === 'pulled')).toHaveLength(4);
    expect(results.filter((result) => result === 'untouched')).toHaveLength(1);
    // The one Stop left out still offers its own Pull, and the button is back for it.
    const skipped = repositories[results.indexOf('untouched')]!;
    await expect(page.getByRole('button', { name: `Pull ${skipped.name}` })).toBeVisible();
    await expect(pullAllButton(page)).toHaveText('Pull all 1');
  } finally {
    remotes.release();
    remotes.server.close();
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
});
