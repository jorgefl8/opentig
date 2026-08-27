import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** Intercept only Pierre's `import { bundledLanguages } from "shiki"` so Vite
 *  emits the curated Git-client grammars instead of every TextMate language. */
function pierreBundledLanguages(): Plugin {
  const shim = path.resolve(__dirname, 'src/renderer/lib/pierre-shiki.ts');
  return {
    name: 'pierre-bundled-languages',
    enforce: 'pre',
    resolveId(id, importer) {
      if (id !== 'shiki' || !importer) return;
      const normalized = importer.replaceAll('\\', '/');
      if (normalized.includes('@pierre/diffs/')) return shim;
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), pierreBundledLanguages()],
  publicDir: path.resolve(__dirname, 'public'),
  worker: { format: 'es' },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'react';
          if (id.includes('@tanstack/')) return 'tanstack';
          if (id.includes('@base-ui/')) return 'base-ui';
        },
      },
    },
  },
});
