import { access, readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { GitHubService } from './GitHubService';
import type { CliProcessRunner, CliRunOptions, CliRunResult } from '../ai/CliProcessRunner';
import type { CliResolver } from '../ai/CliResolver';
import type { GitProcess } from '../git/GitProcess';
import type { RepositoryService } from '../git/RepositoryService';

const tokenFor = (login: string) => `gho_fixture_${login.replaceAll('-', '_')}_00000000000000000000`;
const response = (stdout = '', exitCode = 0, stderr = ''): CliRunResult => ({ stdout, exitCode, stderr });
const input = { repositoryId: 'alice', base: 'origin/main', title: 'Change', body: 'Reviewed body', draft: true };

function fixture(options: {
  remote?: string;
  ssh?: CliRunResult | Error;
  credential?: CliRunResult | Error;
  creation?: CliRunResult | Error;
  activeAuthenticated?: boolean;
} = {}) {
  const bodies: string[] = [];
  const run = vi.fn(async (executable: string, args: string[], runOptions: CliRunOptions = {}) => {
    if (executable === 'ssh') {
      if (args[0] === '-G') return response('hostname github.com\n');
      if (options.ssh instanceof Error) throw options.ssh;
      const login = args.at(-1) === 'git@team-alice' ? 'alice' : 'bob';
      return options.ssh ?? response('', 1, `Hi ${login}! You've successfully authenticated, but GitHub does not provide shell access.\n`);
    }
    if (args[0] === '--version') return response('gh version 2.88.0');
    if (args[0] === 'auth' && args[1] === 'status') return response('', options.activeAuthenticated === false ? 1 : 0);
    if (args[0] === 'auth' && args[1] === 'token') {
      if (options.credential instanceof Error) throw options.credential;
      return options.credential ?? response(`${tokenFor(args.includes('--user') ? args.at(-1)! : 'global-user')}\n`);
    }
    if (args[0] === 'api' && args[1] === 'user') return response(['alice', 'bob', 'global-user'].find((login) => runOptions.env?.GH_TOKEN === tokenFor(login)) ?? 'global-user');
    if (args[0] === 'pr' && args[1] === 'create') {
      bodies.push(await readFile(args[args.indexOf('--body-file') + 1]!, 'utf8'));
      if (options.creation instanceof Error) throw options.creation;
      return options.creation ?? response(`https://github.com/example/demo/pull/${runOptions.cwd === 'alice' ? 42 : 43}\n`);
    }
    return response(args[0] === 'pr' ? '[]' : '{}');
  });
  const candidateEnv = { PATH: '/fixture/bin', GH_TOKEN: 'unrelated_environment_token', GITHUB_TOKEN: 'another_environment_token' };
  const service = new GitHubService(
    { discover: async () => [{ executable: 'gh', alias: 'gh', source: 'process-path', env: candidateEnv }], warning: async () => undefined } as unknown as CliResolver,
    { run } as unknown as CliProcessRunner,
    { run: async (cwd: string, args: string[]) => ({ stdout: Buffer.from(args.includes('core.sshCommand') ? '' : options.remote ?? `git@team-${cwd}:example/demo.git`) }) } as unknown as GitProcess,
    { get: (id: string) => ({ path: id, commonDir: `${id}/.git`, id }), status: async () => ({ branch: 'feature', upstream: 'origin/feature', ahead: 0, detached: false, unborn: false }) } as unknown as RepositoryService,
  );
  return { service, run, bodies, candidateEnv };
}

describe('repository account authentication for PR creation', () => {
  it('creates with the SSH account instead of the active account or repository owner', async () => {
    const { service, run, bodies, candidateEnv } = fixture();
    expect(await service.createPullRequest(input)).toMatchObject({ number: 42 });
    const credential = run.mock.calls.find(([, args]) => args[1] === 'token')!;
    expect(credential[1]).toEqual(['auth', 'token', '--hostname', 'github.com', '--user', 'alice']);
    expect(credential[2]).toMatchObject({ removeEnv: expect.arrayContaining(['GH_TOKEN', 'GITHUB_TOKEN', 'GH_DEBUG']) });
    const creation = run.mock.calls.find(([, args]) => args[1] === 'create')!;
    expect(creation[1]).toEqual(expect.arrayContaining(['-R', 'example/demo', '--base', 'main', '--head', 'feature', '--draft']));
    expect(creation[2]).toMatchObject({ env: { GH_TOKEN: tokenFor('alice'), GH_HOST: 'github.com' }, removeEnv: expect.arrayContaining(['GITHUB_TOKEN', 'GH_DEBUG']) });
    expect(JSON.stringify(creation[1])).not.toContain(tokenFor('alice'));
    expect(bodies).toEqual([input.body]);
    await expect(access(creation[1][creation[1].indexOf('--body-file') + 1]!)).rejects.toThrow();
    expect(candidateEnv.GH_TOKEN).toBe('unrelated_environment_token');
    expect(run.mock.calls.some(([, args]) => args[1] === 'switch')).toBe(false);
  });

  it('keeps concurrent repository accounts isolated', async () => {
    const { service, run } = fixture();
    expect(await Promise.all([service.createPullRequest(input), service.createPullRequest({ ...input, repositoryId: 'bob' })]))
      .toMatchObject([{ number: 42 }, { number: 43 }]);
    for (const [, args, options] of run.mock.calls.filter(([, args]) => args[1] === 'create')) {
      expect(options?.env?.GH_TOKEN).toBe(tokenFor(options!.cwd!));
      expect(args).not.toContain('switch');
    }
  });

  it('can use a valid alternate account even if the global active login is invalid', async () => {
    expect(await fixture({ activeAuthenticated: false }).service.createPullRequest(input)).toMatchObject({ number: 42 });
  });

  it.each([
    response('credential_output_must_stay_private', 1, 'credential_error_must_stay_private'),
    new Error('credential_exception_must_stay_private'),
    response(''),
    response('invalid\nmultiple_lines'),
  ])('reports the missing SSH account without leaking credential output', async (credential) => {
    const { service, run } = fixture({ credential });
    await expect(service.createPullRequest(input)).rejects.toMatchObject({ detail: {
      code: 'GH_ACCOUNT_MISSING', operation: 'gh-pr-create', message: expect.stringContaining('Sign in as alice'),
    } });
    try { await service.createPullRequest(input); } catch (error) {
      expect(JSON.stringify(error)).not.toMatch(/must_stay_private|multiple_lines/);
    }
    expect(run.mock.calls.some(([, args]) => args[1] === 'create')).toBe(false);
  });

  it.each([
    response('', 1, `GraphQL: rejected ${tokenFor('alice')}`),
    new Error(`Unexpected ${tokenFor('alice')}`),
  ])('redacts account tokens from creation failures', async (creation) => {
    const { service } = fixture({ creation });
    try {
      await service.createPullRequest(input);
      expect.fail('Creation must fail');
    } catch (error) {
      expect(error).toHaveProperty('detail.operation', 'gh-pr-create');
      expect(String(error)).not.toContain(tokenFor('alice'));
      expect(JSON.stringify(error)).not.toContain(tokenFor('alice'));
    }
  });

  it.each([
    response('Permission denied', 255),
    new Error('SSH unavailable'),
    response('', 1, "Hi example/demo! You've successfully authenticated, but GitHub does not provide shell access.\n"),
    response('', 255, "Hi alice! You've successfully authenticated, but GitHub does not provide shell access.\n"),
  ])('requires an explicit account when SSH cannot identify a user', async (ssh) => {
    const { service, run } = fixture({ ssh });
    await expect(service.createPullRequest(input)).rejects.toMatchObject({ detail: { code: 'GH_ACCOUNT_UNRESOLVED' } });
    expect(run.mock.calls.some(([, args]) => args[1] === 'create' || args[1] === 'token')).toBe(false);
  });

  it('uses configured SSH ports and never prompts or accepts new host keys', async () => {
    const { service, run } = fixture({ remote: 'ssh://git@team-alice:2222/example/demo.git' });
    await service.createPullRequest(input);
    expect(run.mock.calls.find(([exe, args]) => exe === 'ssh' && args[0] === '-T')?.[1]).toEqual([
      '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5',
      '-o', 'ConnectionAttempts=1', '-o', 'RemoteCommand=none', '-o', 'UpdateHostKeys=no', '-p', '2222', '--', 'git@team-alice',
    ]);
  });

  it('uses the same account for HTTPS creation and SSH read-only listing', async () => {
    const https = fixture({ remote: 'https://github.com/example/demo.git' });
    await https.service.createPullRequest(input);
    expect(https.run.mock.calls.some(([exe]) => exe === 'ssh')).toBe(false);
    expect(https.run.mock.calls.find(([, args]) => args[1] === 'token')?.[1]).not.toContain('--user');
    const ssh = fixture();
    await ssh.service.listPullRequests('alice', ['OPEN']);
    expect(ssh.run.mock.calls.find(([, args]) => args[1] === 'list')?.[2]?.env?.GH_TOKEN).toBe(tokenFor('alice'));
  });
});
