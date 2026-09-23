import eslint from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.vite', '**/dist/**', 'out', 'node_modules', '.forge-scaffold', 'memory', 'packages/server/.client/**', 'packages/server/.resource/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}', 'src/renderer.tsx'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/set-state-in-effect': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'src/main.ts', 'src/preload.ts', 'packages/server/**/*.{ts,mjs}', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
);
