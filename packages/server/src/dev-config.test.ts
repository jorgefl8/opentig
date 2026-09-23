import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { devCliArguments } from './dev-config';
import { parseCliArguments } from './cli-config';

const directories: string[] = [];
function fixture() {
  const home = mkdtempSync(path.join(tmpdir(), 'opentig-web-dev-'));
  directories.push(home);
  return home;
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('web Dev launch configuration', () => {
  it('ignores production host/port/home overrides and keeps production settings untouched', () => {
    const home = fixture();
    const production = path.join(home, '.opentig');
    mkdirSync(production);
    writeFileSync(path.join(production, 'settings.json'), 'production sentinel');
    const environment = { OPENTIG_HOST: '0.0.0.0', OPENTIG_PORT: '6767', OPENTIG_HOME: production };
    const config = parseCliArguments(devCliArguments(['serve'], environment, home), {});
    expect(config).toMatchObject({ command: 'serve', home: path.join(home, '.opentig-dev'), host: '127.0.0.1', port: 6867, openBrowser: false });
    expect(readFileSync(path.join(production, 'settings.json'), 'utf8')).toBe('production sentinel');
    expect(existsSync(path.join(home, '.opentig-dev', 'settings.json'))).toBe(false);
    expect(devCliArguments(['pair'], environment, home)).toEqual(['pair', '--home', config.home]);
  });

  it.each([['serve', '--home', 'prod'], ['serve', '--port', '6767'], ['service'], ['start']])('rejects redirects or unsupported commands: %j', (...args) => {
    const home = fixture();
    expect(() => devCliArguments(args, {}, home)).toThrow('without additional options');
    expect(existsSync(path.join(home, '.opentig-dev'))).toBe(false);
  });

  it('refuses a Dev home redirected to production, including a custom not-yet-created home', () => {
    const home = fixture();
    const production = path.join(home, 'custom-prod');
    symlinkSync(production, path.join(home, '.opentig-dev'), 'junction');
    expect(() => devCliArguments(['serve'], { OPENTIG_HOME: production }, home)).toThrow('overlaps production');
    expect(existsSync(production)).toBe(false);
  });

  it('refuses redirection into Electron Dev data or production admin credentials', () => {
    const home = fixture();
    const desktop = path.join(home, '.config', 'OpenTig Dev');
    mkdirSync(desktop, { recursive: true });
    const dev = path.join(home, '.opentig-dev');
    symlinkSync(desktop, dev, 'junction');
    expect(() => devCliArguments(['serve'], {}, home, 'linux')).toThrow('overlaps production');
    rmSync(dev);
    mkdirSync(path.join(dev, 'server'), { recursive: true });
    symlinkSync(path.join(home, '.opentig', 'server', 'admin-token'), path.join(dev, 'server', 'admin-token'));
    expect(() => devCliArguments(['pair'], {}, home, 'linux')).toThrow('overlaps production');
  });
});
