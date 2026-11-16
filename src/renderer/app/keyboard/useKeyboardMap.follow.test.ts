// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useKeyboardMap } from './useKeyboardMap';

// A list whose marked row follows what was opened, as the app's lists do, and loses the mark when the viewer closes.

let root: Root;
let container: HTMLDivElement;
const opened: string[] = [];
const ROWS = ['one', 'two', 'three', 'four', 'five'];
let drawn = ROWS;
let start: string | null = 'one';

function Harness() {
  const [shown, setShown] = useState<string | null>(start);
  useKeyboardMap({
    enabled: true, mobile: false, viewer: () => (shown ? 'other' : 'none'), changes: () => false,
    showSection: vi.fn(), showShortcuts: vi.fn(), closeViewer: () => setShown(null), phoneBack: vi.fn(),
  });
  return h('div', null,
    h('div', { className: 'sidebar-body' },
      h('div', { 'data-list-root': '' }, drawn.map((name) => h('button', {
        key: name, id: name, 'data-list-item': '', 'data-list-primary': '', 'data-list-current': shown === name ? '' : undefined,
        onClick: () => { opened.push(name); setShown(name); },
      }, name)))),
    h('section', { className: 'viewer-pane' },
      h('div', { className: 'viewer-pane-body', tabIndex: -1, id: 'viewer' },
        h('div', { 'data-escape-owner': '' }, h('button', { id: 'cancel-edit' }, 'Cancel')))));
}

const element = (id: string) => document.getElementById(id)!;
async function key(id: string, type: 'keydown' | 'keyup', name: string, init: KeyboardEventInit = {}) {
  let event!: KeyboardEvent;
  await act(async () => { event = new KeyboardEvent(type, { key: name, bubbles: true, cancelable: true, ...init }); element(id).dispatchEvent(event); });
  return event;
}
const frames = () => act(async () => { for (let frame = 0; frame < 4; frame++) await new Promise((resolve) => requestAnimationFrame(resolve)); });
async function mount() {
  await act(async () => { root.render(h(Harness)); });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  opened.length = 0;
  drawn = ROWS;
  start = 'one';
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it('returns focus to the row the viewer was showing when Esc closes it, not to the top of the list', async () => {
  start = 'four';
  await mount();
  element('viewer').focus();
  await key('viewer', 'keydown', 'Escape');
  await frames();
  expect(element('four').hasAttribute('data-list-current')).toBe(false);
  expect(document.activeElement).toBe(element('four'));
});

it('walks on row by row while j is held in the viewer, and opens only where it stops', async () => {
  await mount();
  element('viewer').focus();
  await key('viewer', 'keydown', 'j');
  expect(opened).toEqual(['two']);
  for (let repeat = 0; repeat < 2; repeat++) await key('viewer', 'keydown', 'j', { repeat: true });
  expect(opened).toEqual(['two']);
  await key('viewer', 'keyup', 'j');
  expect(opened).toEqual(['two', 'four']);
  expect(document.activeElement).toBe(element('viewer'));
});

it('opens nothing with j in the viewer while the row it shows is not among those drawn', async () => {
  start = 'five';
  drawn = ['one', 'two', 'three'];
  await mount();
  element('viewer').focus();
  const event = await key('viewer', 'keydown', 'j');
  await key('viewer', 'keyup', 'j');
  expect(opened).toEqual([]);
  expect(event.defaultPrevented).toBe(false);
});

it('leaves Esc to an editor or a log open inside the viewer', async () => {
  await mount();
  element('cancel-edit').focus();
  const event = await key('cancel-edit', 'keydown', 'Escape');
  expect(event.defaultPrevented).toBe(false);
  expect(element('one').hasAttribute('data-list-current')).toBe(true);
});

it('gives up the row a held key was about to open once Esc closes the viewer', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  await mount();
  element('one').focus();
  await key('one', 'keydown', 'j');
  await key('two', 'keydown', 'j', { repeat: true });
  expect(opened).toEqual(['two']);
  await key('three', 'keydown', 'Escape');
  await act(async () => { vi.advanceTimersByTime(1_000); });
  await key('three', 'keyup', 'j');
  expect(opened).toEqual(['two']);
});
