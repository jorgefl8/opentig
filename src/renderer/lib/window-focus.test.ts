// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusManager, QueryClient, QueryObserver } from '@tanstack/react-query';
import { IDLE_AFTER_MS, isUserIdle, listenForWindowReturn, pausePollingWhileIdle, WINDOW_RETURN_MIN_GAP_MS } from './window-focus';

function fakeWindow() {
  const target = new EventTarget() as EventTarget & { document: { visibilityState: DocumentVisibilityState } };
  target.document = { visibilityState: 'visible' };
  return target;
}

describe('window return listener', () => {
  afterEach(() => { focusManager.setEventListener(() => undefined); });

  it('notifies when a visible window regains focus or becomes visible, at most once per gap', () => {
    const target = fakeWindow();
    let clock = 0;
    let notified = 0;
    const cleanup = listenForWindowReturn(target, () => clock)(() => { notified++; });

    target.dispatchEvent(new Event('focus'));
    expect(notified).toBe(1);
    // Becoming visible together with the focus is the same return.
    target.dispatchEvent(new Event('visibilitychange'));
    expect(notified).toBe(1);

    clock += WINDOW_RETURN_MIN_GAP_MS;
    target.dispatchEvent(new Event('visibilitychange'));
    expect(notified).toBe(2);

    clock += WINDOW_RETURN_MIN_GAP_MS;
    target.document.visibilityState = 'hidden';
    target.dispatchEvent(new Event('visibilitychange'));
    target.dispatchEvent(new Event('focus'));
    expect(notified).toBe(2);

    cleanup();
    target.document.visibilityState = 'visible';
    target.dispatchEvent(new Event('focus'));
    expect(notified).toBe(2);
  });

  it('makes refetchOnWindowFocus queries read again when the window regains focus', async () => {
    const target = fakeWindow();
    focusManager.setEventListener(listenForWindowReturn(target));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
    client.mount();
    let reads = 0;
    const observer = new QueryObserver(client, {
      queryKey: ['repository', 'repo', 'branch-pull-request', 'feature'],
      queryFn: async () => ++reads,
      staleTime: 60_000,
      refetchOnWindowFocus: 'always',
    });
    const unsubscribe = observer.subscribe(() => undefined);
    try {
      await expect.poll(() => reads).toBe(1);
      target.dispatchEvent(new Event('focus'));
      await expect.poll(() => reads).toBe(2);
    } finally {
      unsubscribe();
      client.unmount();
    }
  });
});

describe('polling while nobody is there', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('stops reading on a timer after six minutes without activity or while hidden, and reads at once when the user is back', async () => {
    vi.useFakeTimers();
    const target = fakeWindow();
    let notified = 0;
    const manager = { isFocused: () => target.document.visibilityState !== 'hidden' };
    pausePollingWhileIdle(manager);
    const cleanup = listenForWindowReturn(target)(() => { notified++; });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.mount();
    let reads = 0;
    // What a polling query does on each tick, with the manager the app gives TanStack Query.
    const timer = setInterval(() => { if (manager.isFocused()) reads++; }, 60_000);
    try {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(reads).toBe(5);
      // Moving the pointer counts as being there.
      target.dispatchEvent(new Event('pointermove'));
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(reads).toBe(10);
      expect(isUserIdle()).toBe(false);
      await vi.advanceTimersByTimeAsync(IDLE_AFTER_MS);
      const whileIdle = reads;
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(reads).toBe(whileIdle);
      expect(notified).toBe(0);
      // The first key press is a return to the window: what refreshes on return does, and the timers go on.
      target.dispatchEvent(new Event('keydown'));
      expect(notified).toBe(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(reads).toBe(whileIdle + 1);
      // So is switching back to the window after a long while, before touching anything in it.
      await vi.advanceTimersByTimeAsync(IDLE_AFTER_MS);
      expect(isUserIdle()).toBe(true);
      target.dispatchEvent(new Event('focus'));
      expect(notified).toBe(2);
      expect(isUserIdle()).toBe(false);
      const afterReturn = reads;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(reads).toBe(afterReturn + 1);
      target.document.visibilityState = 'hidden';
      await vi.advanceTimersByTimeAsync(3 * 60_000);
      expect(reads).toBe(afterReturn + 1);
    } finally {
      clearInterval(timer);
      cleanup();
      client.unmount();
    }
  });

  it('pauses a real polling query through the focus manager it asks on every tick', async () => {
    vi.useFakeTimers();
    const target = fakeWindow();
    // The same two calls the app makes on TanStack Query's own manager.
    const original = focusManager.isFocused;
    focusManager.setEventListener(listenForWindowReturn(target));
    pausePollingWhileIdle(focusManager);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.mount();
    let reads = 0;
    // As a pull request's status is read: on a timer, and again on returning to the window.
    const observer = new QueryObserver(client, { queryKey: ['repository', 'repo', 'pull-request-state', 1], queryFn: async () => ++reads, refetchInterval: 60_000, refetchOnWindowFocus: 'always' });
    const unsubscribe = observer.subscribe(() => undefined);
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(reads).toBe(1);
      await vi.advanceTimersByTimeAsync(IDLE_AFTER_MS + 20 * 60_000);
      // Five ticks fit before the six minutes are up; none of the twenty after them read.
      expect(reads).toBe(6);
      // Coming back reads at once, and the timer carries on from there.
      target.dispatchEvent(new Event('pointerdown'));
      await vi.advanceTimersByTimeAsync(0);
      expect(reads).toBe(7);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(reads).toBe(8);
    } finally {
      unsubscribe();
      client.unmount();
      focusManager.isFocused = original;
    }
  });
});
