import { mkdirSync, readlinkSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { applicationName, type ApplicationProfile } from '../../shared/application-profile';

interface ProfileApp {
  readonly isPackaged: boolean;
  getPath(name: 'appData' | 'userData'): string;
  setPath(name: 'userData' | 'sessionData', value: string): void;
  setName(name: string): void;
  setAppUserModelId(id: string): void;
}

/** Resolve before Electron sessions, the instance lock, or any persistence. */
export function configureDesktopProfile(app: ProfileApp, buildProfile: ApplicationProfile, platform: NodeJS.Platform): ApplicationProfile {
  if (buildProfile !== 'dev' && buildProfile !== 'production') throw new Error('Invalid OpenTig build profile.');
  const profile = app.isPackaged ? buildProfile : 'dev';
  if (profile === 'dev') {
    const appData = app.getPath('appData');
    const directory = path.join(appData, 'OpenTig Dev');
    const productionDirectory = path.join(appData, 'OpenTig');
    prepareDevDirectory(directory, productionDirectory);
    app.setPath('userData', directory);
    app.setPath('sessionData', directory);
  }
  // Production retains Electron's existing userData/sessionData paths.
  app.setName(applicationName(profile));
  if (platform === 'win32') app.setAppUserModelId(profile === 'dev' ? 'com.opentig.app.dev' : 'com.opentig.app');
  return profile;
}

/** Compare effective paths even when the leaf does not exist yet. Never create a production directory. */
function effectivePath(value: string, depth = 0): string {
  if (depth > 100) throw new Error('Too many data-directory redirects.');
  try { return realpathSync(value); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // realpath cannot resolve dangling links, which may still redirect future writes.
    let target: string | undefined;
    try { target = readlinkSync(value); }
    catch (linkError) {
      if (!['ENOENT', 'EINVAL'].includes((linkError as NodeJS.ErrnoException).code ?? '')) throw linkError;
    }
    if (target !== undefined) return effectivePath(path.resolve(path.dirname(value), target), depth + 1);
    const parent = path.dirname(value);
    if (parent === value) throw error;
    return path.join(effectivePath(parent, depth + 1), path.basename(value));
  }
}

function overlaps(left: string, right: string): boolean {
  const inside = (parent: string, child: string) => {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  };
  return inside(left, right) || inside(right, left);
}

export function prepareDevDirectory(directory: string, productionDirectory: string | readonly string[]): void {
  const production = (typeof productionDirectory === 'string' ? [productionDirectory] : productionDirectory)
    .map((value) => effectivePath(path.resolve(value)));
  const check = (candidate: string) => {
    const resolved = effectivePath(path.resolve(candidate));
    if (production.some((protectedPath) => overlaps(resolved, protectedPath))) {
      throw new Error('OpenTig Dev data overlaps production. Remove the data-directory redirection before starting Dev.');
    }
  };
  check(directory);
  // Protect app-owned persistence from existing redirected files/directories too.
  for (const entry of ['settings.json', 'settings.json.bak', 'desktop-window.json', 'desktop-window.json.bak', 'desktop-server.json', 'desktop-server.json.bak', 'ai-log.jsonl', 'problems.jsonl', 'runtime.json', 'server', 'server/admin-token', 'server/server-secret', 'server/sessions.json', 'logs', 'logs/server.log', 'Network', 'Local Storage', 'Session Storage', 'Cache', 'Code Cache']) {
    check(path.join(directory, entry));
  }
  mkdirSync(directory, { recursive: true });
  check(directory);
}
