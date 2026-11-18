import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { addRepository, openRepository, otherRepository, repositoryPicker } from './support/app';
import { expect, test, type GitRepository } from './support/fixtures';

// Safe pull and push against a local bare `origin` (docs/features.md, "Safe pull and push").

const toolbar = (page: Page) => page.getByRole('banner');
const pullButton = (page: Page, commits: number) => toolbar(page).getByRole('button', { name: `Pull ${commits} commits` });
const pushButton = (page: Page, commits: number) => toolbar(page).getByRole('button', { name: `Push ${commits} commits` });
const syncButtons = (page: Page) => toolbar(page).getByRole('button', { name: /^(Pull|Push) \d+ commits$|^Publish branch$/ });

/** Commits in `other` and pushes, so `origin` is one commit ahead of the repository. */
async function pushFromOtherClone(other: GitRepository, file: string, content: string, message: string): Promise<string> {
  await other.commit(file, content, message);
  await other.git('push', '-q', 'origin', 'main');
  return other.git('rev-parse', 'HEAD');
}

/** The branch tip stored in the bare `origin` itself, not the local remote-tracking ref. */
function remoteTip(repository: GitRepository, bare: string, branch: string): Promise<string> {
  return repository.git('--git-dir', bare, 'rev-parse', `refs/heads/${branch}`);
}

/** Fetches through the toolbar, as the user would, until the behind count is visible. */
async function fetchFromToolbar(page: Page, behind: number): Promise<void> {
  await toolbar(page).getByRole('button', { name: 'Refresh' }).click();
  await expect(pullButton(page, behind)).toBeVisible();
}

test('publishing a branch without an upstream creates it on origin and tracks it', async ({ pairedPage: page, repository }) => {
  const { bare } = await repository.addRemote();
  await repository.git('switch', '-q', '-c', 'feature');
  await writeFile(path.join(repository.path, 'draft.txt'), 'not committed yet\n');
  await openRepository(page, repository);

  await toolbar(page).getByRole('button', { name: 'Publish branch' }).click();

  await expect(page.getByText('sample-project: branch published')).toBeVisible();
  await expect(toolbar(page).getByRole('button', { name: 'Publish branch' })).toBeHidden();
  await expect.poll(() => repository.git('rev-parse', '--abbrev-ref', 'feature@{upstream}')).toBe('origin/feature');
  expect(await remoteTip(repository, bare, 'feature')).toBe(await repository.git('rev-parse', 'HEAD'));
  // Publishing leaves uncommitted files untouched.
  expect(await repository.git('status', '--porcelain')).toBe('?? draft.txt');
});

test('pushing sends local commits to the remote and clears the push indicator', async ({ pairedPage: page, repository }) => {
  const { bare } = await repository.addRemote();
  await repository.commit('notes.txt', 'first\n', 'Add notes');
  await repository.commit('notes.txt', 'first\nsecond\n', 'Extend notes');
  await openRepository(page, repository);

  await pushButton(page, 2).click();

  await expect(page.getByText('sample-project: 2 commits pushed')).toBeVisible();
  await expect(syncButtons(page)).toHaveCount(0);
  expect(await remoteTip(repository, bare, 'main')).toBe(await repository.git('rev-parse', 'HEAD'));
  expect(await repository.git('rev-list', '--count', 'origin/main..main')).toBe('0');
});

test('fetching shows how far behind the branch is and pulling fast-forwards it', async ({ pairedPage: page, repository }) => {
  const { other } = await repository.addRemote();
  const remoteHead = await pushFromOtherClone(other, 'remote.txt', 'from the remote\n', 'Add remote file');
  await openRepository(page, repository);

  await fetchFromToolbar(page, 1);
  // Fetching only updates the remote-tracking branch.
  expect(await repository.git('rev-parse', 'HEAD')).not.toBe(remoteHead);

  await pullButton(page, 1).click();

  await expect(page.getByText('1 commit pulled')).toBeVisible();
  await expect(syncButtons(page)).toHaveCount(0);
  expect(await repository.git('rev-parse', 'HEAD')).toBe(remoteHead);
  await expect(page.getByRole('tree', { name: 'Files' }).getByRole('treeitem', { name: 'remote.txt' })).toBeVisible();
});

