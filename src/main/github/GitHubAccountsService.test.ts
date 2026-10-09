import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryInfo } from '../../shared/contracts';
import { githubRepositoryKey } from '../../shared/github-accounts';
import { SettingsStore } from '../persistence/SettingsStore';
import { GitHubStatusStore } from '../persistence/GitHubStatusStore';
import type { CliProcessRunner, CliRunOptions } from '../ai/CliProcessRunner';
import type { CliResolver } from '../ai/CliResolver';
import type { GitProcess } from '../git/GitProcess';
import type { RepositoryService } from '../git/RepositoryService';
import { GitHubAccountsService } from './GitHubAccountsService';
import { GitHubService } from './GitHubService';

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
const token = (login: string) => `gho_fixture_${login}_000000000000000000000`;
const response = (stdout = '', exitCode = 0, stderr = '') => ({ stdout, exitCode, stderr });
const remote = 'git@organisation-alias:organisation/demo.git';
const repo: RepositoryInfo = { id: 'repo', name: 'demo', repositoryName: 'demo', path: '/fixture/demo', commonDir: '/fixture/demo/.git' };

async function fixture(options: { https?: boolean; env?: Record<string, string>; invalid?: boolean; noSsh?: boolean; customSsh?: boolean; missing?: boolean; denied?: boolean; noCli?: boolean; unknownJson?: boolean } = {}) {
  vi.stubEnv('GH_TOKEN', ''); vi.stubEnv('GITHUB_TOKEN', ''); vi.stubEnv('GIT_SSH', ''); vi.stubEnv('GIT_SSH_COMMAND', '');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'opentig-account-test-'));
  directories.push(directory);
  const file = path.join(directory, 'settings.json');
  const statusFile = path.join(directory, 'github-status.json');
  const settings = new SettingsStore(file); await settings.load();
  const changed = vi.fn();
  let active = 'alice';
  const run = vi.fn(async (executable: string, args: string[], optionsRun: CliRunOptions = {}) => {
    if (executable === 'ssh') return args[0] === '-G' ? response('hostname github.com\n')
      : options.noSsh ? response('', 255, 'Permission denied') : response('', 1, "Hi bob! You've successfully authenticated, but GitHub does not provide shell access.\n");
    if (args[0] === '--version') return response('gh version 2.88.0');
    if (args[0] === 'auth' && args[1] === 'status') {
      if (options.unknownJson) return response('', 1, 'unknown flag: --json');
      return response(JSON.stringify({ hosts: { 'github.com': [
        { login: 'alice', active: true, state: 'error', tokenSource: 'keyring', token: 'SECRET_MUST_NOT_PERSIST', error: 'PRIVATE_ERROR' },
        { login: 'bob', active: false, state: 'success', tokenSource: '/fixture/config/hosts.yml', scopes: 'repo, read:org' },
      ] } }));
    }
    if (args[0] === 'auth' && args[1] === 'token') {
      const user = args.includes('--user') ? args.at(-1)! : options.env?.GITHUB_TOKEN ? 'envuser' : active;
      return options.missing && user === 'bob' ? response('CREDENTIAL_MUST_NOT_LEAK', 1, 'PRIVATE_ERROR') : response(token(user));
    }
    if (args[0] === 'api' && args[1] === 'user') {
      if (options.invalid) return response(token('bob'), 1, 'HTTP 401: Bad credentials');
      return response(['alice', 'bob', 'envuser'].find((user) => optionsRun.env?.GH_TOKEN === token(user)) ?? 'unexpected');
    }
    if (options.denied) return response('', 1, 'HTTP 403: Resource not accessible by personal access token');
    if (args[0] === 'pr' && args[1] === 'create') return response('https://github.com/organisation/demo/pull/12\n');
    if (args[0] === 'pr' && args[1] === 'view') return response(JSON.stringify({ number: 12, state: 'OPEN', title: 'Fixture' }));
    if (args[0] === 'pr' && args[1] === 'diff') return response('diff --git a/file b/file\n');
    if (args[0] === 'api' && args[1]?.includes('/commits/')) return response('diff --git a/file b/file\n');
    return response(args[0] === 'pr' || args[1]?.includes('/stacks?') ? '[]' : '{}');
  });
  const resolver = { discover: async () => options.noCli ? [] : [{ executable: 'gh', alias: 'gh', source: 'process-path', env: { PATH: '/fixture/bin', ...options.env } }], warning: async () => undefined } as unknown as CliResolver;
  const runner = { run } as unknown as CliProcessRunner;
  const git = { run: async (_cwd: string, args: string[]) => ({ stdout: Buffer.from(args.includes('core.sshCommand') ? options.customSsh ? 'custom ssh' : '' : options.https ? 'https://github.com/organisation/demo.git' : remote) }) } as unknown as GitProcess;
  const repositories = { get: (id: string) => ({ ...repo, id }), status: async () => ({ branch: 'feature', upstream: 'origin/feature', ahead: 0 }) } as unknown as RepositoryService;
  const accounts = new GitHubAccountsService(resolver, runner, git, settings, new GitHubStatusStore(statusFile), changed);
  const service = new GitHubService(resolver, runner, git, repositories, accounts);
  return { accounts, service, settings, run, changed, file, statusFile, setActive: (user: string) => { active = user; } };
}

