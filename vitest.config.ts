import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'packages/**/*.test.ts'],
    clearMocks: true,
    // Several tests spawn real git subprocesses or do hundreds of real fs
    // writes; under full-suite parallel load on Windows that routinely
    // outruns the 5s default even though each test is fast in isolation.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
