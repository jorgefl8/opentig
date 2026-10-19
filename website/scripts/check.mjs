import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

// Astro/Volar require the TypeScript JavaScript API, which TypeScript 7 no
// longer exposes. The hoisted install can place Volar next to the app's
// TypeScript 7 because its peer range is "*". Resolve TypeScript within this
// checker process to the website's compatible version, without changing the
// app or installed files.
const require = createRequire(import.meta.url);
const typescriptUrl = pathToFileURL(require.resolve('typescript')).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'typescript') return { url: typescriptUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
await import(new URL('../bin/astro-check.js', import.meta.resolve('@astrojs/check')).href);
