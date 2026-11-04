// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { revealSourceLine, type FileLineTarget } from './file-line-target';

let frames: Array<() => void>;
const scheduler = {
  requestFrame(callback: () => void) { frames.push(callback); return frames.length; },
  cancelFrame() { frames.length = 0; },
};
const runFrames = (count: number) => { for (let i = 0; i < count && frames.length; i += 1) frames.shift()!(); };

function editor({ renderedFrom = 1, renderedTo = 100 }: { renderedFrom?: number; renderedTo?: number } = {}) {
  const scroller = document.createElement('div');
  Object.defineProperties(scroller, { clientHeight: { value: 400 }, scrollHeight: { value: 2000 } });
  scroller.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  for (let line = renderedFrom; line <= renderedTo; line += 1) {
    const element = document.createElement('div');
    element.dataset.line = String(line);
    // Each line is 20px, measured against the scroller's own offset.
    element.getBoundingClientRect = () => ({ top: 100 + (line - 1) * 20 - scroller.scrollTop, height: 20 }) as DOMRect;
    shadow.append(element);
  }
  scroller.append(host);
  return scroller;
}
const target = (line: number): FileLineTarget => ({ path: 'a.js', line, reached: false });

beforeEach(() => { frames = []; });
afterEach(() => { frames = []; });

it('centres the line and then lets go', () => {
  const scroller = editor();
  const wanted = target(51);
  revealSourceLine(() => scroller, wanted, 100, scheduler);
  runFrames(10);
  expect(scroller.scrollTop).toBe(50 * 20 - (400 - 20) / 2);
  expect(wanted.reached).toBe(true);
  expect(frames).toHaveLength(0);
});

it('stays at the top for a line that is already in view', () => {
  const scroller = editor();
  revealSourceLine(() => scroller, target(2), 100, scheduler);
  runFrames(10);
  expect(scroller.scrollTop).toBe(0);
});

it('heads for the line\'s share of the file while it isn\'t rendered', () => {
  const scroller = editor({ renderedFrom: 1, renderedTo: 0 });
  const wanted = target(51);
  revealSourceLine(() => scroller, wanted, 100, scheduler);
  runFrames(1);
  expect(scroller.scrollTop).toBe((2000 - 400) * 0.5);
  expect(wanted.reached).toBe(false);
  runFrames(200);
  expect(wanted.reached).toBe(true);
});

it('waits for the editor to exist', () => {
  let scroller: HTMLElement | null = null;
  revealSourceLine(() => scroller, target(51), 100, scheduler);
  runFrames(3);
  scroller = editor();
  runFrames(10);
  expect(scroller.scrollTop).toBeGreaterThan(0);
});

it('gives the scroll back as soon as the editor is touched', () => {
  const scroller = editor();
  const wanted = target(51);
  revealSourceLine(() => scroller, wanted, 100, scheduler);
  runFrames(1);
  scroller.dispatchEvent(new Event('pointerdown'));
  expect(wanted.reached).toBe(true);
  expect(frames).toHaveLength(0);
});

it('leaves the target to be reached later when it is cancelled', () => {
  const scroller = editor();
  const wanted = target(51);
  const cancel = revealSourceLine(() => scroller, wanted, 100, scheduler);
  runFrames(1);
  cancel();
  expect(wanted.reached).toBe(false);
  expect(frames).toHaveLength(0);
});
