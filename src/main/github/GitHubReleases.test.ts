import { describe, expect, it, vi } from 'vitest';
import type { CliProcessRunner, CliRunResult } from '../ai/CliProcessRunner';
import type { CliResolver } from '../ai/CliResolver';
import type { GitProcess } from '../git/GitProcess';
import type { RepositoryService } from '../git/RepositoryService';
import type { GitHubAccountsService } from './GitHubAccountsService';
import { GitHubService } from './GitHubService';
import { releaseBodyHash } from './ReleaseParser';

const ok = (value: unknown): CliRunResult => ({ exitCode: 0, stdout: JSON.stringify(value), stderr: '' });
const fail = (stderr: string): CliRunResult => ({ exitCode: 1, stdout: JSON.stringify({ message: 'Not Found', status: '404' }), stderr });
const body = '<!-- opentig:release-notes:start -->\nNotes';
const details = { tagName: 'v1.0.0', name: 'One', isDraft: true, isPrerelease: false, isImmutable: false, createdAt: '2026-01-01T00:00:00Z', publishedAt: null, databaseId: 42, body, targetCommitish: 'a'.repeat(40), url: 'https://github.com/example/demo/releases/tag/untagged-1', assets: [] };
const summary = { tagName: 'v1.0.0', name: 'One', isDraft: true, isPrerelease: false, isLatest: false, isImmutable: false, createdAt: '2026-01-01T00:00:00Z', publishedAt: '0001-01-01T00:00:00Z' };

const workflows = [
  { id: 1, name: 'CI', path: '.github/workflows/ci.yml', state: 'active' },
  { id: 2, name: 'Old', path: '.github/workflows/old.yml', state: 'disabled_manually' },
  { id: 3, name: 'Prepare release', path: '.github/workflows/prepare-release.yml', state: 'active' },
  { id: 4, name: 'Build', path: '.github/workflows/build.yml', state: 'active' },
];

function fixture(overrides: { view?: CliRunResult; list?: CliRunResult; tag?: CliRunResult; commit?: CliRunResult; repository?: CliRunResult; workflows?: CliRunResult; branch?: CliRunResult; mutate?: (args: string[]) => CliRunResult } = {}) {
  const mutations: string[][] = [];
  const run = vi.fn(async (_exe: string, args: string[]): Promise<CliRunResult> => {
    if (args[0] === 'release' && args[1] === 'view') return overrides.view ?? ok(details);
    if (args[0] === 'release' && args[1] === 'list') return overrides.list ?? ok([summary]);
    if (args[0] === 'workflow' && args[1] === 'list') return overrides.workflows ?? ok(workflows);
    if (args[0] === 'api' && args[1]?.includes('/branches/')) return overrides.branch ?? { exitCode: 0, stdout: 'main', stderr: '' };
    if (args[0] === 'api' && args[1]?.includes('/git/ref/tags/')) return overrides.tag ?? ok({ ref: 'refs/tags/v1.0.0' });
    if (args[0] === 'api' && args[1]?.includes('/commits/')) return overrides.commit ?? { exitCode: 0, stdout: 'a'.repeat(40), stderr: '' };
    if (args[0] === 'api') return overrides.repository ?? ok({ default_branch: 'main', permissions: { push: true } });
    mutations.push(args);
    return overrides.mutate?.(args) ?? { exitCode: 0, stdout: '', stderr: '' };
  });
  const accounts = { revisionFor: () => 3, authRevision: 1, authenticate: async () => ({ auth: { env: {} }, executable: { executable: 'gh', alias: 'gh', source: 'process-path', env: {} }, context: { login: 'sample', revision: 3 } }) } as unknown as GitHubAccountsService;
  const service = new GitHubService(
    { discover: async () => [], warning: async () => undefined } as unknown as CliResolver,
    { run } as unknown as CliProcessRunner,
    { onInvalidate: () => undefined, readScope: (cwd: string) => cwd, run: async () => ({ stdout: Buffer.from('https://github.com/example/demo.git') }) } as unknown as GitProcess,
    { get: () => ({ path: '.', commonDir: '.git', id: 'repo' }) } as unknown as RepositoryService,
    accounts,
  );
  return { service, mutations, run };
}
const base = { repositoryId: 'repo', tagName: 'v1.0.0', expectedAccount: { login: 'sample', revision: 3 } };
const identity = { ...base, expectedDatabaseId: 42 };
const publication = { ...identity, expectedTagExists: true };
const edit = { ...identity, expectedBodyHash: releaseBodyHash(body), title: 'New title', notes: body };
const create = { ...base, tagName: 'v2.0.0', title: 'Two', notes: 'Notes', generateNotes: false, prerelease: false, expectedTagExists: true, target: null };
const newTag = { ...create, expectedTagExists: false, target: 'main' };
const notFound = fail('gh: Not Found (HTTP 404)');

