import { describe, expect, it } from 'vitest';
import { resolveWindowControlsInset } from './window-controls';

describe('resolveWindowControlsInset', () => {
  it('measures the space left and right of the reported title bar area', () => {
    expect(resolveWindowControlsInset({ rect: { x: 0, width: 1062 }, viewportWidth: 1200, mac: false }))
      .toEqual({ left: 0, right: 138 });
    expect(resolveWindowControlsInset({ rect: { x: 78, width: 1122 }, viewportWidth: 1200, mac: true }))
      .toEqual({ left: 78, right: 0 });
  });

  it('falls back to the window control widths when no title bar area is reported', () => {
    expect(resolveWindowControlsInset({ rect: null, viewportWidth: 1200, mac: false }))
      .toEqual({ left: 0, right: 138 });
    expect(resolveWindowControlsInset({ rect: null, viewportWidth: 1200, mac: true }))
      .toEqual({ left: 78, right: 0 });
  });

  it('ignores an empty title bar area and never returns negative insets', () => {
    expect(resolveWindowControlsInset({ rect: { x: 0, width: 0 }, viewportWidth: 1200, mac: false }))
      .toEqual({ left: 0, right: 138 });
    expect(resolveWindowControlsInset({ rect: { x: 0, width: 1400 }, viewportWidth: 1200, mac: false }))
      .toEqual({ left: 0, right: 0 });
  });
});
