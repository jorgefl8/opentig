// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ShimmeringText } from './shimmering-text';

let root: Root;
let host: HTMLDivElement;
let intersect: IntersectionObserverCallback;
const disconnect = vi.fn();
const observe = vi.fn();
let visibility: DocumentVisibilityState;
const container = () => host.querySelector<HTMLElement>('.shimmer-text')!;
const state = () => container().style.getPropertyValue('--shimmer-text-play-state');

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(ShimmeringText, { text: 'Thinking' })));
});

afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllGlobals();
});

async function viewport(isIntersecting: boolean) {
  const rect = container().getBoundingClientRect();
  await act(async () => intersect([{ target: container(), isIntersecting, boundingClientRect: rect, intersectionRect: rect, rootBounds: null, intersectionRatio: isIntersecting ? 1 : 0, time: 0 }], {} as IntersectionObserver));
}

async function documentVisibility(next: DocumentVisibilityState) {
  await act(async () => { visibility = next; document.dispatchEvent(new Event('visibilitychange')); });
}

it('runs only when the text intersects the viewport and the document is visible', async () => {
  expect(state()).toBe('paused');
  expect(observe).toHaveBeenCalledWith(container());
  await viewport(true);
  expect(state()).toBe('running');
  await documentVisibility('hidden');
  expect(state()).toBe('paused');
  await viewport(false);
  await documentVisibility('visible');
  expect(state()).toBe('paused');
  await viewport(true);
  expect(state()).toBe('running');
  await viewport(false);
  expect(state()).toBe('paused');
});

it('preserves timing, text and its running state across content updates', async () => {
  await viewport(true);
  await act(async () => root.render(createElement(ShimmeringText, { text: 'Still thinking', duration: 2, repeatDelay: 0.5, spread: 1.6 })));
  expect(container().textContent).toBe('Still thinking');
  expect(state()).toBe('running');
  const characters = [...container().children] as HTMLElement[];
  expect(characters[0]!.style.animationDuration).toBe('2.5s');
  expect(characters[1]!.style.animationDelay).toBe(`${(2 * 1.6) / characters.length}s`);
  expect(characters[0]!.style.animationTimingFunction).toBe('ease-in-out');
});

it('releases its observer and document listener on unmount', async () => {
  const removed = vi.spyOn(document, 'removeEventListener');
  const element = container();
  await viewport(true);
  await act(async () => root.unmount());
  expect(disconnect).toHaveBeenCalledOnce();
  expect(removed).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  await documentVisibility('hidden');
  expect(element.style.getPropertyValue('--shimmer-text-play-state')).toBe('running');
});

it('still follows document visibility without IntersectionObserver support', async () => {
  await act(async () => root.unmount());
  vi.stubGlobal('IntersectionObserver', undefined);
  root = createRoot(host);
  await act(async () => root.render(createElement(ShimmeringText, { text: 'Fallback' })));
  expect(state()).toBe('running');
  await documentVisibility('hidden');
  expect(state()).toBe('paused');
});
