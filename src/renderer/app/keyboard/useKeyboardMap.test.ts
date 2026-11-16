// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useKeyboardMap, type KeyboardMapOptions } from './useKeyboardMap';

let root: Root;
let container: HTMLDivElement;
const opened: string[] = [];
const closeViewer = vi.fn();
const showSection = vi.fn();
let shown: ReturnType<KeyboardMapOptions['viewer']> = 'other';
let inChanges = false;
let files = ['a.ts', 'b.ts', 'c.ts'];

function Harness() {
  useKeyboardMap({
    enabled: true, mobile: false, viewer: () => shown, changes: () => inChanges,
    showSection, showShortcuts: vi.fn(), closeViewer, phoneBack: vi.fn(),
  });
  const row = (name: string, current = false) => h('div', { key: name, 'data-list-item': '', 'data-list-current': current ? '' : undefined },
    h('button', { 'data-list-primary': '', id: name, onClick: () => opened.push(name) }, name),
    h('button', { id: `${name}-copy` }, 'Copy'));
  return h('div', null,
    h('div', { className: 'sidebar-body' },
      h('input', { id: 'filter', 'aria-label': 'Filter' }),
      h('div', { 'data-list-root': '' }, row('first', true), row('second'), row('third'))),
    h('section', { className: 'viewer-pane' },
      h('div', { className: 'viewer-pane-body', tabIndex: -1, id: 'viewer' },
        files.map((name) => h('section', { key: name, className: 'diff-file-section', id: `file-${name}` },
          h('button', { className: 'diff-file-toggle' }, name))))));
}

const element = (id: string) => document.getElementById(id)!;
async function press(id: string, key: string, init: KeyboardEventInit = {}) {
  await act(async () => { element(id).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })); });
}
const frames = () => act(async () => { for (let frame = 0; frame < 4; frame++) await new Promise((resolve) => requestAnimationFrame(resolve)); });

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  opened.length = 0;
  shown = 'other';
  inChanges = false;
  files = ['a.ts', 'b.ts', 'c.ts'];
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => { root.render(h(Harness)); });
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove(); vi.resetAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it('moves through the list with j, k and the arrows, and the open viewer follows each row at once', async () => {
  element('first').focus();
  await press('first', 'j');
  expect(document.activeElement).toBe(element('second'));
  expect(opened).toEqual(['second']);
  await press('second', 'ArrowDown');
  await press('third', 'k');
  expect(document.activeElement).toBe(element('second'));
  expect(opened).toEqual(['second', 'third', 'second']);
});

it('only moves the focus while nothing is open in the viewer', async () => {
  shown = 'none';
  element('first').focus();
  await press('first', 'j');
  expect(document.activeElement).toBe(element('second'));
  expect(opened).toEqual([]);
});

it('opens only the row a held key stops on, as soon as the key is let go', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  element('first').focus();
  await press('first', 'j', { repeat: true });
  await press('second', 'j', { repeat: true });
  expect(document.activeElement).toBe(element('third'));
  expect(opened).toEqual([]);
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'j' })); });
  expect(opened).toEqual(['third']);
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(opened).toEqual(['third']);
});

it('leaves a row’s other buttons and a text field their own keys', async () => {
  element('first-copy').focus();
  await press('first-copy', 'j');
  element('filter').focus();
  await press('filter', 'j');
  await press('filter', 'g');
  await press('filter', 'h');
  expect(opened).toEqual([]);
  expect(showSection).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(element('filter'));
});

it('opens a row with Enter and hands the keys to the viewer, where j opens the next row without leaving it', async () => {
  element('first').focus();
  await press('first', 'Enter');
  expect(opened).toEqual(['first']);
  await frames();
  expect(document.activeElement).toBe(element('viewer'));
  await press('viewer', 'j');
  expect(opened).toEqual(['first', 'second']);
  await frames();
  expect(document.activeElement).toBe(element('viewer'));
});

it('moves between the files of a diff with n and p, without unfolding any', async () => {
  element('viewer').focus();
  await press('viewer', 'n');
  expect(element('file-a.ts').hasAttribute('data-keyboard-file')).toBe(true);
  await press('viewer', 'n');
  expect(element('file-b.ts').hasAttribute('data-keyboard-file')).toBe(true);
  expect(element('file-a.ts').hasAttribute('data-keyboard-file')).toBe(false);
  expect(document.activeElement?.textContent).toBe('b.ts');
  await press('viewer', 'n');
  await press('viewer', 'n');
  expect(element('file-c.ts').hasAttribute('data-keyboard-file')).toBe(true);
  await press('viewer', 'p');
  expect(element('file-b.ts').hasAttribute('data-keyboard-file')).toBe(true);
  expect(opened).toEqual([]);
});

it('closes the viewer with Esc and puts the focus back on its row', async () => {
  element('viewer').focus();
  await press('viewer', 'Escape');
  expect(closeViewer).toHaveBeenCalledOnce();
  await frames();
  expect(document.activeElement).toBe(element('first'));
});

it('leaves a file open on Esc: it is a tab of its own', async () => {
  shown = 'file';
  element('first').focus();
  await press('first', 'Escape');
  element('viewer').focus();
  await press('viewer', 'Escape');
  expect(closeViewer).not.toHaveBeenCalled();
});

it('goes to a section with g and its letter', async () => {
  element('first').focus();
  await press('first', 'g');
  await press('first', 's');
  expect(showSection).toHaveBeenCalledExactlyOnceWith('search');
});

it('takes n to the only file of a commit, and in Changes, whose diffs are one file each, to the next change', async () => {
  await act(async () => { root.unmount(); });
  files = ['only.ts'];
  root = createRoot(container);
  await act(async () => { root.render(h(Harness)); });
  element('viewer').focus();
  await press('viewer', 'n');
  expect(element('file-only.ts').hasAttribute('data-keyboard-file')).toBe(true);
  expect(opened).toEqual([]);

  inChanges = true;
  element('viewer').focus();
  await press('viewer', 'n');
  expect(opened).toEqual(['second']);
});
