import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { NOTES_START, NOTES_END, readCommits, renderNotes, replaceNotes, selectDraft, updateDraft } from './release-draft.mjs';

const head = 'a'.repeat(40);
const body = `${NOTES_START}\nOld notes\n${NOTES_END}`;
const published = { id: 1, tag_name: 'v0.1.0', draft: false, prerelease: false };
const draft = { id: 2, tag_name: 'v0.1.1', name: 'OpenTig v0.1.1', target_commitish: head, draft: true, prerelease: false, body, assets: [] };

function fixture(releases = [], options = {}) {
  const api = vi.fn(async (method, route, payload) => {
    if (method === 'GET') {
      if (route === '/commits/main') return { sha: options.main || head };
      if (route === '/commits/v0.1.1') return { sha: options.tagCommit || head };
      if (route.startsWith('/releases?')) return releases;
      if (route.startsWith('/git/ref/')) return options.tagExists ? { ref: route } : null;
      if (route === '/releases/2') return options.current || releases.find((r) => r.id === 2);
      throw new Error(`Unexpected request ${route}`);
    }
    return payload;
  });
  const git = vi.fn((command) => command === 'rev-parse' ? head : command === 'log'
    ? (options.noChanges ? '' : `${head}\0fix: preserve browser pairing\n\0\n`)
    : '');
  return { api, git, repository: 'jorgefl8/opentig', packageVersion: '0.1.0' };
}

it('starts the first draft at the package version and ignores prereleases when proposing the next patch', () => {
  expect(selectDraft([], '0.1.0').tag).toBe('v0.1.0');
  expect(selectDraft([published, { id: 3, tag_name: 'v1.0.0-rc.1', prerelease: true }], '0.1.0').tag).toBe('v0.1.1');
  expect(selectDraft([published, { ...published, id: 4, tag_name: 'v0.1.10' }], '0.1.0').tag).toBe('v0.1.11');
});

it('promotes the same draft for explicit package bumps and preserves a higher manually chosen version', () => {
  expect(selectDraft([published, draft], '0.2.0')).toMatchObject({ draft, tag: 'v0.2.0' });
  expect(selectDraft([published, { ...draft, tag_name: 'v1.0.0' }], '0.2.0').tag).toBe('v1.0.0');
  expect(() => selectDraft([published, { ...draft, body: 'Manual release' }], '0.1.0')).toThrow('outside the managed');
  expect(() => selectDraft([published, draft, { ...draft, id: 3 }], '0.1.0')).toThrow('Multiple managed');
});

it('preserves manual prose outside the generated block and refuses malformed markers', () => {
  expect(replaceNotes(`Intro\n${body}\nUpgrade instructions`, 'New notes')).toBe('Intro\nNew notes\nUpgrade instructions');
  for (const invalid of ['Manual prose', NOTES_START, `${body}${NOTES_END}`, `${NOTES_END}${NOTES_START}`]) {
    expect(() => replaceNotes(invalid, 'New notes')).toThrow('markers');
  }
});

it('groups direct commits, merge PRs and squash PRs, links them and escapes untrusted markdown', () => {
  const result = renderNotes([
    { sha: head, message: 'fix: browser reload' },
    { sha: 'b'.repeat(40), message: 'Merge pull request #23 from user/mobile\n\nfeat(ui): mobile folder picker' },
    { sha: 'c'.repeat(40), message: 'docs: installation (#24)' },
    { sha: 'd'.repeat(40), message: 'chore: <img> [unsafe](javascript:alert)' },
  ], 'jorgefl8/opentig', 'v0.1.0', head);
  expect(result).toContain('### Features\n\n- feat(ui): mobile folder picker');
  expect(result).toContain('/pull/23');
  expect(result).toContain('/pull/24');
  expect(result).toContain(`/commit/${head}`);
  expect(result).toContain('### Fixes');
  expect(result).toContain('&lt;img&gt; \\[unsafe\\]');
  expect(result).toContain(`/compare/v0.1.0...${head}`);
});

