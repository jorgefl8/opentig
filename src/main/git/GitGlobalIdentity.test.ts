import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GitProcess } from './GitProcess';
import { setGlobalGitIdentity } from './GitGlobalIdentity';

let directory: string, config: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'opentig-global-identity-'));
  config = path.join(directory, 'gitconfig');
  vi.stubEnv('GIT_CONFIG_GLOBAL', config);
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

it('writes a global identity only when none exists', async () => {
  await setGlobalGitIdentity(new GitProcess(), { name: 'Ana López', email: 'ana@acme.dev' });
  const written = await readFile(config, 'utf8');
  expect(written).toContain('name = Ana López');
  expect(written).toContain('email = ana@acme.dev');
  await expect(setGlobalGitIdentity(new GitProcess(), { name: 'Other', email: 'other@acme.dev' })).rejects.toThrow('already exists');
  expect(await readFile(config, 'utf8')).toBe(written);
});

it('refuses partial existing identities and invalid input', async () => {
  await writeFile(config, '[user]\n\temail = kept@acme.dev\n');
  await expect(setGlobalGitIdentity(new GitProcess(), { name: 'Ana', email: 'ana@acme.dev' })).rejects.toThrow('already exists');
  await expect(setGlobalGitIdentity(new GitProcess(), { name: 'Ana', email: 'not-an-email' })).rejects.toThrow('valid email');
  expect(await readFile(config, 'utf8')).toBe('[user]\n\temail = kept@acme.dev\n');
});
