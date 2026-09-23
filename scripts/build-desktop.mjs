import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'vite';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repositoryRoot, stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} failed (${signal ?? code}).`)));
  });
}

export async function buildDesktop(profile) {
  if (!['dev', 'production'].includes(profile)) throw new Error('Invalid desktop build profile.');
  const previous = process.env.OPENTIG_BUILD_PROFILE;
  process.env.OPENTIG_BUILD_PROFILE = profile;
  try {
    // The server builds the shared renderer once; Electron loads that same client over HTTP.
    await run(process.execPath, ['packages/server/scripts/build.mjs']);
    await build({ root: repositoryRoot, configFile: path.join(repositoryRoot, 'vite.main.config.ts') });
    await build({ root: repositoryRoot, configFile: path.join(repositoryRoot, 'vite.preload.config.ts') });
  } finally {
    if (previous === undefined) delete process.env.OPENTIG_BUILD_PROFILE;
    else process.env.OPENTIG_BUILD_PROFILE = previous;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildDesktop(process.env.OPENTIG_BUILD_PROFILE ?? 'production');
}
