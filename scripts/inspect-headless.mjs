import { execFile } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const execute = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(repositoryRoot, 'dist', 'headless');
const metadata = JSON.parse(await readFile(path.join(outputDirectory, 'opentig-headless.json'), 'utf8'));
const rootPackage = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
const cliPackage = JSON.parse(await readFile(path.join(repositoryRoot, 'packages', 'server', 'package.json'), 'utf8'));
const buildManifest = JSON.parse(await readFile(path.join(repositoryRoot, 'packages', 'server', 'dist', 'manifest.json'), 'utf8'));
const protocol = JSON.parse(await readFile(path.join(repositoryRoot, 'src', 'shared', 'protocol-version.json'), 'utf8'));
const tarballPath = path.join(outputDirectory, metadata.filename);
const bytes = await readFile(tarballPath);

if (metadata.schemaVersion !== 1 || metadata.packageName !== '@opentig/cli') throw new Error('Invalid headless artifact metadata.');
if (rootPackage.version !== cliPackage.version
  || cliPackage.version !== metadata.version
  || metadata.version !== buildManifest.appVersion
  || buildManifest.protocolVersion !== protocol.protocolVersion) {
  throw new Error('Desktop, CLI, build manifest, or protocol versions do not match.');
}
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${metadata.version}`) {
  throw new Error(`Release tag must be v${metadata.version}.`);
}
const sha256 = createHash('sha256').update(bytes).digest('hex');
if (sha256 !== metadata.sha256) throw new Error('Headless tarball SHA-256 does not match its metadata.');

const required = new Set([
  'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md', 'package.json',
  'dist/bin.mjs', 'dist/service-update.mjs', 'dist/server.mjs', 'dist/utility.mjs', 'dist/manifest.json', 'dist/client/index.html',
]);
for (const file of metadata.files) {
  required.delete(file.path);
  if (!isAllowedPath(file.path)) throw new Error(`Rejected headless package path: ${file.path}`);
}
if (required.size > 0) throw new Error(`Missing headless package content: ${[...required].join(', ')}`);
if (metadata.files.length !== metadata.entryCount) throw new Error('Headless package file count does not match metadata.');

const { stdout: listing } = await execute('tar', ['-tzf', tarballPath], { maxBuffer: 32 * 1024 * 1024, windowsHide: true });
const tarFiles = listing.split(/\r?\n/).filter(Boolean).map((entry) => entry.replace(/^package\//, ''));
const expectedFiles = metadata.files.map((file) => file.path);
if (JSON.stringify(tarFiles.sort()) !== JSON.stringify(expectedFiles.sort())) throw new Error('Tarball entries do not match npm pack metadata.');

const { stdout: packedPackageBytes } = await execute('tar', ['-xOf', tarballPath, 'package/package.json'], {
  encoding: 'buffer', maxBuffer: 1024 * 1024, windowsHide: true,
});
const packedPackage = JSON.parse(Buffer.from(packedPackageBytes).toString('utf8'));
const expectedDependencies = { trash: '10.1.1', ws: '8.21.3' };
if (packedPackage.name !== metadata.packageName
  || packedPackage.version !== metadata.version
  || packedPackage.private === true
  || packedPackage.type !== 'module'
  || packedPackage.bin?.opentig !== 'dist/bin.mjs'
  || packedPackage.engines?.node !== '>=24'
  || JSON.stringify(packedPackage.dependencies) !== JSON.stringify(expectedDependencies)) {
  throw new Error('Packed CLI metadata or runtime dependencies are invalid.');
}
for (const lifecycle of ['preinstall', 'install', 'postinstall', 'prepare']) {
  if (packedPackage.scripts?.[lifecycle]) throw new Error(`Packed CLI must not define a ${lifecycle} script.`);
}

for (const entry of ['package/dist/bin.mjs', 'package/dist/server.mjs', 'package/dist/utility.mjs']) {
  const { stdout } = await execute('tar', ['-xOf', tarballPath, entry], { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  const source = Buffer.from(stdout).toString('utf8');
  if (/[A-Za-z]:[\\/]Users[\\/]/i.test(source) || source.includes('/home/') || source.includes('/Users/')) {
    throw new Error(`Absolute checkout path found in ${entry}.`);
  }
  if (/from\s*["'](?:electron|uiohook-napi|@electron-forge\/)/.test(source)) throw new Error(`Desktop import found in ${entry}.`);
}

process.stdout.write(`${JSON.stringify({
  packageName: metadata.packageName,
  version: metadata.version,
  filename: metadata.filename,
  sha256,
  npmIntegrity: metadata.npmIntegrity,
  entryCount: metadata.entryCount,
}, null, 2)}\n`);

function isAllowedPath(filePath) {
  if (filePath === 'LICENSE' || filePath === 'README.md' || filePath === 'THIRD_PARTY_NOTICES.md' || filePath === 'package.json') return true;
  if (!filePath.startsWith('dist/')) return false;
  return !/(?:^|\/)(?:node_modules|tests?|coverage|cache|\.git)(?:\/|$)/i.test(filePath)
    && !/(?:\.node|\.map|\.ts|\.tsx)$/i.test(filePath)
    && !/(?:^|\/)(?:admin-token|server-secret|sessions\.json|settings\.json|runtime\.json|ai-log\.jsonl|problems\.jsonl)$/i.test(filePath);
}
