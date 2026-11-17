import { test as base, expect, type Page } from '@playwright/test';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface OpenTigServer {
  origin: string;
  /** The one-time pairing link the server printed at startup. */
  pairingLink: string;
  /** Where the stand-in GitHub CLI reads its world from, when the journey asked for one. */
  githubWorld: string | null;
}

/** A pull request the stand-in GitHub CLI reports, between two commits of the test's repository. */
export interface StandInPullRequest {
  number: number;
  title: string;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  baseRefOid: string;
  commits: Array<{ oid: string; messageHeadline: string }>;
  changedFiles?: number;
  additions?: number;
  deletions?: number;
  body?: string;
  /** Comments in the conversation, oldest first; `bot` marks an account GitHub reports as a bot. */
  conversation?: Array<{ author: string; body: string; bot?: boolean }>;
}

/** What the stand-in GitHub CLI answers with: the signed-in account, the repository and its open pull requests. */
export interface GitHubWorld {
  login: string;
  nameWithOwner: string;
  pulls: StandInPullRequest[];
  /** The clone whose Git answers `gh pr diff`, as GitHub's own diff would. */
  clone?: string;
  /** How long `gh pr list` takes to list the pull requests, to see what shows while the list is read. */
  pullListDelayMs?: number;
}

/** Sets what the stand-in GitHub CLI reports. Each of its runs reads it again, so a journey can change it as it goes. */
export type PublishGitHubWorld = (world: GitHubWorld) => Promise<void>;

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

/** What the stand-in AI CLI answers to a generation: the JSON a provider would return. */
export type AiAnswer = Record<string, unknown>;

/** Starts an idle process the system reports as a coding agent, such as `claude`, working in `cwd`. */
export type StartFakeAgent = (name: string, cwd: string) => Promise<void>;

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

/**
 * Puts a stand-in `gh` first on the server's PATH. It answers OpenTig's reads
 * of an account, a repository and its pull requests from the world file a
 * journey writes (see `stand-in-gh.mjs`), without GitHub or a network.
 */
async function standInGitHubCli(home: string, world: string): Promise<Record<string, string>> {
  const bin = path.join(home, 'stand-in-gh-bin');
  await mkdir(bin, { recursive: true });
  const script = path.resolve(__dirname, 'stand-in-gh.mjs');
  await writeFile(path.join(bin, 'gh'), `#!${process.execPath}\nimport(${JSON.stringify(pathToFileURL(script).href)});\n`, { mode: 0o755 });
  return { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, OPENTIG_E2E_GITHUB: world };
}

async function pair(page: Page, server: OpenTigServer): Promise<void> {
  await page.goto(server.pairingLink);
  await expect(page.getByRole('textbox', { name: 'Pairing code' })).not.toBeEmpty();
  await page.getByRole('button', { name: 'Pair browser' }).click();
  // Pairing ends on the application shell, away from /pair.
  await expect(page).not.toHaveURL(/\/pair/, { timeout: 20_000 });
}

/**
 * Puts a stand-in `codex` first on the server's PATH. It reports a signed-in
 * account and answers every generation with `answer`, so a journey that needs a
 * generated message runs without a real AI CLI, account, or network.
 */
async function standInAiCli(home: string, answer: AiAnswer): Promise<Record<string, string>> {
  const bin = path.join(home, 'stand-in-bin');
  const codexHome = path.join(home, '.codex');
  await mkdir(bin, { recursive: true });
  await mkdir(codexHome, { recursive: true });
  // A generation runs with a profile linked to this file, so it has to exist.
  await writeFile(path.join(codexHome, 'auth.json'), '{}\n');
  // The prompt arrives on stdin; the answer goes where --output-last-message says.
  const script = `#!${process.execPath}
const { writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') console.log('codex-cli 0.0.0-e2e');
else if (args[0] === 'login') console.log('Logged in using a stand-in account');
else if (args[0] === 'exec') {
  process.stdin.resume();
  process.stdin.on('end', () => writeFileSync(args[args.indexOf('--output-last-message') + 1], ${JSON.stringify(JSON.stringify(answer))}));
} else process.exit(1);
`;
  await writeFile(path.join(bin, 'codex'), script, { mode: 0o755 });
  return { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, CODEX_HOME: codexHome };
}

