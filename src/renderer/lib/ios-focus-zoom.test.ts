// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { isIos, preventIosFocusZoom } from './ios-focus-zoom';

const base = 'width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content';
const meta = () => document.querySelector<HTMLMetaElement>('meta[name="viewport"]')!;
beforeEach(() => { document.head.innerHTML = `<meta name="viewport" content="${base}">`; });

describe('preventIosFocusZoom', () => {
  it('stops focus zoom on iOS, once', () => {
    preventIosFocusZoom(document, true);
    preventIosFocusZoom(document, true);
    expect(meta().content).toBe(`${base}, maximum-scale=1`);
  });

  it('leaves pinch zoom alone elsewhere', () => {
    preventIosFocusZoom(document, false);
    expect(meta().content).toBe(base);
  });
});

describe('isIos', () => {
  it.each([
    [{ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Brave', platform: 'iPhone', maxTouchPoints: 5 }, true],
    [{ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 }, true],
    [{ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', platform: 'MacIntel', maxTouchPoints: 0 }, false],
    [{ userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/140.0 Mobile', platform: 'Linux armv8l', maxTouchPoints: 5 }, false],
  ])('recognises %o', (nav, expected) => {
    expect(isIos(nav)).toBe(expected);
  });
});
