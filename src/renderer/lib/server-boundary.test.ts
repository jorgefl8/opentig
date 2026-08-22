import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPEN_TIG_DESKTOP_IPC } from '@shared/desktop-api';
import { OPEN_TIG_SERVER_COMMANDS } from '@shared/protocol';

describe('renderer/server boundary', () => {
  it('keeps server commands disjoint from narrow desktop IPC', () => {
    const desktop = new Set(Object.values(OPEN_TIG_DESKTOP_IPC));
    const server = Object.values(OPEN_TIG_SERVER_COMMANDS).map((definition) => definition.command);

    expect([...desktop].every((channel) => channel.startsWith('desktop:'))).toBe(true);
    expect(server.filter((channel) => desktop.has(channel as never))).toEqual([]);
  });

  it('contains no renderer domain bridge calls or domain ipcMain registration', async () => {
    const rendererFiles = await sourceFiles(path.join(process.cwd(), 'src', 'renderer'));
    const rendererOffenders: string[] = [];
    for (const file of rendererFiles.filter((file) => !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'))) {
      const source = await readFile(file, 'utf8');
      if (source.includes('window.opentig.')) rendererOffenders.push(path.relative(process.cwd(), file));
    }
    expect(rendererOffenders).toEqual([]);

    const ipcFiles = await sourceFiles(path.join(process.cwd(), 'src', 'main', 'ipc'));
    const registrations: string[] = [];
    for (const file of ipcFiles.filter((file) => !file.endsWith('.test.ts'))) {
      const source = await readFile(file, 'utf8');
      if (source.includes('ipcMain.handle')) registrations.push(path.basename(file));
    }
    expect(registrations).toEqual(['registerDesktopHandlers.ts']);
  });

  it('removed the temporary server IPC adapter', async () => {
    await expect(access(path.join(process.cwd(), 'src', 'main', 'ipc', 'registerServerIpcAdapter.ts'))).rejects.toThrow();
  });

  it('keeps Electron main free of the domain runtime and in-process server', async () => {
    const source = await readFile(path.join(process.cwd(), 'src', 'main.ts'), 'utf8');
    expect(source).not.toContain('packages/server');
    expect(source).not.toContain("./main/runtime/");
    expect(source).not.toContain("./main/git/");
    expect(source).not.toContain('runOpenTigServer');
    expect(source).toContain('utilityProcess.fork');
  });
});

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) ? [target] : [];
  }))).flat();
}
