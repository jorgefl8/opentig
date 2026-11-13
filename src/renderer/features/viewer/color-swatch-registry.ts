import { swatchAt, type PlacedSwatch } from './color-swatches';

/** Set on an ancestor of a rendered file when one viewer shows several languages, as a diff does. */
export const COLOR_LANGUAGE_ATTRIBUTE = 'data-color-language';

/** Shares the swatches on screen between the layer that draws them and the hover preview. */
export interface ColorSwatchRegistry {
  /** The swatch under a viewport point. */
  hit(x: number, y: number): PlacedSwatch | undefined;
  /** Records what the layer drew, positioned relative to `layer`; null when it unmounts. */
  update(layer: Element | null, swatches: readonly PlacedSwatch[]): void;
}

export function createColorSwatchRegistry(): ColorSwatchRegistry {
  let layer: Element | null = null;
  let swatches: readonly PlacedSwatch[] = [];
  return {
    hit(x, y) {
      if (!layer || swatches.length === 0) return undefined;
      return swatchAt(swatches, layer.getBoundingClientRect(), x, y);
    },
    update(nextLayer, nextSwatches) {
      layer = nextLayer;
      swatches = nextSwatches;
    },
  };
}
