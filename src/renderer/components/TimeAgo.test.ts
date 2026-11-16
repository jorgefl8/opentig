// @vitest-environment jsdom
import { Activity, act, createElement, memo } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AGE_TICK_MS, TimeAgo } from './TimeAgo';

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const agoOf = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

it('moves an age on while nothing around it is drawn again', async () => {
  const drawn = vi.fn();
  // Memoized with props that never change, as the list an age sits in.
  const Row = memo(({ value }: { value: string }) => { drawn(); return createElement('time', null, createElement(TimeAgo, { value })); });
  const value = agoOf(45);
  await act(async () => root.render(createElement(Row, { value })));
  expect(container.textContent).toBe('just now');

  await act(async () => { vi.advanceTimersByTime(AGE_TICK_MS); });
  expect(container.textContent).toBe('1m ago');
  await act(async () => { vi.advanceTimersByTime(4 * 60_000); });
  expect(container.textContent).toBe('5m ago');
  expect(drawn).toHaveBeenCalledTimes(1);
});

it('runs no timer once no age is on screen, and catches up when one shows again', async () => {
  // The same element each time, as a list that has nothing new to show: showing it again draws nothing by itself.
  const age = createElement(TimeAgo, { value: agoOf(0) });
  const shown = (mode: 'visible' | 'hidden') => createElement(Activity, { mode, children: age });
  await act(async () => root.render(shown('visible')));
  expect(vi.getTimerCount()).toBe(1);

  await act(async () => root.render(shown('hidden')));
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => { vi.advanceTimersByTime(10 * 60_000); });

  await act(async () => root.render(shown('visible')));
  expect(container.textContent).toBe('10m ago');
});
