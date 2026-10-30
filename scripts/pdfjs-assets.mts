import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

/** Keep PDF fonts, CMaps, and decoders local and identical to the bundled worker. */
export function pdfjsAssets(): Plugin {
  const root = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const folders = ['cmaps', 'standard_fonts', 'wasm'];
  return {
    name: 'pdfjs-assets',
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'pdfjs/LICENSE', source: await readFile(path.join(root, 'LICENSE')) });
      for (const folder of folders) {
        for (const name of await readdir(path.join(root, folder))) {
          this.emitFile({ type: 'asset', fileName: `pdfjs/${folder}/${name}`, source: await readFile(path.join(root, folder, name)) });
        }
      }
    },
    configureServer(server) {
      server.middlewares.use('/pdfjs', (request, response, next) => {
        const [folder, name, extra] = (request.url ?? '').slice(1).split('/');
        if (!folder || !folders.includes(folder) || !name || extra || !/^[\w.-]+$/.test(name) || name === '..') return next();
        void readFile(path.join(root, folder, name)).then(bytes => {
          response.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
          response.end(bytes);
        }, () => next());
      });
    },
  };
}
