import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { SyntaxDiagnostic, SyntaxDiagnosticSeverity } from './syntax-diagnostics';
import './syntax-diagnostics.css';

/**
 * CSS for Pierre's shadow root. The editor's marker popover would repeat the
 * message in a second tooltip style; the end-of-line message and its app
 * tooltip carry the details instead.
 */
export const SYNTAX_MARKER_CSS = '[data-marker-popover]{display:none!important}';

interface LineProblems {
  line: number;
  severity: SyntaxDiagnosticSeverity;
  items: SyntaxDiagnostic[];
}

interface LinePlacement {
  line: number;
  /** The tinted row, across the visible code area. */
  row: { top: number; left: number; width: number; height: number };
  /** The message after the line's text, or null when there is no room. */
  message: { top: number; left: number; maxWidth: number; height: number } | null;
}

/** Smallest width worth showing a message in; a narrower one only clutters. */
const MIN_MESSAGE_WIDTH = 48;

function groupByLine(diagnostics: readonly SyntaxDiagnostic[]): LineProblems[] {
  const lines = new Map<number, LineProblems>();
  for (const diagnostic of diagnostics) {
    const line = diagnostic.start.line;
    const entry = lines.get(line);
    if (!entry) lines.set(line, { line, severity: diagnostic.severity, items: [diagnostic] });
    else {
      entry.items.push(diagnostic);
      if (diagnostic.severity === 'error') entry.severity = 'error';
    }
  }
  // Errors lead each line's list, so the inline message names the worst one.
  for (const entry of lines.values()) entry.items.sort((a, b) => Number(a.severity !== 'error') - Number(b.severity !== 'error'));
  return [...lines.values()];
}

function samePlacements(a: LinePlacement[], b: LinePlacement[]) {
  return a.length === b.length && a.every((placement, index) => JSON.stringify(placement) === JSON.stringify(b[index]));
}

/** Pierre's rendered code inside the file surface next to the layer, if any. */
function findCode(layer: HTMLElement) {
  const shadow = layer.parentElement?.querySelector('diffs-container')?.shadowRoot;
  const code = shadow?.querySelector<HTMLElement>('[data-code]');
  const content = code?.querySelector<HTMLElement>('[data-content]');
  if (!shadow || !code || !content) return null;
  return { shadow, code, content, gutter: code.querySelector<HTMLElement>('[data-gutter]') };
}

/** Where the text of a rendered line ends, from its last visual row. */
function textEnd(lineElement: HTMLElement): DOMRect | null {
  const range = document.createRange();
  range.selectNodeContents(lineElement);
  const rects = [...range.getClientRects()].filter((rect) => rect.height > 0 && rect.width > 0);
  return rects.at(-1) ?? null;
}

function measure(layer: HTMLElement, lines: readonly LineProblems[]): LinePlacement[] {
  const found = findCode(layer);
  if (!found) return [];
  const { code, content, gutter } = found;
  const origin = layer.getBoundingClientRect();
  const codeRect = code.getBoundingClientRect();
  const clipLeft = Math.max(codeRect.left, gutter?.getBoundingClientRect().right ?? codeRect.left);
  const clipRight = codeRect.left + code.clientWidth;
  if (clipRight <= clipLeft) return [];
  const gap = parseFloat(getComputedStyle(content).fontSize) * 2 || 24;
  const placements: LinePlacement[] = [];
  for (const { line } of lines) {
    const element = content.querySelector<HTMLElement>(`:scope > [data-line="${line + 1}"]`);
    if (!element) continue;
    const box = element.getBoundingClientRect();
    if (box.height === 0) continue;
    const row = { top: box.top - origin.top, left: clipLeft - origin.left, width: clipRight - clipLeft, height: box.height };
    const end = textEnd(element);
    const style = getComputedStyle(element);
    const lineHeight = parseFloat(style.lineHeight) || box.height;
    const endX = end ? end.right : box.left + (parseFloat(style.paddingLeft) || 0);
    const endTop = end ? end.top + (end.height - lineHeight) / 2 : box.top;
    const left = Math.max(endX + gap, clipLeft + gap / 2);
    const maxWidth = clipRight - left - gap / 2;
    placements.push({
      line,
      row,
      message: maxWidth >= MIN_MESSAGE_WIDTH
        ? { top: endTop - origin.top, left: left - origin.left, maxWidth, height: lineHeight }
        : null,
    });
  }
  return placements;
}

