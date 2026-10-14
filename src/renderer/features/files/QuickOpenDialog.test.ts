// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FileTreeEntry } from '@shared/git-types';
import { QuickOpenDialog } from './QuickOpenDialog';

let root: Root;
let container: HTMLDivElement;
const onOpenFile = vi.fn();
const onOpenChange = vi.fn();
const file = (path: string): FileTreeEntry => ({ path, name: path.split('/').at(-1)!, type: 'file', size: 1, mtimeMs: 0 });
const input = () => document.querySelector<HTMLInputElement>('[aria-label="Search files by name or path"]')!;
async function mount(files: FileTreeEntry[]) {
  await act(async () => { root.render(createElement(QuickOpenDialog, { open: true, files, includeIgnored: false, activePath: null, onOpenFile, onOpenChange })); });
}
async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function key(key: string, isComposing = false) {
  await act(async () => { input().dispatchEvent(new KeyboardEvent('keydown', { key, isComposing, keyCode: isComposing ? 229 : 0, which: isComposing ? 229 : 0, bubbles: true, cancelable: true })); });
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  onOpenFile.mockReturnValue(true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove(); vi.resetAllMocks(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it('keeps arrow/Enter file opening and Escape dismissal available after filtering', async () => {
  await mount([file('src/App.tsx'), file('test/App.tsx'), file('README.md')]);
  await type('app');
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(2);
  await key('ArrowDown');
  await key('Enter');
  expect(onOpenFile).toHaveBeenCalledExactlyOnceWith('test/App.tsx');
  expect(onOpenChange).toHaveBeenCalledWith(false);
  onOpenChange.mockClear();
  await key('Escape');
  expect(onOpenChange.mock.lastCall?.[0]).toBe(false);
});

it('keeps a rejected file open request in the dialog', async () => {
  onOpenFile.mockReturnValue(false);
  await mount([file('App.tsx')]);
  await type('app');
  await key('Enter');
  expect(onOpenFile).toHaveBeenCalledExactlyOnceWith('App.tsx');
  expect(onOpenChange).not.toHaveBeenCalled();
});

it('does not open stale rows or IME confirmation while a large search is pending', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => { now += 4; return now; });
  await mount(Array.from({ length: 10_000 }, (_, i) => file(`src/Component${i}.tsx`)));
  await type('component9.tsx');
  expect(document.querySelector('[role="status"]')?.textContent).toContain('Searching files…');
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
  await key('Enter');
  expect(onOpenFile).not.toHaveBeenCalled();
  await type('component10.tsx');
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(document.querySelector('[role="option"]')?.textContent).toContain('Component10.tsx');
  await key('Enter', true);
  expect(onOpenFile).not.toHaveBeenCalled();
  await key('Enter');
  expect(onOpenFile).toHaveBeenCalledExactlyOnceWith('src/Component10.tsx');
});
