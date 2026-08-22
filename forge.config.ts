import { FuseV1Options, FuseVersion } from '@electron/fuses';
import path from 'node:path';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';
import type { ForgeConfig } from '@electron-forge/shared-types';

const appIcon = path.resolve(__dirname, 'assets', 'opentig.ico');
const trashRuntimeModules = new Set([
  '@nodelib/fs.scandir',
  '@nodelib/fs.stat',
  '@nodelib/fs.walk',
  '@sindresorhus/df',
  '@sindresorhus/merge-streams',
  '@stroncium/procfs',
  'braces',
  'chunkify',
  'cross-spawn',
  'end-of-stream',
  'execa',
  'fast-glob',
  'fastq',
  'fill-range',
  'get-stream',
  'glob-parent',
  'globby',
  'ignore',
  'is-docker',
  'is-extglob',
  'is-glob',
  'is-inside-container',
  'is-number',
  'is-path-inside',
  'is-stream',
  'is-wsl',
  'merge-stream',
  'merge2',
  'micromatch',
  'mimic-fn',
  'mount-point',
  'move-file',
  'npm-run-path',
  'once',
  'onetime',
  'os-homedir',
  'p-finally',
  'p-map',
  'path-key',
  'path-type',
  'picomatch',
  'pify',
  'pinkie',
  'pinkie-promise',
  'powershell-utils',
  'pump',
  'queue-microtask',
  'reusify',
  'run-parallel',
  'signal-exit',
  'slash',
  'strip-final-newline',
  'to-regex-range',
  'trash',
  'unicorn-magic',
  'user-home',
  'wrappy',
  'wsl-utils',
  'xdg-basedir',
  'xdg-trashdir',
]);

function isTrashRuntimeModule(file: string): boolean {
  const normalized = file.replace(/\\/g, '/');
  for (const moduleName of trashRuntimeModules) {
    const moduleRoot = `/node_modules/${moduleName}`;
    if (normalized === moduleRoot || normalized.startsWith(`${moduleRoot}/`)) return true;
  }
  return false;
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: { unpackDir: 'node_modules' },
    name: 'OpenTig',
    executableName: 'OpenTig',
    appBundleId: 'com.opentig.app',
    icon: appIcon,
    extraResource: appIcon,
    // The Vite plugin bundles JavaScript dependencies and otherwise excludes
    // node_modules. Keep the native keyboard hook plus the externalized Trash
    // dependency closure alongside the bundle.
    ignore: (file) => {
      if (!file) return false;
      return !(file.startsWith('/.vite')
        || file === '/node_modules'
        || file.startsWith('/node_modules/uiohook-napi')
        || file.startsWith('/node_modules/node-gyp-build')
        || isTrashRuntimeModule(file));
    },
  },
  // uiohook-napi ships an ABI-stable N-API binary for Windows. Rebuilding it
  // would unnecessarily require a local Visual Studio C++ toolchain.
  rebuildConfig: { onlyModules: [] },
  makers: [
    new MakerSquirrel({ name: 'OpenTig', setupExe: 'OpenTig-Setup.exe', setupIcon: appIcon }),
    new MakerZIP({}, ['win32']),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        { entry: 'src/main.ts', config: 'vite.main.config.ts', target: 'main' },
        { entry: 'src/preload.ts', config: 'vite.preload.config.ts', target: 'preload' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
