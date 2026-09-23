import { defineConfig } from 'vite';
import { desktopBuildProfile } from './desktop-build';

export default defineConfig({
  define: { __OPENTIG_BUILD_PROFILE__: JSON.stringify(desktopBuildProfile()) },
  build: {
    sourcemap: false,
    // Keep native keyboard bindings and `trash` platform executables outside
    // the library-mode bundle. Forge packages their runtime files separately.
    rollupOptions: { external: ['uiohook-napi', 'trash'] },
  },
});
