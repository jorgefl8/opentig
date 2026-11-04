// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MobileChromeContext, type MobileChromeHosts } from '@/components/mobile-chrome-context';
import { MobileFileBar } from './MobileFileBar';
import type { FileSession } from './open-files-model';

let root: Root;
let container: HTMLDivElement;
let hosts: MobileChromeHosts;
const activate = vi.fn(); const close = vi.fn(); const openFile = vi.fn(); const copyPath = vi.fn(async () => {}); const remove = vi.fn(async () => {});
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  hosts = { title: document.createElement('div'), actions: document.createElement('div'), float: null };
  container = document.createElement('div');
  document.body.append(container, hosts.title!, hosts.actions!);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.clearAllMocks(); });

const session = (tabs: Array<{ path: string; dirty?: boolean; missing?: boolean }>, activePath: string): FileSession => ({ tabs: tabs.map((tab) => ({ dirty: false, missing: false, ...tab })), activePath, previewPath: null }) as unknown as FileSession;
async function render(value: FileSession, path = 'src/a.js', readOnly = false) {
  await act(async () => root.render(createElement(MobileChromeContext.Provider, { value: hosts }, createElement(MobileFileBar, {
    path, files: null, session: value, revision: 1,
    actions: { readOnly, fileClipboardAvailable: false, revealAvailable: false, onOpenFile: openFile, onCopyEntries: vi.fn(), onCutEntries: vi.fn(), onCopyPath: copyPath, onCopyContents: vi.fn(), onReveal: vi.fn(), onPaste: vi.fn(), onDeleteEntries: remove },
    onActivateFile: activate, onCloseFile: close, onLoadDirectory: vi.fn(async () => []), onMove: vi.fn(), onRename: vi.fn(), onCreate: vi.fn(),
  }))));
}
const sheetRows = () => [...document.querySelectorAll('.mobile-sheet .mobile-sheet-action')].map((row) => row.textContent);

it('names the file and opens the open-files sheet from its title', async () => {
  await render(session([{ path: 'src/a.js' }, { path: 'b.md', dirty: true }, { path: 'gone.txt', missing: true }], 'src/a.js'));
  const title = hosts.title!.querySelector<HTMLButtonElement>('.mobile-viewer-title')!;
  expect(title.textContent).toBe('a.js');
  expect(title.getAttribute('aria-label')).toBe('a.js. Open files (3)');
  expect(document.querySelector('.mobile-sheet')).toBeNull();
  await act(async () => title.click());
  expect(sheetRows()).toEqual(['a.jssrc/a.js', 'b.mdb.md · Unsaved', 'gone.txtgone.txt · Missing']);
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Close b.md"]')!.click());
  expect(close).toHaveBeenCalledWith('b.md');
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.mobile-sheet .mobile-sheet-action')][1]!.click());
  expect(activate).toHaveBeenCalledWith('b.md');
});

it('marks other unsaved files beside the title, not this one', async () => {
  await render(session([{ path: 'src/a.js', dirty: true }], 'src/a.js'));
  expect(hosts.title!.querySelector('.mobile-unsaved-dot')).toBeNull();
  await render(session([{ path: 'src/a.js' }, { path: 'b.md', dirty: true }], 'src/a.js'));
  expect(hosts.title!.querySelector('.mobile-unsaved-dot')).not.toBeNull();
});

it('offers what the file row offers, with a file outside the loaded list', async () => {
  await render(session([{ path: 'src/a.js' }], 'src/a.js'));
  await act(async () => hosts.actions!.querySelector<HTMLButtonElement>('button[aria-label="More file actions"]')!.click());
  expect(sheetRows()).toEqual(['Keep file open', 'Move to…', 'Rename', 'Copy path', 'Copy contents', 'Delete']);
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.mobile-sheet .mobile-sheet-action')].find((row) => row.textContent === 'Copy path')!.click());
  expect(copyPath).toHaveBeenCalledWith([expect.objectContaining({ path: 'src/a.js', name: 'a.js', type: 'file' })]);
});

it('blocks what changes files while the repository is read-only', async () => {
  await render(session([{ path: 'src/a.js' }], 'src/a.js'), 'src/a.js', true);
  await act(async () => hosts.actions!.querySelector<HTMLButtonElement>('button[aria-label="More file actions"]')!.click());
  const disabled = [...document.querySelectorAll<HTMLButtonElement>('.mobile-sheet .mobile-sheet-action')].filter((row) => row.disabled).map((row) => row.textContent);
  expect(disabled).toEqual(['Move to…', 'Rename', 'Delete']);
});
