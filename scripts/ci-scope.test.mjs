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
  expect(validationScope('push', { before: base }, head, root)).toEqual({ required: false, website: false, installScripts: false });
  expect(needsValidation('pull_request', { pull_request: { base: { sha: base } } }, head, root)).toBe(false);
  expect(needsValidation('workflow_dispatch', {}, head, root)).toBe(true);
});

it('validates a code change mixed with documentation', async () => {
  await writeFile(path.join(root, 'application.ts'), 'export const value = 2;\n');
  expect(validationScope('push', { before: base }, commit(), root)).toEqual({ required: true, website: false, installScripts: false });
});

it('skips application jobs for website-only pushes and PRs', async () => {
  for (const file of ['website/src/pages/index.astro', 'website/wrangler.jsonc', 'docs/website.md']) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), 'Website fixture\n');
  }
  const head = commit();
  expect(validationScope('push', { before: base }, head, root)).toEqual({ required: false, website: true, installScripts: false });
  expect(validationScope('pull_request', { pull_request: { base: { sha: base } } }, head, root)).toEqual({ required: false, website: true, installScripts: false });
  expect(needsValidation('workflow_dispatch', {}, head, root)).toBe(true);
});

// The install-scripts job packs the CLI and installs it with each script on three systems.
it.each(['website/public/install.sh', 'website/public/install.ps1', 'website/scripts/verify-install.mjs'])(
  'runs the install-scripts job, without the application jobs, when %s changes', async (file) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), 'Changed script\n');
    expect(validationScope('push', { before: base }, commit(), root)).toEqual({ required: false, website: true, installScripts: true });
  },
);

it.each(['packages/server/src/cli-service.ts', 'scripts/pack-headless.mjs', 'scripts/headless-release.mjs', '.github/workflows/headless-release.yml', 'pnpm-lock.yaml'])(
  'runs the install-scripts job when the CLI, its packing, or its release changes: %s', async (file) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), 'Changed CLI fixture\n');
    expect(validationScope('push', { before: base }, commit(), root)).toMatchObject({ required: true, installScripts: true });
  },
);

it.each(['src/renderer/app/App.tsx', 'src/main/github/GitHubService.ts', 'e2e/history.e2e.ts'])(
  'leaves the install-scripts job out for application changes outside the CLI package: %s', async (file) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), 'Changed application fixture\n');
    expect(validationScope('pull_request', { pull_request: { base: { sha: base } } }, commit(), root)).toMatchObject({ required: true, installScripts: false });
  },
);

it('validates the website for manual-deployment workflow edits without making an application release', async () => {
  const file = path.join(root, '.github/workflows/website.yml');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, 'name: Deploy website\non:\n  workflow_dispatch:\n');
  const head = commit();
  expect(validationScope('push', { before: base }, head, root)).toEqual({ required: false, website: true, installScripts: false });
  expect(validationScope('pull_request', { pull_request: { base: { sha: base } } }, head, root)).toEqual({ required: false, website: true, installScripts: false });
});

it('keeps release-security automation in application validation scope', async () => {
  const file = path.join(root, '.github/workflows/virustotal.yml');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, 'name: Scan published Windows installer\n');
  expect(validationScope('push', { before: base }, commit(), root)).toEqual({ required: true, website: false, installScripts: false });
});

it.each(['application.ts', 'package.json'])(
  'validates website changes mixed with shared or application file %s', async (file) => {
    await mkdir(path.join(root, 'website'));
    await writeFile(path.join(root, 'website/index.astro'), '<main>OpenTig</main>');
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), 'Changed fixture\n');
    expect(needsValidation('push', { before: base }, commit(), root)).toBe(true);
  },
);

// One path per website rule: shared source prefix, exact tsconfig, and shared tooling list.
it.each([['src/renderer/app/App.tsx', false], ['tsconfig.json', false], ['.github/workflows/ci.yml', true]])(
  'validates both projects when shared file %s changes alone', async (file, installScripts) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), 'Changed shared fixture\n');
    expect(validationScope('push', { before: base }, commit(), root)).toEqual({ required: true, website: true, installScripts });
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
  ]) expect(validationScope(event, payload, head, root)).toEqual({ required: true, website: true, installScripts: true });
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

it('keeps published prose sources prose-only while validating the website', async () => {
  for (const source of publishedSources) {
    if (source !== 'docs/ai-writing-policy.md') await writeFile(path.join(root, source), '# Updated guide\n');
  }
  const head = commit();
  expect(validationScope('push', { before: base }, head, root)).toEqual({ required: false, website: true, installScripts: false });
});

it('validates the application when the AI writing policy compiled into its prompts changes', async () => {
  expect(publishedSources.has('docs/ai-writing-policy.md')).toBe(true);
  await writeFile(path.join(root, 'docs', 'ai-writing-policy.md'), '# Updated policy\n');
  expect(validationScope('push', { before: base }, commit(), root)).toEqual({ required: true, website: true, installScripts: false });
});

it.each(['docs/getting-started.md', 'CONTRIBUTING.md'])('validates the website when the published source %s changes', async (source) => {
  expect(publishedSources.has(source)).toBe(true);
  await writeFile(path.join(root, source), '# Updated guide\n');
  const head = commit();
  expect(validationScope('push', { before: base }, head, root)).toEqual({ required: false, website: true, installScripts: false });
  expect(validationScope('pull_request', { pull_request: { base: { sha: base } } }, head, root)).toEqual({ required: false, website: true, installScripts: false });
});