interface SyntaxDiagnosticsLayerProps {
  diagnostics: readonly SyntaxDiagnostic[];
  /** Moves the caret to the end of a zero-based line. */
  onActivateLine?(line: number): void;
}

/**
 * Error Lens-style problems over Pierre's source editor: each affected line is
 * tinted and its first problem is written after the line's text. Pierre owns
 * the editable DOM, so this layer sits over it and only measures it.
 */
export function SyntaxDiagnosticsLayer({ diagnostics, onActivateLine }: SyntaxDiagnosticsLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => groupByLine(diagnostics), [diagnostics]);
  const [placements, setPlacements] = useState<LinePlacement[]>([]);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer || lines.length === 0) {
      setPlacements((current) => current.length === 0 ? current : []);
      return;
    }
    let frame = 0;
    let observed: ShadowRoot | null = null;
    const update = () => {
      frame = 0;
      const next = measure(layer, lines);
      setPlacements((current) => samePlacements(current, next) ? current : next);
      observe();
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    // Pierre rewrites lines while highlighting and editing, scrolls code
    // sideways inside its shadow root, and reflows wrapped lines on resize.
    const mutations = new MutationObserver(schedule);
    const resize = new ResizeObserver(schedule);
    const observe = () => {
      const shadow = findCode(layer)?.shadow ?? null;
      if (shadow === observed) return;
      observed?.removeEventListener('scroll', schedule, true);
      mutations.disconnect();
      observed = shadow;
      if (!shadow) return;
      mutations.observe(shadow, { childList: true, subtree: true, characterData: true });
      shadow.addEventListener('scroll', schedule, { capture: true, passive: true });
    };
    resize.observe(layer);
    // The file surface may be replaced, such as when another file opens.
    const host = new MutationObserver(schedule);
    if (layer.parentElement) host.observe(layer.parentElement, { childList: true });
    document.fonts.addEventListener('loadingdone', schedule);
    update();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      mutations.disconnect();
      resize.disconnect();
      host.disconnect();
      observed?.removeEventListener('scroll', schedule, true);
      document.fonts.removeEventListener('loadingdone', schedule);
    };
  }, [lines]);

  const byLine = new Map(lines.map((entry) => [entry.line, entry]));
  return (
    <div ref={layerRef} className="syntax-diagnostics-layer">
      {placements.map((placement) => {
        const entry = byLine.get(placement.line);
        if (!entry) return null;
        const [first] = entry.items;
        return (
          <div key={placement.line} className="syntax-diagnostic" data-severity={entry.severity}>
            <div className="syntax-diagnostic-row" style={placement.row} />
            {placement.message && first && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      className="syntax-diagnostic-message"
                      data-syntax-diagnostic-line={placement.line + 1}
                      style={{ ...placement.message, lineHeight: `${placement.message.height}px` }}
                      onMouseDown={(event) => {
                        // Act like a click past the end of the line it covers.
                        event.preventDefault();
                        onActivateLine?.(placement.line);
                      }}
                    />
                  }
                >
                  {first.message}
                  {entry.items.length > 1 && <span className="syntax-diagnostic-more">{`+${entry.items.length - 1}`}</span>}
                </TooltipTrigger>
                <TooltipContent side="bottom" align="start" className="syntax-diagnostic-tooltip">
                  <ul>
                    {entry.items.map((item, index) => (
                      <li key={index} data-severity={item.severity}>
                        <span className="syntax-diagnostic-tooltip-message">{item.message}</span>
                        <span className="syntax-diagnostic-tooltip-meta">
                          {`${item.source} ${item.severity} · Line ${item.start.line + 1}, column ${item.start.character + 1}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        );
      })}
    </div>
  );
}
