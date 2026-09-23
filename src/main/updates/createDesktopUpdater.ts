import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';
import { DesktopUpdater } from './DesktopUpdater';
import { installedUpdateRepository } from './update-eligibility';
import type { ApplicationProfile } from '../../shared/application-profile';

export async function createDesktopUpdater(profile: ApplicationProfile, requestClose: () => void): Promise<DesktopUpdater> {
  const unavailable = (reason?: string) => new DesktopUpdater(null, app.getVersion(), null, requestClose, reason);
  if (profile !== 'production') return unavailable('Dev builds are updated by downloading a new Dev ZIP.');
  if (!app.isPackaged || process.platform !== 'win32') return unavailable();
  try {
    const manifest: unknown = JSON.parse(await readFile(path.join(app.getAppPath(), 'opentig-build.json'), 'utf8'));
    const registry = await promisify(execFile)(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe'), [
      'query', 'HKCU\\Software\\OpenTig', '/v', 'InstallLocation',
    ], { timeout: 5_000, windowsHide: true });
    const directory = /^\s*InstallLocation\s+REG_SZ\s+(.+)$/mi.exec(registry.stdout)?.[1]?.trim() ?? null;
    const repository = installedUpdateRepository({ profile, packaged: app.isPackaged, platform: process.platform,
      version: app.getVersion(), executable: app.getPath('exe'), registeredDirectory: directory, manifest });
    if (!repository) return unavailable();
    // Loading this module is deliberately deferred until after the Dev/portable/installation guards.
    const { default: electronUpdater } = await import('electron-updater');
    return new DesktopUpdater(electronUpdater.autoUpdater, app.getVersion(), repository, requestClose);
  } catch { return unavailable('Automatic updates are unavailable for this installation. Download the latest installer from the official release page.'); }
}
