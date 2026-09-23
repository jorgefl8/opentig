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
    expect(source).not.toContain('CONNECTING_PAGE_URL');
    expect(source).toContain('ready-to-show');
    expect(source).toContain('backgroundThrottling: false');
    expect(source).toContain('if (placement.isMaximized) await maximizeWhileHidden(mainWindow)');
    expect(source.indexOf('maximizeWhileHidden')).toBeLessThan(source.indexOf('loadURL(server.origin)'));
    expect(source).toContain('isMaximized: mainWindow.isMaximized()');
  });

  it('paints the splash in index.html before React mounts', async () => {
    const html = await readFile(path.join(process.cwd(), 'index.html'), 'utf8');
    expect(html).toContain('id="boot-shell"');
    expect(html).toContain('/boot-theme.js');
    expect(html).toContain('position: fixed');
    expect(html).toContain('inset: 0');
  });

  it('keeps listener controls desktop-only while exposing session management without native tooltips', async () => {
    const settingsDialogSource = await readFile(path.join(process.cwd(), 'src', 'renderer', 'features', 'settings', 'SettingsDialog.tsx'), 'utf8');
    const settingsSource = await readFile(path.join(process.cwd(), 'src', 'renderer', 'features', 'settings', 'WebAccessSettings.tsx'), 'utf8');

    expect(settingsDialogSource).toContain('SETTINGS_SECTIONS.map');
    expect(settingsSource).toContain('window.opentigDesktop?.webAccess');
    expect(settingsSource).toContain('desktopApi && status');
    expect(settingsSource).toContain('loadOwnerSessions()');
    expect(settingsSource).not.toMatch(/\stitle=/);
    expect(settingsSource).toContain('The pairing code also works through a same-machine HTTPS tunnel.');
    expect(settingsSource).toContain('renameOwnerSession');
    expect(settingsSource).not.toContain('External HTTPS URL');
  });

  it('replaces a revoked browser session with pairing instructions', async () => {
    const source = await readFile(path.join(process.cwd(), 'src', 'renderer', 'components', 'ServerConnectionBoundary.tsx'), 'utf8');

    expect(source).toContain("if (state === 'auth-required')");
    expect(source).toContain('Generate a pairing code with');
    expect(source).toContain('href="/pair"');
  });

  it('uses the shared endpoint selector and hides healthy connection status', async () => {
    const settingsSource = await readFile(path.join(process.cwd(), 'src', 'renderer', 'features', 'settings', 'WebAccessSettings.tsx'), 'utf8');
    const boundarySource = await readFile(path.join(process.cwd(), 'src', 'renderer', 'components', 'ServerConnectionBoundary.tsx'), 'utf8');

    expect(settingsSource).toContain("from '@/components/ui/select'");
    expect(settingsSource).toContain('<SelectGroup>');
    expect(settingsSource).not.toContain('<select');
    expect(boundarySource).toContain("connectedBefore && state !== 'connected'");
    expect(boundarySource).toContain("if (!connectedBefore && (state === 'offline' || state === 'incompatible-version'))");
    expect(boundarySource).not.toContain('Starting OpenTig');
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
