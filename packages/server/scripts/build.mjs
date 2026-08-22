import { access, cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { verifyServerBuild } from './verify-build.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '..', '..');
const clientBuild = path.join(packageRoot, '.client');
const serverDist = path.join(packageRoot, 'dist');
const resourceRoot = path.join(packageRoot, '.resource', 'opentig-server');

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
await cp(clientBuild, path.join(serverDist, 'client'), { recursive: true, force: true });
await verifyServerBuild(serverDist);

await rm(resourceRoot, { recursive: true, force: true });
await mkdir(path.dirname(resourceRoot), { recursive: true });
await cp(serverDist, resourceRoot, { recursive: true, force: true });
