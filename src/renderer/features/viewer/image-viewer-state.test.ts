import { describe, expect, it } from 'vitest';
import {
  MAX_IMAGE_ZOOM,
  MIN_IMAGE_ZOOM,
  clampImageZoom,
  zoomIn,
  zoomOut,
} from './image-viewer-state';

describe('image viewer zoom state', () => {
  it('clamps invalid and out-of-range values', () => {
    expect(clampImageZoom(Number.NaN)).toBe(1);
    expect(clampImageZoom(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampImageZoom(0)).toBe(MIN_IMAGE_ZOOM);
    expect(clampImageZoom(20)).toBe(MAX_IMAGE_ZOOM);
  });

  it('uses predictable zoom steps from 100%', () => {
    expect(zoomIn(1)).toBe(1.25);
    expect(zoomOut(1)).toBe(0.75);
    expect(zoomOut(zoomIn(1))).toBe(1);
    expect(zoomIn(zoomOut(1))).toBe(1);
  });

  it('stops at both limits', () => {
    expect(zoomOut(MIN_IMAGE_ZOOM)).toBe(MIN_IMAGE_ZOOM);
    expect(zoomIn(MAX_IMAGE_ZOOM)).toBe(MAX_IMAGE_ZOOM);
  });
});
