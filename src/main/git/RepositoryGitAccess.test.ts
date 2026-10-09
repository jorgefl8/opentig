import path from 'node:path';
import { access, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';
import { managementRepository, repositoryWithUpstream, git, addWorktree } from './test-support/repository-fixtures';
import { GitProcess, type RunOptions, type GitOutput } from './GitProcess';
import { GitRepositoryOperations, pushFailure } from './GitRepositoryOperations';
import { GitHubAccountsService } from '../github/GitHubAccountsService';
import type { CliResolver } from '../ai/CliResolver';
import type { CliProcessRunner } from '../ai/CliProcessRunner';
import { RepositoryGitAccess } from './RepositoryGitAccess';
import { FileService } from '../files/FileService';
import { createCredentialBroker, gitShellQuote, managedGitHubPath } from './GitCredentialBroker';
import { GitOperationError } from '../../shared/errors';

const token = (login: string) => `gho_${login}_fixture_012345678901234567890`;
async function fixture(external = false) {
  const f = external ? await repositoryWithUpstream() : await managementRepository();
  if (!external) await git(f.work, ['remote', 'add', 'origin', 'https://github.com/team/demo.git']);
  const process = new GitProcess();
  const run = vi.fn(async (_file: string, args: string[], options?: { env?: Record<string, string> }) => {
    const result = (stdout: string) => ({ stdout, stderr: '', exitCode: 0 });
    if (args[0] === '--version') return result('gh version 2.88.0');
    if (args[0] === 'auth') return result(token(args.at(-1)!));
    if (args[1] === 'user') return result(['alice', 'bob'].find(login => options?.env?.GH_TOKEN === token(login)) ?? 'global');
    return result(JSON.stringify({ permissions: { push: true } }));
  });
  const runner = { run } as unknown as CliProcessRunner;
  const resolver = { discover: async () => [{ executable: 'gh', alias: 'gh', source: 'process-path', env: {} }], warning: async () => undefined } as unknown as CliResolver;
  const accounts = new GitHubAccountsService(resolver, runner, process, f.settings);
  const service = new RepositoryGitAccess(process, f.repositories, accounts, runner); service.install();
  const operations = new GitRepositoryOperations(process, f.repositories, new FileService(process, f.repositories)); operations.access = service;
  const repository = f.repositories.get(f.repositoryId);
  const select = (login = 'alice', gitMode: 'managed' | 'external' = 'managed') => accounts.setSelection(repository, { mode: 'account', host: 'github.com', login, gitMode });
  return { ...f, process, accounts, service, operations, repository, select, run };
}

function fakeNetwork(f: Awaited<ReturnType<typeof fixture>>, action?: (args: string[], options: RunOptions) => Promise<GitOutput>) {
  const original = f.process.network!;
  const network = vi.fn<(args: string[], options: RunOptions) => Promise<GitOutput>>(async () => ({ stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 }));
  f.process.network = (cwd, args, options, execute) => args.includes('--get-url') ? original(cwd, args, options, execute)
    : original(cwd, args, options, action ?? network);
  return network;
}

describe('repository Git access and publication', () => {
  it('keeps migration explicit, worktrees shared, clones separate and authorship unchanged', async () => {
    const f = await fixture();
    await f.accounts.setSelection(f.repository, { mode: 'account', host: 'github.com', login: 'alice' });
    expect((await f.service.publication(f.repositoryId)).mode).toBe('external');
    const author = await f.operations.getCommitAuthorship(f.repositoryId);
    await f.select();
    const tree = await f.repositories.openPath(await addWorktree(f, 'other', 'other'));
    expect(f.accounts.selection(tree)).toEqual(f.accounts.selection(f.repository));
    const clonePath = path.join(f.root, 'clone'); await git(f.root, ['clone', f.work, clonePath]);
    const clone = await f.repositories.openPath(clonePath);
    expect(f.accounts.selection(clone)).toEqual({ mode: 'auto' });
    await f.accounts.setSelection(clone, { mode: 'account', host: 'github.com', login: 'bob', gitMode: 'managed' });
    expect(f.accounts.selection(tree)).toMatchObject({ login: 'alice' });
    const revision = f.accounts.revisionFor(clone);
    await f.select('alice', 'external');
    expect(f.accounts.revisionFor(clone)).toBe(revision);
    expect((await f.service.publication(f.repositoryId)).mode).toBe('external');
    expect(await f.operations.getCommitAuthorship(f.repositoryId)).toEqual(author);
  });

  it.each(['branch.main.pushRemote', 'remote.pushDefault'])('resolves forks, %s, pushurl and URL rewrites', async key => {
    const f = await fixture(); await f.select();
    await git(f.work, ['remote', 'add', 'fork', 'https://github.com/alice/read.git']);
    await git(f.work, ['config', key, 'fork']);
    await git(f.work, ['config', 'remote.fork.pushurl', 'publish:alice/write.git']);
    await git(f.work, ['config', 'url.https://github.com/.insteadOf', 'publish:']);
    const context = await f.service.publication(f.repositoryId);
    expect(context).toMatchObject({ remote: 'fork', urls: ['https://github.com/alice/write.git'], mode: 'managed', login: 'alice' });
    await git(f.work, ['config', '--add', 'remote.fork.pushurl', 'https://github.com/other/demo.git']);
    expect((await f.service.publication(f.repositoryId)).blocked).toContain('multiple');
  });

  it('rejects an account or destination changed in another session before sending credentials', async () => {
    const f = await fixture(); await f.select(); const network = fakeNetwork(f);
    const context = await f.service.publication(f.repositoryId);
    await f.select('bob');
    expect(await f.operations.push(f.repositoryId, undefined, context.id)).toMatchObject({ status: 'rejected', reason: 'configuration' });
    const next = await f.service.publication(f.repositoryId);
    await git(f.work, ['remote', 'set-url', '--push', 'origin', 'https://github.com/bob/other.git']);
    expect(await f.operations.push(f.repositoryId, undefined, next.id)).toMatchObject({ status: 'rejected', reason: 'configuration' });
    expect(network).not.toHaveBeenCalled();
  });

  it('publishes and fetches through the real external transport without changing its identity', async () => {
    const f = await fixture(true); await f.select('alice', 'external');
    await git(f.work, ['commit', '--allow-empty', '-m', 'Local']);
    const context = await f.service.publication(f.repositoryId);
    expect(context.hasUpstream).toBe(true);
    expect(await f.operations.push(f.repositoryId, undefined, context.id)).toMatchObject({ status: 'success' });
    expect(await f.operations.fetch(f.repositoryId)).toMatchObject({ status: 'success' });
    expect(f.run).not.toHaveBeenCalled();
  });

  it('distinguishes a new branch from an existing upstream for publication review', async () => {
    const f = await fixture(true);
    expect((await f.service.publication(f.repositoryId)).hasUpstream).toBe(true);
    await git(f.work, ['switch', '-c', 'feature/new']);
    expect((await f.service.publication(f.repositoryId)).hasUpstream).toBe(false);
  });

  it('routes all read and write commands through the selected credential and cleans each broker', async () => {
    const f = await fixture(); await f.select();
    const seen: string[] = [];
    const network = fakeNetwork(f, async (args, options) => {
      let index = 0; while (args[index] === '-c') index += 2;
      seen.push(args[index]!);
      expect(JSON.stringify(args)).not.toContain(token('alice'));
      expect(options.managed).toBe(true);
      // Exercise the real helper protocol, without contacting GitHub or pushing.
      const result = await execa('git', [...args.slice(0, index), 'credential', 'fill'], { cwd: f.work,
        input: 'protocol=https\nhost=github.com\npath=team/demo.git\n\n', env: { GIT_TERMINAL_PROMPT: '0' } });
      expect(result.stdout).toContain(`password=${token('alice')}`);
      expect(result.stdout).toContain('username=alice');
      return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
    });
    const before = await readdir(os.tmpdir());
    expect(await f.operations.fetch(f.repositoryId)).toMatchObject({ status: 'success' });
    expect(await f.operations.fetchBranches(f.repositoryId)).toMatchObject({ status: 'success' });
    const context = await f.service.publication(f.repositoryId);
    expect(await f.operations.push(f.repositoryId, undefined, context.id)).toMatchObject({ status: 'published' });
    const status = await f.service.status(f.repositoryId, true);
    expect(status).toMatchObject({ identity: { state: 'ok' }, api: { state: 'ok' }, read: { state: 'ok' }, write: { state: 'ok' } });
    expect(seen).toEqual(['fetch', 'fetch', 'push', 'ls-remote']);
    expect((await readdir(os.tmpdir())).filter(name => name.startsWith('opentig-git-auth-') && !before.includes(name))).toEqual([]);
    expect(network).not.toHaveBeenCalled();
  });

  it('does not reuse successes after the account changes during a check', async () => {
    const f = await fixture(); await f.select();
    let release!: () => void; let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    fakeNetwork(f, async () => { started(); await new Promise<void>(resolve => { release = resolve; }); return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 }; });
    const checking = f.service.status(f.repositoryId, true); await ready;
    await f.select('bob'); release();
    expect(await checking).toMatchObject({ publication: { login: 'bob' }, identity: { state: 'unchecked' }, read: { state: 'unchecked' } });
  });

  it.each(['git@github.com:team/demo.git', 'https://gitlab.com/team/demo.git'])('leaves unsupported transport external: %s', async url => {
    const f = await fixture(); await f.select(); await git(f.work, ['remote', 'set-url', 'origin', url]);
    expect(await f.service.publication(f.repositoryId)).toMatchObject({ mode: 'external', login: null });
    const network = fakeNetwork(f); await f.operations.fetch(f.repositoryId);
    expect(network.mock.calls[0]?.[1].managed).toBeUndefined(); expect(f.run).not.toHaveBeenCalled();
  });
});

