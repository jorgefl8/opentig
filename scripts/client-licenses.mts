import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const packageLicense = (name: string) => path.join(path.dirname(createRequire(import.meta.url).resolve(`${name}/package.json`)), 'LICENSE');

/** License texts that must accompany the fonts and KaTeX assets bundled into the client. */
const sources: Record<string, () => string> = {
  'geist-OFL.txt': () => packageLicense('@fontsource-variable/geist'),
  'geist-mono-OFL.txt': () => packageLicense('@fontsource-variable/geist-mono'),
  'inconsolata-OFL.txt': () => packageLicense('@fontsource-variable/inconsolata'),
  'jetbrains-mono-OFL.txt': () => packageLicense('@fontsource-variable/jetbrains-mono'),
  'plus-jakarta-sans-OFL.txt': () => packageLicense('@fontsource-variable/plus-jakarta-sans'),
  'space-grotesk-OFL.txt': () => packageLicense('@fontsource-variable/space-grotesk'),
  'departure-mono-OFL.txt': () => fileURLToPath(new URL('../src/renderer/assets/fonts/departure-mono/LICENSE', import.meta.url)),
  'katex-LICENSE.txt': () => packageLicense('katex'),
};

/** Paths relative to the client root; package verification requires each one. */
export const clientLicenseFiles = Object.keys(sources).map((name) => `licenses/${name}`);

export function clientLicenses(): Plugin {
  return {
    name: 'client-licenses',
    async generateBundle() {
      for (const [name, source] of Object.entries(sources)) {
        this.emitFile({ type: 'asset', fileName: `licenses/${name}`, source: await readFile(source()) });
      }
    },
  };
}
