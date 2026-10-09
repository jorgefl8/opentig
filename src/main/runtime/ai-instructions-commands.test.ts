import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { IPC } from '../../shared/contracts';
import { RepositoryAiInstructions } from '../ai/RepositoryAiInstructions';
import { SettingsStore } from '../persistence/SettingsStore';
import { CommandRegistry } from './CommandRegistry';
import type { OpenTigHost } from './OpenTigHost';
import type { OpenTigRuntimeServices } from './OpenTigRuntime';
import { registerServerCommands } from './registerServerCommands';

it('persists explicit boolean opt-ins on the backend and broadcasts only after a successful update', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opentig-instruction-commands-'));
  try {
    const settings = new SettingsStore(path.join(root, 'settings.json')); await settings.load();
    const repositories = { get: (id: string) => { if (id !== 'repo') throw new Error('Unknown repository'); return { id, name: 'sample', repositoryName: 'sample', path: root, commonDir: path.join(root, '.git') }; } };
    const aiInstructionsChanged = vi.fn();
    const registry = new CommandRegistry();
    registerServerCommands(registry, { settings, repositories, aiInstructions: new RepositoryAiInstructions(repositories, settings), events: { aiInstructionsChanged } } as unknown as OpenTigRuntimeServices, {} as OpenTigHost);
    expect(await registry.execute('test', IPC.aiRepositoryInstructions, ['repo'])).toMatchObject({ ok: true, value: { enabled: false } });
    expect(await registry.execute('test', IPC.aiSetRepositoryInstructions, ['repo', 'true'])).toMatchObject({ ok: false });
    expect(await registry.execute('test', IPC.aiSetRepositoryInstructions, ['unknown', true])).toMatchObject({ ok: false });
    expect(aiInstructionsChanged).not.toHaveBeenCalled();
    expect(await registry.execute('test', IPC.aiSetRepositoryInstructions, ['repo', true])).toMatchObject({ ok: true, value: { enabled: true } });
    expect(aiInstructionsChanged).toHaveBeenCalledWith(path.join(root, '.git'));
    expect(settings.repositoryAiInstructionsEnabled(path.join(root, '.git'))).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
