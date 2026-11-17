import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { bundledNpm } from './bundled-npm.mjs';

const execute = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(repositoryRoot, 'dist', 'headless');
// The CLI is published with npm, so pack it with the npm bundled with Node.js
// rather than the workspace package manager that runs this script.
const npmCli = bundledNpm().cli;

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
const { stdout } = await execute(process.execPath, [
  npmCli, 'pack', '--pack-destination', outputDirectory, '--json',
], { cwd: path.join(repositoryRoot, 'packages', 'server'), maxBuffer: 32 * 1024 * 1024, windowsHide: true });
const packed = JSON.parse(stdout);
if (!Array.isArray(packed) || packed.length !== 1 || packed[0]?.name !== '@opentig/cli') {
  throw new Error('Expected npm pack to produce exactly one @opentig/cli artifact.');
}
const artifact = packed[0];
const tarballPath = path.join(outputDirectory, artifact.filename);
const bytes = await readFile(tarballPath);
const alias = await packAlias(artifact.version);
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
  alias,
};
await writeFile(path.join(outputDirectory, 'opentig-headless.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({
  packageName: metadata.packageName,
  version: metadata.version,
  filename: metadata.filename,
  sha256: metadata.sha256,
  npmIntegrity: metadata.npmIntegrity,
  entryCount: metadata.entryCount,
  alias: { packageName: alias.packageName, filename: alias.filename, sha256: alias.sha256, npmIntegrity: alias.npmIntegrity },
  metadata: 'opentig-headless.json',
}, null, 2)}\n`);

// The opentig package is the CLI's short name: its command imports @opentig/cli
// at exactly the same version, so it is built from the CLI's own manifest.
async function packAlias(version) {
  const serverDirectory = path.join(repositoryRoot, 'packages', 'server');
  const cli = JSON.parse(await readFile(path.join(serverDirectory, 'package.json'), 'utf8'));
  const source = await mkdtemp(path.join(tmpdir(), 'opentig-alias-'));
  try {
    await copyFile(path.join(serverDirectory, 'alias', 'bin.mjs'), path.join(source, 'bin.mjs'));
    await copyFile(path.join(serverDirectory, 'alias', 'README.md'), path.join(source, 'README.md'));
    await copyFile(path.join(serverDirectory, 'LICENSE'), path.join(source, 'LICENSE'));
    await writeFile(path.join(source, 'package.json'), `${JSON.stringify({
      name: 'opentig',
      version,
      description: `Short name for ${cli.name}: ${cli.description}`,
      type: 'module',
      bin: { opentig: 'bin.mjs' },
      files: ['bin.mjs', 'README.md', 'LICENSE'],
      dependencies: { [cli.name]: version },
      engines: cli.engines,
      os: cli.os,
      keywords: cli.keywords,
      author: cli.author,
      license: cli.license,
      repository: { ...cli.repository, directory: 'packages/server/alias' },
      bugs: cli.bugs,
      homepage: cli.homepage,
      publishConfig: { access: 'public' },
    }, null, 2)}\n`, 'utf8');
    const { stdout: aliasOutput } = await execute(process.execPath, [
      npmCli, 'pack', '--pack-destination', outputDirectory, '--json',
    ], { cwd: source, maxBuffer: 1024 * 1024, windowsHide: true });
    const [aliasArtifact, ...extra] = JSON.parse(aliasOutput);
    if (extra.length || aliasArtifact?.name !== 'opentig' || aliasArtifact.version !== version) throw new Error('Expected npm pack to produce exactly one opentig artifact.');
    const aliasBytes = await readFile(path.join(outputDirectory, aliasArtifact.filename));
    return {
      packageName: aliasArtifact.name,
      version: aliasArtifact.version,
      filename: aliasArtifact.filename,
      sha256: createHash('sha256').update(aliasBytes).digest('hex'),
      npmIntegrity: aliasArtifact.integrity,
      files: aliasArtifact.files.map(({ path: filePath, size, mode }) => ({ path: filePath, size, mode })),
    };
  } finally {
    await rm(source, { recursive: true, force: true });
  }
}