it('creates a notes-only draft, then updates its existing id without publishing or creating a tag', async () => {
  const first = fixture();
  await updateDraft(first);
  expect(first.api).toHaveBeenCalledWith('POST', '/releases', expect.objectContaining({ tag_name: 'v0.1.0', draft: true, prerelease: false }));
  const next = fixture([published, { ...draft, body: `Intro\n${body}\nManual tail`, name: 'My release title' }]);
  await updateDraft(next);
  const writes = next.api.mock.calls.filter(([method]) => method !== 'GET');
  expect(writes).toHaveLength(1);
  expect(writes[0].slice(0, 2)).toEqual(['PATCH', '/releases/2']);
  expect(writes[0][2]).not.toHaveProperty('draft');
  expect(writes[0][2]).not.toHaveProperty('name');
  expect(writes[0][2].body).toMatch(/^Intro\n/);
  expect(writes[0][2].body).toMatch(/Manual tail$/);
});

it('starts a fresh draft after publication with only the changes after that release', async () => {
  const next = fixture([published, { ...draft, draft: false }]);
  await updateDraft(next);
  expect(next.git).toHaveBeenCalledWith('log', '--first-parent', '--reverse', '--format=%H%x00%B%x00', `v0.1.1..${head}`, '--');
  expect(next.api).toHaveBeenCalledWith('POST', '/releases', expect.objectContaining({ tag_name: 'v0.1.2', draft: true }));
});

it('freezes a candidate once a tag exists or assets are attached', async () => {
  for (const context of [fixture([published, draft], { tagExists: true }), fixture([published, { ...draft, assets: [{ id: 1 }] }])]) {
    expect(await updateDraft(context)).toContain('frozen');
    expect(context.api.mock.calls.every(([method]) => method === 'GET')).toBe(true);
  }
});

it('reconciles notes to the tagged commit if main/tag pushes race, excluding later main commits', async () => {
  const target = 'b'.repeat(40);
  const context = fixture([published, draft], { tagExists: true, tagCommit: target });
  await updateDraft(context);
  expect(context.git).toHaveBeenCalledWith('log', '--first-parent', '--reverse', '--format=%H%x00%B%x00', `v0.1.0..${target}`, '--');
  expect(context.api).toHaveBeenCalledWith('PATCH', '/releases/2', expect.objectContaining({ target_commitish: target, tag_name: 'v0.1.1' }));
});

it('does not write when history is unchanged, a run is stale, or dry-run is requested', async () => {
  for (const context of [fixture([published], { noChanges: true }), fixture([], { main: 'b'.repeat(40) }), { ...fixture(), dryRun: true }]) {
    await updateDraft(context);
    expect(context.api.mock.calls.every(([method]) => method === 'GET')).toBe(true);
  }
});

it('refuses to patch a draft that was published, manually edited or given assets during generation', async () => {
  for (const current of [{ ...draft, draft: false }, { ...draft, body: 'New manual text' }, { ...draft, assets: [{ id: 1 }] }]) {
    const context = fixture([published, draft], { current });
    await expect(updateDraft(context)).rejects.toThrow('changed during generation');
    expect(context.api.mock.calls.every(([method]) => method === 'GET')).toBe(true);
  }
});

it('paginates releases so older stable versions still delimit the notes', async () => {
  const context = fixture();
  const baseApi = context.api;
  context.api = vi.fn((method, route, ...args) => {
    if (route === '/releases?per_page=100&page=1') return Array.from({ length: 100 }, (_, id) => ({ id: id + 10, tag_name: `v2.0.0-rc.${id}`, prerelease: true }));
    if (route === '/releases?per_page=100&page=2') return [published];
    return baseApi(method, route, ...args);
  });
  await updateDraft(context);
  expect(context.api).toHaveBeenCalledWith('POST', '/releases', expect.objectContaining({ tag_name: 'v0.1.1' }));
});

it('uses real first-parent Git history without duplicating commits within a merged PR', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'opentig-draft-'));
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.invalid');
    const commit = (message) => git('commit', '--allow-empty', '-m', message);
    commit('first release');
    git('tag', 'v0.1.0');
    git('checkout', '-b', 'feature');
    commit('feat: add folder list');
    commit('fix: folder spacing');
    git('checkout', 'main');
    git('merge', '--no-ff', 'feature', '-m', 'Merge pull request #23 from user/feature\n\nfeat: browse folders');
    commit('fix: pairing');
    const commits = readCommits(git, 'v0.1.0', 'HEAD');
    expect(commits.map((c) => c.message.trim())).toEqual(['Merge pull request #23 from user/feature\n\nfeat: browse folders', 'fix: pairing']);
    expect(readCommits(git, 'v0.1.0', 'v0.1.0')).toEqual([]);
    git('checkout', '--orphan', 'unrelated');
    commit('unrelated history');
    expect(() => readCommits(git, 'v0.1.0', 'HEAD')).toThrow();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
