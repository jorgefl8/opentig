import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = fileURLToPath(import.meta.url);
const loadModule = createRequire(import.meta.url);
const electron = loadModule('electron');

async function verifyPackagedTrash() {
  const resources = path.resolve(scriptDirectory, '..', 'out', 'OpenTig-win32-x64', 'resources');
  const moduleUrl = pathToFileURL(path.join(resources, 'app.asar.unpacked', 'node_modules', 'trash', 'index.js')).href;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'opentig-packaged-trash-'));
  if (!directory.startsWith(path.join(os.tmpdir(), 'opentig-packaged-trash-'))) {
    throw new Error(`Unexpected temporary path: ${directory}`);
  }
  const target = path.join(directory, 'literal-[fixture].txt');
  try {
    await writeFile(target, 'fixture');
    const { default: trash } = await import(moduleUrl);
    await trash([target], { glob: false });
    await expectMissing(target);
    process.stdout.write('PACKAGED_SYSTEM_TRASH_SMOKE_OK\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function expectMissing(target) {
  try {
    await access(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error('Packaged system Trash left the source item in place.');
}

if (typeof electron === 'string') {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(electron, [scriptPath], { env: environment, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else {
  const { app } = electron;
  app.whenReady()
    .then(async () => {
      await verifyPackagedTrash();
      app.exit(0);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      app.exit(1);
    });
}
