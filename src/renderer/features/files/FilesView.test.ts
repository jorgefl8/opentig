// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FileTreeEntry } from '@shared/git-types';
import { DEFAULT_SHORTCUT_MAP } from '@shared/shortcuts';
import { ShortcutsProvider } from '@/app/ShortcutsContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import { FilesView, type FilesViewProps } from './FilesView';
import { emptyFileSession } from './open-files-model';

let root: Root;
let container: HTMLDivElement;

const tree: FileTreeEntry[] = [{ type: 'file', path: 'README.md', name: 'README.md', size: 2048, mtimeMs: 1 }];

function props(): FilesViewProps {
  return {
    active: true, initialExpandedPaths: [], files: tree, filesSnapshotRevision: 1, showDotEnvFiles: true, activePath: null, readOnly: false,
    fileClipboardAvailable: true, revealAvailable: true, historyState: { canUndo: true, undoLabel: null, canRedo: true, redoLabel: null },
    openFiles: emptyFileSession,
    onActivateFile: vi.fn(), onCloseFile: vi.fn(), onQuickOpen: vi.fn(), onUndo: vi.fn(async () => {}), onRedo: vi.fn(async () => {}), onOpenFile: vi.fn(),
    onLoadDirectory: vi.fn(async () => []), onPersistExpandedPaths: vi.fn(), onCopyPath: vi.fn(async () => {}), onCopyEntries: vi.fn(async () => {}),
    onCutEntries: vi.fn(async () => {}), onCopyContents: vi.fn(async () => {}), onPaste: vi.fn(async () => {}), onMoveEntries: vi.fn(async () => {}), onDeleteEntries: vi.fn(async () => {}),
    onReveal: vi.fn(async () => {}), onRename: vi.fn(async () => {}), onCreate: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
  // The virtualizer reads the scroll area's size from clientHeight.
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('shows the undo and redo shortcuts the user has bound in the context menu', async () => {
  const shortcuts = { ...DEFAULT_SHORTCUT_MAP, undoFileChange: 'Ctrl+Alt+U', redoFileChange: 'Ctrl+Alt+Y' };
  await act(async () => root.render(createElement(ShortcutsProvider, { shortcuts }, createElement(TooltipProvider, null, createElement(FilesView, props())))));
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Actions for README.md"]')!.click());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const item = (label: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((element) => element.textContent?.trim().startsWith(label));
  expect(item('Undo')?.textContent?.trim()).toBe('Undo Ctrl+Alt+U');
  expect(item('Redo')?.textContent?.trim()).toBe('Redo Ctrl+Alt+Y');
});