describe('credential broker', () => {
  it('isolates concurrent accounts from a different global helper and rejects other hosts and paths', async () => {
    const brokers = await Promise.all(['alice', 'bob'].map(login => createCredentialBroker('https://github.com/team/demo.git', login, token(login))));
    try {
      const results = await Promise.all(brokers.map(broker => execa('git', ['-c', 'credential.helper=!echo username=global', '-c', 'credential.helper=', '-c', `credential.helper=${broker.helper}`, '-c', 'credential.useHttpPath=true', 'credential', 'fill'], {
        input: 'protocol=https\nhost=github.com\npath=team/demo.git\n\n', env: { GIT_TERMINAL_PROMPT: '0' },
      })));
      expect(results[0]!.stdout).toContain(token('alice')); expect(results[1]!.stdout).toContain(token('bob'));
      for (const host of ['other.example', 'github.com:443']) {
        const result = await execa('git', ['-c', 'credential.helper=', '-c', `credential.helper=${brokers[0]!.helper}`, '-c', 'credential.useHttpPath=true', 'credential', 'fill'], {
          input: `protocol=https\nhost=${host}\npath=team/demo.git\n\n`, env: { GIT_TERMINAL_PROMPT: '0' }, reject: false,
        });
        expect(result.exitCode).not.toBe(0); expect(result.stdout).not.toContain(token('alice'));
      }
      expect(await readFile(path.join(brokers[0]!.directory, 'helper.sh'), 'utf8')).not.toContain(token('alice'));
    } finally { await Promise.all(brokers.map(broker => broker.dispose())); }
    for (const broker of brokers) await expect(access(broker.directory)).rejects.toThrow();
  });
  it('quotes Windows paths with spaces and apostrophes for Git’s shell and rejects unsafe URLs', () => {
    expect(gitShellQuote("C:\\Users\\Test User's\\helper.sh")).toBe("'C:/Users/Test User'\\''s/helper.sh'");
    for (const url of ['http://github.com/a/b', 'https://user:password@github.com/a/b', 'https://github.com/a/b?token=secret', 'https://github.com.evil/a/b', 'https://github.com/a/b/c']) expect(managedGitHubPath(url)).toBeNull();
  });
});

