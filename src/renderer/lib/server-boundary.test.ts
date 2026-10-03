import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { describe, expect, it } from 'vitest';
import { OPEN_TIG_DESKTOP_IPC } from '@shared/desktop-api';
import { OPEN_TIG_SERVER_COMMANDS } from '@shared/protocol';
import { analyzeSource, sourceFiles } from '../../../scripts/test-support/source-analysis';

describe('renderer/server boundary', () => {
  it('keeps server commands disjoint from narrow desktop IPC', () => {
    const desktop = new Set(Object.values(OPEN_TIG_DESKTOP_IPC));
    const server = Object.values(OPEN_TIG_SERVER_COMMANDS).map((definition) => definition.command);

    expect([...desktop].every((channel) => channel.startsWith('desktop:'))).toBe(true);
    expect(server.filter((channel) => desktop.has(channel as never))).toEqual([]);
  });

  it('keeps renderer code free of Node, Electron, and the old domain bridge', async () => {
    const files = await sourceFiles(path.join(process.cwd(), 'src', 'renderer'));
    const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));
    const offenders = files.filter(({ imports, accesses }) =>
      imports.some((name) => name === 'electron' || name.startsWith('node:') || builtins.has(name) || /(?:^|\/)main\//.test(name))
      || accesses.includes('window.opentig'),
    ).map(({ file }) => path.relative(process.cwd(), file));
    expect(offenders).toEqual([]);
  });

  it('confines desktop IPC registration to the narrow handler module', async () => {
    const root = path.join(process.cwd(), 'src', 'main', 'ipc');
    const files = await sourceFiles(root);
    const registrations = files.filter(({ accesses }) => accesses.includes('ipcMain.handle'))
      .map(({ file }) => path.relative(root, file));
    expect(registrations).toEqual(['registerDesktopHandlers.ts']);
  });

  it('keeps Electron main free of domain runtime and in-process server dependencies', async () => {
    const main = analyzeSource(await readFile(path.join(process.cwd(), 'src', 'main.ts'), 'utf8'));
    expect(main.imports.filter((name) => /(?:^|\/)(?:packages\/server|main\/(?:runtime|git))(?:\/|$)/.test(name))).toEqual([]);
  });
});
