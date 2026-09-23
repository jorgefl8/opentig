import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { prepareRelease } from './prepare-release.mjs';
import { NOTES_START, NOTES_END, updateDraft } from './release-draft.mjs';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function gitAt(root) {
  return (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function fixture({ draft = true, changed = true } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'opentig-prepare-'));
  roots.push(directory);
  const root = path.join(directory, 'checkout');
  const remotePath = path.join(directory, 'remote.git');
  mkdirSync(root);
  gitAt(directory)('init', '--bare', '--initial-branch=main', remotePath);
  const git = gitAt(root);
  const remote = gitAt(remotePath);
  git('init', '-b', 'main');
  git('remote', 'add', 'origin', remotePath);
  mkdirSync(path.join(root, 'packages/server'), { recursive: true });
  const desktop = { name: '@opentig/desktop', version: '0.1.0', dependencies: { example: '1.2.3' } };
  const server = { name: '@opentig/cli', version: '0.1.0' };
  const documents = { 'package.json': desktop, 'packages/server/package.json': server,
    'package-lock.json': { name: desktop.name, version: desktop.version, lockfileVersion: 3,
      packages: { '': desktop, 'packages/server': server, 'node_modules/example': { version: '1.2.3', integrity: 'unchanged' } } } };
  for (const [file, data] of Object.entries(documents)) writeFileSync(path.join(root, file), `${JSON.stringify(data, null, 2)}\n`);
  git('add', '.');
  git('commit', '-m', 'feat: first version');
  git('tag', 'v0.1.0');
  if (changed) git('commit', '--allow-empty', '-m', 'fix: current change');
  git('push', 'origin', 'main', '--tags');
  const head = git('rev-parse', 'HEAD').trim();
  const releases = [{ id: 1, tag_name: 'v0.1.0', draft: false, prerelease: false }];
  if (draft) releases.push({ id: 2, tag_name: 'v0.1.1', draft: true, prerelease: false,
    name: 'Custom title', target_commitish: head, assets: [],
    body: `Manual introduction\n${NOTES_START}\nOld notes\n${NOTES_END}\nManual footer` });
  const api = vi.fn(async (method, route, payload) => {
    if (method === 'PATCH') {
      const release = releases.find((r) => `/releases/${r.id}` === route);
      Object.assign(release, payload);
      return structuredClone(release);
    }
    if (method === 'POST' && route === '/releases') {
      const release = { ...payload, id: releases.length + 1, assets: [] };
      releases.push(release);
      return structuredClone(release);
    }
    if (route.startsWith('/releases?')) return structuredClone(releases);
    if (route.startsWith('/releases/')) return structuredClone(releases.find((r) => route === `/releases/${r.id}`));
    if (route.startsWith('/git/ref/tags/')) {
      try { return { sha: remote('rev-parse', '--verify', `refs/tags/${route.slice('/git/ref/tags/'.length)}`).trim() }; }
      catch { return null; }
    }
    if (route.startsWith('/commits/')) return { sha: remote('rev-parse', `${route.slice('/commits/'.length)}^{commit}`).trim() };
    if (route.includes('&author=')) return [];
    if (route.startsWith('/commits?')) {
      const target = new URL(route, 'https://example.invalid').searchParams.get('sha');
      return remote('log', '--format=%H', target).trim().split('\n')
        .map((sha) => ({ sha, author: { login: 'fixture', type: 'User' }, commit: { author: { name: 'Fixture' } } }));
    }
    if (route.startsWith('/pulls?')) return [];
    throw new Error(`Unexpected API request: ${method} ${route}`);
  });
  return { api, git, root, remote, remotePath, directory, releases, repository: 'jorgefl8/opentig' };
}

