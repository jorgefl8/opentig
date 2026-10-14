import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CliProcessRunner, CliRunOptions, CliRunResult } from '../ai/CliProcessRunner';
import type { CliResolver } from '../ai/CliResolver';
import type { RepositoryInfo } from '../../shared/contracts';
import type { RepositoryService } from '../git/RepositoryService';
import { GitProcess } from '../git/GitProcess';
import { SettingsStore } from '../persistence/SettingsStore';
import { GitHubAccountsService } from './GitHubAccountsService';
import { GitHubService } from './GitHubService';

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});
const result = (stdout: string, exitCode = 0, stderr = ''): CliRunResult => ({ stdout, exitCode, stderr });
const token = (login: string) => `gho_fixture_${login}_0000000000000000000`;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

async function fixture(reply: (args: string[], options: CliRunOptions) => Promise<CliRunResult>) {
  vi.stubEnv('GH_TOKEN', ''); vi.stubEnv('GITHUB_TOKEN', '');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'opentig-gh-flight-'));
  directories.push(directory);
  const settings = new SettingsStore(path.join(directory, 'settings.json'));
  await settings.load();
  const repos: RepositoryInfo[] = ['alice', 'bob'].map(login => ({
    id: login, name: login, repositoryName: login, path: path.join(directory, login), commonDir: path.join(directory, login, '.git'),
  }));
  const repositories = { get: (id: string) => repos.find(repo => repo.id === id)!, status: async () => ({ branch: 'feature', upstream: 'origin/feature', ahead: 0 }) } as unknown as RepositoryService;
  const git = new GitProcess();
  for (const repo of repos) git.registerRepository(repo.path, repo.commonDir);
  let remote = 'https://github.com/example/demo.git';
  const gitRun = vi.spyOn(git, 'run').mockImplementation(async () => ({ stdout: Buffer.from(remote), stderr: Buffer.alloc(0), exitCode: 0 }));
  const run = vi.fn(async (_executable: string, args: string[], options: CliRunOptions = {}) => {
    if (args[0] === '--version') return result('gh version 2.88.0');
    if (args[0] === 'auth') return result(token(args.includes('--user') ? args.at(-1)! : 'alice'));
    if (args[0] === 'api' && args[1] === 'user') return result(options.env?.GH_TOKEN === token('bob') ? 'bob' : 'alice');
    return reply(args, options);
  });
  const resolver = { discover: async () => [{ executable: 'gh', alias: 'gh', source: 'process-path', env: {} }], warning: async () => undefined } as unknown as CliResolver;
  const runner = { run } as unknown as CliProcessRunner;
  const accounts = new GitHubAccountsService(resolver, runner, git, settings);
  for (const repo of repos) await accounts.setSelection(repo, { mode: 'account', host: 'github.com', login: repo.id });
  const service = new GitHubService(resolver, runner, git, repositories, accounts);
  return { service, accounts, run, git, gitRun, repos, setRemote: (value: string) => { remote = value; } };
}
const views = (run: ReturnType<typeof vi.fn>) => run.mock.calls.filter(([, args]) => args[0] === 'pr' && args[1] === 'view');

