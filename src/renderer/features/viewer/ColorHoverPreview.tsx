import { useEffect, useMemo, useRef, useState } from 'react';
import { Tooltip, TooltipContent } from '@/components/ui/tooltip';
import { attributeFromPath, columnFromPoint, findLineElement, lineText, rangeForColumns } from './color-hover-dom';
import { createColorHoverController, type ColorHoverTarget } from './color-hover-controller';
import { browserColorValidator, colorRangeAt, findColorRanges, isStylesheetLanguage, type ColorRange } from './css-colors';
import './color-preview.css';

/** Set on an ancestor of a rendered file when one viewer shows several languages, as a diff does. */
export const COLOR_LANGUAGE_ATTRIBUTE = 'data-color-language';

const SHOW_DELAY_MS = 300;
const LINE_CACHE_SIZE = 200;

interface HoveredColor extends ColorHoverTarget, ColorRange {
  line: Element;
}

interface ColorHoverPreviewProps {
  /** The element whose rendered code lines are watched, looked up on each pointer move. */
  getRoot(): Element | null;
  /** The file's language; without it, the closest `data-color-language` above the hovered line decides. */
  language?: string | undefined;
}

/**
 * Shows the color under the pointer in a tooltip, like VS Code's color hover.
 * It only listens and measures: nothing is added to Pierre's rendered lines,
 * which the editor owns while editing.
 */
export function ColorHoverPreview({ getRoot, language }: ColorHoverPreviewProps) {
  const [hovered, setHovered] = useState<HoveredColor | null>(null);
  const getRootRef = useRef(getRoot);
  const languageRef = useRef(language);
  const hideRef = useRef<() => void>(() => setHovered(null));
  useEffect(() => {
    getRootRef.current = getRoot;
    languageRef.current = language;
  }, [getRoot, language]);

  useEffect(() => {
    const document = globalThis.document;
    const isValid = browserColorValidator();
    const lines = new Map<string, ColorRange[]>();
    const controller = createColorHoverController<HoveredColor>({ delayMs: SHOW_DELAY_MS, onChange: setHovered });
    let frame = 0;
    let latest: { path: EventTarget[]; x: number; y: number } | null = null;

    const rangesFor = (text: string, stylesheet: boolean) => {
      const key = `${stylesheet ? 's' : 'c'}${text}`;
      let ranges = lines.get(key);
      if (!ranges) {
        ranges = findColorRanges(text, { stylesheet, isValid });
        if (lines.size >= LINE_CACHE_SIZE) lines.delete(lines.keys().next().value!);
        lines.set(key, ranges);
      }
      return ranges;
    };

    const resolve = () => {
      frame = 0;
      const pointer = latest;
      latest = null;
      if (!pointer) return;
      const line = findLineElement(pointer.path);
      const column = line && columnFromPoint(line, pointer.x, pointer.y);
      if (!line || column === null) {
        controller.update(null);
        return;
      }
      const stylesheet = isStylesheetLanguage(languageRef.current ?? attributeFromPath(pointer.path, COLOR_LANGUAGE_ATTRIBUTE));
      const range = colorRangeAt(rangesFor(lineText(line), stylesheet), column);
      controller.update(range ? { ...range, line, key: `${line.getAttribute('data-line')}:${range.start}:${range.value}` } : null);
    };

    const hide = () => {
      latest = null;
      controller.update(null);
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
      latest = { path, x: event.clientX, y: event.clientY };
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
