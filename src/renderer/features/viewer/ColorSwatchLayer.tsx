import { useEffect, useRef, useState } from 'react';
import { lineText, rangeForColumns } from './color-hover-dom';
import { boxInside, sameSwatches, swatchBox, swatchSlots, type Bounds, type PlacedSwatch } from './color-swatches';
import { isStylesheetLanguage, lineColors } from './css-colors';
import { COLOR_LANGUAGE_ATTRIBUTE, type ColorSwatchRegistry } from './color-swatch-registry';
import './color-preview.css';

/** Swatches drawn at most, so a file full of colors stays cheap to scroll. */
const MAX_SWATCHES = 300;
/** Lines this far outside the viewport get swatches ahead of scrolling into it. */
const VIEWPORT_MARGIN = 200;
/** Pierre's own floating parts (caret, selections, find panel); changes there move no text. */
const PIERRE_OVERLAY = '[data-editor-overlay], [data-search-panel], [data-editor-widget]';

/** Keys survive re-renders of the same line element, and differ between the two sides of a split diff. */
const lineIds = new WeakMap<Element, number>();
let nextLineId = 0;
function lineId(line: Element): number {
  let id = lineIds.get(line);
  if (id === undefined) {
    nextLineId += 1;
    id = nextLineId;
    lineIds.set(line, id);
  }
  return id;
}

interface ColorSwatchLayerProps {
  registry: ColorSwatchRegistry;
  /** The file's language; without it, the closest `data-color-language` above each file decides. */
  language?: string | undefined;
}

/**
 * Draws a small swatch in front of each color in the rendered files next to
 * it, like VS Code's color decorators. It goes inside the scrolled content,
 * before the files, so swatches scroll with the code; Pierre's lines are only
 * read and measured, never changed.
 */
export function ColorSwatchLayer({ registry, language }: ColorSwatchLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const languageRef = useRef(language);
  const [swatches, setSwatches] = useState<readonly PlacedSwatch[]>([]);
  useEffect(() => { languageRef.current = language; }, [language]);

  useEffect(() => {
    const layer = layerRef.current;
    const scope = layer?.parentElement;
    if (!layer || !scope) return;
    const viewport = scope.parentElement ?? scope;
    let frame = 0;
    let current: readonly PlacedSwatch[] = [];

    const schedule = () => { frame ||= requestAnimationFrame(compute); };
    const watched = new WeakSet<ShadowRoot>();
    const shadowObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        if (!target?.closest(PIERRE_OVERLAY)) {
          schedule();
          return;
        }
      }
    });
    const watch = (shadow: ShadowRoot) => {
      if (watched.has(shadow)) return;
      watched.add(shadow);
      shadowObserver.observe(shadow, { childList: true, subtree: true, characterData: true });
      // Scroll events stay inside the shadow tree; the code scrolls sideways there.
      shadow.addEventListener('scroll', schedule, { capture: true, passive: true });
    };

    function compute() {
      frame = 0;
      if (!layer!.isConnected) return;
      const origin = layer!.getBoundingClientRect();
      const view = viewport.getBoundingClientRect();
      const next: PlacedSwatch[] = [];
      for (const host of scope!.querySelectorAll('diffs-container')) {
        const shadow = host.shadowRoot;
        if (!shadow) continue;
        watch(shadow);
        const stylesheet = isStylesheetLanguage(languageRef.current ?? host.closest(`[${COLOR_LANGUAGE_ATTRIBUTE}]`)?.getAttribute(COLOR_LANGUAGE_ATTRIBUTE) ?? undefined);
        const clips = new Map<Element, Bounds>();
        for (const line of shadow.querySelectorAll('[data-line]')) {
          if (next.length >= MAX_SWATCHES) break;
          const lineBox = line.getBoundingClientRect();
          if (lineBox.bottom < view.top - VIEWPORT_MARGIN || lineBox.top > view.bottom + VIEWPORT_MARGIN || lineBox.height === 0) continue;
          const text = lineText(line);
          const ranges = lineColors(text, stylesheet);
          if (ranges.length === 0) continue;
          const code = line.closest('[data-code]');
          let clip = code ? clips.get(code) : undefined;
          if (code && !clip) {
            clip = visibleCode(code, view);
            clips.set(code, clip);
          }
          for (const { range, cell } of swatchSlots(text, ranges)) {
            const cellBox = rangeForColumns(line, cell, cell + 1)?.getBoundingClientRect();
            if (!cellBox || cellBox.width === 0) continue;
            const box = swatchBox(cellBox);
            if (clip && !boxInside(box, clip)) continue;
            next.push({
              key: `${lineId(line)}:${range.start}`,
              value: range.value,
              line,
              start: range.start,
              end: range.end,
              left: box.left - origin.left,
              top: box.top - origin.top,
              size: box.size,
            });
            if (next.length >= MAX_SWATCHES) break;
          }
        }
      }
      if (sameSwatches(current, next)) return;
      current = next;
      registry.update(layer!, next);
      setSwatches(next);
    }

    const lightObserver = new MutationObserver(schedule);
    lightObserver.observe(scope, { childList: true, subtree: true });
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(viewport);
    resizeObserver.observe(scope);
    viewport.addEventListener('scroll', schedule, { passive: true });
    document.fonts?.addEventListener('loadingdone', schedule);
    schedule();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      shadowObserver.disconnect();
      lightObserver.disconnect();
      resizeObserver.disconnect();
      viewport.removeEventListener('scroll', schedule);
      document.fonts?.removeEventListener('loadingdone', schedule);
      registry.update(null, []);
    };
  }, [registry]);

  return (
    <div ref={layerRef} className="color-swatch-layer" aria-hidden="true">
      {swatches.map((swatch) => (
        <span
          key={swatch.key}
          className="color-preview-swatch color-swatch"
          style={{ left: swatch.left, top: swatch.top, width: swatch.size, height: swatch.size }}
        >
          <span style={{ backgroundColor: swatch.value }} />
        </span>
      ))}
    </div>
  );
}

/** The part of a code column on screen: right of its sticky gutter and inside the viewport. */
function visibleCode(code: Element, view: DOMRect): Bounds {
  const box = code.getBoundingClientRect();
  const gutter = [...code.children].find((child) => child.hasAttribute('data-gutter'));
  const left = Math.max(box.left, gutter ? gutter.getBoundingClientRect().right : box.left, view.left);
  const right = Math.min(box.left + code.clientWidth, view.right);
  return { left, right, top: view.top - VIEWPORT_MARGIN, bottom: view.bottom + VIEWPORT_MARGIN };
}
