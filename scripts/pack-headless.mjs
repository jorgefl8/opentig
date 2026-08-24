import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const execute = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(repositoryRoot, 'dist', 'headless');
const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
const { stdout } = await execute(process.execPath, [
  npmCli, 'pack', '--workspace', 'packages/server', '--pack-destination', outputDirectory, '--json',
], { cwd: repositoryRoot, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
const packed = JSON.parse(stdout);
if (!Array.isArray(packed) || packed.length !== 1 || packed[0]?.name !== '@opentig/cli') {
  throw new Error('Expected npm pack to produce exactly one @opentig/cli artifact.');
}
const artifact = packed[0];
const tarballPath = path.join(outputDirectory, artifact.filename);
const bytes = await readFile(tarballPath);
const metadata = {
  schemaVersion: 1,
  packageName: artifact.name,
  version: artifact.version,
  filename: artifact.filename,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  npmIntegrity: artifact.integrity,
  size: artifact.size,
  unpackedSize: artifact.unpackedSize,
  entryCount: artifact.entryCount,
  files: artifact.files.map(({ path: filePath, size, mode }) => ({ path: filePath, size, mode })),
};
await writeFile(path.join(outputDirectory, 'opentig-headless.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({
  packageName: metadata.packageName,
  version: metadata.version,
  filename: metadata.filename,
  sha256: metadata.sha256,
  npmIntegrity: metadata.npmIntegrity,
  entryCount: metadata.entryCount,
  metadata: 'opentig-headless.json',
}, null, 2)}\n`);
