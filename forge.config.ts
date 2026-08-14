import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';
import type { ForgeConfig } from '@electron-forge/shared-types';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'JustGit',
    executableName: 'JustGit',
    appBundleId: 'dev.justgit.app',
    // The Vite plugin bundles JavaScript dependencies and otherwise excludes
    // node_modules. Keep the native keyboard hook and its loader alongside the
    // bundle so Electron can load the platform binary at runtime.
    ignore: (file) => {
      if (!file) return false;
      return !(file.startsWith('/.vite')
        || file === '/node_modules'
        || file.startsWith('/node_modules/uiohook-napi')
        || file.startsWith('/node_modules/node-gyp-build'));
    },
  },
  // uiohook-napi ships an ABI-stable N-API binary for Windows. Rebuilding it
  // would unnecessarily require a local Visual Studio C++ toolchain.
  rebuildConfig: { onlyModules: [] },
  makers: [
    new MakerSquirrel({ name: 'JustGit', setupExe: 'JustGit-Setup.exe' }),
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