describe('reading releases', () => {
  it('lists them with the repository', async () => {
    const { service, run } = fixture();
    expect(await service.listReleases('repo')).toEqual([{ ...summary, publishedAt: null }]);
    expect(run.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining(['release', 'list', '-R', 'example/demo']));
  });

  it('combines the release with its tag and the viewer\'s access', async () => {
    const { service } = fixture();
    expect(await service.getRelease('repo', 'v1.0.0')).toMatchObject({ databaseId: 42, tagExists: true, viewerCanWrite: true, bodyHash: releaseBodyHash(body) });
  });

  it('says the tag is missing only on a 404', async () => {
    expect(await fixture({ tag: notFound }).service.getRelease('repo', 'v1.0.0')).toMatchObject({ tagExists: false });
    await expect(fixture({ tag: fail('gh: Server Error (HTTP 502)') }).service.getRelease('repo', 'v1.0.0')).rejects.toThrow('Server Error');
  });

  it('asks for a tag with slashes path by path', async () => {
    const { service, run } = fixture();
    await service.getRelease('repo', 'release/1.0 beta');
    expect(run.mock.calls.flatMap(([, args]) => args)).toContain('repos/example/demo/git/ref/tags/release/1.0%20beta');
  });

  it('marks the viewer without push access', async () => {
    expect(await fixture({ repository: ok({ default_branch: 'main', permissions: { push: false } }) }).service.getRelease('repo', 'v1.0.0')).toMatchObject({ viewerCanWrite: false });
    expect(await fixture({ repository: ok({ default_branch: 'main' }) }).service.getRelease('repo', 'v1.0.0')).toMatchObject({ viewerCanWrite: false });
  });

  it('asks for a newer gh when it does not know a field', async () => {
    const { service } = fixture({ list: { exitCode: 1, stdout: '', stderr: 'Unknown JSON field: "isImmutable"' } });
    await expect(service.listReleases('repo')).rejects.toMatchObject({ detail: { code: 'GH_CLI_INCOMPATIBLE' } });
  });
});

describe('creating a draft', () => {
  it('verifies an existing tag, so it stays the one the draft names', async () => {
    const { service, mutations } = fixture();
    await service.createRelease({ ...create, generateNotes: true, prerelease: true });
    expect(mutations[0]!.slice(0, 11)).toEqual(['release', 'create', 'v2.0.0', '-R', 'example/demo', '--draft', '--verify-tag', '--title', 'Two', '--notes-file', mutations[0]![10]]);
    expect(mutations[0]).toEqual(expect.arrayContaining(['--generate-notes', '--prerelease']));
    expect(mutations[0]).not.toContain('Notes');
  });

  it('leaves out options that were not chosen', async () => {
    const { service, mutations } = fixture();
    await service.createRelease(create);
    expect(mutations[0]).not.toContain('--generate-notes');
    expect(mutations[0]).not.toContain('--prerelease');
  });

  it('leaves a new tag to GitHub, created from the target when the draft is published', async () => {
    const { service, mutations, run } = fixture({ tag: notFound });
    await service.createRelease(newTag);
    expect(mutations[0]!.slice(0, 11)).toEqual(['release', 'create', 'v2.0.0', '-R', 'example/demo', '--draft', '--target', 'main', '--title', 'Two', '--notes-file']);
    expect(mutations[0]).not.toContain('--verify-tag');
    expect(run).toHaveBeenCalledWith('gh', ['api', 'repos/example/demo/commits/main', '--jq', '.sha'], expect.anything());
  });

  it.each([
    ['a release already uses the tag', { list: ok([{ ...summary, tagName: 'v2.0.0' }]) }, create, 'already exists'],
    ['the viewer cannot write', { repository: ok({ permissions: { push: false } }) }, create, 'write access'],
    ['the tag went away after the check', { tag: notFound }, create, 'no longer on GitHub'],
    ['the tag appeared after the check', {}, newTag, 'now exists'],
    ['a new tag has no target', { tag: notFound }, { ...newTag, target: null }, 'Choose the branch or commit'],
    ['the target is not on GitHub', { tag: notFound, commit: fail('gh: No commit found for SHA: nope (HTTP 422)') }, newTag, "isn't a branch or commit"],
  ])('refuses when %s', async (_name, overrides, input, message) => {
    const { service, mutations } = fixture(overrides);
    await expect(service.createRelease(input)).rejects.toThrow(message);
    expect(mutations).toEqual([]);
  });

  it('says what the dialog needs about a tag', async () => {
    expect(await fixture().service.checkReleaseTag('repo', 'v2.0.0')).toEqual({ exists: true, hasRelease: false, defaultBranch: 'main' });
    expect(await fixture({ tag: notFound }).service.checkReleaseTag('repo', 'v1.0.0')).toEqual({ exists: false, hasRelease: true, defaultBranch: 'main' });
  });

  it('stops with another account', async () => {
    const { service, mutations } = fixture();
    await expect(service.createRelease({ ...create, expectedAccount: { login: 'other', revision: 3 } })).rejects.toMatchObject({ detail: { code: 'GH_ACCOUNT_UNRESOLVED' } });
    expect(mutations).toEqual([]);
  });
});