test('pulling a diverged branch rebases local commits on top of the remote without a merge commit', async ({ pairedPage: page, repository }) => {
  const { bare, other } = await repository.addRemote();
  const remoteHead = await pushFromOtherClone(other, 'remote.txt', 'from the remote\n', 'Add remote file');
  await repository.commit('local.txt', 'from this clone\n', 'Add local file');
  await openRepository(page, repository);
  await fetchFromToolbar(page, 1);
  await expect(pushButton(page, 1)).toBeVisible();

  await pullButton(page, 1).click();

  await expect(page.getByText('Your local commit was kept on top and is ready to push.')).toBeVisible();
  await expect(pullButton(page, 1)).toBeHidden();
  await expect(pushButton(page, 1)).toBeVisible();
  expect(await repository.git('rev-parse', 'HEAD~1')).toBe(remoteHead);
  expect(await repository.git('log', '-1', '--format=%s')).toBe('Add local file');
  expect(await repository.git('rev-list', '--merges', '--count', 'HEAD')).toBe('0');

  await pushButton(page, 1).click();

  await expect(page.getByText('sample-project: 1 commit pushed')).toBeVisible();
  expect(await remoteTip(repository, bare, 'main')).toBe(await repository.git('rev-parse', 'HEAD'));
});

test('a pull whose rebase would conflict is aborted and leaves the branch unchanged', async ({ pairedPage: page, repository }) => {
  const { other } = await repository.addRemote();
  await pushFromOtherClone(other, 'README.md', '# Remote title\n', 'Retitle on the remote');
  await repository.commit('README.md', '# Local title\n', 'Retitle locally');
  const localHead = await repository.git('rev-parse', 'HEAD');
  await openRepository(page, repository);
  await fetchFromToolbar(page, 1);

  await pullButton(page, 1).click();

  await expect(page.getByText('Could not rebase onto the remote')).toBeVisible();
  await expect(page.getByText('Your local commits overlap the remote changes in README.md. The branch was left unchanged.')).toBeVisible();
  expect(await repository.git('rev-parse', 'HEAD')).toBe(localHead);
  expect(await repository.git('status', '--porcelain')).toBe('');
  const gitDir = path.join(repository.path, '.git');
  expect(existsSync(path.join(gitDir, 'rebase-merge')) || existsSync(path.join(gitDir, 'rebase-apply'))).toBe(false);
  await expect(pullButton(page, 1)).toBeVisible();
});

test('pulling keeps uncommitted and untracked local changes', async ({ pairedPage: page, repository }) => {
  const { other } = await repository.addRemote();
  const remoteHead = await pushFromOtherClone(other, 'remote.txt', 'from the remote\n', 'Add remote file');
  await writeFile(path.join(repository.path, 'README.md'), '# Sample project\n\nWork in progress.\n');
  await writeFile(path.join(repository.path, 'scratch.txt'), 'untracked\n');
  await openRepository(page, repository);
  await fetchFromToolbar(page, 1);

  await pullButton(page, 1).click();

  await expect(page.getByText('Local and staged changes were restored.')).toBeVisible();
  expect(await repository.git('rev-parse', 'HEAD')).toBe(remoteHead);
  expect(await readFile(path.join(repository.path, 'README.md'), 'utf8')).toBe('# Sample project\n\nWork in progress.\n');
  expect(await repository.git('diff', '--name-only')).toBe('README.md');
  expect(await repository.git('diff', '--cached', '--name-only')).toBe('');
  expect(await repository.git('ls-files', '--others', '--exclude-standard')).toBe('scratch.txt');
  // The temporary safety stash is dropped once the changes are restored.
  expect(await repository.git('stash', 'list')).toBe('');
});

/** A notice's own controls. Its text is also the name of the notice itself, so they are matched exactly. */
const noticeAction = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const bothCommits = 'Add local file\nAdd remote file\nInitial commit';

test('a push the remote refuses offers Pull and push, which leaves both commits on the remote', async ({ pairedPage: page, repository }) => {
  const { bare, other } = await repository.addRemote();
  await repository.commit('local.txt', 'from this clone\n', 'Add local file');
  await openRepository(page, repository);
  // The remote moves after the last fetch, so OpenTig still shows only a push.
  const remoteHead = await pushFromOtherClone(other, 'remote.txt', 'from the remote\n', 'Add remote file');

  await pushButton(page, 1).click();

  await expect(page.getByText('Push needs the latest commits first')).toBeVisible();
  await expect(page.getByText('origin/main has 1 commit you don\'t have.')).toBeVisible();
  await expect(page.getByText('Your commit has to go on top of it before it can be pushed.')).toBeVisible();
  // Nothing is force-pushed: the remote keeps its own commit.
  expect(await remoteTip(repository, bare, 'main')).toBe(remoteHead);
  // Git's own words stay folded away until they are asked for.
  await expect(page.getByText('(fetch first)')).toHaveCount(0);
  await noticeAction(page, 'Details').click();
  await expect(page.getByText('! [rejected] main -> main (fetch first)')).toBeVisible();
  await expect(page.getByText(/incoming: [0-9a-f]+ Add remote file/)).toBeVisible();

  await noticeAction(page, 'Pull and push').click();

  await expect(page.getByText('Pulled 1 commit and pushed 1')).toBeVisible();
  await expect(syncButtons(page)).toHaveCount(0);
  expect(await repository.git('log', '--format=%s', 'main')).toBe(bothCommits);
  expect(await repository.git('--git-dir', bare, 'log', '--format=%s', 'main')).toBe(bothCommits);
  expect(await remoteTip(repository, bare, 'main')).toBe(await repository.git('rev-parse', 'HEAD'));
  expect(await repository.git('rev-list', '--merges', '--count', 'HEAD')).toBe('0');
});

