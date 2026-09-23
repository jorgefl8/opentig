import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractFile, listPackage } from '@electron/asar';
import { getCurrentFuseWire, FuseV1Options, FuseVersion } from '@electron/fuses';
import { packagedPaths } from './packaged-paths.mjs';
import { verifyServerBuild } from '../packages/server/scripts/verify-build.mjs';

const { profile, platform, arch, productName, resources, executable } = packagedPaths();
const archive = path.join(resources, 'app.asar');
const files = listPackage(archive).map((file) => file.replaceAll('\\', '/'));
const metadata = JSON.parse(extractFile(archive, 'package.json').toString());
const manifest = JSON.parse(extractFile(archive, 'opentig-build.json').toString());
assert.equal(metadata.productName, productName);
assert.equal(metadata.main, '.vite/build/main.js');
assert.deepEqual(Object.keys(metadata.dependencies).sort(), ['electron-updater', 'trash', 'uiohook-napi']);
assert.equal(manifest.profile, profile);
assert.equal(manifest.platform, platform);
assert.equal(manifest.arch, arch);
assert.ok(['directory', 'zip', 'installer'].includes(manifest.distribution));
assert.ok(profile !== 'dev' || manifest.distribution !== 'installer');
assert.ok(profile !== 'dev' || (manifest.release === false && manifest.signedRelease === false && manifest.updateRepository === null));
const updateConfig = path.join(resources, 'app-update.yml');
if (manifest.release) {
  assert.equal(profile, 'production');
  assert.equal(platform, 'win32');
  await access(updateConfig);
} else {
  await assert.rejects(access(updateConfig), { code: 'ENOENT' });
}
assert.ok(files.includes('/.vite/build/main.js'));
assert.ok(files.includes('/.vite/build/preload.js'));
assert.deepEqual(files.filter((file) => file.startsWith('/.vite/build/')).sort(), ['/.vite/build/main.js', '/.vite/build/preload.js']);
assert.ok(!files.some((file) => file.startsWith('/.vite/renderer') || file.startsWith('/src/') || file.startsWith('/node_modules/electron/')));
const modules = path.join(resources, 'app.asar.unpacked/node_modules');
await access(path.join(modules, 'uiohook-napi', 'prebuilds', `${platform}-${arch}`, 'uiohook-napi.node'));
await access(path.join(resources, 'opentig.ico'));
const trash = await import(pathToFileURL(path.join(modules, 'trash/index.js')).href);
assert.equal(typeof trash.default, 'function', 'Packaged trash dependency closure must load independently');
if (platform === 'win32') await access(path.join(modules, 'trash/lib/windows-trash.exe'));
await verifyServerBuild(path.join(resources, 'opentig-server'));
await access(path.join(resources, 'opentig-server/node_modules/ws/index.js'));
// The shared HTML receives its profile at runtime; verify:packaged-server checks the served identity.
const fuses = await getCurrentFuseWire(executable);
assert.equal(fuses.version, FuseVersion.V1);
for (const fuse of [FuseV1Options.RunAsNode, FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseV1Options.EnableNodeCliInspectArguments]) assert.equal(fuses[fuse], 0x30);
for (const fuse of [FuseV1Options.EnableCookieEncryption, FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseV1Options.OnlyLoadAppFromAsar]) assert.equal(fuses[fuse], 0x31);
console.log(`PACKAGED_DESKTOP_OK ${productName} ${platform}-${arch} (${manifest.distribution})`);
