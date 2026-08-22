import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    target: 'node24',
    outDir: path.join(packageRoot, 'dist'),
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    ssr: true,
    rollupOptions: {
      // `trash` ships platform executables and cannot be safely inlined by
      // Vite library mode. Step 5 packages its narrow runtime closure beside
      // the utility entry before that entry becomes executable.
      external: [/^node:/, 'trash', 'ws'],
      input: {
        server: path.join(packageRoot, 'src', 'server.ts'),
        utility: path.join(packageRoot, 'src', 'utility.ts'),
      },
      output: {
        entryFileNames: '[name].mjs',
        chunkFileNames: 'chunks/[name]-[hash].mjs',
      },
    },
  },
  ssr: {
    noExternal: true,
  },
});
