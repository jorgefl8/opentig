import { access, chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { verifyServerBuild } from './verify-build.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '..', '..');
const clientBuild = path.join(packageRoot, '.client');
const serverDist = path.join(packageRoot, 'dist');
const resourceRoot = path.join(packageRoot, '.resource', 'opentig-server');
const packageMetadata = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
const protocolMetadata = JSON.parse(await readFile(path.join(repositoryRoot, 'src', 'shared', 'protocol-version.json'), 'utf8'));

await build({
  root: repositoryRoot,
  configFile: path.join(repositoryRoot, 'vite.renderer.config.ts'),
  build: {
    outDir: clientBuild,
    emptyOutDir: true,
  },
});

await access(path.join(clientBuild, 'index.html'));
await build({ configFile: path.join(packageRoot, 'vite.config.ts') });
await chmod(path.join(serverDist, 'bin.mjs'), 0o755);
await cp(clientBuild, path.join(serverDist, 'client'), { recursive: true, force: true });
await writeFile(path.join(serverDist, 'manifest.json'), `${JSON.stringify({
  packageName: packageMetadata.name,
  appVersion: packageMetadata.version,
  protocolVersion: protocolMetadata.protocolVersion,
  cliEntrypoint: 'bin.mjs',
  serverEntrypoint: 'server.mjs',
  utilityEntrypoint: 'utility.mjs',
  clientEntrypoint: 'client/index.html',
}, null, 2)}\n`, 'utf8');
await verifyServerBuild(serverDist);

await rm(resourceRoot, { recursive: true, force: true });
await mkdir(path.dirname(resourceRoot), { recursive: true });
await cp(serverDist, resourceRoot, { recursive: true, force: true });
await cp(path.join(repositoryRoot, 'node_modules', 'ws'), path.join(resourceRoot, 'node_modules', 'ws'), {
  recursive: true,
  force: true,
});
