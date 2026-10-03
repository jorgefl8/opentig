// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerDirectoryListing } from '../../../shared/contracts';
import { TooltipProvider } from '@/components/ui/tooltip';
import { OpenRepositoryDialog } from './OpenRepositoryDialog';

const listing = (path = '/workspace'): ServerDirectoryListing => ({
  path, parentPath: '/', repository: null,
  locations: [{ name: 'Home', path: '/home/sample', kind: 'home' }],
  directories: [
    { name: 'atlas', path: `${path}/atlas`, repository: { branch: 'main' } },
    { name: 'notes', path: `${path}/notes`, repository: null },
    { name: '.hidden', path: `${path}/.hidden`, repository: { branch: 'feature' } },
  ],
});
let root: Root;
let container: HTMLDivElement;
const onOpen = vi.fn<(path: string) => Promise<void>>();
const onOpenChange = vi.fn();
const onBrowse = vi.fn<(path?: string) => Promise<ServerDirectoryListing>>();
const button = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(item => item.getAttribute('aria-label') === name || item.textContent?.trim() === name)!;
async function click(name: string) { await act(async () => button(name).click()); }
async function render(overrides: Partial<Parameters<typeof OpenRepositoryDialog>[0]> = {}) { await act(async () => root.render(createElement(TooltipProvider, null, createElement(OpenRepositoryDialog, { open: true, initialPath: '/workspace', onOpen, onOpenChange, onBrowse, ...overrides })))); }
async function input(selector: string, value: string) {
  const node = document.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  onBrowse.mockResolvedValue(listing()); onOpen.mockResolvedValue(undefined);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

describe('repository selection and asynchronous navigation', () => {
  it('lets desktop users choose a native folder and inspect it before confirming', async () => {
    const onPick = vi.fn(async () => '/chosen');
    await render({ onPick });
    onBrowse.mockResolvedValueOnce({ ...listing('/chosen'), repository: { branch: 'main' }, directories: [] });
    await click('Choose a folder…');
    expect(onPick).toHaveBeenCalledOnce();
    expect(onBrowse).toHaveBeenLastCalledWith('/chosen');
    expect(onOpen).not.toHaveBeenCalled();
    await click('Open repository');
    expect(onOpen).toHaveBeenCalledExactlyOnceWith('/chosen');
  });

  it('requires a Git selection and prevents duplicate opens or dismissal during an open', async () => {
    await render();
    expect(button('Open repository').disabled).toBe(true);
    await click('Select folder notes'); expect(button('Open repository').disabled).toBe(true);
    await click('Select repository atlas');
    let finish!: () => void;
    onOpen.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    await click('Open repository');
    expect(onOpen).toHaveBeenCalledExactlyOnceWith('/workspace/atlas');
    expect(button('Close dialog').disabled).toBe(true);
    await click('Cancel'); expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => finish()); expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not open the old selection while a pasted path is being edited or fails to load', async () => {
    await render(); await click('Select repository atlas'); await click('Enter a folder path');
    expect(button('Open repository').disabled).toBe(true);
    await input('#repository-path', '/missing'); onBrowse.mockRejectedValueOnce(new Error('That folder was not found.'));
    await click('Go to folder');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('That folder was not found.');
    expect(button('Open repository').disabled).toBe(true); expect(onOpen).not.toHaveBeenCalled();
    onBrowse.mockResolvedValueOnce({ ...listing('/recovered'), repository: { branch: 'main' }, directories: [] });
    await click('Edit path'); await input('#repository-path', '/recovered'); await click('Go to folder');
    expect(button('Open repository').disabled).toBe(false);
    await click('Open repository'); expect(onOpen).toHaveBeenCalledExactlyOnceWith('/recovered');
  });

  it('ignores a stale directory response after another navigation has finished', async () => {
    let finishOld!: (value: ServerDirectoryListing) => void;
    onBrowse.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }));
    await render();
    onBrowse.mockResolvedValueOnce({ ...listing('/home/sample'), directories: [] });
    await click('Home');
    await act(async () => finishOld(listing('/workspace')));
    expect(document.querySelector('.repository-browser-breadcrumbs')?.textContent).toContain('sample');
    expect(document.querySelector('[aria-label="Select repository atlas"]')).toBeNull();
    expect(button('Open repository').disabled).toBe(true);
  });

  it('filters folders, reveals hidden entries, and opens the focused repository with Enter', async () => {
    await render();
    expect(document.querySelector('[aria-label="Select repository .hidden"]')).toBeNull();
    await act(async () => document.querySelector<HTMLInputElement>('.repository-browser-list-footer input')!.click());
    expect(button('Select repository .hidden')).toBeTruthy();
    await input('[aria-label="Filter folders"]', 'hidden');
    expect(document.querySelector('[aria-label="Select repository atlas"]')).toBeNull();
    const row = button('Select repository .hidden'); row.focus();
    await act(async () => row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith('/workspace/.hidden');
  });

  it('keeps the selected repository and exposes an open failure without closing the dialog', async () => {
    await render(); await click('Select repository atlas'); onOpen.mockRejectedValueOnce(new Error('This repository is no longer available.'));
    await click('Open repository');
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('This repository is no longer available.');
    expect(button('Open repository').disabled).toBe(false);
    await click('Open repository'); expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
