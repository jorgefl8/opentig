import { access, cp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const RUNTIME_DEPENDENCIES = ['uiohook-napi', 'trash', 'electron-updater'];

/** Preserve npm's nested dependency layout instead of maintaining a hand-written transitive list. */
export async function stageRuntimeDependencies(root, destination) {
  const modules = await realpath(path.join(root, 'node_modules'));
  const copied = new Set();
  const resolvePackage = async (name, from) => {
    let directory = from;
    for (;;) {
      const candidate = path.join(directory, 'node_modules', name);
      try { await access(path.join(candidate, 'package.json')); return await realpath(candidate); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const parent = path.dirname(directory);
      if (parent === directory) throw new Error(`Missing runtime dependency: ${name}`);
      directory = parent;
    }
  };
  const copy = async (name, from) => {
    const source = await resolvePackage(name, from);
    if (copied.has(source)) return;
    const relative = path.relative(modules, source);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Runtime dependency escapes node_modules: ${name}`);
    copied.add(source);
    const target = path.join(destination, 'node_modules', relative);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { recursive: true, dereference: true });
    const metadata = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
    for (const dependency of Object.keys(metadata.dependencies ?? {})) await copy(dependency, source);
    for (const dependency of Object.keys(metadata.optionalDependencies ?? {})) {
      try { await resolvePackage(dependency, source); }
      catch (error) { if (error.message.startsWith('Missing runtime dependency:')) continue; throw error; }
      await copy(dependency, source);
    }
  };
  for (const name of RUNTIME_DEPENDENCIES) await copy(name, root);
}

export async function stageDesktopApp(root, options) {
  const directory = path.join(root, '.vite', 'desktop', `${options.profile}-${options.platform}-${options.arch}`);
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const release = JSON.parse(await readFile(path.join(root, 'release.config.json'), 'utf8'));
  await rm(directory, { recursive: true, force: true });
  await mkdir(path.join(directory, '.vite'), { recursive: true });
  await cp(path.join(root, '.vite', 'build'), path.join(directory, '.vite', 'build'), { recursive: true });
  await writeFile(path.join(directory, 'package.json'), `${JSON.stringify({
    name: options.profile === 'dev' ? 'opentig-dev' : 'opentig',
    productName: options.profile === 'dev' ? 'OpenTig Dev' : 'OpenTig',
    version: metadata.version,
    description: metadata.description,
    author: metadata.author,
    license: metadata.license,
    main: '.vite/build/main.js',
    private: true,
    dependencies: Object.fromEntries(RUNTIME_DEPENDENCIES.map((name) => [name, metadata.dependencies[name]])),
  }, null, 2)}\n`);
  await writeFile(path.join(directory, 'opentig-build.json'), `${JSON.stringify({
    version: metadata.version, profile: options.profile, distribution: options.distribution,
    platform: options.platform, arch: options.arch,
    release: options.release === true,
    signedRelease: options.signed === true,
    updateRepository: options.release ? `${release.owner}/${release.repo}` : null,
  }, null, 2)}\n`);
  await stageRuntimeDependencies(root, directory);
  await access(path.join(directory, 'node_modules', 'uiohook-napi', 'prebuilds', `${options.platform}-${options.arch}`, 'uiohook-napi.node'));
  return directory;
}