it.each([
  ['Repository not found', 'inaccessible'], ['Authentication failed', 'authentication'], ['Write access to repository not granted', 'permission'],
  ['GH013: repository rule violations\nfailed to push some refs', 'hook'], ['[rejected] (fetch first)\nfailed to push some refs', 'remote-changed'],
  ['Could not resolve host', 'network'], ['failed to push some refs', 'unknown'],
])('preserves and classifies push errors: %s', (message, reason) => {
  expect(pushFailure(new GitOperationError({ code: 'UNKNOWN', operation: 'push', message }))).toMatchObject({ reason, message: expect.stringContaining(message) });
});

it.each(['missing', 'revoked', 'denied'])('shows the selected account failure without fallback: %s', async failure => {
  const f = await fixture(); await f.select(); const network = fakeNetwork(f);
  const original = f.run.getMockImplementation()!;
  f.run.mockImplementation(async (file, args, options) => {
    if (failure === 'missing' && args[0] === 'auth') return { stdout: '', stderr: 'missing', exitCode: 1 };
    if (failure === 'revoked' && args[1] === 'user') return { stdout: '', stderr: 'HTTP 401: Bad credentials', exitCode: 1 };
    if (failure === 'denied' && args[1]?.startsWith('repos/')) return { stdout: '', stderr: 'HTTP 404: Not Found', exitCode: 1 };
    return original(file, args, options);
  });
  const result = await f.service.status(f.repositoryId, true);
  expect(result.publication.login).toBe('alice');
  if (failure === 'denied') expect(result.api.state).toBe('inaccessible');
  else { expect(result.identity.state).toBe('expired'); expect(network).not.toHaveBeenCalled(); }
  expect(f.run.mock.calls.filter(([, args]) => args[0] === 'auth').every(([, args]) => args.includes('--user') && args.at(-1) === 'alice')).toBe(true);
});

