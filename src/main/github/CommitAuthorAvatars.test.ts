import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CliRunResult } from '../ai/CliProcessRunner';
import { GhOperationError } from '../../shared/errors';
import { CommitAuthorAvatars, parseCommitAuthorAvatar, type CommitAuthorAvatarAccess } from './CommitAuthorAvatars';

afterEach(() => { vi.useRealTimers(); });

const OID_A = 'a'.repeat(40);
const OID_B = 'b'.repeat(40);
const OID_C = 'c'.repeat(40);
const PICTURE = 'https://avatars.githubusercontent.com/u/583231?v=4';
const SHOWN = 'https://avatars.githubusercontent.com/u/583231?v=4&s=64';
const ok = (stdout: string): CliRunResult => ({ exitCode: 0, stdout, stderr: '' });
const fail = (stderr: string): CliRunResult => ({ exitCode: 1, stdout: '', stderr });

function fixture({ nameWithOwner = 'example/demo' as string | null, emails = { [OID_A]: 'ada@example.com', [OID_B]: 'Ada@Example.com', [OID_C]: 'grace@example.com' } as Record<string, string>,
  answer = (_oid: string): CliRunResult | Promise<CliRunResult> => ok(`${PICTURE}\n`), requireGitHub }: {
  nameWithOwner?: string | null;
  emails?: Record<string, string>;
  answer?: (oid: string) => CliRunResult | Promise<CliRunResult>;
  requireGitHub?: CommitAuthorAvatarAccess['requireGitHub'];
} = {}) {
  const run = vi.fn(async (_executable: unknown, args: string[], _options: unknown) => answer(args[1]!.split('/').at(-1)!));
  const access: CommitAuthorAvatarAccess = {
    repository: async () => ({ path: '/work/demo', nameWithOwner }),
    authorEmail: async (_cwd, oid) => emails[oid] ?? null,
    requireGitHub: requireGitHub ?? (async () => ({
      repository: { path: '/work/demo' } as never, nameWithOwner: nameWithOwner ?? '', auth: {} as never, executable: { executable: 'gh' } as never,
    })),
    run: run as unknown as CommitAuthorAvatarAccess['run'],
  };
  return { avatars: new CommitAuthorAvatars(access, 1_000), run };
}

describe('parseCommitAuthorAvatar', () => {
  it('keeps a picture GitHub serves, sized for the card', () => {
    expect(parseCommitAuthorAvatar(`${PICTURE}\n`)).toBe(SHOWN);
  });

  it('shows nothing for a commit GitHub links to no account, or for any other address', () => {
    expect(parseCommitAuthorAvatar('\n')).toBeNull();
    expect(parseCommitAuthorAvatar('null')).toBeNull();
    expect(parseCommitAuthorAvatar('http://avatars.githubusercontent.com/u/1')).toBeNull();
    expect(parseCommitAuthorAvatar('https://avatars.githubusercontent.com.example.com/u/1')).toBeNull();
    expect(parseCommitAuthorAvatar('https://user@avatars.githubusercontent.com/u/1')).toBeNull();
    expect(parseCommitAuthorAvatar('https://example.com/a.png')).toBeNull();
  });
});