describe('editing', () => {
  it('sends the title, and the raw notes through a file', async () => {
    const { service, mutations } = fixture();
    await service.updateRelease(edit);
    expect(mutations[0]!.slice(0, 8)).toEqual(['release', 'edit', 'v1.0.0', '-R', 'example/demo', '--title', 'New title', '--notes-file']);
    expect(mutations[0]).not.toContain(body);
  });

  it.each([
    ['the notes changed', { ...edit, expectedBodyHash: 'b'.repeat(64) }],
    ['it is another release', { ...edit, expectedDatabaseId: 7 }],
  ])('stops when %s', async (_name, input) => {
    const { service, mutations } = fixture();
    await expect(service.updateRelease(input)).rejects.toMatchObject({ detail: { code: 'GH_PR_STATE_CHANGED' } });
    expect(mutations).toEqual([]);
  });

  it('stops without write access', async () => {
    const { service, mutations } = fixture({ repository: ok({ permissions: { push: false } }) });
    await expect(service.updateRelease(edit)).rejects.toMatchObject({ detail: { code: 'GH_PR_ACTION_NOT_ALLOWED' } });
    expect(mutations).toEqual([]);
  });
});

describe('deleting a draft', () => {
  it('keeps the tag', async () => {
    const { service, mutations } = fixture();
    await service.deleteDraftRelease(identity);
    expect(mutations).toEqual([['release', 'delete', 'v1.0.0', '-R', 'example/demo', '--yes']]);
  });

  it.each([
    ['it was published', { view: ok({ ...details, isDraft: false }) }, identity, 'GH_PR_ACTION_NOT_ALLOWED'],
    ['it is another release', {}, { ...identity, expectedDatabaseId: 7 }, 'GH_PR_STATE_CHANGED'],
    ['the viewer cannot write', { repository: ok({ permissions: { push: false } }) }, identity, 'GH_PR_ACTION_NOT_ALLOWED'],
  ])('refuses when %s', async (_name, overrides, input, code) => {
    const { service, mutations } = fixture(overrides);
    await expect(service.deleteDraftRelease(input)).rejects.toMatchObject({ detail: { code } });
    expect(mutations).toEqual([]);
  });
});

