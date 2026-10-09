import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsStore } from '../persistence/SettingsStore';
import { RepositoryAiInstructions, repositoryInstructionPrompt } from './RepositoryAiInstructions';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opentig-instructions-test-')); directories.push(root);
  const first = path.join(root, 'first'); const sibling = path.join(root, 'sibling'); const other = path.join(root, 'other');
  await Promise.all([first, sibling, other].map(dir => mkdir(dir)));
  const settings = new SettingsStore(path.join(root, 'settings.json')); await settings.load();
  const repos = { first: { path: first, commonDir: path.join(first, '.git') }, sibling: { path: sibling, commonDir: path.join(first, '.git') }, other: { path: other, commonDir: path.join(other, '.git') } };
  const service = new RepositoryAiInstructions({ get: (id) => ({ id, name: id, repositoryName: id, ...repos[id as keyof typeof repos] }) }, settings);
  return { root, first, sibling, other, settings, service };
}
describe('repository AI instructions', () => {
  it('defaults off, reads no contents while disabled, and shares only the preference across worktrees', async () => {
    const { first, sibling, service, settings, root } = await fixture();
    await writeFile(path.join(first, 'AGENTS.md'), Buffer.from([0xff]));
    await writeFile(path.join(sibling, 'AGENTS.md'), 'Write in Spanish.');
    expect(await service.status('first')).toEqual({ enabled: false, files: ['AGENTS.md'] });
    expect((await service.snapshot('first')).files).toEqual([]);
    await service.setEnabled('first', true);
    expect((await service.status('sibling')).enabled).toBe(true);
    expect((await service.status('other')).enabled).toBe(false);
    expect((await service.snapshot('sibling')).files).toEqual([{ name: 'AGENTS.md', text: 'Write in Spanish.' }]);
    const restarted = new SettingsStore(path.join(root, 'settings.json')); await restarted.load();
    expect(restarted.repositoryAiInstructionsEnabled(path.join(first, '.git'))).toBe(true);
    await expect(service.snapshot('first')).rejects.toMatchObject({ detail: { operation: 'ai-repository-instructions' } });
    await service.setEnabled('first', false);
    expect(settings.repositoryAiInstructionsEnabled(path.join(first, '.git'))).toBe(false);
  });
  it('loads only supported root files, does not follow imports or parent/nested instructions, and fingerprints changes', async () => {
    const { first, root, service } = await fixture();
    await writeFile(path.join(root, 'AGENTS.md'), 'PARENT_MARKER');
    await mkdir(path.join(first, 'nested'));
    await writeFile(path.join(first, 'nested', 'AGENTS.md'), 'NESTED_MARKER');
    await writeFile(path.join(first, 'CLAUDE.md'), '@./nested/AGENTS.md');
    await writeFile(path.join(first, 'GROK.md'), 'Write imperative subjects.');
    await writeFile(path.join(first, 'opencode.json'), '{"instructions":["nested/AGENTS.md"]}');
    await service.setEnabled('first', true);
    const snapshot = await service.snapshot('first');
    expect(snapshot.files).toEqual([{ name: 'CLAUDE.md', text: '@./nested/AGENTS.md' }, { name: 'GROK.md', text: 'Write imperative subjects.' }]);
    expect(repositoryInstructionPrompt(snapshot.files)).not.toMatch(/PARENT_MARKER|NESTED_MARKER/);
    await writeFile(path.join(first, 'GROK.md'), 'Write Spanish subjects.');
    expect((await service.snapshot('first')).fingerprint).not.toBe(snapshot.fingerprint);
    await service.setEnabled('first', false);
    expect((await service.snapshot('first')).fingerprint).not.toBe(snapshot.fingerprint);
  });
  it('ignores symlinks and rejects oversized or binary text without sending partial instructions', async () => {
    const { first, root, service } = await fixture();
    await writeFile(path.join(root, 'private.txt'), 'PRIVATE_MARKER');
    await symlink(path.join(root, 'private.txt'), path.join(first, 'AGENTS.md'));
    await service.setEnabled('first', true);
    expect((await service.snapshot('first')).files).toEqual([]);
    await writeFile(path.join(first, 'CLAUDE.md'), 'x'.repeat(32 * 1024));
    await writeFile(path.join(first, 'GROK.md'), 'x');
    await expect(service.snapshot('first')).rejects.toMatchObject({ detail: { code: 'AI_CONTEXT_TOO_LARGE' } });
    await rm(path.join(first, 'GROK.md'));
    expect((await service.snapshot('first')).files[0]?.text.length).toBe(32 * 1024);
    await writeFile(path.join(first, 'CLAUDE.md'), 'text\0binary');
    await expect(service.snapshot('first')).rejects.toMatchObject({ detail: { code: 'AI_CONTEXT_TOO_LARGE' } });
  });
});
