import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
  const state = { login: options.login ?? 'tester', remote: options.remote ?? 'https://github.com/example/demo.git', views: 0, failWith: null as string | null, gate: null as Promise<void> | null, bodyBytes: 0 };
  const clock = options.clock ?? { now: Date.parse('2026-11-15T10:00:00Z') };
  const run = vi.fn(async (_exe: string, args: string[]): Promise<CliRunResult> => {
    if (args[0] === 'auth' && args[1] === 'token') return { exitCode: 0, stdout: TOKEN, stderr: '' };
    if (args[0] === 'api' && args[1] === 'user') return { exitCode: 0, stdout: state.login, stderr: '' };
    if (args[0] === '--version' || args[0] === 'auth') return ok('ready');
    if (args[0] === 'api' && /actions\/runs\/\d+$/.test(args[1] ?? '')) {
      state.views++;
      return ok({ id: 5, name: 'CI', run_number: 3, run_attempt: 1, workflow_id: 1, status: 'completed', conclusion: state.views > 1 ? 'success' : 'failure', event: 'push', head_branch: 'main', head_sha: 'b'.repeat(40), html_url: 'https://github.com/example/demo/actions/runs/5', path: null, created_at: '2026-11-15T09:00:00Z', updated_at: '2026-11-15T09:00:00Z' });
    }
    if (args[0] === 'api' && /\/jobs\?/.test(args[1] ?? '')) return ok({ total_count: 0, jobs: [] });
    if (args[0] === 'pr' && args[1] === 'view') {
      if (state.failWith) return { exitCode: 1, stdout: '', stderr: state.failWith };
      state.views++;
      const views = state.views;
      if (state.gate) await state.gate;
      return ok({ number: Number(args[2]), state: 'OPEN', title: `read ${views}`, body: 'x'.repeat(state.bodyBytes), updatedAt: '2026-11-15T09:00:00Z', headRefOid: 'a'.repeat(40) });
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
    run: async (cwd: string, args: string[]) => ({ stdout: Buffer.from(args.includes('core.sshCommand') || args[0] === 'config' ? '' : cwd === '/work/other' ? 'https://github.com/example/other.git' : state.remote) }),
  } as unknown as GitProcess;
  const repository = { path: '/work/demo', commonDir: '/work/demo/.git', id: 'repo', name: 'demo', repositoryName: 'demo' } as RepositoryInfo;
  const other = { path: '/work/other', commonDir: '/work/other/.git', id: 'other', name: 'other', repositoryName: 'other' } as RepositoryInfo;
  const repositories = { get: (id: string) => id === 'other' ? other : repository } as unknown as RepositoryService;
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
    expect((await service.getPullRequest('repo', 12, false, client.sink)).title).toBe('read 1');
    expect(client.answers).toHaveLength(1);
    expect(client.answers[0]!.readAt).toBe('2026-11-15T10:00:00.000Z');
    await expect(client.answers[0]!.refresh).resolves.toEqual({ outcome: 'updated' });
    expect(state.views).toBe(2);
    // Told of the refresh, the client asks again and gets the new answer without another read.
    const after = keptSink();
    expect((await service.getPullRequest('repo', 12, false, after.sink)).title).toBe('read 2');
    expect(after.answers).toHaveLength(0);
    expect(state.views).toBe(2);

    // A client that cannot mark an answer as old waits for GitHub once the answer is no longer current.
    clock.now += 2 * 60_000;
    expect((await service.getPullRequest('repo', 12)).title).toBe('read 3');
  });

  it('reads again from GitHub when asked for a fresh answer, unless GitHub answered moments ago', async () => {
    const { service, clock, state } = server(path.join(await folder(), 'github-cache.json'));
    await service.getPullRequest('repo', 12);
    // Refresh pressed again a moment later: what GitHub just said is new enough.
    clock.now += 2_000;
    expect((await service.getPullRequest('repo', 12, true)).title).toBe('read 1');
    expect(state.views).toBe(1);
    // Past that, an ordinary read is answered from what was kept, and a fresh one asks GitHub.
    clock.now += 10_000;
    expect((await service.getPullRequest('repo', 12)).title).toBe('read 1');
    expect((await service.getPullRequest('repo', 12, true)).title).toBe('read 2');
    expect(state.views).toBe(2);
  });

  it('never answers a fresh read with a read that began before it was asked', async () => {
    const { service, state } = server(path.join(await folder(), 'github-cache.json'));
    let open!: () => void;
    state.gate = new Promise<void>((resolve) => { open = resolve; });
    const opened = service.getPullRequest('repo', 12);
    await vi.waitFor(() => expect(state.views).toBe(1));
    const refreshed = service.getPullRequest('repo', 12, true);
    await vi.waitFor(() => expect(state.views).toBe(2));
    open();
    expect((await opened).title).toBe('read 1');
    expect((await refreshed).title).toBe('read 2');
    expect(state.views).toBe(2);
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
    expect((await restarted.service.getPullRequest('repo', 12, false, client.sink)).title).toBe('read 1');
    expect(client.answers).toHaveLength(1);

    const otherAccount = server(file, { clock, login: 'someone-else' });
    const other = keptSink();
    expect((await otherAccount.service.getPullRequest('repo', 12, false, other.sink)).title).toBe('read 1');
    // Read from GitHub with its own account: the stub numbers reads per server.
    expect(other.answers).toHaveLength(0);
    expect(otherAccount.state.views).toBe(1);
  });

  it('never shows what one remote said once the repository points at another', async () => {
    const { service, state, cache } = server(path.join(await folder(), 'github-cache.json'));
    await service.getPullRequest('repo', 12);
    state.remote = 'https://github.com/someone/fork.git';
    const client = keptSink();
    expect((await service.getPullRequest('repo', 12, false, client.sink)).title).toBe('read 2');
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
    await service.getPullRequest('repo', 12, false, client.sink);
    await expect(client.answers[0]!.refresh).resolves.toMatchObject({ outcome: 'failed', error: { code: 'GH_AUTH_REQUIRED' } });
    expect(cache.size).toBe(0);
  });

  it('never shows a finished run as current: it may have been started again on GitHub', async () => {
    const { service, state, clock } = server(path.join(await folder(), 'github-cache.json'));
    expect((await service.getActionRun('repo', 5)).conclusion).toBe('failure');
    // Moments later, a client that can mark it gets it marked, and the run is read again behind it.
    const client = keptSink();
    expect((await service.getActionRun('repo', 5, client.sink)).conclusion).toBe('failure');
    expect(client.answers).toHaveLength(1);
    await client.answers[0]!.refresh;
    expect(state.views).toBe(2);
    // Told of the refresh, the client reads again without accepting a kept answer: the refresh's answer, not another read.
    const after = keptSink();
    expect((await service.getActionRun('repo', 5)).conclusion).toBe('success');
    expect(after.answers).toHaveLength(0);
    expect(state.views).toBe(2);
    // Past that moment, a client that cannot mark it waits for GitHub.
    clock.now += 10_000;
    await service.getActionRun('repo', 5);
    expect(state.views).toBe(3);
  });

  it('does not serve again a kept answer GitHub has replaced with one too large to keep', async () => {
    const { service, state, clock } = server(path.join(await folder(), 'github-cache.json'));
    await service.getPullRequest('repo', 12);
    clock.now += 2 * 60_000;
    state.bodyBytes = GITHUB_READ_CACHE_LIMITS.memoryBytes / 4 + 1;
    const client = keptSink();
    await service.getPullRequest('repo', 12, false, client.sink);
    await client.answers[0]!.refresh;
    // Told of the refresh, the client asks again: it gets GitHub's answer, never the old one again.
    const again = keptSink();
    expect((await service.getPullRequest('repo', 12, false, again.sink)).title).toBe('read 3');
    expect(again.answers).toHaveLength(0);
  });

  it('keeps a refresh that finished while another repository was changed through OpenTig', async () => {
    const { service, state, clock } = server(path.join(await folder(), 'github-cache.json'));
    // The other repository has been read, so which GitHub repository it is is known.
    await service.getPullRequest('other', 1);
    await service.getPullRequest('repo', 12);
    clock.now += 2 * 60_000;
    let open!: () => void;
    state.gate = new Promise((resolve) => { open = resolve; });
    const client = keptSink();
    await service.getPullRequest('repo', 12, false, client.sink);
    service.invalidate('other', { pullRequest: 12 });
    open();
    state.gate = null;
    await client.answers[0]!.refresh;
    // The refreshed answer was kept, so asking again is answered from it.
    expect((await service.getPullRequest('repo', 12, false, keptSink().sink)).title).toBe('read 3');
    expect(state.views).toBe(3);
  });

  it('counts a change in a checkout whose GitHub repository is not known yet as concerning every read', async () => {
    const { service, state, clock } = server(path.join(await folder(), 'github-cache.json'));
    await service.getPullRequest('repo', 12);
    clock.now += 2 * 60_000;
    let open!: () => void;
    state.gate = new Promise((resolve) => { open = resolve; });
    const client = keptSink();
    await service.getPullRequest('repo', 12, false, client.sink);
    // The other checkout has made no GitHub read in this run: it may be a clone of the same repository.
    service.invalidate('other', { pullRequest: 12 });
    open();
    state.gate = null;
    await client.answers[0]!.refresh;
    clock.now += 10_000;
    const again = keptSink();
    expect((await service.getPullRequest('repo', 12, false, again.sink)).title).toBe('read 1');
    expect(again.answers).toHaveLength(1);
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

  it('keeps a drop made before the file is read: what it dropped does not come back from disk', async () => {
    const file = path.join(await folder(), 'github-cache.json');
    const first = new GitHubReadCache(file);
    first.set('kept', scope, { title: 'old account' });
    first.set('other', { ...scope, login: 'someone' }, { title: 'other account' });
    await first.close();
    // An account change at start-up, before any GitHub view has read the file.
    const next = new GitHubReadCache(file);
    next.dropWhere((entry) => entry.scope.login === 'tester');
    expect(await next.get('kept')).toBeUndefined();
    expect(await next.get('other')).toBeDefined();
    await next.flush();
    const restarted = new GitHubReadCache(file);
    expect(await restarted.get('kept')).toBeUndefined();
    expect(await restarted.get('other')).toBeDefined();
  });

  it('removes what a write cut short left behind', async () => {
    const folderPath = await folder();
    const file = path.join(folderPath, 'github-cache.json');
    await writeFile(`${file}.0f0e0d0c-aaaa-bbbb-cccc-000000000000.tmp`, '{"format":1,');
    await new GitHubReadCache(file).load();
    expect(await readdir(folderPath)).toEqual([]);
  });

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