test('a push from a branch already known to be behind is not sent, and Pull and push finishes it', async ({ pairedPage: page, repository }) => {
  const { bare, other } = await repository.addRemote();
  const remoteHead = await pushFromOtherClone(other, 'remote.txt', 'from the remote\n', 'Add remote file');
  await repository.commit('local.txt', 'from this clone\n', 'Add local file');
  await openRepository(page, repository);
  await fetchFromToolbar(page, 1);

  await pushButton(page, 1).click();

  await expect(page.getByText('origin/main has 1 commit you don\'t have.')).toBeVisible();
  expect(await remoteTip(repository, bare, 'main')).toBe(remoteHead);
  // Git was never asked, so the details only place the branch.
  await noticeAction(page, 'Details').click();
  await expect(page.getByText('This branch is 1 behind and 1 ahead of origin/main.')).toBeVisible();
  await expect(page.getByText('[rejected]')).toHaveCount(0);

  await noticeAction(page, 'Pull and push').click();

  await expect(page.getByText('Pulled 1 commit and pushed 1')).toBeVisible();
  await expect(syncButtons(page)).toHaveCount(0);
  expect(await repository.git('--git-dir', bare, 'log', '--format=%s', 'main')).toBe(bothCommits);
  expect(await remoteTip(repository, bare, 'main')).toBe(await repository.git('rev-parse', 'HEAD'));
});

test('Pull only brings the remote commit in and leaves the push to the user', async ({ pairedPage: page, repository }) => {
  const { bare, other } = await repository.addRemote();
  await repository.commit('local.txt', 'from this clone\n', 'Add local file');
  await openRepository(page, repository);
  const remoteHead = await pushFromOtherClone(other, 'remote.txt', 'from the remote\n', 'Add remote file');

  await pushButton(page, 1).click();
  await noticeAction(page, 'Pull only').click();

  await expect(page.getByText('Your local commit was kept on top and is ready to push.')).toBeVisible();
  expect(await repository.git('log', '--format=%s', 'main')).toBe(bothCommits);
  await expect(pushButton(page, 1)).toBeVisible();
  expect(await remoteTip(repository, bare, 'main')).toBe(remoteHead);
});

test('Pull and push stops at a pull that would conflict, with the branch as it was and nothing pushed', async ({ pairedPage: page, repository }) => {
  const { bare, other } = await repository.addRemote();
  const remoteHead = await pushFromOtherClone(other, 'README.md', '# Remote title\n', 'Retitle on the remote');
  await repository.commit('README.md', '# Local title\n', 'Retitle locally');
  const localHead = await repository.git('rev-parse', 'HEAD');
  await openRepository(page, repository);
  await fetchFromToolbar(page, 1);

  await pushButton(page, 1).click();
  await noticeAction(page, 'Pull and push').click();

  await expect(page.getByText('Could not rebase onto the remote')).toBeVisible();
  await expect(page.getByText('Your local commits overlap the remote changes in README.md. The branch was left unchanged. Nothing was pushed.')).toBeVisible();
  expect(await repository.git('rev-parse', 'HEAD')).toBe(localHead);
  expect(await repository.git('status', '--porcelain')).toBe('');
  const gitDir = path.join(repository.path, '.git');
  expect(existsSync(path.join(gitDir, 'rebase-merge')) || existsSync(path.join(gitDir, 'rebase-apply'))).toBe(false);
  expect(await remoteTip(repository, bare, 'main')).toBe(remoteHead);
  await expect(pullButton(page, 1)).toBeVisible();
  await expect(pushButton(page, 1)).toBeVisible();
});

