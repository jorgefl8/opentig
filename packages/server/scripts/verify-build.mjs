import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';

const FORBIDDEN_PACKAGES = [
  'electron',
  'uiohook-napi',
  '@electron-forge/',
  '@electron/packager',
];
const NODE_BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

export async function verifyServerBuild(serverDist) {
  await access(path.join(serverDist, 'bin.mjs'));
  await access(path.join(serverDist, 'server.mjs'));
  await access(path.join(serverDist, 'utility.mjs'));
  await access(path.join(serverDist, 'client', 'index.html'));
  const manifest = JSON.parse(await readFile(path.join(serverDist, 'manifest.json'), 'utf8'));
  if (manifest.packageName !== '@opentig/cli'
    || typeof manifest.appVersion !== 'string'
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.appVersion)
    || !Number.isSafeInteger(manifest.protocolVersion)
    || manifest.protocolVersion < 1
    || manifest.cliEntrypoint !== 'bin.mjs'
    || manifest.serverEntrypoint !== 'server.mjs'
    || manifest.utilityEntrypoint !== 'utility.mjs'
    || manifest.clientEntrypoint !== 'client/index.html') {
    throw new Error('OpenTig server build manifest is invalid.');
  }
  const files = await findFiles(serverDist);
  const rejected = files.filter((filePath) => filePath.endsWith('.node') || filePath.endsWith('.map'));
  if (rejected.length > 0) throw new Error(`Forbidden server artifact: ${path.relative(serverDist, rejected[0])}`);
  const modules = await findModules(serverDist);
  if (modules.length === 0) throw new Error('Server build contains no JavaScript entry.');

  for (const modulePath of modules) {
    const source = await readFile(modulePath, 'utf8');
    const relativeModule = path.relative(serverDist, modulePath).replace(/\\/g, '/');
    const isClientModule = relativeModule.startsWith('client/');
    if (/[A-Za-z]:[\\/]Users[\\/]/i.test(source) || source.includes('/home/') || source.includes('/Users/')) {
      throw new Error(`Absolute checkout path in ${path.relative(serverDist, modulePath)}.`);
    }
    for (const specifier of importedSpecifiers(source)) {
      if (specifier.endsWith('.node') || FORBIDDEN_PACKAGES.some((name) => specifier === name || specifier.startsWith(name))) {
        throw new Error(`Forbidden server import in ${path.relative(serverDist, modulePath)}: ${specifier}`);
      }
      if (!isClientModule && !specifier.startsWith('.') && !NODE_BUILTINS.has(specifier) && specifier !== 'trash' && specifier !== 'ws') {
        throw new Error(`Undeclared external server import in ${path.relative(serverDist, modulePath)}: ${specifier}`);
      }
    }
  }

  const bin = await readFile(path.join(serverDist, 'bin.mjs'), 'utf8');
  if (!bin.startsWith('#!/usr/bin/env node')) throw new Error('OpenTig CLI entry is missing its Node shebang.');
}

async function findFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findFiles(target));
    else files.push(target);
  }
  return files;
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
