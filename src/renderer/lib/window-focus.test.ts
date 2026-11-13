import { afterEach, describe, expect, it } from 'vitest';
import { focusManager, QueryClient, QueryObserver } from '@tanstack/react-query';
import { listenForWindowReturn, WINDOW_RETURN_MIN_GAP_MS } from './window-focus';

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