test('a push the remote\'s hook declines says so, without offering repository access', async ({ pairedPage: page, repository }) => {
  const { bare } = await repository.addRemote();
  const remoteHead = await remoteTip(repository, bare, 'main');
  await writeFile(path.join(bare, 'hooks', 'pre-receive'), '#!/bin/sh\necho "Commits need a ticket number" >&2\nexit 1\n', { mode: 0o755 });
  await repository.commit('local.txt', 'from this clone\n', 'Add local file');
  await openRepository(page, repository);

  await pushButton(page, 1).click();

  await expect(page.getByText('sample-project: could not push commits')).toBeVisible();
  await expect(page.getByText('The remote declined this push. A branch rule or a check on the server is blocking it.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Repository access' })).toHaveCount(0);
  await expect(page.getByText('Commits need a ticket number')).toHaveCount(0);
  await noticeAction(page, 'Details').click();
  await expect(page.getByText(/! \[remote rejected\] main -> main \(pre-receive hook declined\)/)).toBeVisible();
  await expect(page.getByText(/Commits need a ticket number/)).toBeVisible();
  expect(await remoteTip(repository, bare, 'main')).toBe(remoteHead);
  await expect(pushButton(page, 1)).toBeVisible();
});

test('a branch that tracks another remote branch is published under its own name, never pushed to that branch', async ({ pairedPage: page, repository }) => {
  const { bare } = await repository.addRemote();
  await repository.git('push', '-q', 'origin', 'main:dev');
  await repository.git('fetch', '-q', 'origin');
  const devTip = await remoteTip(repository, bare, 'dev');
  // Git's default branch.autoSetupMerge makes fix/login track origin/dev.
  await repository.git('checkout', '-q', '-b', 'fix/login', 'origin/dev');
  await repository.commit('login.txt', 'fixed\n', 'Fix login');
  await openRepository(page, repository);

  // The top bar names the tracked branch beside the current one (read as "Tracks origin/dev").
  const trackedChip = '- text: Tracks origin/dev';
  await expect(toolbar(page)).toMatchAriaSnapshot(trackedChip);
  const dialog = page.getByRole('dialog', { name: 'Publish as a new branch?' });

  // The toolbar's push asks first, and cancelling pushes nothing.
  await pushButton(page, 1).click();
  await expect(dialog).toContainText('origin/fix/login');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect(await remoteTip(repository, bare, 'dev')).toBe(devTip);
  expect(await repository.git('--git-dir', bare, 'branch', '--list', 'fix/login')).toBe('');
  expect(await repository.git('rev-parse', '--abbrev-ref', 'fix/login@{upstream}')).toBe('origin/dev');

  // Changes warns instead of offering a push, and publishes after the same confirmation.
  await page.getByRole('navigation', { name: 'Repository views' }).getByRole('button', { name: /^Changes/ }).click();
  await expect(page.getByText('1 commit isn\'t published yet.')).toBeVisible();
  await expect(page.getByRole('note')).toContainText('This branch tracks origin/dev');
  await expect(page.getByRole('button', { name: 'Push it' })).toBeHidden();
  await page.getByRole('button', { name: 'Publish as new branch' }).click();
  await dialog.getByRole('button', { name: 'Publish branch' }).click();

  await expect(page.getByText('fix/login now tracks origin/fix/login.')).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Nothing to review or commit.')).toBeVisible();
  await expect(toolbar(page)).not.toMatchAriaSnapshot(trackedChip);
  await expect(syncButtons(page)).toHaveCount(0);
  expect(await remoteTip(repository, bare, 'fix/login')).toBe(await repository.git('rev-parse', 'HEAD'));
  expect(await remoteTip(repository, bare, 'dev')).toBe(devTip);
  expect(await repository.git('rev-parse', '--abbrev-ref', 'fix/login@{upstream}')).toBe('origin/fix/login');
});

/**
 * Records every state the repository list shows for one row's Pull or Push, as
 * the page draws it: `idle` when the action is on offer, `running` while its
 * spinner turns, `gone` when the row offers neither. Consecutive repeats are
 * folded, so a state that lasted a single frame is still in the list.
 */
async function recordListAction(page: Page, action: 'Pull' | 'Push', repository: string): Promise<() => Promise<string[]>> {
  await page.evaluate(({ label }) => {
    const states: string[] = [];
    const note = () => {
      const button = document.querySelector(`[role="listbox"] [aria-label="${label}"]`);
      const state = !button ? 'gone' : button.querySelector('[data-slot="spinner"]') ? 'running' : 'idle';
      if (states.at(-1) !== state) states.push(state);
    };
    note();
    new MutationObserver(note).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    (window as unknown as { listActionStates: string[] }).listActionStates = states;
  }, { label: `${action} ${repository}` });
  return () => page.evaluate(() => [...(window as unknown as { listActionStates: string[] }).listActionStates]);
}