describe('publishing', () => {
  it('passes both the tag and the check that it exists, because gh ignores one without the other', async () => {
    const { service, mutations } = fixture();
    await service.publishRelease(publication);
    expect(mutations).toEqual([['release', 'edit', 'v1.0.0', '-R', 'example/demo', '--tag', 'v1.0.0', '--verify-tag', '--draft=false']]);
  });

  it("lets GitHub create a missing tag at the draft's target, as its own page does", async () => {
    const { service, mutations } = fixture({ tag: notFound });
    await service.publishRelease({ ...publication, expectedTagExists: false });
    expect(mutations).toEqual([['release', 'edit', 'v1.0.0', '-R', 'example/demo', '--draft=false']]);
  });

  it.each([
    ['the tag went away after the confirmation', { tag: notFound }, publication, 'GH_PR_STATE_CHANGED', 'no longer on GitHub'],
    ['the tag appeared after the confirmation', {}, { ...publication, expectedTagExists: false }, 'GH_PR_STATE_CHANGED', 'now exists'],
    ['it is already published', { view: ok({ ...details, isDraft: false }) }, publication, 'GH_PR_ACTION_NOT_ALLOWED', 'already published'],
    ['it is another release', {}, { ...publication, expectedDatabaseId: 7 }, 'GH_PR_STATE_CHANGED', 'changed'],
    ['the viewer cannot write', { repository: ok({ permissions: { push: false } }) }, publication, 'GH_PR_ACTION_NOT_ALLOWED', 'write access'],
  ])('refuses when %s', async (_name, overrides, input, code, message) => {
    const { service, mutations } = fixture(overrides);
    const failure = service.publishRelease(input);
    await expect(failure).rejects.toMatchObject({ detail: { code } });
    await expect(failure).rejects.toThrow(message);
    expect(mutations).toEqual([]);
  });

  it('does not publish when it cannot tell whether the tag exists', async () => {
    const { service, mutations } = fixture({ tag: fail('gh: Server Error (HTTP 502)') });
    await expect(service.publishRelease(publication)).rejects.toThrow('Server Error');
    expect(mutations).toEqual([]);
  });

  it('stops with another account', async () => {
    const { service, mutations } = fixture();
    await expect(service.publishRelease({ ...publication, expectedAccount: { login: 'other', revision: 3 } })).rejects.toMatchObject({ detail: { code: 'GH_ACCOUNT_UNRESOLVED' } });
    expect(mutations).toEqual([]);
  });
});

describe('workflows', () => {
  const run = { repositoryId: 'repo', path: '.github/workflows/prepare-release.yml', ref: 'main', inputs: {}, expectedAccount: { login: 'sample', revision: 3 } };

  it('lists active ones, those about releases first', async () => {
    expect(await fixture().service.listWorkflows('repo')).toEqual({
      defaultBranch: 'main', viewerCanWrite: true,
      workflows: [{ id: 3, name: 'Prepare release', path: '.github/workflows/prepare-release.yml' }, { id: 4, name: 'Build', path: '.github/workflows/build.yml' }, { id: 1, name: 'CI', path: '.github/workflows/ci.yml' }],
    });
  });

  it('runs one on the default branch, without inputs', async () => {
    const { service, mutations } = fixture();
    await service.runWorkflow(run);
    expect(mutations).toEqual([['workflow', 'run', run.path, '-R', 'example/demo', '--ref', 'main']]);
  });

  it('runs one on another branch that exists on GitHub, passing each input as a raw field', async () => {
    const { service, mutations, run: calls } = fixture();
    await service.runWorkflow({ ...run, ref: 'feature/x', inputs: { version: '0.3.0', notes: 'a=b; $(nothing)' } });
    expect(calls.mock.calls.some(([, args]) => args[1] === 'repos/example/demo/branches/feature/x')).toBe(true);
    expect(mutations).toEqual([['workflow', 'run', run.path, '-R', 'example/demo', '--ref', 'feature/x', '-f', 'version=0.3.0', '-f', 'notes=a=b; $(nothing)']]);
  });

  it.each([
    ['a branch that isn\'t on GitHub', { ...run, ref: 'local-only' }, { branch: notFound }, 'GH_PR_STATE_CHANGED'],
    ['a disabled workflow', { ...run, path: '.github/workflows/old.yml' }, {}, 'GH_PR_ACTION_NOT_ALLOWED'],
    ['an unknown workflow', { ...run, path: '.github/workflows/other.yml' }, {}, 'GH_PR_ACTION_NOT_ALLOWED'],
    ['no write access', run, { repository: ok({ default_branch: 'main', permissions: { push: false } }) }, 'GH_PR_ACTION_NOT_ALLOWED'],
    ['another account', { ...run, expectedAccount: { login: 'other', revision: 3 } }, {}, 'GH_ACCOUNT_UNRESOLVED'],
  ])('refuses %s', async (_name, input, overrides, code) => {
    const { service, mutations } = fixture(overrides);
    await expect(service.runWorkflow(input)).rejects.toMatchObject({ detail: { code } });
    expect(mutations).toEqual([]);
  });

  it('passes GitHub\'s own reason through when a workflow can\'t be started', async () => {
    const { service } = fixture({ mutate: () => ({ exitCode: 1, stdout: '', stderr: "could not create workflow dispatch event: HTTP 422: Workflow does not have 'workflow_dispatch' trigger" }) });
    await expect(service.runWorkflow(run)).rejects.toThrow("Workflow does not have 'workflow_dispatch' trigger");
  });
});
