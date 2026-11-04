// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FileTreeEntry } from '@shared/git-types';
import { MobileFilesView } from './MobileFilesView';
import type { FilesViewProps } from './FilesView';

let root: Root;
let container: HTMLDivElement;

const folder = (path: string, children: FileTreeEntry[] = []) => ({ type: 'directory' as const, path, name: path.split('/').pop()!, children });
const file = (path: string, size = 2048, ignored = false): FileTreeEntry => ({ type: 'file', path, name: path.split('/').pop()!, size, mtimeMs: 1, ...(ignored ? { ignored } : {}) });
const release = folder('src/release', [file('src/release/board.js')]);
const src = folder('src', [release, file('src/a.js')]);
const tree = [src, file('README.md')];
const levels: Record<string, FileTreeEntry[]> = { '': tree, src: src.children, 'src/release': release.children };

function props(overrides: Partial<FilesViewProps> = {}): FilesViewProps {
  return {
    active: true, initialExpandedPaths: [], files: tree, filesSnapshotRevision: 1, showDotEnvFiles: true, activePath: null, readOnly: false,
    fileClipboardAvailable: true, revealAvailable: true, historyState: { canUndo: true, canRedo: false, undoLabel: 'rename' },
    openFiles: { tabs: [{ path: 'README.md', dirty: false, missing: false }], activePath: 'README.md', previewPath: null },
    onActivateFile: vi.fn(), onCloseFile: vi.fn(), onQuickOpen: vi.fn(), onUndo: vi.fn(async () => {}), onRedo: vi.fn(async () => {}), onOpenFile: vi.fn(),
    onLoadDirectory: vi.fn(async (path: string) => levels[path] ?? []), onPersistExpandedPaths: vi.fn(), onCopyPath: vi.fn(async () => {}), onCopyEntries: vi.fn(async () => {}),
    onCutEntries: vi.fn(async () => {}), onCopyContents: vi.fn(async () => {}), onPaste: vi.fn(async () => {}), onMoveEntries: vi.fn(async () => {}), onDeleteEntries: vi.fn(async () => {}),
    onReveal: vi.fn(async () => {}), onRename: vi.fn(async () => {}), onCreate: vi.fn(async () => {}),
    ...overrides,
  } as FilesViewProps;
}

async function settle() {
  for (let tick = 0; tick < 4; tick++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
async function render(overrides: Partial<FilesViewProps> = {}) {
  const value = props(overrides);
  await act(async () => root.render(createElement(MobileFilesView, value)));
  await settle();
  return value;
}
const row = (name: string) => [...container.querySelectorAll<HTMLElement>('.mobile-file-row')].find((item) => item.querySelector('.mobile-file-name')?.textContent === name)!;
const openButton = (name: string) => row(name).querySelector<HTMLButtonElement>('.mobile-file-open')!;
const sheetRows = () => [...document.querySelectorAll('.mobile-sheet .mobile-sheet-action')].map((item) => item.textContent);
const sheetRow = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.mobile-sheet .mobile-sheet-action')].find((item) => item.textContent?.startsWith(text))!;
const tools = async () => { await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="File actions"]')!.click()); };
const press = async (name: string) => { await act(async () => openButton(name).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))); };

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(390);
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

it('shows a filter and one menu, and a path line only inside a folder', async () => {
  await render();
  expect(container.querySelector('input[aria-label="Filter this folder"]')).not.toBeNull();
  expect([...container.querySelectorAll('.mobile-files-tools button')].map((button) => button.getAttribute('aria-label'))).toEqual(['File actions']);
  expect(container.querySelector('.mobile-file-up')).toBeNull();
  await act(async () => openButton('src').click());
  await settle();
  await act(async () => openButton('release').click());
  await settle();
  const up = container.querySelector<HTMLButtonElement>('.mobile-file-up')!;
  expect(up.textContent).toBe('src/release');
  expect(up.getAttribute('aria-label')).toBe('Back to src');
  await act(async () => up.click());
  await settle();
  expect(container.querySelector('.mobile-file-up')?.textContent).toBe('src');
  await act(async () => container.querySelector<HTMLButtonElement>('.mobile-file-up')!.click());
  await settle();
  expect(container.querySelector('.mobile-file-up')).toBeNull();
});

it('reduces a row to an icon, a name and a chevron for a folder', async () => {
  await render();
  expect(row('src').querySelector('.folder-icon')).not.toBeNull();
  expect(row('src').querySelector('.tabler-icon-chevron-right')).not.toBeNull();
  expect(row('README.md').querySelector('img')).not.toBeNull();
  expect(row('README.md').querySelector('.tabler-icon-chevron-right')).toBeNull();
  expect(row('README.md').textContent).toBe('README.md');
  expect(row('README.md').querySelectorAll('.mobile-file-open')).toHaveLength(1);
  expect(row('src').style.height).toBe('48px');
});

