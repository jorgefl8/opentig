import { describe, expect, it } from 'vitest';
import { resolveWindowControlsInset } from './window-controls';

describe('resolveWindowControlsInset', () => {
  it('measures the space left and right of the reported title bar area', () => {
    expect(resolveWindowControlsInset({ rect: { x: 0, width: 1062, height: 46 }, viewportWidth: 1200, mac: false, desktop: true }))
      .toEqual({ left: 0, right: 138, height: 46 });
    expect(resolveWindowControlsInset({ rect: { x: 78, width: 1122, height: 46 }, viewportWidth: 1200, mac: true, desktop: true }))
      .toEqual({ left: 78, right: 0, height: 46 });
  });

  it('falls back to the window control widths when no title bar area is reported', () => {
    expect(resolveWindowControlsInset({ rect: null, viewportWidth: 1200, mac: false, desktop: true }))
      .toEqual({ left: 0, right: 138, height: 0 });
    expect(resolveWindowControlsInset({ rect: null, viewportWidth: 1200, mac: true, desktop: true }))
      .toEqual({ left: 78, right: 0, height: 0 });
  });

  it('ignores an empty title bar area and never returns negative insets', () => {
    expect(resolveWindowControlsInset({ rect: { x: 0, width: 0, height: 46 }, viewportWidth: 1200, mac: false, desktop: true }))
      .toEqual({ left: 0, right: 138, height: 0 });
    expect(resolveWindowControlsInset({ rect: { x: 0, width: 1400, height: 46 }, viewportWidth: 1200, mac: false, desktop: true }))
      .toEqual({ left: 0, right: 0, height: 46 });
  });

  it('does not reserve native window controls in a browser', () => {
    expect(resolveWindowControlsInset({ rect: null, viewportWidth: 1200, mac: false, desktop: false }))
      .toEqual({ left: 0, right: 0, height: 0 });
    expect(resolveWindowControlsInset({ rect: { x: 0, width: 1062, height: 46 }, viewportWidth: 1200, mac: false, desktop: false }))
      .toEqual({ left: 0, right: 0, height: 0 });
  });
});
