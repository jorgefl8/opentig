import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    target: 'node24',
    outDir: '.vite/build',
    emptyOutDir: false,
    sourcemap: false,
    lib: { entry: 'src/preload.ts', formats: ['cjs'], fileName: () => 'preload.js' },
    rollupOptions: {
      external: ['electron', ...builtinModules, /^node:/],
      output: { inlineDynamicImports: true },
    },
  },
});
