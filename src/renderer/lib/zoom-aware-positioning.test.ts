// @vitest-environment jsdom
import type { Platform } from '@floating-ui/dom';
import { afterEach, describe, expect, it } from 'vitest';
import { documentZoom, installZoomAwarePositioning, unzoomRect } from './zoom-aware-positioning';

const reference = { x: 330, y: 88, width: 44, height: 22 };
const floating = { x: 0, y: 0, width: 120, height: 30 };
const viewport = { x: 0, y: 0, width: 1280, height: 720 };

function fakePlatform(offsetParent: Element | Window): Platform {
  return {
    getElementRects: async () => ({ reference: { ...reference }, floating: { ...floating } }),
    getClippingRect: async () => ({ ...viewport }),
    getDimensions: async () => ({ width: floating.width, height: floating.height }),
    getOffsetParent: async () => offsetParent,
  } as unknown as Platform;
}

function setZoom(zoom: number | undefined) {
  Object.defineProperty(document.documentElement, 'currentCSSZoom', { value: zoom, configurable: true });
}

afterEach(() => setZoom(undefined));

describe('zoom-aware positioning', () => {
  it('reads the document zoom and leaves rects alone without one', () => {
    expect(documentZoom()).toBe(1);
    setZoom(1.1);
    expect(documentZoom()).toBe(1.1);
    expect(unzoomRect(reference, 1)).toBe(reference);
  });

  it('measures popups placed against the window in CSS pixels', async () => {
    setZoom(1.1);
    const platform = fakePlatform(window);
    installZoomAwarePositioning(platform);
    const element = document.createElement('div');
    const rects = await platform.getElementRects({ reference: element, floating: element, strategy: 'absolute' });
    expect(rects.reference).toEqual({ x: 300, y: 80, width: 40, height: 20 });
    expect(rects.floating).toEqual(floating);
    const clip = await platform.getClippingRect({ element, boundary: 'clippingAncestors', rootBoundary: 'viewport', strategy: 'absolute' });
    expect(clip.width).toBeCloseTo(1280 / 1.1);
    expect(clip.height).toBeCloseTo(720 / 1.1);
  });

  it('leaves popups placed against an element to Floating UI, which already scales them', async () => {
    setZoom(1.3);
    const platform = fakePlatform(document.body);
    installZoomAwarePositioning(platform);
    const element = document.createElement('div');
    const rects = await platform.getElementRects({ reference: element, floating: element, strategy: 'absolute' });
    expect(rects.reference).toEqual(reference);
    expect(await platform.getClippingRect({ element, boundary: 'clippingAncestors', rootBoundary: 'viewport', strategy: 'absolute' })).toEqual(viewport);
  });
});
