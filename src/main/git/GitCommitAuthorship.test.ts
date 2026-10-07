import { readFile, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GitProcess } from './GitProcess';
import { GitCommitAuthorship } from './GitCommitAuthorship';
import { managementRepository, addWorktree, git } from './test-support/repository-fixtures';

beforeEach(() => {
  for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS']) vi.stubEnv(key, undefined);
});
afterEach(() => vi.unstubAllEnvs());

it('reads actual Git authorship without writing configuration or using GitHub', async () => {
  const fixture = await managementRepository();
  const config = path.join(fixture.work, '.git', 'config');
  const before = await readFile(config, 'utf8');
  const identity = await fixture.operations.getCommitAuthorship(fixture.repositoryId);
  expect(identity).toMatchObject({ author: { name: 'OpenTig Test', email: 'opentig@example.invalid' }, committer: { name: 'OpenTig Test', email: 'opentig@example.invalid' }, source: 'local', editable: true });
  expect(identity.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(await fixture.operations.getCommitAuthorship(fixture.repositoryId)).toEqual(identity);
  expect(await readFile(config, 'utf8')).toBe(before);
});

it('applies both fields locally, preserves unrelated settings and creates commits with that identity', async () => {
  const fixture = await managementRepository();
  await git(fixture.work, ['config', 'user.signingKey', 'sample-signing-key']);
  await git(fixture.work, ['config', 'remote.origin.url', 'git@github.com:example/demo.git']);
  await git(fixture.work, ['config', 'credential.helper', 'sample-helper']);
  const identity = await fixture.operations.getCommitAuthorship(fixture.repositoryId);
  const result = await fixture.operations.setCommitAuthorship(fixture.repositoryId, { name: 'Sample Contributor', email: 'sample@example.com', expectedRevision: identity.revision });
  expect(result.author).toEqual({ name: 'Sample Contributor', email: 'sample@example.com' });
  for (const [key, value] of [['user.signingKey', 'sample-signing-key'], ['remote.origin.url', 'git@github.com:example/demo.git'], ['credential.helper', 'sample-helper']]) expect(await git(fixture.work, ['config', key!])).toBe(value);
  await writeFile(path.join(fixture.work, 'new.txt'), 'new content');
  await fixture.operations.stage(fixture.repositoryId, ['new.txt']);
  await fixture.operations.createCommit(fixture.repositoryId, 'New commit');
  expect(await git(fixture.work, ['log', '-1', '--format=%an|%ae|%cn|%ce'])).toBe('Sample Contributor|sample@example.com|Sample Contributor|sample@example.com');
  expect(await git(fixture.work, ['log', '--skip=1', '-1', '--format=%an|%ae'])).toBe('OpenTig Test|opentig@example.invalid');
});

it('shares local authorship across worktrees and rejects a second stale sibling update', async () => {
  const fixture = await managementRepository();
  const worktree = await addWorktree(fixture, 'feature', 'feature');
  const sibling = await fixture.repositories.openPath(worktree);
  const original = await fixture.operations.getCommitAuthorship(fixture.repositoryId);
  const siblingOriginal = await fixture.operations.getCommitAuthorship(sibling.id);
  const results = await Promise.allSettled([
    fixture.operations.setCommitAuthorship(fixture.repositoryId, { name: 'First', email: 'first@example.com', expectedRevision: original.revision }),
    fixture.operations.setCommitAuthorship(sibling.id, { name: 'Second', email: 'second@example.com', expectedRevision: siblingOriginal.revision }),
  ]);
  expect(results.map((item) => item.status)).toEqual(['fulfilled', 'rejected']);
  expect((await fixture.operations.getCommitAuthorship(sibling.id)).author).toEqual({ name: 'First', email: 'first@example.com' });
});

it('keeps isolated repositories independent and never edits global identity', async () => {
  const first = await managementRepository();
  const second = await managementRepository();
  const global = path.join(first.root, 'global.gitconfig');
  await writeFile(global, '[user]\n name = Global Sample\n email = global@example.com\n');
  vi.stubEnv('GIT_CONFIG_GLOBAL', global);
  const before = await readFile(global, 'utf8');
  const identity = await first.operations.getCommitAuthorship(first.repositoryId);
  await first.operations.setCommitAuthorship(first.repositoryId, { name: 'Local Only', email: 'local@example.com', expectedRevision: identity.revision });
  expect(await readFile(global, 'utf8')).toBe(before);
  expect((await second.operations.getCommitAuthorship(second.repositoryId)).author?.name).toBe('OpenTig Test');
});

it('detects missing configured identity and allows setting it explicitly', async () => {
  const fixture = await managementRepository();
  const global = path.join(fixture.root, 'empty.gitconfig');
  await writeFile(global, ''); vi.stubEnv('GIT_CONFIG_GLOBAL', global); vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  await git(fixture.work, ['config', '--unset', 'user.name']);
  await git(fixture.work, ['config', '--unset', 'user.email']);
  await git(fixture.work, ['config', 'user.useConfigOnly', 'true']);
  const identity = await fixture.operations.getCommitAuthorship(fixture.repositoryId);
  expect(identity).toMatchObject({ author: null, source: 'unset', editable: true });
  await fixture.operations.setCommitAuthorship(fixture.repositoryId, { name: 'New User', email: 'new@example.com', expectedRevision: identity.revision });
  expect(await git(fixture.work, ['config', '--local', 'user.email'])).toBe('new@example.com');
});

it.each(['GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'EMAIL'])('shows %s overrides and prevents ineffective edits', async (key) => {
  const fixture = await managementRepository();
  const config = path.join(fixture.work, '.git', 'config');
  const before = await readFile(config, 'utf8');
  vi.stubEnv(key, key.includes('NAME') ? 'Environment User' : 'environment@example.com');
  const identity = await fixture.operations.getCommitAuthorship(fixture.repositoryId);
  expect(identity).toMatchObject({ source: 'environment', editable: false });
  await expect(fixture.operations.setCommitAuthorship(fixture.repositoryId, { name: 'Other', email: 'other@example.com', expectedRevision: identity.revision })).rejects.toThrow(/environment/);
  expect(await readFile(config, 'utf8')).toBe(before);
});

it.each(['author.email', 'committer.name'])('shows %s separately and refuses to overwrite it', async (key) => {
  const fixture = await managementRepository();
  await git(fixture.work, ['config', key, key.endsWith('name') ? 'Other Committer' : 'other@example.com']);
  const identity = await fixture.operations.getCommitAuthorship(fixture.repositoryId);
  expect(identity).toMatchObject({ source: 'custom', editable: false });
  expect(identity.author).not.toEqual(identity.committer);
  await expect(fixture.operations.setCommitAuthorship(fixture.repositoryId, { name: 'Other', email: 'other@example.com', expectedRevision: identity.revision })).rejects.toThrow(/author\.\*/);
});

it('refuses worktree-specific identity instead of changing shared defaults', async () => {
  const fixture = await managementRepository();
  await git(fixture.work, ['config', 'extensions.worktreeConfig', 'true']);
  await git(fixture.work, ['config', '--worktree', 'user.email', 'worktree@example.com']);
  const identity = await fixture.operations.getCommitAuthorship(fixture.repositoryId);
  expect(identity).toMatchObject({ source: 'worktree', editable: false, author: { email: 'worktree@example.com' } });
});

it('rejects stale reviewed settings and preserves an existing config lock', async () => {
  const fixture = await managementRepository();
  const identity = await fixture.operations.getCommitAuthorship(fixture.repositoryId);
  await git(fixture.work, ['config', 'core.abbrev', '10']);
  await expect(fixture.operations.setCommitAuthorship(fixture.repositoryId, { name: 'Other', email: 'other@example.com', expectedRevision: identity.revision })).rejects.toThrow(/settings changed/);
  const current = await fixture.operations.getCommitAuthorship(fixture.repositoryId);
  const lock = path.join(fixture.work, '.git', 'config.lock');
  await writeFile(lock, 'another process');
  await expect(fixture.operations.setCommitAuthorship(fixture.repositoryId, { name: 'Other', email: 'other@example.com', expectedRevision: current.revision })).rejects.toThrow(/Another Git process/);
  expect(await readFile(lock, 'utf8')).toBe('another process');
});

it('refuses an included identity that would override the candidate without publishing either field', async () => {
  const fixture = await managementRepository();
  const config = path.join(fixture.work, '.git', 'config');
  const included = path.join(fixture.root, 'included.gitconfig');
  await writeFile(included, '[user]\n name = Included\n email = included@example.com\n');
  await git(fixture.work, ['config', 'include.path', included]);
  const before = await readFile(config, 'utf8');
  const identity = await fixture.operations.getCommitAuthorship(fixture.repositoryId);
  expect(identity.author?.name).toBe('Included');
  await expect(fixture.operations.setCommitAuthorship(fixture.repositoryId, { name: 'Other', email: 'other@example.com', expectedRevision: identity.revision })).rejects.toThrow(/included Git setting/);
  expect(await readFile(config, 'utf8')).toBe(before);
  expect(await readFile(included, 'utf8')).toContain('included@example.com');
});

it('does not publish either field when the second config write fails', async () => {
  const fixture = await managementRepository();
  const process = new GitProcess();
  const service = new GitCommitAuthorship(process, fixture.repositories);
  const identity = await service.get(fixture.repositoryId);
  const config = path.join(fixture.work, '.git', 'config');
  const before = await readFile(config, 'utf8');
  const run = process.run.bind(process);
  vi.spyOn(process, 'run').mockImplementation((cwd, args, options) => args.includes('--replace-all') && args.includes('user.email') ? Promise.reject(new Error('simulated write failure')) : run(cwd, args, options));
  await expect(service.set(fixture.repositoryId, { name: 'Other', email: 'other@example.com', expectedRevision: identity.revision })).rejects.toThrow('simulated write failure');
  expect(await readFile(config, 'utf8')).toBe(before);
  await expect(readFile(`${config}.lock`)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('refuses linked config files that could belong to another repository', async () => {
  const fixture = await managementRepository();
  const config = path.join(fixture.work, '.git', 'config');
  const linked = path.join(fixture.root, 'shared-config');
  const before = await readFile(config);
  await writeFile(linked, before);
  const { unlink } = await import('node:fs/promises');
  await unlink(config);
  await symlink(linked, config);
  const identity = await fixture.operations.getCommitAuthorship(fixture.repositoryId);
  expect(identity.editable).toBe(false);
  await expect(fixture.operations.setCommitAuthorship(fixture.repositoryId, { name: 'Other', email: 'other@example.com', expectedRevision: identity.revision })).rejects.toThrow(/linked or shared/);
  expect(await readFile(linked)).toEqual(before);
});

it.each([['Bad\nName', 'normal@example.com'], ['Normal', 'bad\n@example.com'], ['<Name>', 'normal@example.com'], ['Normal', 'not-an-email']])('rejects invalid identity %s / %s before writing', async (name, email) => {
  const fixture = await managementRepository();
  const identity = await fixture.operations.getCommitAuthorship(fixture.repositoryId);
  await expect(fixture.operations.setCommitAuthorship(fixture.repositoryId, { name, email, expectedRevision: identity.revision })).rejects.toThrow(/valid name/);
});
