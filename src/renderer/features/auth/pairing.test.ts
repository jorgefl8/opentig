import { describe, expect, it, vi } from 'vitest';
import { exchangePairingFragment } from './pairing';

describe('pairing fragment exchange', () => {
  it('clears the fragment before exchanging the one-time token', async () => {
    const order: string[] = [];
    const replaceState = vi.fn(() => order.push('cleared'));
    const request = vi.fn(async (_input: string, init: RequestInit) => {
      order.push('requested');
      expect(init).toMatchObject({ method: 'POST', credentials: 'include' });
      expect(JSON.parse(String(init.body))).toEqual({ token: 'one-time-secret' });
      return { ok: true };
    });

    await expect(exchangePairingFragment(
      { pathname: '/pair', search: '', hash: '#token=one-time-secret' },
      { replaceState },
      request,
    )).resolves.toBe('paired');
    expect(order).toEqual(['cleared', 'requested']);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/pair');
  });

  it('does not send a request when the fragment contains no token', async () => {
    const request = vi.fn();
    await expect(exchangePairingFragment(
      { pathname: '/pair', search: '', hash: '#other=value' },
      { replaceState: vi.fn() },
      request,
    )).resolves.toBe('missing-token');
    expect(request).not.toHaveBeenCalled();
  });

  it('reports rejected and unavailable exchanges without retaining credentials', async () => {
    const location = { pathname: '/pair', search: '', hash: '#token=secret' };
    await expect(exchangePairingFragment(location, { replaceState: vi.fn() }, async () => ({ ok: false }))).resolves.toBe('rejected');
    await expect(exchangePairingFragment(location, { replaceState: vi.fn() }, async () => { throw new Error('offline'); })).resolves.toBe('unavailable');
  });
});