export const test = base.extend<{ aiAnswer: AiAnswer | null; countRequests: boolean; standInGitHub: boolean; server: OpenTigServer; repository: GitRepository; pairedPage: Page; startFakeAgent: StartFakeAgent; github: PublishGitHubWorld }>({
  // Off unless a journey sets it with `test.use`, so the others see no AI CLI of the tests' making.
  aiAnswer: [null, { option: true }],

  // Off unless a journey sets it with `test.use`; the journey then says what GitHub holds with `github`.
  standInGitHub: [false, { option: true }],

  // Turns on the app's performance harness, which counts the requests each navigation makes
  // (see `requestsDuring`). Off unless a journey sets it with `test.use`.
  countRequests: [false, { option: true }],

  // One isolated server per test: its own home, settings, and port, so tests
  // never share state and nothing touches a developer's OpenTig data. The
  // built server starts in about a second.
  server: async ({ aiAnswer, countRequests, standInGitHub }, use, testInfo) => {
    const serverEntry = path.resolve(path.dirname(testInfo.config.configFile ?? process.cwd()), 'packages/server/dist/bin.mjs');
    if (!existsSync(serverEntry)) throw new Error('The built OpenTig server is missing. Run "pnpm run build:server" before the end-to-end tests.');
    const home = await mkdtemp(path.join(os.tmpdir(), 'opentig-e2e-home-'));
    const port = await freePort();
    const output = { text: '' };
    const githubWorld = standInGitHub ? path.join(home, 'github-world.json') : null;
    const aiCli: Record<string, string> = aiAnswer ? await standInAiCli(home, aiAnswer) : {};
    const githubCli: Record<string, string> = githubWorld ? await standInGitHubCli(home, githubWorld) : {};
    const searchPath = [githubCli.PATH, aiCli.PATH].filter(Boolean).join(path.delimiter);
    const child = spawn(process.execPath, [serverEntry, 'serve', '--home', home, '--host', '127.0.0.1', '--port', String(port)], {
      // A private HOME keeps the system Trash, CLI logins, and global Git
      // config of the developer's account out of the tests.
      env: { ...process.env, NO_COLOR: '1', HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), XDG_DATA_HOME: path.join(home, 'data'), XDG_CACHE_HOME: path.join(home, 'cache'), ...aiCli, ...githubCli, ...(searchPath ? { PATH: searchPath } : {}), ...(countRequests ? { OPENTIG_PERF_AUTOMATION: '1' } : {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { output.text += chunk; });
    child.stderr.on('data', (chunk: string) => { output.text += chunk; });
    try {
      const [, origin] = await waitForOutput(child, /Connection URL: (\S+)/, output);
      const [pairingLink] = await waitForOutput(child, /https?:\/\/\S+\/pair#token=\S+/, output);
      await use({ origin: origin!, pairingLink, githubWorld });
    } finally {
      if (child.exitCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        await exited;
      }
      await rm(home, { recursive: true, force: true, maxRetries: 3 });
    }
  },

  github: async ({ server }, use) => {
    await use(async (world) => {
      if (!server.githubWorld) throw new Error('Set `standInGitHub: true` with test.use to give this journey a stand-in GitHub.');
      await writeFile(server.githubWorld, JSON.stringify(world));
    });
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

  // Linux names a process after the file it was started from, so a link to
  // Node named `claude` is what OpenTig's agent detection sees in /proc. The
  // process is a sibling of the server, not its child, so it counts as an
  // agent the user started. Agent detection reads /proc, so this only works on
  // Linux.
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads fixture dependencies from this parameter.
  startFakeAgent: async ({}, use) => {
    const bin = await mkdtemp(path.join(os.tmpdir(), 'opentig-e2e-agent-'));
    const running: ChildProcess[] = [];
    try {
      await use(async (name, cwd) => {
        const executable = path.join(bin, name);
        if (!existsSync(executable)) await symlink(process.execPath, executable);
        const child = spawn(executable, ['-e', 'setInterval(() => {}, 60_000)'], { cwd, stdio: 'ignore' });
        running.push(child);
        await once(child, 'spawn');
      });
    } finally {
      await Promise.all(running.filter((child) => child.exitCode === null && child.signalCode === null).map((child) => {
        const exited = once(child, 'exit');
        child.kill('SIGKILL');
        return exited;
      }));
      await rm(bin, { recursive: true, force: true });
    }
  },
});

export { expect };
