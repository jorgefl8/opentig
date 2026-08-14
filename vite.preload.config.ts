import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    sourcemap: false,
    rollupOptions: { output: { format: 'cjs', inlineDynamicImports: true } },
  },
});
