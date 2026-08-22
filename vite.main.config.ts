import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    sourcemap: false,
    // Keep native keyboard bindings, `trash` platform executables, and `ws`
    // outside the library-mode bundle. Bundling `ws` can rewrite its optional
    // `bufferutil` require into an incompatible namespace object.
    rollupOptions: { external: ['uiohook-napi', 'trash', 'ws'] },
  },
});
