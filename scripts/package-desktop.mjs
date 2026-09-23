import { readFile, rm, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, Platform, Arch } from 'electron-builder';
import { desktopPackageConfig } from '../electron-builder.config.mts';
import { buildDesktop, repositoryRoot } from './build-desktop.mjs';
import { stageDesktopApp } from './desktop-runtime.mjs';

export function packageOptions(args, environment = process.env, hostPlatform = process.platform, hostArch = process.arch) {
  const [command = 'package', ...flags] = args;
  if (!['package', 'make'].includes(command)) throw new Error('Expected package or make.');
  const profile = environment.OPENTIG_BUILD_PROFILE ?? 'production';
  if (!['dev', 'production'].includes(profile)) throw new Error('Invalid OPENTIG_BUILD_PROFILE.');
  let platform = hostPlatform;
  let arch = hostArch;
  let release = false;
  let signed = false;
  for (const flag of flags) {
    if (flag === '--release') release = true;
    else if (flag === '--signed') signed = true;
    else if (flag.startsWith('--platform=')) platform = flag.slice('--platform='.length);
    else if (flag.startsWith('--arch=')) arch = flag.slice('--arch='.length);
    else throw new Error(`Unsupported packaging option: ${flag}`);
  }
  if (!['win32', 'linux', 'darwin'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw new Error('Unsupported desktop target.');
  if (command === 'make' && profile === 'production' && (platform !== 'win32' || arch !== 'x64')) {
    throw new Error('The stable installer targets Windows x64. Use make -- --platform=win32 --arch=x64, or make:dev for a native ZIP.');
  }
  const publisherName = environment.OPENTIG_PUBLISHER_NAME?.trim();
  if (release && (command !== 'make' || profile !== 'production' || platform !== 'win32' || arch !== 'x64')) throw new Error('Release mode requires a production Windows x64 installer.');
  if (signed && !release) throw new Error('--signed requires --release.');
  if (signed && (!publisherName || !(environment.WIN_CSC_LINK || environment.CSC_LINK))) throw new Error('Release signing requires OPENTIG_PUBLISHER_NAME and CSC_LINK (or WIN_CSC_LINK).');
  return { command, profile, platform, arch, release, signed, publisherName, distribution: command === 'package' ? 'directory' : profile === 'dev' ? 'zip' : 'installer' };
}

export async function packageDesktop(options) {
  await buildDesktop(options.profile);
  const appDirectory = await stageDesktopApp(repositoryRoot, options);
  const electron = JSON.parse(await readFile(path.join(repositoryRoot, 'node_modules/electron/package.json'), 'utf8'));
  const config = desktopPackageConfig({ ...options, root: repositoryRoot, appDirectory, electronVersion: electron.version });
  let unpackedDirectory;
  config.afterPack = async (context) => { unpackedDirectory = context.appOutDir; };
  const platform = { win32: Platform.WINDOWS, linux: Platform.LINUX, darwin: Platform.MAC }[options.platform];
  const target = options.command === 'package' ? 'dir' : options.profile === 'dev' ? 'zip' : 'nsis';
  const artifacts = await build({
    projectDir: repositoryRoot, config, publish: 'never',
    targets: platform.createTarget(target, Arch[options.arch]),
  });
  if (!unpackedDirectory) throw new Error('Builder did not produce an unpacked application.');
  const productName = options.profile === 'dev' ? 'OpenTig Dev' : 'OpenTig';
  const packagedDirectory = path.join(repositoryRoot, 'out', `${productName}-${options.platform}-${options.arch}`);
  await rm(packagedDirectory, { recursive: true, force: true });
  await rename(unpackedDirectory, packagedDirectory);
  console.log(`Packaged ${productName}: ${packagedDirectory}`);
  for (const artifact of artifacts) console.log(`Artifact: ${artifact}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await packageDesktop(packageOptions(process.argv.slice(2)));
}
