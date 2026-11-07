import { test as base, expect, type Page } from '@playwright/test';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface OpenTigServer {
  origin: string;
  /** The one-time pairing link the server printed at startup. */
  pairingLink: string;
}

export interface GitRepository {
  path: string;
  name: string;
  git(...args: string[]): Promise<string>;
  commit(file: string, content: string, message: string): Promise<void>;
  /**
   * Adds a local bare `origin`, pushes `main` with upstream tracking, and
   * returns a second clone of it so a test can create remote-only commits.
   */
  addRemote(): Promise<{ bare: string; other: GitRepository }>;
}

async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  probe.close();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a loopback port.');
  return address.port;
}

/** Waits for a line matching `pattern` on the server's stdout. */
function waitForOutput(child: ChildProcess, pattern: RegExp, output: { text: string }): Promise<RegExpMatchArray> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`OpenTig server did not print ${pattern} in time:\n${output.text}`)), 30_000);
    const check = () => {
      const match = output.text.match(pattern);
      if (!match) return;
      clearTimeout(timer);
      child.stdout?.off('data', check);
      resolve(match);
    };
    child.stdout?.on('data', check);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`OpenTig server exited with ${code}:\n${output.text}`)); });
    check();
  });
}

async function gitRepository(root: string, work: string): Promise<GitRepository> {
  const git = async (...args: string[]) => (await execFileAsync('git', args, { cwd: work })).stdout.trim();
  await git('config', 'user.name', 'E2E Tester');
  await git('config', 'user.email', 'e2e@example.com');
  await git('config', 'commit.gpgsign', 'false');
  const repository: GitRepository = {
    path: work,
    name: path.basename(work),
    git,
    commit: async (file, content, message) => {
      await mkdir(path.dirname(path.join(work, file)), { recursive: true });
      await writeFile(path.join(work, file), content);
      await git('add', file);
      await git('commit', '-q', '-m', message);
    },
    addRemote: async () => {
      const bare = path.join(root, 'origin.git');
      await execFileAsync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
      await git('remote', 'add', 'origin', bare);
      await git('push', '-q', '-u', 'origin', 'main');
      const otherPath = path.join(root, 'other-clone');
      await execFileAsync('git', ['clone', '-q', bare, otherPath]);
      return { bare, other: await gitRepository(root, otherPath) };
    },
  };
  return repository;
}

async function pair(page: Page, server: OpenTigServer): Promise<void> {
  await page.goto(server.pairingLink);
  await expect(page.getByRole('textbox', { name: 'Pairing code' })).not.toBeEmpty();
  await page.getByRole('button', { name: 'Pair browser' }).click();
  // Pairing ends on the application shell, away from /pair.
  await expect(page).not.toHaveURL(/\/pair/, { timeout: 20_000 });
}

export const test = base.extend<{ server: OpenTigServer; repository: GitRepository; pairedPage: Page }>({
  // One isolated server per test: its own home, settings, and port, so tests
  // never share state and nothing touches a developer's OpenTig data. The
  // built server starts in about a second.
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads fixture dependencies from this parameter.
  server: async ({}, use, testInfo) => {
    const serverEntry = path.resolve(path.dirname(testInfo.config.configFile ?? process.cwd()), 'packages/server/dist/bin.mjs');
    if (!existsSync(serverEntry)) throw new Error('The built OpenTig server is missing. Run "pnpm run build:server" before the end-to-end tests.');
    const home = await mkdtemp(path.join(os.tmpdir(), 'opentig-e2e-home-'));
    const port = await freePort();
    const output = { text: '' };
    const child = spawn(process.execPath, [serverEntry, 'serve', '--home', home, '--host', '127.0.0.1', '--port', String(port)], {
      // A private HOME keeps the system Trash, CLI logins, and global Git
      // config of the developer's account out of the tests.
      env: { ...process.env, NO_COLOR: '1', HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), XDG_DATA_HOME: path.join(home, 'data'), XDG_CACHE_HOME: path.join(home, 'cache') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { output.text += chunk; });
    child.stderr.on('data', (chunk: string) => { output.text += chunk; });
    try {
      const [, origin] = await waitForOutput(child, /Connection URL: (\S+)/, output);
      const [pairingLink] = await waitForOutput(child, /https?:\/\/\S+\/pair#token=\S+/, output);
      await use({ origin: origin!, pairingLink });
    } finally {
      if (child.exitCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        await exited;
      }
      await rm(home, { recursive: true, force: true, maxRetries: 3 });
    }
  },

  pairedPage: async ({ page, server }, use) => {
    await pair(page, server);
    await use(page);
  },

  // oxlint-disable-next-line no-empty-pattern -- Playwright reads fixture dependencies from this parameter.
  repository: async ({}, use) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'opentig-e2e-repo-'));
    const work = path.join(root, 'sample-project');
    await execFileAsync('git', ['init', '-q', '-b', 'main', work]);
    const repository = await gitRepository(root, work);
    await repository.commit('README.md', '# Sample project\n', 'Initial commit');
    try {
      await use(repository);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3 });
    }
  },
});

export { expect };
