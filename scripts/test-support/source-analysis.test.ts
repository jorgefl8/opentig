import { expect, it } from 'vitest';
import { analyzeSource } from './source-analysis';

it('finds dependencies across static, dynamic, CommonJS, and re-export syntax', () => {
  expect(analyzeSource(`
    import { app as desktop } from 'electron';
    export * from './main/runtime/OpenTigRuntime';
    const server = import('packages/server');
    const shortcuts = require('uiohook-napi');
    import filesystem = require('node:fs');
  `).imports).toEqual(['electron', './main/runtime/OpenTigRuntime', 'packages/server', 'uiohook-napi', 'node:fs']);
});

it('ignores comments and strings that mention forbidden APIs', () => {
  expect(analyzeSource(`
    // import { app } from 'electron'; window.opentig.oldApi();
    const example = "require('uiohook-napi')";
    const explanation = 'window.opentig';
  `)).toEqual({ imports: [], accesses: [] });
});

it('detects bracket and optional bridge access while allowing the desktop bridge', () => {
  const { accesses } = analyzeSource(`window ['opentig']?.run(); window.opentigDesktop?.webAccess;`);
  expect(accesses).toContain('window.opentig');
  expect(accesses).toContain('window.opentigDesktop.webAccess');
});

it('recognizes an aliased IPC registration regardless of whitespace or brackets', () => {
  expect(analyzeSource(`import { ipcMain as ipc } from 'electron'; ipc ['handle'] ('desktop:test', handler);`).accesses)
    .toContain('ipcMain.handle');
});
