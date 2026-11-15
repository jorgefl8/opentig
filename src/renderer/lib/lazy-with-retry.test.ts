// @vitest-environment jsdom
import { act, createElement, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { importWithRetry, isModuleLoadError, lazyWithPreload, preloadWhenIdle } from './lazy-with-retry';

describe('isModuleLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://example.invalid/assets/PierreDiffViewer-C3j-CXjN.js',
    'Importing a module script failed.',
    'error loading dynamically imported module: https://example.invalid/assets/a.js',
    'Unable to preload CSS for /assets/a.css',
  ])('recognises %s', (message) => {
    expect(isModuleLoadError(new TypeError(message))).toBe(true);
  });

  it('leaves other errors alone', () => {
    expect(isModuleLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
  });
});

describe('importWithRetry', () => {
  const dropped = () => new TypeError('Importing a module script failed.');

  it('tries a dropped download again', async () => {
    const load = vi.fn().mockRejectedValueOnce(dropped()).mockResolvedValue('module');
    await expect(importWithRetry(load, [0, 0])).resolves.toBe('module');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('gives up after its retries, with the last error', async () => {
    const load = vi.fn().mockRejectedValue(dropped());
    await expect(importWithRetry(load, [0, 0])).rejects.toThrow('Importing a module script failed.');
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('does not retry an error inside the module', async () => {
    const load = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(importWithRetry(load, [0, 0])).rejects.toThrow('boom');
    expect(load).toHaveBeenCalledOnce();
  });
});

describe('lazyWithPreload', () => {
  it('renders preloaded code straight away, without its fallback, and loads it once', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const load = vi.fn(async () => ({ default: ({ name }: { name: string }) => createElement('p', null, `Hello ${name}`) }));
    const Greeting = lazyWithPreload(load);
    Greeting.preload();
    Greeting.preload();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const container = document.createElement('div');
    const root = createRoot(container);
    act(() => root.render(createElement(Suspense, { fallback: createElement('p', null, 'Loading') }, createElement(Greeting, { name: 'there' }))));
    expect(container.textContent).toBe('Hello there');
    expect(load).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });
});

describe('preloadWhenIdle', () => {
  const desktop = { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' };
  const parts = () => [{ preload: vi.fn() }, { preload: vi.fn() }, { preload: vi.fn() }];
  const started = (list: ReturnType<typeof parts>) => list.map((part) => part.preload.mock.calls.length);
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('downloads one part per idle moment, in order, and stops when called off', async () => {
    vi.useFakeTimers();
    // Without requestIdleCallback an idle moment is a short timer.
    vi.stubGlobal('requestIdleCallback', undefined);
    const list = parts();
    const cancel = preloadWhenIdle(list, desktop);
    // Nothing competes with the app starting up.
    expect(started(list)).toEqual([0, 0, 0]);
    await vi.advanceTimersByTimeAsync(200);
    expect(started(list)).toEqual([1, 0, 0]);
    await vi.advanceTimersByTimeAsync(200);
    expect(started(list)).toEqual([1, 1, 0]);
    cancel();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(started(list)).toEqual([1, 1, 0]);
  });

  it('downloads nothing ahead when the user saves data or the phone is low on memory', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
    const saving = parts();
    preloadWhenIdle(saving, { ...desktop, connection: { saveData: true } });
    const lowEnd = parts();
    preloadWhenIdle(lowEnd, { userAgent: 'Mozilla/5.0 (Linux; Android 14)', deviceMemory: 2, hardwareConcurrency: 8 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(started(saving)).toEqual([0, 0, 0]);
    expect(started(lowEnd)).toEqual([0, 0, 0]);
  });
});
