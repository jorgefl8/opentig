import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { publishedSources } from '../website/docs.config.mjs';
import { needsValidation, validationScope } from './ci-scope.mjs';

let root;
let base;
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const commit = () => { git('add', '.'); git('commit', '-qm', 'Fixture change'); return git('rev-parse', 'HEAD'); };
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'opentig-ci-scope-'));
  git('init', '-q');
  git('config', 'user.name', 'OpenTig Test');
  git('config', 'user.email', 'opentig@example.invalid');
  await mkdir(path.join(root, 'docs'));
  await writeFile(path.join(root, 'README.md'), 'Initial documentation\n');
  await writeFile(path.join(root, 'application.ts'), 'export const value = 1;\n');
  base = commit();
});
beforeEach(async () => {
  git('reset', '--hard', base);
  git('clean', '-fd');
  await mkdir(path.join(root, 'docs'), { recursive: true });
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true, maxRetries: 3 }); });

it('skips prose-only push and PR changes while retaining manual validation', async () => {
  await writeFile(path.join(root, 'docs', 'guide.md'), 'New documentation\n');
  const head = commit();
  expect(validationScope('push', { before: base }, head, root)).toEqual({ required: false, website: false });
  expect(needsValidation('pull_request', { pull_request: { base: { sha: base } } }, head, root)).toBe(false);
  expect(needsValidation('workflow_dispatch', {}, head, root)).toBe(true);
});

it('validates a code change mixed with documentation', async () => {
  await writeFile(path.join(root, 'application.ts'), 'export const value = 2;\n');
  expect(validationScope('push', { before: base }, commit(), root)).toEqual({ required: true, website: false });
});

it('skips application jobs for website-only pushes and PRs', async () => {
  for (const file of ['website/src/pages/index.astro', 'website/wrangler.jsonc', 'docs/website.md']) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), 'Website fixture\n');
  }
  const head = commit();
  expect(validationScope('push', { before: base }, head, root)).toEqual({ required: false, website: true });
  expect(validationScope('pull_request', { pull_request: { base: { sha: base } } }, head, root)).toEqual({ required: false, website: true });
  expect(needsValidation('workflow_dispatch', {}, head, root)).toBe(true);
});

it('validates the website for manual-deployment workflow edits without making an application release', async () => {
  const file = path.join(root, '.github/workflows/website.yml');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, 'name: Deploy website\non:\n  workflow_dispatch:\n');
  const head = commit();
  expect(validationScope('push', { before: base }, head, root)).toEqual({ required: false, website: true });
  expect(validationScope('pull_request', { pull_request: { base: { sha: base } } }, head, root)).toEqual({ required: false, website: true });
});

it('keeps release-security automation in application validation scope', async () => {
  const file = path.join(root, '.github/workflows/virustotal.yml');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, 'name: Scan published Windows installer\n');
  expect(validationScope('push', { before: base }, commit(), root)).toEqual({ required: true, website: false });
});

it.each(['application.ts', 'package.json', 'package-lock.json', '.oxlintrc.json', 'scripts/change-scope.mjs'])(
  'validates website changes mixed with shared or application file %s', async (file) => {
    await mkdir(path.join(root, 'website'));
    await writeFile(path.join(root, 'website/index.astro'), '<main>OpenTig</main>');
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), 'Changed fixture\n');
    expect(needsValidation('push', { before: base }, commit(), root)).toBe(true);
  },
);

it.each(['src/renderer/app/App.tsx', 'src/shared/contracts.ts', 'public/vscode-icons/file.svg', 'tsconfig.json', 'package.json', 'package-lock.json', '.oxlintrc.json', '.npmrc', '.github/workflows/ci.yml', 'scripts/ci-scope.mjs', 'scripts/change-scope.mjs'])(
  'validates both projects when shared file %s changes alone', async (file) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), 'Changed shared fixture\n');
    expect(validationScope('push', { before: base }, commit(), root)).toEqual({ required: true, website: true });
  },
);

it('validates both projects for manual runs and when history cannot establish scope', () => {
  for (const [event, payload, head] of [
    ['workflow_dispatch', {}, base],
    ['push', { before: '0'.repeat(40) }, base],
    ['pull_request', {}, base],
    ['push', { before: 'a'.repeat(40) }, base],
    ['push', { before: base }, base],
    ['unknown', {}, base],
  ]) expect(validationScope(event, payload, head, root)).toEqual({ required: true, website: true });
});

it('does not exempt application code moved into the website', async () => {
  await mkdir(path.join(root, 'website'));
  await rename(path.join(root, 'application.ts'), path.join(root, 'website', 'application.ts'));
  expect(needsValidation('push', { before: base }, commit(), root)).toBe(true);
});

it('does not exempt a code file renamed into documentation', async () => {
  await rename(path.join(root, 'application.ts'), path.join(root, 'docs', 'example.md'));
  expect(needsValidation('push', { before: base }, commit(), root)).toBe(true);
});

it('validates non-prose assets under docs', async () => {
  const before = git('rev-parse', 'HEAD');
  await writeFile(path.join(root, 'docs', 'example.html'), '<main>Example</main>');
  expect(needsValidation('push', { before }, commit(), root)).toBe(true);
});

it('fails safe for unavailable bases, initial pushes, empty diffs, and unknown events', () => {
  expect(needsValidation('push', { before: '0'.repeat(40) }, base, root)).toBe(true);
  expect(needsValidation('pull_request', {}, base, root)).toBe(true);
  expect(needsValidation('push', { before: 'a'.repeat(40) }, base, root)).toBe(true);
  expect(needsValidation('push', { before: base }, base, root)).toBe(true);
  expect(needsValidation('unknown', {}, base, root)).toBe(true);
});

it.each([...publishedSources])('validates the website when the published source %s changes', async (source) => {
  await writeFile(path.join(root, source), '# Updated guide\n');
  const head = commit();
  expect(validationScope('push', { before: base }, head, root)).toEqual({ required: false, website: true });
  expect(validationScope('pull_request', { pull_request: { base: { sha: base } } }, head, root)).toEqual({ required: false, website: true });
});
