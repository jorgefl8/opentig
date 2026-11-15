import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { clientLicenses } from './scripts/client-licenses.mts';
import { pdfjsAssets } from './scripts/pdfjs-assets.mts';

/** Intercept only Pierre's `import { bundledLanguages } from "shiki"` so Vite
 *  emits the curated Git-client grammars instead of every TextMate language. */
function pierreBundledLanguages(): Plugin {
  const shim = path.resolve(import.meta.dirname, 'src/renderer/lib/pierre-shiki.ts');
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

/** A fingerprint of the file icons, added to their addresses so the server can let browsers keep them for good. */
function iconsVersion(): string {
  const folder = path.resolve(import.meta.dirname, 'public/vscode-icons');
  const hash = createHash('sha256');
  for (const name of readdirSync(folder).sort()) hash.update(name).update(readFileSync(path.join(folder, name)));
  return hash.digest('hex').slice(0, 12);
}

export default defineConfig({
  define: { __OPENTIG_ICONS_VERSION__: JSON.stringify(iconsVersion()) },
  plugins: [react(), tailwindcss(), pierreBundledLanguages(), pdfjsAssets(), clientLicenses()],
  publicDir: path.resolve(import.meta.dirname, 'public'),
  worker: { format: 'es' },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src/renderer'),
      '@shared': path.resolve(import.meta.dirname, 'src/shared'),
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
