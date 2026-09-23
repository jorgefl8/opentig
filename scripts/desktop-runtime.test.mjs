import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stageRuntimeDependencies } from './desktop-runtime.mjs';
import { packageOptions } from './package-desktop.mjs';
import { desktopPackageConfig } from '../electron-builder.config.mts';

const fixtures = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'opentig-package-test-'));
  fixtures.push(root);
  const add = async (name, metadata = {}) => {
    const directory = path.join(root, 'node_modules', name);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...metadata }));
  };
  return { root, add, output: path.join(root, 'staged') };
}

describe('runtime dependency staging', () => {
  it('preserves nested versions, follows transitive dependencies and excludes unrelated build tools', async () => {
    const { root, add, output } = await fixture();
    await add('uiohook-napi', { dependencies: { shared: '1' } });
    await add('electron-updater');
    await add('trash', { dependencies: { shared: '2' }, optionalDependencies: { absent: '*' } });
    await add('shared', { version: '1.0.0', dependencies: { leaf: '*' } });
    await add('leaf');
    await add('trash/node_modules/shared', { version: '2.0.0' });
    await add('unrelated-build-tool');
    await stageRuntimeDependencies(root, output);
    expect((await readdir(path.join(output, 'node_modules'))).sort()).toEqual(['electron-updater', 'leaf', 'shared', 'trash', 'uiohook-napi']);
    expect(JSON.parse(await readFile(path.join(output, 'node_modules/trash/node_modules/shared/package.json'), 'utf8')).version).toBe('2.0.0');
    expect(JSON.parse(await readFile(path.join(output, 'node_modules/shared/package.json'), 'utf8')).version).toBe('1.0.0');
  });
  it('fails before producing a package when a required dependency is missing', async () => {
    const { root, add, output } = await fixture();
    await add('uiohook-napi', { dependencies: { missing: '*' } });
    await expect(stageRuntimeDependencies(root, output)).rejects.toThrow('Missing runtime dependency: missing');
  });
});

describe('distribution boundaries', () => {
  it('allows a Linux Dev ZIP and a cross-built stable Windows installer', () => {
    expect(packageOptions(['make'], { OPENTIG_BUILD_PROFILE: 'dev' }, 'linux', 'x64')).toMatchObject({ profile: 'dev', distribution: 'zip' });
    expect(packageOptions(['make', '--platform=win32', '--arch=x64'], {}, 'linux', 'arm64')).toMatchObject({ platform: 'win32', arch: 'x64', distribution: 'installer' });
    expect(() => packageOptions(['make'], {}, 'linux', 'x64')).toThrow('Windows x64');
    expect(() => packageOptions(['make', '--publish=always'])).toThrow('Unsupported packaging option');
    expect(() => packageOptions([], { OPENTIG_BUILD_PROFILE: 'typo' })).toThrow('Invalid');
  });
  it('keeps stable and Dev identities distinct and local builds unpublished', () => {
    const options = { root: '/checkout', appDirectory: '/stage', platform: 'win32', arch: 'x64', electronVersion: '43.1.1' };
    const stable = desktopPackageConfig({ ...options, profile: 'production' });
    const dev = desktopPackageConfig({ ...options, profile: 'dev' });
    expect(stable.appId).not.toBe(dev.appId);
    expect(stable.productName).toBe('OpenTig');
    expect(dev.productName).toBe('OpenTig Dev');
    expect(stable.nsis.deleteAppDataOnUninstall).toBe(false);
    expect(stable.publish).toBeNull();
    expect(dev.publish).toBeNull();
    expect(stable.electronFuses.runAsNode).toBe(false);
    expect(dev.electronFuses.runAsNode).toBe(false);
  });
  it('requires explicit release mode, signing credentials and a stable installer before adding a feed', () => {
    expect(() => packageOptions(['make', '--release'], {}, 'win32', 'x64')).toThrow('Release signing requires');
    expect(() => packageOptions(['make', '--release'], { OPENTIG_BUILD_PROFILE: 'dev' }, 'win32', 'x64')).toThrow('production');
    const options = packageOptions(['make', '--release'], { CSC_LINK: 'fixture-certificate', OPENTIG_PUBLISHER_NAME: 'OpenTig Test' }, 'win32', 'x64');
    const config = desktopPackageConfig({ ...options, root: '/checkout', appDirectory: '/stage', electronVersion: '43.1.1' });
    expect(config.forceCodeSigning).toBe(true);
    expect(config.publish).toEqual([{ provider: 'github', owner: 'jorgefl8', repo: 'opentig', channel: 'latest', releaseType: 'draft' }]);
    expect(config.win.signtoolOptions.publisherName).toBe('OpenTig Test');
  });
});
