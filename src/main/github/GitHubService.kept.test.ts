import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CliProcessRunner, CliRunResult } from '../ai/CliProcessRunner';
import type { CliResolver } from '../ai/CliResolver';
import type { GitProcess } from '../git/GitProcess';
import type { RepositoryService } from '../git/RepositoryService';
import type { SettingsStore } from '../persistence/SettingsStore';
import type { KeptAnswer } from '../../shared/kept-reads';
import type { RepositoryInfo } from '../../shared/contracts';
import { GitHubAccountsService } from './GitHubAccountsService';
import { GitHubReadCache, GITHUB_READ_CACHE_LIMITS } from './GitHubReadCache';
import { GitHubService } from './GitHubService';

const TOKEN = 'gho_kepttest0000000000000000000000';
const ok = (value: unknown): CliRunResult => ({ exitCode: 0, stdout: JSON.stringify(value), stderr: '' });
const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))); });

async function folder(): Promise<string> {
  const created = await mkdtemp(path.join(os.tmpdir(), 'opentig-github-cache-'));
  folders.push(created);
  return created;
}

/**
 * The real service and account logic over a stubbed `gh`: the repository uses the
 * account its settings name, and GitHub answers each `pr view` with a new title.
 */
function server(file: string, options: { login?: string; remote?: string; clock?: { now: number } } = {}) {
  const state = { login: options.login ?? 'tester', remote: options.remote ?? 'https://github.com/example/demo.git', views: 0, failWith: null as string | null };
  const clock = options.clock ?? { now: Date.parse('2026-11-15T10:00:00Z') };
  const run = vi.fn(async (_exe: string, args: string[]): Promise<CliRunResult> => {
    if (args[0] === 'auth' && args[1] === 'token') return { exitCode: 0, stdout: TOKEN, stderr: '' };
    if (args[0] === 'api' && args[1] === 'user') return { exitCode: 0, stdout: state.login, stderr: '' };
    if (args[0] === '--version' || args[0] === 'auth') return ok('ready');
    if (args[0] === 'pr' && args[1] === 'view') {
      if (state.failWith) return { exitCode: 1, stdout: '', stderr: state.failWith };
      state.views++;
      return ok({ number: Number(args[2]), state: 'OPEN', title: `read ${state.views}`, updatedAt: '2026-11-15T09:00:00Z', headRefOid: 'a'.repeat(40) });
    }
    return ok([]);
  });
  const settings = {
    githubAccount: () => ({ mode: 'account', host: 'github.com', login: state.login }),
    githubDefaultLogin: null,
    githubRepositoryAccounts: [],
    setGitHubAccount: async (_commonDir: string, selection: { login: string }) => { state.login = selection.login; },
  } as unknown as SettingsStore;
  const resolver = { discover: async () => [{ executable: 'gh', alias: 'gh', source: 'process-path', env: {} }], warning: async () => undefined } as unknown as CliResolver;
  const git = {
    onInvalidate: () => undefined, readScope: (cwd: string) => cwd,
    run: async (_cwd: string, args: string[]) => ({ stdout: Buffer.from(args.includes('core.sshCommand') || args[0] === 'config' ? '' : state.remote) }),
  } as unknown as GitProcess;
  const repository = { path: '/work/demo', commonDir: '/work/demo/.git', id: 'repo', name: 'demo', repositoryName: 'demo' } as RepositoryInfo;
  const repositories = { get: () => repository } as unknown as RepositoryService;
  const accounts = new GitHubAccountsService(resolver, { run } as unknown as CliProcessRunner, git, settings);
  const cache = new GitHubReadCache(file, () => clock.now);
  const service = new GitHubService(resolver, { run } as unknown as CliProcessRunner, git, repositories, accounts, cache, () => clock.now);
  return { service, cache, accounts, repository, state, clock, run };
}

/** A client that can show an answer marked as old. */
function keptSink() {
  const answers: KeptAnswer[] = [];
  return { answers, sink: (answer: KeptAnswer) => { answers.push(answer); } };
}

