import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { openRepository } from './support/app';
import { expect, test, type GitRepository } from './support/fixtures';

// How the app holds up in a large repository: 50,000 commits, 100,000 files and
// 5,000 uncommitted changes. Building it takes minutes, so it only runs on request:
//   OPENTIG_E2E_LARGE=1 pnpm run test:e2e large-repository
// It prints what it measured, attaches it to the report, and asserts only that the
// commit box keeps what was typed; times differ too much between machines to be a budget.

const COMMITS = 50_000;
const FILES = 100_000;
const CHANGES = 5_000;
const filePath = (index: number) => `pkg${String(Math.floor(index / 1_000)).padStart(3, '0')}/dir${String(Math.floor(index / 50) % 20).padStart(2, '0')}/file${String(index).padStart(6, '0')}.txt`;

test.skip(!process.env.OPENTIG_E2E_LARGE, 'Opt-in: set OPENTIG_E2E_LARGE=1 to build and measure the large repository.');

/** Writes the whole history through one `git fast-import`, which takes seconds where commits would take hours. */
async function buildLargeRepository(repository: GitRepository): Promise<void> {
  const importer = spawn('git', ['fast-import', '--quiet', '--force'], { cwd: repository.path, stdio: ['pipe', 'ignore', 'inherit'] });
  const write = async (text: string) => { if (!importer.stdin.write(text)) await once(importer.stdin, 'drain'); };
  const commit = (index: number, body: string) => `commit refs/heads/main\nmark :${index + 1}\ncommitter E2E Tester <e2e@example.com> ${1_700_000_000 + index * 60} +0000\ndata <<EOM\nChange ${index}\nEOM\n${index > 0 ? `from :${index}\n` : ''}${body}\n`;
  let first = '';
  for (let index = 0; index < FILES; index += 1) first += `M 100644 inline ${filePath(index)}\ndata <<EOF\nline ${index}\nEOF\n`;
  await write(commit(0, first));
  for (let index = 1; index < COMMITS; index += 1) {
    await write(commit(index, `M 100644 inline ${filePath(index % FILES)}\ndata <<EOF\nline ${index} changed\nEOF\n`));
  }
  importer.stdin.end();
  const [code] = await once(importer, 'exit');
  if (code !== 0) throw new Error(`git fast-import exited with ${code}`);
  await repository.git('reset', '-q', '--hard', 'main');
  for (let index = 0; index < CHANGES; index += 1) {
    const target = path.join(repository.path, filePath(FILES - 1 - index * 7));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `edited ${index}\n`);
  }
  // Staged, so the commit box is open over the list of changes.
  await repository.git('add', '-A');
}

/** Long tasks and slow interactions the browser reports from now on. */
async function observeResponsiveness(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = { longTasks: [] as number[], interactions: [] as number[] };
    (window as unknown as { __e2eResponsiveness: typeof store }).__e2eResponsiveness = store;
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) store.longTasks.push(Math.round(entry.duration)); }).observe({ type: 'longtask' });
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) store.interactions.push(Math.round(entry.duration)); })
      .observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit);
  });
}

async function takeResponsiveness(page: Page) {
  // Entries are delivered after the frame that follows the interaction.
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const store = (window as unknown as { __e2eResponsiveness: { longTasks: number[]; interactions: number[] } }).__e2eResponsiveness;
    const summary = (values: number[]) => ({ count: values.length, totalMs: values.reduce((sum, value) => sum + value, 0), worstMs: Math.max(0, ...values) });
    const taken = { longTasks: summary(store.longTasks), slowInteractions: summary(store.interactions) };
    store.longTasks.length = 0;
    store.interactions.length = 0;
    return taken;
  });
}

test('a large repository stays usable while typing a commit message and moving between sections', async ({ pairedPage: page, repository }, testInfo) => {
  test.setTimeout(10 * 60_000);
  await buildLargeRepository(repository);
  console.log(`[large] built ${new Date().toISOString()}`);
  await openRepository(page, repository);
  const sidebar = page.getByRole('complementary');
  const views = page.getByRole('navigation', { name: 'Repository views' });
  const report: Record<string, unknown> = {};
  await observeResponsiveness(page);

  const step = (name: string) => console.log(`[large] ${name} ${new Date().toISOString()}`);
  step('opened');
  const openedAt = Date.now();
  await views.getByRole('button', { name: /^Changes/ }).click();
  await expect(sidebar.getByText(`${CHANGES} changes`, { exact: true })).toBeVisible({ timeout: 120_000 });
  step('changes shown');
  report.changesShown = { waitMs: Date.now() - openedAt, ...(await takeResponsiveness(page)) };

  const message = page.getByRole('group', { name: 'Create commit' }).getByRole('textbox', { name: 'Commit message' });
  await message.click({ timeout: 60_000 });
  await takeResponsiveness(page);
  const text = 'Describe five thousand changes';
  await page.keyboard.type(text, { delay: 40 });
  await expect(message).toHaveValue(text);
  step('typed');
  report.typing = { keys: text.length, ...(await takeResponsiveness(page)) };

  for (const [label, name, content] of [
    ['history', /^History/, sidebar.getByRole('list', { name: 'Commit history' })],
    ['files', /^Files/, sidebar.getByRole('tree', { name: 'Files' })],
    ['changes', /^Changes/, sidebar.getByText(`${CHANGES} changes`, { exact: true })],
  ] as const) {
    step(`to ${label}`);
    const startedAt = Date.now();
    await views.getByRole('button', { name }).click();
    // A section that never shows its content is a result to report, not a reason to stop measuring.
    const shown = await content.waitFor({ state: 'visible', timeout: 60_000 }).then(() => true, () => false);
    report[`to ${label}`] = { shown, waitMs: Date.now() - startedAt, ...(await takeResponsiveness(page)) };
  }

  console.log(`Large repository: ${JSON.stringify(report)}`);
  await testInfo.attach('large-repository', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  // The message typed while the list held every change is still there.
  await expect(message).toHaveValue(text);
});
