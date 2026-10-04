// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FileTreeEntry } from '@shared/git-types';
import { useDirectoryLevel } from './use-directory-level';

let root: Root;
let container: HTMLDivElement;
const file = (path: string): FileTreeEntry => ({ path, name: path.split('/').at(-1)!, type: 'file', size: 1, mtimeMs: 0 });
function deferred() {
  let resolve!: (entries: FileTreeEntry[]) => void;
  const promise = new Promise<FileTreeEntry[]>((done) => { resolve = done; });
  return { promise, resolve };
}
function Listing({ path, revision, load }: { path: string; revision: number; load: (path: string) => Promise<FileTreeEntry[]> }) {
  const { entries } = useDirectoryLevel(path, revision, load);
  return createElement('div', null, entries === null ? 'Loading…' : entries.map((entry) => createElement('div', { key: entry.path }, entry.name)));
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('keeps visible rows mounted while a background refresh waits, then shows new files', async () => {
  const refresh = deferred();
  const load = vi.fn().mockResolvedValueOnce([file('first.txt')]).mockReturnValueOnce(refresh.promise);
  await act(async () => root.render(createElement(Listing, { path: '', revision: 1, load })));
  const row = container.firstElementChild?.firstElementChild;
  await act(async () => root.render(createElement(Listing, { path: '', revision: 2, load })));
  expect(container.textContent).toBe('first.txt');
  expect(container.firstElementChild?.firstElementChild).toBe(row);
  await act(async () => refresh.resolve([file('first.txt'), file('new.txt')]));
  expect(container.textContent).toBe('first.txtnew.txt');
});

it('does not show the previous folder or let an old response replace a new destination', async () => {
  const old = deferred(); const next = deferred();
  const load = vi.fn().mockResolvedValueOnce([file('first.txt')]).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  await act(async () => root.render(createElement(Listing, { path: '', revision: 1, load })));
  await act(async () => root.render(createElement(Listing, { path: '', revision: 2, load })));
  await act(async () => root.render(createElement(Listing, { path: 'docs', revision: 2, load })));
  expect(container.textContent).toBe('Loading…');
  await act(async () => next.resolve([file('docs/guide.md')]));
  await act(async () => old.resolve([file('stale.txt')]));
  expect(container.textContent).toBe('guide.md');
});
