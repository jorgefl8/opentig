import { containsPersonalPath } from '../packages/server/scripts/verify-build.mjs';
import { clientLicenseFiles } from './client-licenses.mts';
import { isDeepStrictEqual } from 'node:util';
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
  ...[...clientLicenseFiles, 'pdfjs/LICENSE', 'vscode-icons/LICENSE.txt'].map((file) => `dist/client/${file}`),
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
const expectedDependencies = cliPackage.dependencies;
if (packedPackage.name !== metadata.packageName
  || packedPackage.version !== metadata.version
  || packedPackage.private === true
  || packedPackage.type !== 'module'
  || packedPackage.bin?.opentig !== 'dist/bin.mjs'
  || packedPackage.engines?.node !== '>=24'
  || !isDeepStrictEqual(Object.keys(expectedDependencies).sort(), ['trash', 'ws'])
  || !isDeepStrictEqual(packedPackage.dependencies, expectedDependencies)) {
  throw new Error('Packed CLI metadata or runtime dependencies are invalid.');
}
for (const lifecycle of ['preinstall', 'install', 'postinstall', 'prepare']) {
  if (packedPackage.scripts?.[lifecycle]) throw new Error(`Packed CLI must not define a ${lifecycle} script.`);
}

for (const entry of ['package/dist/bin.mjs', 'package/dist/server.mjs', 'package/dist/utility.mjs']) {
  const { stdout } = await execute('tar', ['-xOf', tarballPath, entry], { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  const source = Buffer.from(stdout).toString('utf8');
  if (containsPersonalPath(source)) {
    throw new Error(`Absolute checkout path found in ${entry}.`);
  }
  if (/from\s*["'](?:electron|uiohook-napi|@electron-forge\/)/.test(source)) throw new Error(`Desktop import found in ${entry}.`);
}

// The opentig alias: the same version, only its command, and @opentig/cli at exactly that version.
const alias = metadata.alias;
if (alias?.packageName !== 'opentig' || alias.version !== metadata.version || alias.filename !== `opentig-${metadata.version}.tgz`) {
  throw new Error('The opentig alias is missing from the headless metadata or does not match the CLI version.');
}
const aliasPath = path.join(outputDirectory, alias.filename);
const aliasBytes = await readFile(aliasPath);
if (createHash('sha256').update(aliasBytes).digest('hex') !== alias.sha256
  || `sha512-${createHash('sha512').update(aliasBytes).digest('base64')}` !== alias.npmIntegrity) {
  throw new Error('The opentig alias tarball does not match its metadata.');
}
const { stdout: aliasListing } = await execute('tar', ['-tzf', aliasPath], { windowsHide: true });
const aliasFiles = aliasListing.split(/\r?\n/).filter(Boolean).map((entry) => entry.replace(/^package\//, '')).sort();
if (!isDeepStrictEqual(aliasFiles, ['LICENSE', 'README.md', 'bin.mjs', 'package.json'])
  || !isDeepStrictEqual(alias.files.map((file) => file.path).sort(), aliasFiles)) throw new Error(`Unexpected opentig alias content: ${aliasFiles.join(', ')}`);
const { stdout: aliasPackageBytes } = await execute('tar', ['-xOf', aliasPath, 'package/package.json'], { encoding: 'buffer', windowsHide: true });
const aliasPackage = JSON.parse(Buffer.from(aliasPackageBytes).toString('utf8'));
if (aliasPackage.name !== 'opentig' || aliasPackage.version !== metadata.version || aliasPackage.private === true
  || aliasPackage.type !== 'module' || !isDeepStrictEqual(aliasPackage.bin, { opentig: 'bin.mjs' })
  || !isDeepStrictEqual(aliasPackage.dependencies, { '@opentig/cli': metadata.version })
  || aliasPackage.engines?.node !== packedPackage.engines?.node || aliasPackage.scripts !== undefined) {
  throw new Error('Packed opentig alias metadata is invalid.');
}
if (packedPackage.exports?.['./bin'] !== './dist/bin.mjs') throw new Error('The CLI must export the command the opentig alias imports.');
const { stdout: aliasEntryBytes } = await execute('tar', ['-xOf', aliasPath, 'package/bin.mjs'], { encoding: 'buffer', windowsHide: true });
if (!/^import '@opentig\/cli\/bin';$/m.test(Buffer.from(aliasEntryBytes).toString('utf8'))) throw new Error('The opentig alias must run the @opentig/cli command.');

process.stdout.write(`${JSON.stringify({
  packageName: metadata.packageName,
  version: metadata.version,
  filename: metadata.filename,
  sha256,
  npmIntegrity: metadata.npmIntegrity,
  entryCount: metadata.entryCount,
  alias: { packageName: alias.packageName, filename: alias.filename, sha256: alias.sha256 },
}, null, 2)}\n`);

function isAllowedPath(filePath) {
  if (filePath === 'LICENSE' || filePath === 'README.md' || filePath === 'THIRD_PARTY_NOTICES.md' || filePath === 'package.json') return true;
  if (!filePath.startsWith('dist/')) return false;
  return !/(?:^|\/)(?:node_modules|tests?|coverage|cache|\.git)(?:\/|$)/i.test(filePath)
    && !/(?:\.node|\.map|\.ts|\.tsx)$/i.test(filePath)
    && !/(?:^|\/)(?:admin-token|server-secret|sessions\.json|settings\.json|runtime\.json|ai-log\.jsonl|problems\.jsonl)$/i.test(filePath);
}
