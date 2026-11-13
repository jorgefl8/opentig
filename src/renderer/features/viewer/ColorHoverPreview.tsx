import { useEffect, useMemo, useRef, useState } from 'react';
import { Tooltip, TooltipContent } from '@/components/ui/tooltip';
import { attributeFromPath, columnFromPoint, findLineElement, lineText, pathFromPoint, rangeForColumns } from './color-hover-dom';
import { createColorHoverController, type ColorHoverTarget } from './color-hover-controller';
import { colorRangeAt, isStylesheetLanguage, lineColors, type ColorRange } from './css-colors';
import { COLOR_LANGUAGE_ATTRIBUTE, type ColorSwatchRegistry } from './color-swatch-registry';
import './color-preview.css';

const SHOW_DELAY_MS = 300;

interface HoveredColor extends ColorHoverTarget, ColorRange {
  line: Element;
}

interface ColorHoverPreviewProps {
  /** The element whose rendered code lines are watched, looked up on each pointer move. */
  getRoot(): Element | null;
  /** The file's language; without it, the closest `data-color-language` above the hovered line decides. */
  language?: string | undefined;
  /** The swatches drawn in front of colors; hovering one previews its color too. */
  swatches?: ColorSwatchRegistry | undefined;
}

/**
 * Shows the color under the pointer in a tooltip, like VS Code's color hover.
 * It only listens and measures: nothing is added to Pierre's rendered lines,
 * which the editor owns while editing.
 */
export function ColorHoverPreview({ getRoot, language, swatches }: ColorHoverPreviewProps) {
  const [hovered, setHovered] = useState<HoveredColor | null>(null);
  const getRootRef = useRef(getRoot);
  const languageRef = useRef(language);
  const swatchesRef = useRef(swatches);
  const hideRef = useRef<() => void>(() => setHovered(null));
  useEffect(() => {
    getRootRef.current = getRoot;
    languageRef.current = language;
    swatchesRef.current = swatches;
  }, [getRoot, language, swatches]);

  useEffect(() => {
    const document = globalThis.document;
    const controller = createColorHoverController<HoveredColor>({ delayMs: SHOW_DELAY_MS, onChange: setHovered });
    let frame = 0;
    let latest: { path: EventTarget[]; x: number; y: number } | null = null;

    // The line last handed to the controller, and where the pointer rests over it.
    let target: Element | null = null;
    let resting: { x: number; y: number } | null = null;
    const update = (next: HoveredColor | null) => {
      target = next?.line ?? null;
      if (target) watchLines(target);
      controller.update(next);
    };

    const resolve = () => {
      frame = 0;
      const pointer = latest;
      latest = null;
      if (!pointer) return;
      const swatch = swatchesRef.current?.hit(pointer.x, pointer.y);
      if (swatch && !swatch.line.isConnected) {
        // The swatch layer redraws on the next frame after Pierre replaces its lines.
        latest = pointer;
        frame = requestAnimationFrame(resolve);
        return;
      }
      if (swatch) {
        update({ value: swatch.value, start: swatch.start, end: swatch.end, line: swatch.line, key: hoverKey(swatch.line, swatch.start, swatch.value) });
        return;
      }
      const line = findLineElement(pointer.path);
      const column = line && columnFromPoint(line, pointer.x, pointer.y);
      if (!line || column === null) {
        update(null);
        return;
      }
      const stylesheet = isStylesheetLanguage(languageRef.current ?? attributeFromPath(pointer.path, COLOR_LANGUAGE_ATTRIBUTE));
      const range = colorRangeAt(lineColors(lineText(line), stylesheet), column);
      update(range ? { ...range, line, key: hoverKey(line, range.start, range.value) } : null);
    };

    // Pierre replaces its line elements when highlighting arrives or the file
    // reloads. A preview anchored to a removed line would measure as nothing,
    // so look again at the resting pointer, without waiting for it to move.
    let watchedRoot: Node | null = null;
    const lineObserver = new MutationObserver(() => {
      if (!target || target.isConnected || !resting) return;
      latest = { path: pathFromPoint(document, resting.x, resting.y), ...resting };
      frame ||= requestAnimationFrame(resolve);
    });
    function watchLines(line: Element) {
      const root = line.getRootNode();
      if (root === watchedRoot) return;
      lineObserver.disconnect();
      lineObserver.observe(root, { childList: true, subtree: true });
      watchedRoot = root;
    }

    const hide = () => {
      latest = null;
      resting = null;
      update(null);
    };
    hideRef.current = hide;

    const onPointerMove = (event: PointerEvent) => {
      const root = getRootRef.current();
      // The path is only readable while the event dispatches, so keep it for the next frame.
      const path = event.composedPath();
      if (event.pointerType !== 'mouse' || event.buttons !== 0 || !root || !path.includes(root)) {
        hide();
        return;
      }
      resting = { x: event.clientX, y: event.clientY };
      latest = { path, ...resting };
      frame ||= requestAnimationFrame(resolve);
    };

    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    document.addEventListener('scroll', hide, { capture: true, passive: true });
    document.documentElement.addEventListener('pointerleave', hide);
    window.addEventListener('blur', hide);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      lineObserver.disconnect();
      controller.dispose();
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      document.removeEventListener('scroll', hide, { capture: true });
      document.documentElement.removeEventListener('pointerleave', hide);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Measured on demand, so the popup follows the text if the layout shifts.
  const anchor = useMemo(() => hovered && {
    getBoundingClientRect: () => rangeForColumns(hovered.line, hovered.start, hovered.end)?.getBoundingClientRect() ?? new DOMRect(),
  }, [hovered]);

  return (
    <Tooltip open={hovered !== null} onOpenChange={(open) => { if (!open) hideRef.current(); }}>
      {hovered && anchor && (
        <TooltipContent anchor={anchor} side="top" sideOffset={6} className="color-preview">
          <span className="color-preview-swatch" aria-hidden="true">
            <span style={{ backgroundColor: hovered.value }} />
          </span>
          <code className="color-preview-value">{hovered.value}</code>
        </TooltipContent>
      )}
    </Tooltip>
  );
}

const lineIds = new WeakMap<Element, number>();
let nextLineId = 0;

/**
 * The same color at the same place, whether reached through its text or its
 * swatch. A line element Pierre re-rendered counts as a new place, so the
 * preview moves to it.
 */
function hoverKey(line: Element, start: number, value: string): string {
  let id = lineIds.get(line);
  if (id === undefined) {
    nextLineId += 1;
    id = nextLineId;
    lineIds.set(line, id);
  }
  return `${id}:${start}:${value}`;
}
