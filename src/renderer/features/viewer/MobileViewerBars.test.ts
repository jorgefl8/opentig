// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommitInfo } from '@shared/git-types';
import { MobileChromeContext, type MobileChromeHosts } from '@/components/mobile-chrome-context';
import { MobileCommitBar, MobileDiffBar } from './MobileViewerBars';

const browser = vi.hoisted(() => ({ openExternalUrl: vi.fn() }));
const copy = vi.hoisted(() => ({ copyCommitHash: vi.fn() }));
vi.mock('@/lib/browser-capabilities', async (original) => ({ ...await original<object>(), openExternalUrl: browser.openExternalUrl }));
vi.mock('@/features/history/copy-commit-hash', () => ({ copyCommitHash: copy.copyCommitHash }));

let root: Root;
let container: HTMLDivElement;
let hosts: MobileChromeHosts;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  hosts = { title: document.createElement('div'), actions: document.createElement('div'), float: null };
  container = document.createElement('div');
  document.body.append(container, hosts.title!, hosts.actions!);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.clearAllMocks(); });

const patch = 'diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1,2 @@\n-one\n+uno\n+dos\n';
const handlers = { onOpenFile: vi.fn(), onWrapLinesChange: vi.fn(), onMoveAcrossIndex: vi.fn(), onDiscard: vi.fn() };
async function renderDiff(overrides: Partial<Parameters<typeof MobileDiffBar>[0]> = {}) {
  await act(async () => root.render(createElement(MobileChromeContext.Provider, { value: hosts }, createElement(MobileDiffBar, {
    path: 'src/a.js', kind: 'unstaged', diff: { path: 'src/a.js', patch, binary: false, truncated: false, lineCount: 3 }, wrapLines: true, readOnly: false, busy: false, ...handlers, ...overrides,
  }))));
}
const rows = () => [...document.querySelectorAll<HTMLButtonElement>('.mobile-sheet-action')];
const row = (label: string) => rows().find((item) => item.textContent === label)!;
const openMenu = async () => { await act(async () => hosts.actions!.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!.click()); };

describe('a diff on a phone', () => {
  it('names the file, its folder and how much changed', async () => {
    await renderDiff();
    expect(hosts.title!.querySelector('strong')?.textContent).toBe('a.js');
    expect(hosts.title!.querySelector('small')?.textContent).toBe('src · +2 −1');
  });

  it('shows just the count for a file at the root, and nothing yet while loading', async () => {
    await renderDiff({ path: 'a.js' });
    expect(hosts.title!.querySelector('small')?.textContent).toBe('+2 −1');
    await renderDiff({ path: 'a.js', diff: null });
    expect(hosts.title!.querySelector('small')).toBeNull();
  });

  it('stages a working-tree change and unstages a staged one', async () => {
    await renderDiff();
    await act(async () => hosts.actions!.querySelector<HTMLButtonElement>('button[aria-label="Stage this file"]')!.click());
    expect(handlers.onMoveAcrossIndex).toHaveBeenCalledWith('src/a.js', 'unstaged');
    await renderDiff({ kind: 'staged' });
    await act(async () => hosts.actions!.querySelector<HTMLButtonElement>('button[aria-label="Unstage this file"]')!.click());
    expect(handlers.onMoveAcrossIndex).toHaveBeenLastCalledWith('src/a.js', 'staged');
  });

  it('holds staging while the repository is busy or read-only', async () => {
    await renderDiff({ busy: true });
    expect(hosts.actions!.querySelector<HTMLButtonElement>('button[aria-label="Stage this file"]')!.disabled).toBe(true);
    await renderDiff({ readOnly: true });
    expect(hosts.actions!.querySelector<HTMLButtonElement>('button[aria-label="Stage this file"]')!.disabled).toBe(true);
  });

  it('opens the file, switches wrapping without closing, and only asks to discard a working-tree change', async () => {
    await renderDiff();
    await openMenu();
    expect(rows().map((item) => item.textContent)).toEqual(['Open file', 'Wrap lines', 'Discard changes']);
    expect(row('Discard changes').classList.contains('destructive')).toBe(true);
    await act(async () => row('Wrap lines').click());
    expect(handlers.onWrapLinesChange).toHaveBeenCalledWith(false);
    expect(row('Wrap lines').getAttribute('aria-checked')).toBe('true');
    await act(async () => row('Discard changes').click());
    expect(handlers.onDiscard).toHaveBeenCalledWith('src/a.js');
    await act(async () => root.unmount()); root = createRoot(container);
    await renderDiff({ kind: 'staged' });
    await openMenu();
    expect(rows().map((item) => item.textContent)).toEqual(['Open file', 'Wrap lines']);
  });
});

describe('a commit on a phone', () => {
  const oid = 'a'.repeat(40);
  const commit = { oid, shortOid: 'aaaaaaa', upstreamState: 'published', isHead: true, parentCount: 1 } as CommitInfo;
  const onUndo = vi.fn();
  async function renderCommit(overrides: Partial<Parameters<typeof MobileCommitBar>[0]> = {}) {
    await act(async () => root.render(createElement(MobileChromeContext.Provider, { value: hosts }, createElement(MobileCommitBar, {
      oid, commit, canUndo: true, githubRepository: 'sample/demo', onUndo, ...overrides,
    }))));
  }

  it('titles with the short hash and offers copying it and opening it on GitHub', async () => {
    await renderCommit();
    expect(hosts.title!.textContent).toBe('aaaaaaa');
    await openMenu();
    expect(rows().map((item) => item.textContent)).toEqual(['Copy hash', 'Open on GitHub']);
    await act(async () => row('Copy hash').click());
    expect(copy.copyCommitHash).toHaveBeenCalledWith(oid);
  });

  it('offers undo only where the same rule allows it', async () => {
    await renderCommit({ commit: { ...commit, upstreamState: 'local-only' } });
    await openMenu();
    expect(rows().map((item) => item.textContent)).toEqual(['Copy hash', 'Undo commit…']);
    expect(row('Undo commit…').classList.contains('destructive')).toBe(true);
    await act(async () => row('Undo commit…').click());
    expect(onUndo).toHaveBeenCalledOnce();
    await act(async () => root.unmount()); root = createRoot(container);
    await renderCommit({ commit: { ...commit, upstreamState: 'local-only' }, canUndo: false });
    await openMenu();
    expect(rows().map((item) => item.textContent)).toEqual(['Copy hash']);
  });

  it('titles one of its files with the hash below', async () => {
    await renderCommit({ path: 'src/a.js' });
    expect(hosts.title!.querySelector('strong')?.textContent).toBe('a.js');
    expect(hosts.title!.querySelector('small')?.textContent).toBe('aaaaaaa');
  });
});
