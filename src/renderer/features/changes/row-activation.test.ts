import { describe, expect, it, vi } from 'vitest';
import { shouldActivateChangeRow } from './row-activation';

describe('shouldActivateChangeRow', () => {
  it('activates the row for its non-control spacing', () => {
    const closest = vi.fn(() => null);

    expect(shouldActivateChangeRow({ closest } as unknown as EventTarget)).toBe(true);
    expect(closest).toHaveBeenCalledWith('button, a, input, select, textarea, [role="button"]');
  });

  it('leaves nested controls responsible for their own clicks', () => {
    const closest = vi.fn(() => ({}));

    expect(shouldActivateChangeRow({ closest } as unknown as EventTarget)).toBe(false);
  });

  it('treats a direct row target as activatable', () => {
    expect(shouldActivateChangeRow(null)).toBe(true);
  });
});