it('prepares one draft from real history, atomically bumps all package versions and pins the tag and notes', async () => {
  const context = fixture();
  const result = await prepareRelease(context);
  expect(result).toMatchObject({ tag: 'v0.1.1', resumed: false, dryRun: false });
  expect(context.remote('rev-parse', 'main').trim()).toBe(result.commit);
  expect(context.remote('rev-parse', 'v0.1.1^{commit}').trim()).toBe(result.commit);
  for (const file of ['package.json', 'packages/server/package.json', 'package-lock.json']) {
    expect(JSON.parse(context.remote('show', `${result.commit}:${file}`)).version).toBe('0.1.1');
  }
  const lock = JSON.parse(context.remote('show', `${result.commit}:package-lock.json`));
  expect(lock.packages[''].version).toBe('0.1.1');
  expect(lock.packages['packages/server'].version).toBe('0.1.1');
  expect(lock.packages['node_modules/example']).toEqual({ version: '1.2.3', integrity: 'unchanged' });
  expect(context.releases).toHaveLength(2);
  expect(context.releases[1]).toMatchObject({ name: 'Custom title', draft: true, target_commitish: result.commit });
  expect(context.releases[1].body).toContain('Manual introduction');
  expect(context.releases[1].body).toContain('Manual footer');
  expect(context.releases[1].body).toContain('fix: current change');
  expect(context.releases[1].body).toContain(`v0.1.0...${result.commit}`);
});

it('can prepare before the draft updater runs and can reuse an already aligned package version', async () => {
  const context = fixture({ draft: false });
  const before = await prepareRelease({ ...context, dryRun: true });
  expect(before.versionCommitNeeded).toBe(true);
  await prepareRelease(context);
  expect(context.releases[1]).toMatchObject({ name: 'OpenTig v0.1.1', draft: true });
  // A separate initial release may already have all versions aligned.
  const initial = fixture({ draft: false });
  initial.releases.length = 0;
  initial.git('tag', '-d', 'v0.1.0');
  initial.remote('tag', '-d', 'v0.1.0');
  const original = initial.git('rev-parse', 'HEAD').trim();
  expect((await prepareRelease(initial)).commit).toBe(original);
});

it('dry run previews without changing the worktree, remote refs or release notes', async () => {
  const context = fixture();
  const head = context.git('rev-parse', 'HEAD');
  const refs = context.remote('show-ref');
  const releases = structuredClone(context.releases);
  expect(await prepareRelease({ ...context, dryRun: true })).toMatchObject({ tag: 'v0.1.1', dryRun: true });
  expect(context.git('rev-parse', 'HEAD')).toBe(head);
  expect(context.git('status', '--porcelain')).toBe('');
  expect(context.remote('show-ref')).toBe(refs);
  expect(context.releases).toEqual(releases);
  expect(context.api.mock.calls.every(([method]) => method === 'GET')).toBe(true);
});

it('recovers after a notes failure, freezes the prepared commit, and carries later changes to the following release', async () => {
  const context = fixture({ draft: false });
  const api = context.api;
  await expect(prepareRelease({ ...context, api: async (method, ...args) => {
    if (method === 'PATCH') throw new Error('Transient GitHub failure');
    return api(method, ...args);
  } })).rejects.toThrow('Transient GitHub failure');
  const tagged = context.remote('rev-parse', 'v0.1.1^{commit}').trim();
  context.git('commit', '--allow-empty', '-m', 'feat: later change');
  context.git('push', 'origin', 'main');
  const next = context.remote('rev-parse', 'main').trim();
  expect(await prepareRelease(context)).toMatchObject({ commit: tagged, tag: 'v0.1.1', resumed: true });
  expect(context.remote('rev-parse', 'main').trim()).toBe(next);
  expect(context.releases[1].body).not.toContain('later change');
  expect(context.releases[1].target_commitish).toBe(tagged);
  const draftContext = { ...context, packageVersion: '0.1.1' };
  expect(await updateDraft(draftContext)).toContain('frozen');
  context.releases[1].draft = false;
  await updateDraft(draftContext);
  expect(context.releases[2]).toMatchObject({ tag_name: 'v0.1.2', draft: true });
  expect(context.releases[2].body).toContain('feat: later change');
  expect(context.releases[2].body).not.toContain('fix: current change');
});

