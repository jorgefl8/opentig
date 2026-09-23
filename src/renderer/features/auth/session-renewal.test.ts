import { afterEach, describe, expect, it, vi } from 'vitest';
import { maintainBrowserSession } from './session-renewal';

const stops: Array<() => void> = [];
afterEach(() => { stops.splice(0).forEach((stop) => stop()); vi.useRealTimers(); });

function fixture(request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))) {
  vi.useFakeTimers();
  const page = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
  const lifecycle = new EventTarget();
  const stop = maintainBrowserSession({ request, page, lifecycle });
  stops.push(stop);
  return { page, lifecycle, request, stop };
}

describe('browser session renewal', () => {
  it('renews on entry, hourly while visible, and when the page returns to the foreground', async () => {
    const f = fixture();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.request).toHaveBeenCalledWith('/api/auth/renew', expect.objectContaining({ method: 'POST', credentials: 'include', cache: 'no-store' }));
    await vi.advanceTimersByTimeAsync(60 * 60 * 1_000);
    expect(f.request).toHaveBeenCalledTimes(2);
    f.page.visibilityState = 'hidden';
    f.page.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1_000);
    expect(f.request).toHaveBeenCalledTimes(2);
    f.page.visibilityState = 'visible';
    f.page.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.request).toHaveBeenCalledTimes(3);
    f.lifecycle.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.request).toHaveBeenCalledTimes(4);
  });

  it('retries transient failures and responds to the browser coming online', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValue(new Response(null, { status: 204 }));
    const f = fixture(request);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(2);
    f.lifecycle.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('allows only one pending renewal and aborts it when disposed', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const f = fixture(request);
    f.lifecycle.dispatchEvent(new Event('focus'));
    f.lifecycle.dispatchEvent(new Event('online'));
    expect(request).toHaveBeenCalledTimes(1);
    const signal = request.mock.calls[0]![1]!.signal!;
    f.stop();
    expect(signal.aborted).toBe(true);
    f.lifecycle.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1_000);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('times out a stuck request and retries instead of leaving renewal blocked', async () => {
    const request = vi.fn<typeof fetch>().mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new Error('aborted')));
    })).mockResolvedValue(new Response(null, { status: 204 }));
    fixture(request);
    await vi.advanceTimersByTimeAsync(70_000);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403])('does not keep retrying rejected credentials (%s)', async (status) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
    fixture(request);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
