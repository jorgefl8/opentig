import { platform, type Platform } from '@floating-ui/dom';

/**
 * In a browser, Interface size is CSS `zoom` on `<html>` (the desktop app
 * zooms the whole window instead). Floating UI, which places every tooltip,
 * menu and popover through Base UI, measures the anchor with
 * `getBoundingClientRect()`, which already includes that zoom, and writes the
 * result as CSS lengths, which the browser zooms again. At 110% a tooltip
 * landed at 1.1 times its anchor's position. Measuring the anchor and the
 * clipping area in the document's own CSS pixels keeps both sides in one unit.
 */

type Rect = { x: number; y: number; width: number; height: number };

/** The CSS zoom applied to the document element, 1 when there is none. */
export function documentZoom(root: HTMLElement = document.documentElement): number {
  const current = (root as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom;
  const zoom = typeof current === 'number' ? current : Number.parseFloat(getComputedStyle(root).zoom);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

export function unzoomRect<T extends Rect>(rect: T, zoom: number): T {
  if (zoom === 1) return rect;
  return { ...rect, x: rect.x / zoom, y: rect.y / zoom, width: rect.width / zoom, height: rect.height / zoom };
}

/**
 * The zoom to take out of Floating UI's measurements for `floating`. When the
 * popup is positioned against an element (a dialog's portal, for instance),
 * Floating UI already divides by that element's scale, which includes the
 * zoom; only popups placed against the window need the correction.
 */
async function uncorrectedZoom(platformThis: Platform, floating: Element): Promise<number> {
  const getOffsetParent = platformThis.getOffsetParent ?? platform.getOffsetParent;
  const offsetParent = getOffsetParent ? await getOffsetParent(floating) : null;
  if (offsetParent instanceof Element) return 1;
  return documentZoom(floating.ownerDocument.documentElement);
}

let installed = false;

/** Patches Floating UI's shared DOM platform once; idempotent. */
export function installZoomAwarePositioning(target: Platform = platform): void {
  if (installed && target === platform) return;
  if (target === platform) installed = true;
  const getElementRects = target.getElementRects;
  const getClippingRect = target.getClippingRect;

  target.getElementRects = async function (this: Platform, data) {
    const rects = await getElementRects.call(this, data);
    const zoom = await uncorrectedZoom(this, data.floating);
    return zoom === 1 ? rects : { ...rects, reference: unzoomRect(rects.reference, zoom) };
  };
  target.getClippingRect = async function (this: Platform, data) {
    const rect = await getClippingRect.call(this, data);
    return unzoomRect(rect, await uncorrectedZoom(this, data.element));
  };
}
