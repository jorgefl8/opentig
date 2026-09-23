import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import { desktopBuildProfile } from './desktop-build';

export default defineConfig({
  publicDir: false,
  define: { __OPENTIG_BUILD_PROFILE__: JSON.stringify(desktopBuildProfile()) },
  build: {
    target: 'node24',
    outDir: '.vite/build',
    emptyOutDir: true,
    sourcemap: false,
    ssr: true,
    lib: { entry: 'src/main.ts', formats: ['cjs'], fileName: () => 'main.js' },
    // Keep native keyboard bindings and `trash` platform executables outside
    // the library-mode bundle. The desktop staging step copies their runtime dependencies.
    rollupOptions: {
      external: ['electron', 'uiohook-napi', 'trash', 'electron-updater', ...builtinModules, /^node:/],
      output: { inlineDynamicImports: true },
    },
  },
  ssr: { noExternal: true },
});
