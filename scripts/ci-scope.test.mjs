import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { needsValidation } from './ci-scope.mjs';

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
  expect(needsValidation('push', { before: base }, head, root)).toBe(false);
  expect(needsValidation('pull_request', { pull_request: { base: { sha: base } } }, head, root)).toBe(false);
  expect(needsValidation('workflow_dispatch', {}, head, root)).toBe(true);
});

it('validates a code change mixed with documentation', async () => {
  await writeFile(path.join(root, 'application.ts'), 'export const value = 2;\n');
  expect(needsValidation('push', { before: base }, commit(), root)).toBe(true);
});

it('skips application jobs for website-only pushes and PRs', async () => {
  for (const file of ['website/src/pages/index.astro', '.github/workflows/website.yml', 'docs/website.md']) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), 'Website fixture\n');
  }
  const head = commit();
  expect(needsValidation('push', { before: base }, head, root)).toBe(false);
  expect(needsValidation('pull_request', { pull_request: { base: { sha: base } } }, head, root)).toBe(false);
  expect(needsValidation('workflow_dispatch', {}, head, root)).toBe(true);
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