/** What the row went through from its action being clicked: nothing but the spinner and then what is left. */
const afterClick = (states: string[]) => states.slice(states.indexOf('running'));

test('pulling another repository from the list goes from its spinner to nothing to pull, without Pull in between', async ({ pairedPage: page, repository }) => {
  const { other } = await repository.addRemote();
  await openRepository(page, repository);
  const remoteHead = await pushFromOtherClone(other, 'remote.txt', 'from the remote\n', 'Add remote file');
  const second = await otherRepository('second-project');
  try {
    await addRepository(page, second);
    await repositoryPicker(page).click();
    const list = page.getByRole('listbox', { name: 'Select project or repository' });
    // Opening the list fetches each saved repository.
    await expect(list.getByRole('button', { name: 'Pull sample-project' })).toContainText('1');
    const states = await recordListAction(page, 'Pull', 'sample-project');

    await list.getByRole('button', { name: 'Pull sample-project' }).click();

    await expect(page.getByText('sample-project: 1 commit pulled')).toBeVisible();
    await expect.poll(states).toContain('gone');
    expect(afterClick(await states())).toEqual(['running', 'gone']);
    expect(await repository.git('rev-parse', 'HEAD')).toBe(remoteHead);
  } finally {
    await second.dispose();
  }
});

test('pulling the open repository from the list goes from its spinner to nothing to pull, without Pull in between', async ({ pairedPage: page, repository }) => {
  const { other } = await repository.addRemote();
  const remoteHead = await pushFromOtherClone(other, 'remote.txt', 'from the remote\n', 'Add remote file');
  await openRepository(page, repository);
  await fetchFromToolbar(page, 1);
  await repositoryPicker(page).click();
  const list = page.getByRole('listbox', { name: 'Select project or repository' });
  await expect(list.getByRole('button', { name: 'Pull sample-project' })).toContainText('1');
  const states = await recordListAction(page, 'Pull', 'sample-project');

  await list.getByRole('button', { name: 'Pull sample-project' }).click();

  await expect(page.getByText('sample-project: 1 commit pulled')).toBeVisible();
  await expect.poll(states).toContain('gone');
  expect(afterClick(await states())).toEqual(['running', 'gone']);
  await expect(pullButton(page, 1)).toBeHidden();
  expect(await repository.git('rev-parse', 'HEAD')).toBe(remoteHead);
});

test('pushing another repository from the list clears its Push at once, and a refused push offers it again', async ({ pairedPage: page, repository }) => {
  const { bare, other } = await repository.addRemote();
  await repository.commit('local.txt', 'from this clone\n', 'Add local file');
  await openRepository(page, repository);
  const second = await otherRepository('second-project');
  try {
    await addRepository(page, second);
    await repositoryPicker(page).click();
    const list = page.getByRole('listbox', { name: 'Select project or repository' });
    const push = list.getByRole('button', { name: 'Push sample-project' });
    await expect(push).toContainText('1');
    let states = await recordListAction(page, 'Push', 'sample-project');

    await push.click();

    await expect(page.getByText('sample-project: 1 commit pushed')).toBeVisible();
    await expect.poll(states).toContain('gone');
    expect(afterClick(await states())).toEqual(['running', 'gone']);
    expect(await remoteTip(repository, bare, 'main')).toBe(await repository.git('rev-parse', 'HEAD'));

    // The remote moves on while another commit waits here: the push is refused, and Push stays on offer.
    await repository.commit('local.txt', 'from this clone\nagain\n', 'Extend local file');
    await other.git('pull', '-q', '--ff-only');
    await pushFromOtherClone(other, 'remote.txt', 'from the remote\n', 'Add remote file');
    await page.keyboard.press('Escape');
    await repositoryPicker(page).click();
    await expect(push).toContainText('1');
    states = await recordListAction(page, 'Push', 'sample-project');

    await push.click();

    await expect(page.getByText('sample-project needs the latest commits first')).toBeVisible();
    await expect.poll(async () => (await states()).at(-1)).toBe('idle');
    expect(afterClick(await states())).toEqual(['running', 'idle']);
    await expect(list.getByRole('button', { name: 'Pull sample-project' })).toContainText('1');
  } finally {
    await second.dispose();
  }
});