it('still says a row is ignored', async () => {
  await render({ onLoadDirectory: vi.fn(async () => [file('dist.js', 2048, true)]) });
  expect(row('dist.js').querySelector('small')?.textContent).toBe('Ignored');
});

it('opens a file or a folder on a tap', async () => {
  const value = await render();
  await act(async () => openButton('README.md').click());
  expect(value.onOpenFile).toHaveBeenCalledWith('README.md');
  await act(async () => openButton('src').click());
  await settle();
  expect(row('a.js')).toBeDefined();
});

it('keeps everything the list offered in its menu, with the open files counted', async () => {
  await render();
  await tools();
  expect(document.querySelector('.mobile-sheet-title')?.textContent).toBe('Files');
  expect(sheetRows()).toEqual(['Open files1', 'Find a file by name', 'Select', 'New file', 'New folder', 'Paste here', 'Undo rename', 'Redo']);
  expect(document.querySelectorAll('.mobile-sheet hr')).toHaveLength(2);
});

it('runs each of the menu\'s actions', async () => {
  const value = await render();
  await tools();
  await act(async () => sheetRow('Find a file').click());
  expect(value.onQuickOpen).toHaveBeenCalledOnce();
  await tools();
  await act(async () => sheetRow('Undo rename').click());
  expect(value.onUndo).toHaveBeenCalledOnce();
  await tools();
  await act(async () => sheetRow('Paste here').click());
  expect(value.onPaste).toHaveBeenCalledWith('');
  await tools();
  expect(sheetRow('Redo').disabled).toBe(true);
});

it('opens the sheet of open files from the menu, and switches from it', async () => {
  const value = await render();
  await tools();
  await act(async () => sheetRow('Open files').click());
  await settle();
  expect([...document.querySelectorAll('.mobile-sheet-title')].map((title) => title.textContent)).toContain('Open files');
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.mobile-open-file .mobile-sheet-action')][0]!.click());
  expect(value.onActivateFile).toHaveBeenCalledWith('README.md');
});

it('offers what the row\'s menu did on a long press, with what the row no longer shows', async () => {
  const value = await render();
  await press('README.md');
  expect(document.querySelector('.mobile-sheet-title')?.textContent).toBe('README.md');
  expect(document.querySelector('.mobile-sheet-description')?.textContent).toBe('2 KB');
  expect(sheetRows()).toEqual(['Keep file open', 'Move to…', 'Rename', 'Copy', 'Cut', 'Copy path', 'Copy contents', 'Reveal in file manager', 'Paste here', 'Delete']);
  await act(async () => sheetRow('Delete').click());
  expect(value.onDeleteEntries).toHaveBeenCalledWith([expect.objectContaining({ path: 'README.md' })]);
});

it('offers a folder its own actions on a long press', async () => {
  await render();
  await press('src');
  expect(sheetRows()).toEqual(['Open folder', 'Move to…', 'Rename', 'Copy', 'Cut', 'Copy path', 'Reveal in file manager', 'Paste here', 'Delete']);
});

it('reaches a row\'s sheet from the keyboard too', async () => {
  await render();
  await act(async () => row('README.md').querySelector<HTMLButtonElement>('[aria-label="More actions for README.md"]')!.click());
  expect(document.querySelector('.mobile-sheet-title')?.textContent).toBe('README.md');
});

it('selects from the menu, acts on the selection from its bar, and ends with Cancel', async () => {
  const value = await render();
  await tools();
  await act(async () => sheetRow('Select').click());
  await settle();
  expect(container.querySelector('[aria-label="File actions"]')).toBeNull();
  const del = () => container.querySelector<HTMLButtonElement>('[aria-label="Delete selected items"]')!;
  expect(del().disabled).toBe(true);
  await act(async () => openButton('README.md').click());
  expect(value.onOpenFile).not.toHaveBeenCalled();
  expect(openButton('README.md').getAttribute('aria-pressed')).toBe('true');
  expect(row('src').querySelector('.tabler-icon-chevron-right')).toBeNull();
  // A long press doesn't open anything while selecting.
  await press('src');
  expect(document.querySelector('.mobile-sheet .mobile-sheet-action')).toBeNull();
  await act(async () => del().click());
  expect(value.onDeleteEntries).toHaveBeenCalledWith([expect.objectContaining({ path: 'README.md' })]);
  const cancel = container.querySelector<HTMLButtonElement>('[aria-label="Cancel selection, 1 selected"]')!;
  await act(async () => cancel.click());
  expect(container.querySelector('.mobile-file-selection-actions')).toBeNull();
  expect(container.querySelector('[aria-label="File actions"]')).not.toBeNull();
});
