import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    sourcemap: false,
    // Keep native keyboard bindings and `trash` platform executables outside
    // the library-mode bundle. Forge packages their runtime files separately.
    rollupOptions: { external: ['uiohook-napi', 'trash'] },
  },
});
