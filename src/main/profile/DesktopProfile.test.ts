import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureDesktopProfile, prepareDevDirectory } from './DesktopProfile';

const directories: string[] = [];
function fixture(isPackaged = false) {
  const directory = mkdtempSync(path.join(tmpdir(), 'opentig-profile-'));
  directories.push(directory);
  const production = path.join(directory, 'OpenTig');
  mkdirSync(production);
  writeFileSync(path.join(production, 'settings.json'), 'production sentinel');
  const app = {
    isPackaged,
    getPath: () => directory,
    setPath: vi.fn(), setName: vi.fn(), setAppUserModelId: vi.fn(),
  };
  return { app, directory, production, dev: path.join(directory, 'OpenTig Dev') };
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('desktop profile isolation', () => {
  it('uses the same separate data and Chromium directory for source and packaged Dev', () => {
    const { app, dev, production } = fixture();
    expect(configureDesktopProfile(app, 'production', 'linux')).toBe('dev');
    expect(app.setPath.mock.calls).toEqual([['userData', dev], ['sessionData', dev]]);
    expect(app.setName).toHaveBeenCalledWith('OpenTig Dev');
    writeFileSync(path.join(dev, 'settings.json'), 'dev sentinel');
    app.isPackaged = true;
    expect(configureDesktopProfile(app, 'dev', 'win32')).toBe('dev');
    expect(app.setAppUserModelId).toHaveBeenCalledWith('com.opentig.app.dev');
    expect(readFileSync(path.join(dev, 'settings.json'), 'utf8')).toBe('dev sentinel');
    expect(readFileSync(path.join(production, 'settings.json'), 'utf8')).toBe('production sentinel');
  });

  it('preserves packaged production paths and rejects invalid build profiles', () => {
    const { app } = fixture(true);
    expect(configureDesktopProfile(app, 'production', 'win32')).toBe('production');
    expect(app.setPath).not.toHaveBeenCalled();
    expect(app.setAppUserModelId).toHaveBeenCalledWith('com.opentig.app');
    expect(() => configureDesktopProfile(app, 'invalid' as never, 'linux')).toThrow('Invalid');
  });

  it('refuses redirected Dev directories and app-owned files without modifying production', () => {
    const { app, production, dev } = fixture();
    symlinkSync(production, dev, 'junction');
    expect(() => configureDesktopProfile(app, 'dev', 'linux')).toThrow('overlaps production');
    expect(app.setPath).not.toHaveBeenCalled();
    rmSync(dev);
    mkdirSync(dev);
    symlinkSync(path.join(production, 'settings.json'), path.join(dev, 'settings.json'));
    expect(() => configureDesktopProfile(app, 'dev', 'linux')).toThrow('overlaps production');
    expect(readFileSync(path.join(production, 'settings.json'), 'utf8')).toBe('production sentinel');
  });

  it('refuses ancestor and descendant paths', () => {
    const { directory, production } = fixture();
    expect(() => prepareDevDirectory(directory, production)).toThrow('overlaps production');
    expect(() => prepareDevDirectory(path.join(production, 'dev'), production)).toThrow('overlaps production');
  });

  it('refuses dangling links into production before any future log write', () => {
    const { app, dev, production } = fixture();
    mkdirSync(dev);
    symlinkSync(path.join(production, 'ai-log.jsonl'), path.join(dev, 'ai-log.jsonl'));
    expect(() => configureDesktopProfile(app, 'dev', 'linux')).toThrow('overlaps production');
    expect(app.setPath).not.toHaveBeenCalled();
  });
});