describe('GitHub pending reads', () => {
  it('stops retrying when authentication keeps changing and recovers on the next request', async () => {
    let attempts = 0;
    const f = await fixture(async args => {
      if (args[0] !== 'pr') return result('{}');
      if (++attempts <= 10) await f.accounts.setSelection(f.repos[0]!, { mode: 'account', host: 'github.com', login: attempts % 2 ? 'bob' : 'alice' });
      return result('{"number":12,"state":"OPEN"}');
    });
    await expect(f.service.getPullRequest('alice', 12)).rejects.toThrow(/changed repeatedly/);
    expect(attempts).toBe(3);
    attempts = 10;
    expect(await f.service.getPullRequest('alice', 12)).toMatchObject({ number: 12 });
  });

  it('four readers share routing, credentials, detail and stack membership, with no settled cache', async () => {
    const started = deferred<void>();
    const gate = deferred<CliRunResult>();
    const f = await fixture(async args => {
      if (args[0] === 'pr') { started.resolve(); return gate.promise; }
      return result('{}');
    });
    const readers = Array.from({ length: 4 }, () => f.service.getPullRequest('alice', 12));
    await started.promise;
    expect(views(f.run)).toHaveLength(1);
    expect(f.gitRun).toHaveBeenCalledTimes(1);
    expect(f.run.mock.calls.filter(([, args]) => args[1] === 'token')).toHaveLength(1);
    gate.resolve(result('{"number":12,"state":"OPEN","title":"Initial"}'));
    const values = await Promise.all(readers);
    expect(f.run.mock.calls.filter(([, args]) => args[1] === 'graphql')).toHaveLength(1);
    values[0]!.title = 'consumer edit';
    expect(values[1]!.title).toBe('Initial');
    await f.service.getPullRequest('alice', 12);
    expect(views(f.run)).toHaveLength(2);
  });

  it('shares failures only while pending and retries without retaining errors', async () => {
    const started = deferred<void>();
    const gate = deferred<CliRunResult>();
    let offline = true;
    const f = await fixture(async args => {
      if (args[0] !== 'pr') return result('{}');
      if (offline) { started.resolve(); return gate.promise; }
      return result('{"number":12,"state":"OPEN"}');
    });
    const pending = Promise.allSettled(Array.from({ length: 4 }, () => f.service.getPullRequest('alice', 12)));
    await started.promise;
    gate.resolve(result('', 1, 'connection refused'));
    expect((await pending).every(value => value.status === 'rejected')).toBe(true);
    offline = false;
    const fresh = await Promise.all(Array.from({ length: 4 }, () => f.service.getPullRequest('alice', 12)));
    expect(fresh.every(value => value.number === 12)).toBe(true);
    expect(views(f.run)).toHaveLength(2);
  });

  it('isolates resources, repositories and credentials while sharing only routing probes', async () => {
    const started = deferred<void>();
    const gate = deferred<void>();
    let count = 0;
    const f = await fixture(async (args, options) => {
      if (args[0] !== 'pr') return result('{}');
      if (++count === 3) started.resolve();
      await gate.promise;
      return result(JSON.stringify({ number: Number(args[2]), state: 'OPEN', title: options.env?.GH_TOKEN === token('bob') ? 'bob' : 'alice' }));
    });
    const pending = [f.service.getPullRequest('alice', 12), f.service.getPullRequest('alice', 13), f.service.getPullRequest('bob', 12)];
    await started.promise;
    expect(f.gitRun).toHaveBeenCalledTimes(2);
    gate.resolve();
    expect((await Promise.all(pending)).map(value => [value.number, value.title])).toEqual([[12, 'alice'], [13, 'alice'], [12, 'bob']]);
    expect(views(f.run)).toHaveLength(3);
  });

  it('discards old-account data when the account changes during a read', async () => {
    const started = deferred<void>();
    const gate = deferred<CliRunResult>();
    const f = await fixture(async (args, options) => {
      if (args[0] !== 'pr') return result('{}');
      if (options.env?.GH_TOKEN === token('alice')) { started.resolve(); return gate.promise; }
      return result('{"number":12,"state":"OPEN","title":"bob"}');
    });
    const pending = f.service.getPullRequest('alice', 12);
    await started.promise;
    await f.accounts.setSelection(f.repos[0]!, { mode: 'account', host: 'github.com', login: 'bob' });
    gate.resolve(result('{"number":12,"state":"OPEN","title":"alice"}'));
    expect(await pending).toMatchObject({ title: 'bob' });
    expect(views(f.run)).toHaveLength(2);
  });

  it('re-resolves external remote changes during a read and on later refreshes', async () => {
    const started = deferred<void>();
    const gate = deferred<CliRunResult>();
    let first = true;
    const f = await fixture(async args => {
      if (args[0] !== 'pr') return result('{}');
      if (first) { first = false; started.resolve(); return gate.promise; }
      return result(JSON.stringify({ number: 12, state: 'OPEN', title: args[args.indexOf('-R') + 1] }));
    });
    const pending = f.service.getPullRequest('alice', 12);
    await started.promise;
    f.setRemote('https://github.com/example/changed.git');
    f.git.invalidate(f.repos[0]!.path);
    gate.resolve(result('{"number":12,"state":"OPEN","title":"old remote"}'));
    expect(await pending).toMatchObject({ title: 'example/changed' });
    expect(views(f.run)).toHaveLength(2);
    f.setRemote('https://github.com/example/later.git');
    expect(await f.service.getPullRequest('alice', 12)).toMatchObject({ title: 'example/later' });
  });

  it('never shares PR creation and invalidates a pending read after the mutation', async () => {
    const started = deferred<void>();
    const gate = deferred<CliRunResult>();
    let first = true;
    const f = await fixture(async args => {
      if (args[1] === 'create') return result('https://github.com/example/demo/pull/12');
      if (args[1] === 'view') {
        if (first) { first = false; started.resolve(); return gate.promise; }
        return result('{"number":12,"state":"OPEN","title":"fresh"}');
      }
      return result('{}');
    });
    const pending = f.service.getPullRequest('alice', 12);
    await started.promise;
    const input = { repositoryId: 'alice', title: 'Fixture', body: 'Test', base: 'main', draft: true };
    await Promise.all([f.service.createPullRequest(input), f.service.createPullRequest(input)]);
    expect(f.run.mock.calls.filter(([, args]) => args[1] === 'create')).toHaveLength(2);
    gate.resolve(result('{"number":12,"state":"OPEN","title":"stale"}'));
    expect(await pending).toMatchObject({ title: 'fresh' });
    expect(views(f.run)).toHaveLength(2);
  });
});