it.each(['error', 'cancel'])('cleans the operation broker after %s and never exposes its token', async outcome => {
  const f = await fixture(); await f.select();
  const before = await readdir(os.tmpdir());
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  fakeNetwork(f, async (_args, options) => {
    if (outcome === 'error') throw new Error(`failure ${token('alice')}`);
    const pending = f.process.run(f.work, ['-c', 'alias.wait=!sleep 20', 'wait'], options);
    started(); return pending;
  });
  const pending = f.operations.fetch(f.repositoryId);
  if (outcome === 'cancel') { await ready; await f.process.close(); }
  const result = await pending;
  expect(result).toMatchObject({ status: 'failed' });
  expect(JSON.stringify(result)).not.toContain(token('alice'));
  expect((await readdir(os.tmpdir())).filter(name => name.startsWith('opentig-git-auth-') && !before.includes(name))).toEqual([]);
});

it('redacts selected credentials from Git output and removes credential/trace environment from hooks', async () => {
  const f = await fixture();
  vi.stubEnv('GH_TOKEN', 'global-secret'); vi.stubEnv('GITHUB_TOKEN', 'other-secret'); vi.stubEnv('GIT_TRACE', '1');
  try {
    const result = await f.process.run(f.work, ['-c', `alias.inspect=!printf 'credential=${token('alice')} gh=%s github=%s trace=%s' "$GH_TOKEN" "$GITHUB_TOKEN" "$GIT_TRACE"`, 'inspect'], { operation: 'inspect', managed: true, managedSecrets: [token('alice')] });
    expect(result.stdout.toString()).toBe('credential=[redacted] gh= github= trace=');
    expect(result.stderr.toString()).not.toContain(token('alice'));
  } finally { vi.unstubAllEnvs(); }
});

