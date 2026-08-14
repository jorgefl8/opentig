export type ImageSizingMode = 'fit' | 'actual';

export const MIN_IMAGE_ZOOM = 0.25;
export const MAX_IMAGE_ZOOM = 8;

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8] as const;

export function clampImageZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_IMAGE_ZOOM, Math.max(MIN_IMAGE_ZOOM, value));
}

export function zoomIn(value: number): number {
  const current = clampImageZoom(value);
  return ZOOM_STEPS.find((step) => step > current + Number.EPSILON) ?? MAX_IMAGE_ZOOM;
}

export function zoomOut(value: number): number {
  const current = clampImageZoom(value);
  return [...ZOOM_STEPS].reverse().find((step) => step < current - Number.EPSILON) ?? MIN_IMAGE_ZOOM;
}