describe('CommitAuthorAvatars', () => {
  it("asks GitHub for the commit in the remote's repository and nothing more", async () => {
    const { avatars, run } = fixture();
    expect(await avatars.avatar('repo', OID_A.toUpperCase())).toBe(SHOWN);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![1]).toEqual(['api', `repos/example/demo/commits/${OID_A}`, '--jq', '.author.avatar_url // ""']);
    expect(run.mock.calls[0]![2]).toMatchObject({ timeoutMs: expect.any(Number), maxOutputBytes: expect.any(Number) });
  });

  it.each(['HEAD', `${OID_A.slice(0, 39)}`, `${OID_A}/../../user`, `${OID_A} --method DELETE`, '-a'])('never asks about a commit id that is not one: %s', async (oid) => {
    const { avatars, run } = fixture();
    expect(await avatars.avatar('repo', oid)).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('asks about one author once per GitHub repository, picture or not, and shares a read under way', async () => {
    let finish: (result: CliRunResult) => void = () => undefined;
    const { avatars, run } = fixture({ answer: (oid) => oid === OID_C ? ok('\n') : new Promise((resolve) => { finish = resolve; }) });
    // The same e-mail, in another case, on another commit.
    const first = avatars.avatar('repo', OID_A);
    const second = avatars.avatar('repo', OID_B);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    finish(ok(PICTURE));
    expect(await Promise.all([first, second])).toEqual([SHOWN, SHOWN]);
    expect(await avatars.avatar('repo', OID_B)).toBe(SHOWN);
    // An author GitHub links to no account is remembered too.
    expect(await avatars.avatar('repo', OID_C)).toBeNull();
    expect(await avatars.avatar('repo', OID_C)).toBeNull();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('remembers a commit GitHub does not have, without giving up on the author', async () => {
    const { avatars, run } = fixture({ answer: (oid) => oid === OID_A ? fail(`gh: No commit found for SHA: ${OID_A} (HTTP 422)`) : ok(PICTURE) });
    expect(await avatars.avatar('repo', OID_A)).toBeNull();
    expect(await avatars.avatar('repo', OID_A)).toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
    // A pushed commit by the same author still finds the picture, which then holds for every commit of theirs.
    expect(await avatars.avatar('repo', OID_B)).toBe(SHOWN);
    expect(await avatars.avatar('repo', OID_A)).toBe(SHOWN);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('shows nothing, without asking GitHub, for a repository without a GitHub remote or a commit Git cannot read', async () => {
    const local = fixture({ nameWithOwner: null });
    expect(await local.avatars.avatar('repo', OID_A)).toBeNull();
    expect(local.run).not.toHaveBeenCalled();
    const unknown = fixture({ emails: {} });
    expect(await unknown.avatars.avatar('repo', OID_A)).toBeNull();
    expect(unknown.run).not.toHaveBeenCalled();
  });

  it('shows nothing when GitHub access is not set up, and asks again later', async () => {
    let signedIn = false;
    const { avatars, run } = fixture({
      requireGitHub: async () => {
        if (!signedIn) throw new GhOperationError({ code: 'GH_AUTH_REQUIRED', operation: 'gh-commit-author-avatar', message: 'Sign in.' });
        return { repository: { path: '/work/demo' } as never, nameWithOwner: 'example/demo', auth: {} as never, executable: { executable: 'gh' } as never };
      },
    });
    expect(await avatars.avatar('repo', OID_A)).toBeNull();
    expect(run).not.toHaveBeenCalled();
    signedIn = true;
    expect(await avatars.avatar('repo', OID_A)).toBe(SHOWN);
  });

  it.each([
    ['a failed request', () => fail('HTTP 404: Not Found (https://api.github.com/repos/example/demo/commits/aaa)')],
    ['an unreachable GitHub', () => fail('error connecting to api.github.com')],
    ['a GitHub CLI that cannot run', () => Promise.reject(new GhOperationError({ code: 'GH_TIMEOUT', operation: 'gh-commit-author-avatar', message: 'Too slow.' }))],
  ])('shows nothing after %s, and does not remember it', async (_name, result) => {
    let calls = 0;
    const { avatars } = fixture({ answer: () => (calls++ === 0 ? result() : ok(PICTURE)) });
    expect(await avatars.avatar('repo', OID_A)).toBeNull();
    expect(await avatars.avatar('repo', OID_A)).toBe(SHOWN);
  });

  it('gives up on a GitHub that does not answer in time', async () => {
    vi.useFakeTimers();
    const { avatars } = fixture({ answer: () => new Promise(() => undefined) });
    const read = avatars.avatar('repo', OID_A);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await read).toBeNull();
  });
});