it('uses the same managed transport for pull and rejects credentials for another repository path', async () => {
  const f = await fixture(); await f.select();
  await git(f.work, ['config', 'branch.main.remote', 'origin']);
  await git(f.work, ['config', 'branch.main.merge', 'refs/heads/main']);
  await git(f.work, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  let fetched = false;
  fakeNetwork(f, async (args, options) => {
    let index = 0; while (args[index] === '-c') index += 2;
    expect(args[index]).toBe('fetch'); fetched = true;
    expect(args).toContain('http.followRedirects=false'); expect(options.managed).toBe(true);
    const result = await execa('git', [...args.slice(0, index), 'credential', 'fill'], { cwd: f.work,
      input: 'protocol=https\nhost=github.com\npath=another/private.git\n\n', env: { GIT_TERMINAL_PROMPT: '0' }, reject: false });
    expect(result.exitCode).not.toBe(0); expect(result.stdout).not.toContain(token('alice'));
    return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
  });
  expect(await f.operations.pull(f.repositoryId)).toEqual({ status: 'up-to-date' }); expect(fetched).toBe(true);
});

it('isolates complete concurrent Git operations in two repositories', async () => {
  const f = await fixture(); await f.select();
  const clonePath = path.join(f.root, 'independent'); await git(f.root, ['clone', f.work, clonePath]);
  await git(clonePath, ['remote', 'set-url', 'origin', 'https://github.com/team/demo.git']);
  const clone = await f.repositories.openPath(clonePath);
  await f.accounts.setSelection(clone, { mode: 'account', host: 'github.com', login: 'bob', gitMode: 'managed' });
  const identities: string[] = [];
  fakeNetwork(f, async args => {
    let index = 0; while (args[index] === '-c') index += 2;
    const result = await execa('git', [...args.slice(0, index), 'credential', 'fill'], { cwd: f.work,
      input: 'protocol=https\nhost=github.com\npath=team/demo.git\n\n', env: { GIT_TERMINAL_PROMPT: '0' } });
    identities.push(result.stdout.split('\n').find(line => line.startsWith('username='))!);
    return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
  });
  const results = await Promise.all([f.operations.fetch(f.repositoryId), f.operations.fetch(clone.id)]);
  expect(results.every(result => result.status === 'success')).toBe(true);
  expect(identities.sort()).toEqual(['username=alice', 'username=bob']);
});

it('keeps the original account for a multi-remote operation already in progress', async () => {
  const f = await fixture(); await f.select();
  await git(f.work, ['remote', 'add', 'upstream', 'https://github.com/team/demo.git']);
  const identities: string[] = [];
  fakeNetwork(f, async args => {
    let index = 0; while (args[index] === '-c') index += 2;
    const result = await execa('git', [...args.slice(0, index), 'credential', 'fill'], { cwd: f.work,
      input: 'protocol=https\nhost=github.com\npath=team/demo.git\n\n', env: { GIT_TERMINAL_PROMPT: '0' } });
    identities.push(result.stdout.split('\n').find(line => line.startsWith('username='))!);
    if (identities.length === 1) await f.select('bob');
    return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
  });
  expect(await f.operations.fetchBranches(f.repositoryId)).toMatchObject({ status: 'success' });
  expect(identities).toEqual(['username=alice', 'username=alice']);
  expect(f.accounts.selection(f.repository)).toMatchObject({ login: 'bob' });
});

it('applies pushInsteadOf only to publication, leaving the API/read remote independent', async () => {
  const f = await fixture(); await f.select();
  await git(f.work, ['config', 'url.https://github.com/alice/.pushInsteadOf', 'https://github.com/team/']);
  expect((await f.service.publication(f.repositoryId)).urls).toEqual(['https://github.com/alice/demo.git']);
  expect(await git(f.work, ['remote', 'get-url', 'origin'])).toBe('https://github.com/team/demo.git');
});

it('keeps a verified identity separate from API transport failures and redacts thrown credential details', async () => {
  const f = await fixture(); await f.select(); fakeNetwork(f);
  const original = f.run.getMockImplementation()!;
  f.run.mockImplementation(async (file, args, options) => {
    if (args[1]?.startsWith('repos/')) throw new Error(`Connection reset with ${token('alice')}`);
    return original(file, args, options);
  });
  const result = await f.service.status(f.repositoryId, true);
  expect(result).toMatchObject({ identity: { state: 'ok' }, api: { state: 'offline' }, write: { state: 'offline' } });
  expect(JSON.stringify(result)).not.toContain(token('alice'));
});

it('rejects unconfigured publication URLs and multiple upstream branches before authentication', async () => {
  const f = await fixture(); await f.select(); const network = fakeNetwork(f);
  expect((await f.service.publication(f.repositoryId, 'https://github.com/other/private.git')).blocked).toContain('not configured');
  await git(f.work, ['config', 'branch.main.remote', 'origin']);
  await git(f.work, ['config', '--add', 'branch.main.merge', 'refs/heads/main']);
  await git(f.work, ['config', '--add', 'branch.main.merge', 'refs/heads/other']);
  expect(await f.operations.push(f.repositoryId)).toMatchObject({ status: 'rejected', reason: 'configuration' });
  expect(network).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled();
});

it('uses Git’s origin fetch default with multiple remotes and pins the managed fetch destination', async () => {
  const f = await fixture(); await f.select();
  await git(f.work, ['remote', 'add', 'upstream', 'https://github.com/upstream/demo.git']);
  await git(f.work, ['config', 'fetch.all', 'true']);
  const network = fakeNetwork(f);
  expect(await f.operations.fetch(f.repositoryId)).toMatchObject({ status: 'success' });
  expect(network.mock.calls[0]?.[0].slice(-3)).toEqual(['fetch', '--', 'origin']);
  expect((await f.service.publication(f.repositoryId)).remote).toBeNull();
});

it('uses the global OpenTig default for Git credentials and rejects publications prepared before a default change', async () => {
  const f = await fixture();
  await f.accounts.setDefaultAccount('alice');
  await f.accounts.setSelection(f.repository, { mode: 'account', host: 'github.com', login: 'alice', useGlobalDefault: true, gitMode: 'managed' });
  const before = await f.service.publication(f.repositoryId);
  await f.accounts.setDefaultAccount('bob');
  const usernames: string[] = [];
  fakeNetwork(f, async (args) => {
    let index = 0; while (args[index] === '-c') index += 2;
    const result = await execa('git', [...args.slice(0, index), 'credential', 'fill'], { cwd: f.work,
      input: 'protocol=https\nhost=github.com\npath=team/demo.git\n\n', env: { GIT_TERMINAL_PROMPT: '0' } });
    expect(result.stdout).toContain(`password=${token('bob')}`);
    usernames.push(result.stdout.split('\n').find(line => line.startsWith('username='))!);
    return { stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0 };
  });
  expect(await f.operations.push(f.repositoryId, undefined, before.id)).toMatchObject({ status: 'rejected', reason: 'configuration' });
  expect(usernames).toEqual([]);
  await f.operations.fetch(f.repositoryId);
  expect(usernames).toEqual(['username=bob']);
  expect((await f.service.publication(f.repositoryId)).login).toBe('bob');
});
