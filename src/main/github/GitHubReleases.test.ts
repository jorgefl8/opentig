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

function fixture(overrides: { view?: CliRunResult; list?: CliRunResult; tag?: CliRunResult; repository?: CliRunResult; workflows?: CliRunResult; runs?: CliRunResult; mutate?: (args: string[]) => CliRunResult } = {}) {
  const mutations: string[][] = [];
  const run = vi.fn(async (_exe: string, args: string[]): Promise<CliRunResult> => {
    if (args[0] === 'release' && args[1] === 'view') return overrides.view ?? ok(details);
    if (args[0] === 'release' && args[1] === 'list') return overrides.list ?? ok([summary]);
    if (args[0] === 'workflow' && args[1] === 'list') return overrides.workflows ?? ok(workflows);
    if (args[0] === 'run' && args[1] === 'list') return overrides.runs ?? ok([{ databaseId: 1, status: 'completed', conclusion: 'success', url: 'https://github.com/example/demo/actions/runs/1', createdAt: '2026-01-01T00:00:00Z', displayTitle: 'Prepare release' }]);
    if (args[0] === 'api' && args[1]?.includes('/git/ref/tags/')) return overrides.tag ?? ok({ ref: 'refs/tags/v1.0.0' });
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
const edit = { ...identity, expectedBodyHash: releaseBodyHash(body), title: 'New title', notes: body };
const create = { ...base, tagName: 'v2.0.0', title: 'Two', notes: 'Notes', generateNotes: false, prerelease: false };
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
  it('requires the tag on GitHub, and never creates one', async () => {
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

  it.each([
    ['the tag is missing', { tag: notFound }, 'create and push it first'],
    ['a release already uses the tag', { list: ok([{ ...summary, tagName: 'v2.0.0' }]) }, 'already exists'],
    ['the viewer cannot write', { repository: ok({ permissions: { push: false } }) }, 'write access'],
  ])('refuses when %s', async (_name, overrides, message) => {
    const { service, mutations } = fixture(overrides);
    await expect(service.createRelease(create)).rejects.toThrow(message);
    expect(mutations).toEqual([]);
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
    await service.publishRelease(identity);
    expect(mutations).toEqual([['release', 'edit', 'v1.0.0', '-R', 'example/demo', '--tag', 'v1.0.0', '--verify-tag', '--draft=false']]);
  });

  it.each([
    ['the tag does not exist', { tag: notFound }, identity, 'GH_PR_ACTION_NOT_ALLOWED', "doesn't exist yet"],
    ['it is already published', { view: ok({ ...details, isDraft: false }) }, identity, 'GH_PR_ACTION_NOT_ALLOWED', 'already published'],
    ['it is another release', {}, { ...identity, expectedDatabaseId: 7 }, 'GH_PR_STATE_CHANGED', 'changed'],
    ['the viewer cannot write', { repository: ok({ permissions: { push: false } }) }, identity, 'GH_PR_ACTION_NOT_ALLOWED', 'write access'],
  ])('refuses when %s', async (_name, overrides, input, code, message) => {
    const { service, mutations } = fixture(overrides);
    const failure = service.publishRelease(input);
    await expect(failure).rejects.toMatchObject({ detail: { code } });
    await expect(failure).rejects.toThrow(message);
    expect(mutations).toEqual([]);
  });

  it('does not publish when it cannot tell whether the tag exists', async () => {
    const { service, mutations } = fixture({ tag: fail('gh: Server Error (HTTP 502)') });
    await expect(service.publishRelease(identity)).rejects.toThrow('Server Error');
    expect(mutations).toEqual([]);
  });

  it('stops with another account', async () => {
    const { service, mutations } = fixture();
    await expect(service.publishRelease({ ...identity, expectedAccount: { login: 'other', revision: 3 } })).rejects.toMatchObject({ detail: { code: 'GH_ACCOUNT_UNRESOLVED' } });
    expect(mutations).toEqual([]);
  });
});

describe('workflows', () => {
  const run = { repositoryId: 'repo', path: '.github/workflows/prepare-release.yml', ref: 'main', expectedAccount: { login: 'sample', revision: 3 } };

  it('lists active ones, those about releases first', async () => {
    expect(await fixture().service.listWorkflows('repo')).toEqual({
      defaultBranch: 'main', viewerCanWrite: true,
      workflows: [{ id: 3, name: 'Prepare release', path: '.github/workflows/prepare-release.yml' }, { id: 4, name: 'Build', path: '.github/workflows/build.yml' }, { id: 1, name: 'CI', path: '.github/workflows/ci.yml' }],
    });
  });

  it('reads the latest runs of one', async () => {
    const { service, run: calls } = fixture();
    expect(await service.listWorkflowRuns('repo', run.path)).toEqual([expect.objectContaining({ databaseId: 1, conclusion: 'success' })]);
    expect(calls.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining(['--workflow', run.path, '--limit', '3']));
  });

  it('runs one on the default branch, without inputs', async () => {
    const { service, mutations } = fixture();
    await service.runWorkflow(run);
    expect(mutations).toEqual([['workflow', 'run', run.path, '-R', 'example/demo', '--ref', 'main']]);
  });

  it.each([
    ['another branch', { ...run, ref: 'feature' }, {}, 'GH_PR_STATE_CHANGED'],
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