describe('GitHub answers kept on the server', () => {
  it('serves a kept answer at once to a client that can mark it, reads it behind, and makes any other client wait', async () => {
    const { service, clock, state } = server(path.join(await folder(), 'github-cache.json'));
    expect((await service.getPullRequest('repo', 12)).title).toBe('read 1');
    clock.now += 2 * 60_000;

    const client = keptSink();
    expect((await service.getPullRequest('repo', 12, client.sink)).title).toBe('read 1');
    expect(client.answers).toHaveLength(1);
    expect(client.answers[0]!.readAt).toBe('2026-11-15T10:00:00.000Z');
    await expect(client.answers[0]!.refresh).resolves.toEqual({ outcome: 'updated' });
    expect(state.views).toBe(2);
    // Told of the refresh, the client asks again and gets the new answer without another read.
    const after = keptSink();
    expect((await service.getPullRequest('repo', 12, after.sink)).title).toBe('read 2');
    expect(after.answers).toHaveLength(0);
    expect(state.views).toBe(2);

    // A client that cannot mark an answer as old waits for GitHub once the answer is no longer current.
    clock.now += 2 * 60_000;
    expect((await service.getPullRequest('repo', 12)).title).toBe('read 3');
  });

  it('keeps answers across a restart, for the same account only', async () => {
    const file = path.join(await folder(), 'github-cache.json');
    const clock = { now: Date.parse('2026-11-15T10:00:00Z') };
    const first = server(file, { clock });
    await first.service.getPullRequest('repo', 12);
    await first.cache.close();

    clock.now += 60 * 60_000;
    const restarted = server(file, { clock });
    const client = keptSink();
    expect((await restarted.service.getPullRequest('repo', 12, client.sink)).title).toBe('read 1');
    expect(client.answers).toHaveLength(1);

    const otherAccount = server(file, { clock, login: 'someone-else' });
    const other = keptSink();
    expect((await otherAccount.service.getPullRequest('repo', 12, other.sink)).title).toBe('read 1');
    // Read from GitHub with its own account: the stub numbers reads per server.
    expect(other.answers).toHaveLength(0);
    expect(otherAccount.state.views).toBe(1);
  });

  it('never shows what one remote said once the repository points at another', async () => {
    const { service, state, cache } = server(path.join(await folder(), 'github-cache.json'));
    await service.getPullRequest('repo', 12);
    state.remote = 'https://github.com/someone/fork.git';
    const client = keptSink();
    expect((await service.getPullRequest('repo', 12, client.sink)).title).toBe('read 2');
    expect(client.answers).toHaveLength(0);
    // The answer for the previous remote is gone, not just passed over.
    expect(cache.size).toBe(1);
  });

  it('drops what a repository read when its account changes', async () => {
    const { service, accounts, repository, cache } = server(path.join(await folder(), 'github-cache.json'));
    await service.getPullRequest('repo', 12);
    expect(cache.size).toBe(1);
    await accounts.setSelection(repository, { mode: 'account', host: 'github.com', login: 'another' });
    expect(cache.size).toBe(0);
  });

  it('drops what credentials GitHub rejected had read, and reports the refresh as failed', async () => {
    const { service, state, clock, cache } = server(path.join(await folder(), 'github-cache.json'));
    await service.getPullRequest('repo', 12);
    clock.now += 2 * 60_000;
    state.failWith = 'HTTP 401: Bad credentials';
    const client = keptSink();
    await service.getPullRequest('repo', 12, client.sink);
    await expect(client.answers[0]!.refresh).resolves.toMatchObject({ outcome: 'failed', error: { code: 'GH_AUTH_REQUIRED' } });
    expect(cache.size).toBe(0);
  });

  it('drops only what a change made through OpenTig affects', async () => {
    const { service, state } = server(path.join(await folder(), 'github-cache.json'));
    await service.getPullRequest('repo', 12);
    await service.getPullRequest('repo', 13);
    service.invalidate('repo', { pullRequest: 12 });
    await service.getPullRequest('repo', 13);
    expect(state.views).toBe(2);
    await service.getPullRequest('repo', 12);
    expect(state.views).toBe(3);
  });

  it('writes a file only the server user can read, with no token or remote credentials in it', async () => {
    const file = path.join(await folder(), 'github-cache.json');
    const { service, cache } = server(file, { remote: 'https://someone:gho_remotesecret0000000000000000@github.com/example/demo.git' });
    await service.getPullRequest('repo', 12);
    await cache.flush();
    const contents = await readFile(file, 'utf8');
    expect(contents).toContain('read 1');
    expect(contents).not.toContain(TOKEN);
    expect(contents).not.toContain('gho_remotesecret');
    expect(contents).not.toContain('someone:');
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it.each([
    ['corrupt', '{"format":1,'],
    ['of an older format', JSON.stringify({ format: 0, entries: [] })],
    ['changed outside OpenTig', JSON.stringify({ format: 1, checksum: '0'.repeat(64), entries: '[]' })],
  ])('discards a file that is %s and starts empty', async (_case, contents) => {
    const file = path.join(await folder(), 'github-cache.json');
    await writeFile(file, contents);
    const cache = new GitHubReadCache(file);
    await cache.load();
    expect(cache.size).toBe(0);
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('GitHubReadCache bounds', () => {
  const scope = { host: 'github.com', nameWithOwner: 'example/demo', login: 'tester', path: '/work/demo', commonDir: '/work/demo/.git', remote: 'f'.repeat(64) };

  it('keeps a finished run past the age limit, and nothing else', async () => {
    const clock = { now: 0 };
    const cache = new GitHubReadCache(null, () => clock.now);
    cache.set('finished', scope, { status: 'completed' }, { noExpiry: true });
    cache.set('pull', scope, { state: 'OPEN' });
    clock.now += GITHUB_READ_CACHE_LIMITS.maxAgeMs + 1;
    expect(await cache.get('finished')).toBeDefined();
    expect(await cache.get('pull')).toBeUndefined();
  });

  it('drops the least recently used answers past the entry bound, and writes only answers small enough for disk', async () => {
    const file = path.join(await folder(), 'github-cache.json');
    const cache = new GitHubReadCache(file);
    for (let index = 0; index <= GITHUB_READ_CACHE_LIMITS.entries; index++) cache.set(`entry-${index}`, scope, { index });
    expect(cache.size).toBe(GITHUB_READ_CACHE_LIMITS.entries);
    expect(await cache.get('entry-0')).toBeUndefined();
    cache.set('large', scope, 'x'.repeat(GITHUB_READ_CACHE_LIMITS.diskEntryBytes + 1));
    await cache.flush();
    const reloaded = new GitHubReadCache(file);
    await reloaded.load();
    expect(await reloaded.get(`entry-${GITHUB_READ_CACHE_LIMITS.entries}`)).toBeDefined();
    expect(await reloaded.get('large')).toBeUndefined();
  });
});
