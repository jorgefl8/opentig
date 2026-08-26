import { describe, expect, it, vi } from 'vitest';
import { consumePairingFragment, defaultDeviceName, exchangePairingToken } from './pairing';

describe('browser pairing', () => {
  it('clears and returns a fragment credential before any exchange', () => {
    const replaceState = vi.fn();
    expect(consumePairingFragment(
      { pathname: '/pair', search: '', hash: '#token=one-time-secret' },
      { replaceState },
    )).toBe('one-time-secret');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/pair');
  });

  it('submits both the one-use code and the user-visible device name', async () => {
    const request = vi.fn(async (_input: string, init: RequestInit) => {
      expect(init).toMatchObject({ method: 'POST', credentials: 'include' });
      expect(JSON.parse(String(init.body))).toEqual({ token: 'one-time-secret', clientName: 'Work laptop' });
      return { ok: true };
    });
    await expect(exchangePairingToken('one-time-secret', 'Work laptop', request)).resolves.toBe('paired');
  });

  it('reports rejected and unavailable exchanges', async () => {
    await expect(exchangePairingToken('secret', 'Browser', async () => ({ ok: false }))).resolves.toBe('rejected');
    await expect(exchangePairingToken('secret', 'Browser', async () => { throw new Error('offline'); })).resolves.toBe('unavailable');
  });

  it('suggests a recognizable browser and operating system name', () => {
    expect(defaultDeviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0')).toBe('Chrome on Windows');
    expect(defaultDeviceName('unknown')).toBe('Browser');
  });
});
