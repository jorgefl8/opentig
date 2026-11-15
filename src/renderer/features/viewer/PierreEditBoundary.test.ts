// @vitest-environment jsdom
import { act, createElement, useContext, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EditReadyContext } from './edit-ready-context';
import { PierreEditBoundary } from './PierreEditBoundary';

const bundle = vi.hoisted(() => {
  let arrive!: () => void;
  return { arrived: new Promise<void>((resolve) => { arrive = resolve; }), arrive: () => arrive() };
});
vi.mock('@pierre/diffs/edit', async () => {
  await bundle.arrived;
  return { Editor: class {} };
});
vi.mock('sileo', () => ({ sileo: { error: vi.fn() } }));

let root: Root;
let container: HTMLDivElement;
const seen = { mounts: 0, ready: [] as boolean[] };
function FileSurface() {
  const ready = useContext(EditReadyContext);
  useEffect(() => { seen.mounts++; }, []);
  useEffect(() => { seen.ready.push(ready); }, [ready]);
  return createElement('div', { 'data-surface': '' });
}
const mount = async () => {
  root = createRoot(container);
  await act(async () => root.render(createElement(PierreEditBoundary, { enabled: true }, createElement(FileSurface))));
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  seen.mounts = 0;
  seen.ready = [];
});
afterEach(() => { container.remove(); vi.unstubAllGlobals(); });

it('turns the file below editable in place when the edit bundle arrives, then starts later files editable', async () => {
  await mount();
  const surface = container.querySelector('[data-surface]');
  expect(seen).toEqual({ mounts: 1, ready: [false] });

  await act(async () => { bundle.arrive(); await bundle.arrived; await new Promise((resolve) => setTimeout(resolve, 0)); });
  await vi.waitFor(() => expect(seen.ready).toEqual([false, true]));
  // The same element, mounted once: a remount here is the file being drawn and highlighted twice.
  expect(container.querySelector('[data-surface]')).toBe(surface);
  expect(seen.mounts).toBe(1);

  // Leaving Files and coming back mounts a new boundary, which already has the editor.
  await act(async () => root.unmount());
  seen.mounts = 0;
  seen.ready = [];
  await mount();
  expect(seen).toEqual({ mounts: 1, ready: [true] });
  await act(async () => root.unmount());
});
