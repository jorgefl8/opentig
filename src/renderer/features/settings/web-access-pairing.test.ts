import { describe, expect, it } from 'vitest';
import { PairingRequests } from './web-access-pairing';

describe('pairing request display', () => {
  it('prevents overlapping minting and does not reopen after dismissal', () => {
    const requests = new PairingRequests();
    const first = requests.begin()!;
    requests.dismiss();
    expect(requests.begin()).toBeNull();
    expect(requests.isCurrent(first)).toBe(false);
    expect(requests.finish(first)).toBe(false);
    const second = requests.begin()!;
    expect(requests.isCurrent(first)).toBe(false);
    expect(requests.finish(second)).toBe(true);
  });
  it('only expires the displayed request and invalidates results on cleanup', () => {
    const requests = new PairingRequests();
    const first = requests.begin()!;
    requests.finish(first);
    const second = requests.begin()!;
    expect(requests.isCurrent(first)).toBe(false);
    requests.dismiss();
    expect(requests.finish(second)).toBe(false);
  });
});
