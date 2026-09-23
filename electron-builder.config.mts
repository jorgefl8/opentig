import path from 'node:path';
import type { Configuration } from 'electron-builder';
import type { ApplicationProfile } from './src/shared/application-profile';
import { readFileSync } from 'node:fs';

const release = JSON.parse(readFileSync(new URL('./release.config.json', import.meta.url), 'utf8')) as { owner: string; repo: string; channel: string };

export interface DesktopPackageOptions {
  root: string;
  appDirectory: string;
  profile: ApplicationProfile;
  platform: 'win32' | 'linux' | 'darwin';
  arch: 'x64' | 'arm64';
  electronVersion: string;
  release?: boolean;
  signed?: boolean;
  publisherName?: string;
}

/** Explicit two-package layout: only the staged runtime is eligible for packaging. */
export function desktopPackageConfig(options: DesktopPackageOptions): Configuration {
  const dev = options.profile === 'dev';
  const productName = dev ? 'OpenTig Dev' : 'OpenTig';
  if (options.release && (dev || options.platform !== 'win32' || options.arch !== 'x64')) throw new Error('Releases require Windows x64 production.');
  if (options.signed && (!options.release || !options.publisherName)) throw new Error('Signed releases require release mode and a publisher name.');
  return {
    appId: dev ? 'com.opentig.app.dev' : 'com.opentig.app',
    productName,
    electronVersion: options.electronVersion,
    directories: {
      app: options.appDirectory,
      output: path.join(options.root, 'out', 'make', options.profile, `${options.platform}-${options.arch}`),
      buildResources: path.join(options.root, 'assets'),
    },
    files: ['.vite/build/**', 'package.json', 'opentig-build.json'],
    extraResources: [
      { from: path.join(options.root, 'assets', 'opentig.ico'), to: 'opentig.ico' },
      { from: path.join(options.root, 'packages/server/.resource/opentig-server'), to: 'opentig-server' },
      // Builder excludes a source root's node_modules even for extraResources.
      { from: path.join(options.root, 'packages/server/.resource/opentig-server/node_modules'), to: 'opentig-server/node_modules' },
    ],
    asar: true,
    asarUnpack: ['node_modules/**'],
    // uiohook-napi includes ABI-stable N-API binaries for each supported target.
    npmRebuild: false,
    nodeGypRebuild: false,
    electronFuses: {
      runAsNode: false,
      enableCookieEncryption: true,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
    },
    // Local package/make commands must never create a release or use a stable update feed.
    publish: options.release ? [{ provider: 'github', ...release, releaseType: 'draft' }] : null,
    forceCodeSigning: options.signed === true,
    electronUpdaterCompatibility: '>=2.16',
    artifactName: `${dev ? 'OpenTig-Dev' : 'OpenTig'}-\${version}-${options.platform}-\${arch}.\${ext}`,
    win: {
      target: [{ target: dev ? 'zip' : 'nsis', arch: [options.arch] }],
      executableName: productName,
      icon: path.join(options.root, 'assets', 'opentig.ico'),
      signExecutable: options.signed === true,
      verifyUpdateCodeSignature: options.signed === true,
      ...(options.signed ? { signtoolOptions: { publisherName: options.publisherName! } } : {}),
    },
    nsis: {
      oneClick: true,
      perMachine: false,
      deleteAppDataOnUninstall: false,
      createStartMenuShortcut: true,
      createDesktopShortcut: true,
      include: path.join(options.root, 'assets', 'installer.nsh'),
      artifactName: 'OpenTig-${version}-win32-${arch}-Setup.${ext}',
    },
    linux: { target: ['zip'], executableName: productName, category: 'Development' },
    mac: { target: ['zip'], category: 'public.app-category.developer-tools' },
  };
}