describe('GitHub account inventory and repository policy', () => {
  it('opens cached status without invoking a CLI and stores only allowlisted metadata', async () => {
    const f = await fixture();
    expect(await f.accounts.status()).toMatchObject({ checkedAt: null, installationStatus: 'unchecked' });
    expect(f.run).not.toHaveBeenCalled();
    const [first, second] = await Promise.all([f.accounts.status(true), f.accounts.status(true)]);
    expect(first).toEqual(second);
    expect(first.accounts).toMatchObject([{ login: 'alice', active: true, state: 'invalid' }, { login: 'bob', state: 'authenticated', storage: 'file' }]);
    expect(f.run.mock.calls.filter(([, args]) => args[1] === 'status')).toHaveLength(1);
    expect(await readFile(f.statusFile, 'utf8')).not.toMatch(/SECRET|PRIVATE_ERROR|oauth_token|token"/);
    const calls = f.run.mock.calls.length;
    await f.accounts.status();
    expect(f.run.mock.calls).toHaveLength(calls);
    const saved = await new GitHubStatusStore(f.statusFile).load();
    expect({ ...saved, defaultLogin: null, suggestedLogin: null, repositoryAccounts: [] }).toEqual(first);
  });

  it('keeps saved global and environment authentication distinct', async () => {
    const f = await fixture({ https: true, env: { GITHUB_TOKEN: 'environment_token_000000000000000' } });
    const status = await f.accounts.status(true);
    expect(status).toMatchObject({ activeLogin: 'alice', environment: { present: true, login: 'envuser', state: 'authenticated' } });
    expect(f.run.mock.calls.find(([, args]) => args[1] === 'status')?.[2]?.removeEnv).toEqual(expect.arrayContaining(['GH_TOKEN', 'GITHUB_TOKEN']));
    expect(await f.service.repositoryAccount('repo', true)).toMatchObject({ login: 'envuser', source: 'environment' });
    await f.accounts.setSelection(repo, { mode: 'account', host: 'github.com', login: 'bob' });
    expect(await f.service.repositoryAccount('repo', true)).toMatchObject({ login: 'bob', source: 'explicit' });
  });

  it('uses the SSH user, independent of alias, owner and invalid active account', async () => {
    const f = await fixture(); await f.accounts.status(true);
    expect(await f.service.repositoryAccount('repo', true)).toMatchObject({ login: 'bob', source: 'ssh', state: 'ready' });
    expect(f.run.mock.calls.some(([, args]) => args.includes('switch') || args.includes('login'))).toBe(false);
    expect(await f.service.listPullRequests('repo', ['OPEN'])).toEqual([]);
  });

  it('bypasses SSH and token-identity caches on an explicit repository check', async () => {
    const f = await fixture();
    await f.service.repositoryAccount('repo', true);
    await f.service.listPullRequests('repo', ['OPEN']);
    await f.service.repositoryAccount('repo', true);
    expect(f.run.mock.calls.filter(([executable, args]) => executable === 'ssh' && args[0] === '-T')).toHaveLength(2);
    expect(f.run.mock.calls.filter(([, args]) => args[1] === 'user')).toHaveLength(2);
  });

  it.each([{ noSsh: true }, { customSsh: true }])('requires explicit selection for unverifiable or overridden SSH (%j)', async (options) => {
    const f = await fixture(options);
    await expect(f.service.listPullRequests('repo', ['OPEN'])).rejects.toMatchObject({ detail: { code: 'GH_ACCOUNT_UNRESOLVED' } });
    await f.accounts.setSelection(repo, { mode: 'account', host: 'github.com', login: 'alice' });
    expect(await f.service.listPullRequests('repo', ['OPEN'])).toEqual([]);
  });

  it.each([{ missing: true, code: 'GH_ACCOUNT_MISSING' }, { invalid: true, code: 'GH_AUTH_REQUIRED' }])('does not fall back when selected credentials fail (%j)', async (options) => {
    const f = await fixture(options);
    await expect(f.service.listPullRequests('repo', ['OPEN'])).rejects.toMatchObject({ detail: { code: options.code } });
    expect(f.run.mock.calls.some(([, args]) => args[0] === 'pr')).toBe(false);
    expect(JSON.stringify(await f.service.repositoryAccount('repo'))).not.toMatch(/CREDENTIAL_MUST|PRIVATE_ERROR|gho_fixture/);
  });

  it('reports repository access errors without treating valid authentication as logout', async () => {
    const f = await fixture({ denied: true });
    await expect(f.service.listPullRequests('repo', ['OPEN'])).rejects.toMatchObject({ detail: { code: 'GH_ACCESS_DENIED' } });
    expect(await f.service.repositoryAccount('repo')).toMatchObject({ state: 'ready', login: 'bob' });
  });

  it('reports missing and incompatible CLI independently from authentication', async () => {
    expect(await (await fixture({ noCli: true })).accounts.status(true)).toMatchObject({ installationStatus: 'not-found' });
    expect(await (await fixture({ unknownJson: true })).accounts.status(true)).toMatchObject({ installationStatus: 'incompatible' });
  });
});

describe('coherent GitHub operations and persistence', () => {
  it('applies the same account to every PR and API operation including stacks', async () => {
    const f = await fixture();
    await f.service.listPullRequests('repo', ['OPEN', 'CLOSED']);
    await f.service.findPullRequestForBranch('repo', 'feature');
    await f.service.getPullRequest('repo', 12);
    await f.service.getPullRequestStack('repo', 12);
    await f.service.getPullRequestDiff('repo', 12);
    await f.service.getPullRequestCommitDiff('repo', 'a'.repeat(40));
    await f.service.createPullRequest({ repositoryId: 'repo', title: 'Fixture', body: 'Body', base: 'main', draft: false });
    const calls = f.run.mock.calls.filter(([, args]) => args[0] === 'pr' || (args[0] === 'api' && args[1] !== 'user'));
    expect(calls.length).toBeGreaterThan(8);
    for (const [, args, options] of calls) {
      expect(options?.env?.GH_TOKEN).toBe(token('bob'));
      expect(JSON.stringify(args)).not.toContain(token('bob'));
      expect(options?.removeEnv).toContain('GH_DEBUG');
    }
    expect(f.run.mock.calls.filter(([executable, args]) => executable === 'ssh' && args[0] === '-T')).toHaveLength(1);
    expect(f.run.mock.calls.filter(([, args]) => args[1] === 'user')).toHaveLength(1);
  });

  it('persists per common directory across worktrees and separates concurrent repositories', async () => {
    const f = await fixture({ https: true });
    await f.accounts.setSelection(repo, { mode: 'account', host: 'github.com', login: 'bob' });
    expect(f.accounts.selection({ ...repo, id: 'other-worktree', path: '/fixture/worktree' })).toMatchObject({ login: 'bob' });
    const restarted = new SettingsStore(f.file); await restarted.load();
    expect(restarted.githubAccount(repo.commonDir)).toMatchObject({ login: 'bob' });
    const other = { ...repo, id: 'other', commonDir: '/fixture/other/.git' };
    await f.accounts.setSelection(other, { mode: 'account', host: 'github.com', login: 'alice' });
    const [first, second] = await Promise.all([f.accounts.authenticate(repo, 'https://github.com/org/a.git', 'org/a', 'read'), f.accounts.authenticate(other, 'https://github.com/org/b.git', 'org/b', 'read')]);
    expect([first.auth.env?.GH_TOKEN, second.auth.env?.GH_TOKEN]).toEqual([token('bob'), token('alice')]);
    await f.accounts.setSelection(repo, { mode: 'auto' });
    expect(f.accounts.selection(repo)).toEqual({ mode: 'auto' });
    expect(githubRepositoryKey('/Fixture/.git', 'linux')).not.toBe(githubRepositoryKey('/fixture/.git', 'linux'));
    expect(githubRepositoryKey('C:\\Fixture\\.git', 'win32')).toBe(githubRepositoryKey('c:/fixture/.git', 'win32'));
  });

  it('blocks creation when the reviewed account or selection revision changed', async () => {
    const f = await fixture({ https: true });
    const reviewed = await f.service.repositoryAccount('repo', true);
    f.setActive('bob');
    await expect(f.service.createPullRequest({ repositoryId: 'repo', title: 'Fixture', body: 'Body', base: 'main', draft: false,
      expectedAccount: { login: reviewed.login!, revision: reviewed.revision } })).rejects.toMatchObject({ detail: { code: 'GH_ACCOUNT_UNRESOLVED' } });
    expect(f.run.mock.calls.some(([, args]) => args[1] === 'create')).toBe(false);
  });

  it('publishes an external identity change discovered by a read and keeps the updated context', async () => {
    const f = await fixture({ https: true });
    const first = await f.service.repositoryAccount('repo', true);
    f.setActive('bob');
    await f.service.findPullRequestForBranch('repo', 'feature');
    expect(f.changed).toHaveBeenCalledOnce();
    expect(await f.service.repositoryAccount('repo')).toMatchObject({ state: 'ready', login: 'bob', revision: first.revision + 1 });
    await f.service.listPullRequests('repo', ['OPEN']);
    expect(f.changed).toHaveBeenCalledOnce();
  });
});

describe('OpenTig global default', () => {
  it('follows the OpenTig default across worktrees without changing fixed accounts or active gh', async () => {
    const f = await fixture({ https: true });
    const fixed = { ...repo, id: 'clone', commonDir: '/fixture/clone/.git' };
    expect((await f.accounts.status()).defaultLogin).toBeNull();
    await f.accounts.setDefaultAccount('bob');
    await f.accounts.setSelection(repo, { mode: 'account', host: 'github.com', login: 'bob', useGlobalDefault: true, gitMode: 'managed' });
    await f.accounts.setSelection(fixed, { mode: 'account', host: 'github.com', login: 'bob', gitMode: 'external' });
    const reviewed = f.accounts.revisionFor(repo); const fixedRevision = f.accounts.revisionFor(fixed);
    const authenticated = await f.accounts.authenticate(repo, 'https://github.com/org/demo.git', 'org/demo', 'read');
    await f.accounts.setDefaultAccount('alice');
    expect(authenticated.auth.env?.GH_TOKEN).toBe(token('bob'));
    expect(f.accounts.selection({ ...repo, id: 'worktree', path: '/fixture/worktree' })).toMatchObject({ login: 'alice', useGlobalDefault: true, gitMode: 'managed' });
    expect(f.accounts.selection(fixed)).toMatchObject({ login: 'bob', gitMode: 'external' });
    expect(f.accounts.revisionFor(repo)).toBeGreaterThan(reviewed);
    expect(f.accounts.revisionFor(fixed)).toBe(fixedRevision);
    f.setActive('bob');
    expect((await f.accounts.authenticate(repo, 'https://github.com/org/demo.git', 'org/demo', 'read')).auth.env?.GH_TOKEN).toBe(token('alice'));
    expect(f.run.mock.calls.some(([, args]) => args[0] === 'auth' && args[1] === 'switch')).toBe(false);
    const restarted = new SettingsStore(f.file); await restarted.load();
    expect(restarted.githubDefaultLogin).toBe('alice');
    expect(restarted.githubAccount(repo.commonDir)).toMatchObject({ login: 'alice', useGlobalDefault: true });
    expect(restarted.githubAccount('/fixture/new/.git')).toEqual({ mode: 'auto' });
  });
  it('rejects a default or repository choice changed since setup was reviewed', async () => {
    const f = await fixture({ https: true });
    const reviewed = await f.service.repositoryAccount('repo');
    await f.accounts.setDefaultAccount('alice');
    await expect(f.accounts.setSelection(repo, { mode: 'account', host: 'github.com', login: 'bob', useGlobalDefault: true })).rejects.toThrow('default account changed');
    await f.accounts.setSelection(repo, { mode: 'account', host: 'github.com', login: 'bob' });
    await expect(f.service.setRepositoryAccount('repo', { mode: 'account', host: 'github.com', login: 'alice' }, reviewed.revision)).rejects.toThrow('another session');
    expect(f.accounts.selection(repo)).toMatchObject({ login: 'bob' });
  });
  it('does not fall back when the default account has disappeared', async () => {
    const f = await fixture({ https: true, missing: true });
    await f.accounts.setDefaultAccount('bob');
    await f.accounts.setSelection(repo, { mode: 'account', host: 'github.com', login: 'bob', useGlobalDefault: true, gitMode: 'managed' });
    await expect(f.accounts.authenticate(repo, 'https://github.com/org/demo.git', 'org/demo', 'read')).rejects.toThrow();
    expect(f.accounts.selection(repo)).toMatchObject({ login: 'bob' });
    const tokenCalls = f.run.mock.calls.filter(([, args]) => args[0] === 'auth' && args[1] === 'token');
    expect(tokenCalls.every(([, args]) => args.at(-1) === 'bob')).toBe(true);
  });
});

it('reserves the repository revision before awaiting persistence so concurrent setup saves cannot overwrite it', async () => {
  const f = await fixture({ https: true });
  const original = f.settings.setGitHubAccount.bind(f.settings);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(f.settings, 'setGitHubAccount').mockImplementation(async (...args) => { await original(...args); await gate; });
  const first = f.service.setRepositoryAccount('repo', { mode: 'account', host: 'github.com', login: 'bob' }, 0);
  try {
    await expect(f.service.setRepositoryAccount('repo', { mode: 'account', host: 'github.com', login: 'alice' }, 0)).rejects.toThrow('another session');
    expect(f.accounts.selection(repo)).toMatchObject({ login: 'bob' });
  } finally { release(); await first; }
});

it('does not mistake verification of a freshly saved choice for an external account change', async () => {
  const f = await fixture({ https: true });
  const old = await f.service.repositoryAccount('repo', true);
  const saved = await f.service.setRepositoryAccount('repo', { mode: 'account', host: 'github.com', login: 'bob', gitMode: 'managed' }, old.revision);
  const checked = await f.service.repositoryAccount('repo', true);
  expect(checked).toMatchObject({ login: 'bob', state: 'ready', revision: saved.revision });
});
