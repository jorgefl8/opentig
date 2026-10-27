import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';

const include = ['src/**/*.test.ts', 'packages/**/*.test.ts', 'scripts/**/*.test.mjs', 'scripts/**/*.test.ts'];

// Reusing workers across files skips a worker start and module reload per
// file, but only files without process-wide state can share one. Anything that
// mocks modules, changes globals, env, timers or the DOM environment, or uses
// a shared test-support helper keeps a fresh worker per file.
const NEEDS_ISOLATION = /vi\.(mock|doMock|unmock|stubGlobal|stubEnv|resetModules|hoisted|useFakeTimers|setSystemTime|spyOn)|@vitest-environment|process\.env\.[A-Za-z_]+ *=|process\.env\[|globalThis\.[a-zA-Z]+ *=|Object\.defineProperty\((globalThis|window|navigator|process)|test-support\//;
const sharedWorkerFiles = globSync(include, { exclude: (file) => file === 'node_modules' })
  .filter((file) => !NEEDS_ISOLATION.test(readFileSync(file, 'utf8')))
  .map((file) => file.split(path.sep).join('/'));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src/renderer'),
      '@shared': path.resolve(import.meta.dirname, 'src/shared'),
    },
  },
  test: {
    environment: 'node',
    clearMocks: true,
    // Several tests spawn real git subprocesses or do hundreds of real fs
    // writes; under full-suite parallel load on Windows that routinely
    // outruns the 5s default even though each test is fast in isolation.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    projects: [
      { extends: true, test: { name: 'isolated', include, exclude: [...configDefaults.exclude, ...sharedWorkerFiles] } },
      { extends: true, test: { name: 'shared-worker', include: sharedWorkerFiles, isolate: false } },
    ],
  },
});