it('rejects a concurrent main push without leaving a remote tag or overwriting the new main commit', async () => {
  const context = fixture();
  const originalGit = context.git;
  let concurrent;
  const git = (...args) => {
    if (args[0] === 'push') {
      const rival = path.join(context.directory, 'rival');
      gitAt(context.directory)('clone', context.remotePath, rival);
      const other = gitAt(rival);
      other('commit', '--allow-empty', '-m', 'fix: concurrent change');
      other('push', 'origin', 'main');
      concurrent = other('rev-parse', 'HEAD').trim();
    }
    return originalGit(...args);
  };
  await expect(prepareRelease({ ...context, git })).rejects.toThrow();
  expect(context.remote('rev-parse', 'main').trim()).toBe(concurrent);
  expect(() => context.remote('rev-parse', '--verify', 'refs/tags/v0.1.1')).toThrow();
  expect(JSON.parse(context.remote('show', 'main:package.json')).version).toBe('0.1.0');
  expect(context.api.mock.calls.every(([method]) => method === 'GET')).toBe(true);
});

it('does not mutate published releases, dirty checkouts, malformed notes or empty release ranges', async () => {
  const unchanged = fixture({ changed: false });
  await expect(prepareRelease(unchanged)).rejects.toThrow('No changes');
  const dirty = fixture();
  writeFileSync(path.join(dirty.root, 'uncommitted.txt'), 'keep me');
  await expect(prepareRelease(dirty)).rejects.toThrow('clean checkout');
  const malformed = fixture();
  malformed.releases[1].body = `${NOTES_START}\nMissing end marker`;
  await expect(prepareRelease(malformed)).rejects.toThrow('markers');
  expect(() => malformed.remote('rev-parse', '--verify', 'refs/tags/v0.1.1')).toThrow();
  const published = fixture();
  const api = published.api;
  await expect(prepareRelease({ ...published, api: async (method, route, ...args) => {
    const value = await api(method, route, ...args);
    return route === '/releases/2' ? { ...value, draft: false } : value;
  } })).rejects.toThrow('Draft changed');
  expect(() => published.remote('rev-parse', '--verify', 'refs/tags/v0.1.1')).toThrow();
});

it('keeps a frozen tag when main proposes a higher version and refuses mismatched tagged versions', async () => {
  const context = fixture();
  const prepared = await prepareRelease(context);
  const file = path.join(context.root, 'package.json');
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  pkg.version = '0.2.0';
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  context.git('add', '.');
  context.git('commit', '-m', 'chore: propose next minor');
  context.git('push', 'origin', 'main');
  expect(await prepareRelease({ ...context, dryRun: true })).toMatchObject({ tag: 'v0.1.1', commit: prepared.commit, resumed: true });
  const invalid = fixture();
  invalid.git('tag', 'v0.1.1');
  invalid.git('push', 'origin', 'refs/tags/v0.1.1');
  await expect(prepareRelease(invalid)).rejects.toThrow('Tagged version does not match');
});

it('passes the prepared commit to the builder validator and rejects a substituted commit', async () => {
  const context = fixture();
  const prepared = await prepareRelease(context);
  writeFileSync(path.join(context.root, 'release.config.json'), JSON.stringify({ owner: 'jorgefl8', repo: 'opentig' }));
  const validate = (commit) => execFileSync(process.execPath, [fileURLToPath(new URL('./validate-release-tag.mjs', import.meta.url))], {
    cwd: context.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, OPENTIG_RELEASE_TAG: prepared.tag, OPENTIG_RELEASE_COMMIT: commit,
      GITHUB_REPOSITORY: context.repository, GITHUB_OUTPUT: '' },
  });
  expect(validate(prepared.commit)).toContain('validated');
  expect(() => validate('f'.repeat(40))).toThrow('Checkout does not match the prepared commit');
});
