import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN_PACKAGES = [
  'electron',
  'uiohook-napi',
  '@electron-forge/',
  '@electron/packager',
];

export async function verifyServerBuild(serverDist) {
  await access(path.join(serverDist, 'server.mjs'));
  await access(path.join(serverDist, 'client', 'index.html'));
  const modules = await findModules(serverDist);
  if (modules.length === 0) throw new Error('Server build contains no JavaScript entry.');

  for (const modulePath of modules) {
    const source = await readFile(modulePath, 'utf8');
    for (const specifier of importedSpecifiers(source)) {
      if (specifier.endsWith('.node') || FORBIDDEN_PACKAGES.some((name) => specifier === name || specifier.startsWith(name))) {
        throw new Error(`Forbidden server import in ${path.relative(serverDist, modulePath)}: ${specifier}`);
      }
    }
  }
}

async function findModules(directory) {
  const modules = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) modules.push(...await findModules(target));
    else if (entry.name.endsWith('.mjs') || entry.name.endsWith('.js')) modules.push(target);
  }
  return modules;
}

function importedSpecifiers(source) {
  const specifiers = [];
  const pattern = /(?:from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  return specifiers;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  await verifyServerBuild(path.join(packageRoot, 'dist'));
}
