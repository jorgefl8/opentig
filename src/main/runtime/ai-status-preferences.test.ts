import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { IPC } from '../../shared/contracts';
import { SettingsStore } from '../persistence/SettingsStore';
import { CommandRegistry } from './CommandRegistry';
import type { OpenTigHost } from './OpenTigHost';
import type { OpenTigRuntimeServices } from './OpenTigRuntime';
import { registerServerCommands } from './registerServerCommands';

it('invalidates provider checks only when saved executable paths actually change', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'opentig-ai-preferences-'));
  try {
    const settings = new SettingsStore(path.join(directory, 'settings.json'));
    await settings.load();
    const invalidateStatuses = vi.fn();
    const registry = new CommandRegistry();
    registerServerCommands(registry, { settings, ai: { invalidateStatuses } } as unknown as OpenTigRuntimeServices,
      { preferencesChanged: vi.fn() } as unknown as OpenTigHost);
    const update = async (partial: Parameters<SettingsStore['setPreferences']>[0]) => {
      expect(await registry.execute('test', IPC.preferences, [partial])).toMatchObject({ ok: true });
    };
    await update({ commitMessageHarness: 'claude' });
    await update({ commitMessageModels: { ...settings.preferences.commitMessageModels, claude: 'opus' } });
    await update({ aiExecutablePaths: {} });
    expect(invalidateStatuses).not.toHaveBeenCalled();
    await update({ aiExecutablePaths: { codex: path.join(directory, 'codex') } });
    expect(invalidateStatuses).toHaveBeenCalledOnce();
    await update({ aiExecutablePaths: { ...settings.preferences.aiExecutablePaths } });
    expect(invalidateStatuses).toHaveBeenCalledOnce();
    await update({ aiExecutablePaths: {} });
    expect(invalidateStatuses).toHaveBeenCalledTimes(2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
