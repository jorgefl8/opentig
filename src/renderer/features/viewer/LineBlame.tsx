import { useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Popover } from '@base-ui/react/popover';
import { IconHistory, IconUserCode } from '@tabler/icons-react';
import { formatDateTime } from '@shared/date-format';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { useMobileChrome } from '@/components/mobile-chrome-context';
import { FileViewerToolbarButton } from './FileViewerToolbar';
import { LineBlameContext } from './line-blame-context';
import { useLineBlame } from './useLineBlame';
import { NOT_COMMITTED_LABEL, blameForLine, blameGhostText, blameTargetLine, formatBlameAge, lineNumberFromEventPath, shortOid } from './line-blame';
import './line-blame.css';

const CARD_OPEN_DELAY_MS = 300;
const CARD_CLOSE_DELAY_MS = 200;
const HOVER_CLEAR_DELAY_MS = 120;

interface GhostPosition {
  top: number;
  left: number;
  maxWidth: number;
  height: number;
  fontSize: string;
}

/** The syntax problem written after a line's text by the layer next to this one, if any. */
function syntaxProblemMessage(container: HTMLElement, line: number): HTMLElement | null {
  return container.querySelector<HTMLElement>(`.syntax-diagnostic-message[data-syntax-diagnostic-line="${line}"]`);
}

/**
 * Where the ghost text goes: after the end of the line's text, or after the
 * syntax problem written there, measured from Pierre's rendered row. Nothing
 * is added to the editor's own DOM.
 */
function measureGhost(container: HTMLElement, root: ShadowRoot, line: number): GhostPosition | null {
  const row = root.querySelector<HTMLElement>(`[data-content] > [data-line="${line}"]`);
  if (!row) return null;
  const rowRect = row.getBoundingClientRect();
  if (!rowRect.height) return null;
  const style = getComputedStyle(row);
  const height = Number.parseFloat(style.lineHeight) || rowRect.height;
  const fontSize = Number.parseFloat(style.fontSize) || 13;
  const range = document.createRange();
  range.selectNodeContents(row);
  const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
  const last = rects.at(-1);
  const textEnd = last ? last.right : rowRect.left + (Number.parseFloat(style.paddingLeft) || 0);
  const middle = last ? (last.top + last.bottom) / 2 : rowRect.top + height / 2;
  const box = container.getBoundingClientRect();
  const viewport = container.parentElement?.getBoundingClientRect() ?? box;
  const gutterRight = root.querySelector('[data-gutter]')?.getBoundingClientRect().right ?? rowRect.left;
  const problemEnd = syntaxProblemMessage(container, line)?.getBoundingClientRect().right;
  const start = Math.max(textEnd + fontSize * 2.5, problemEnd === undefined ? 0 : problemEnd + fontSize * 1.5);
  const maxWidth = Math.min(box.right, viewport.right) - start - 12;
  // Hidden when the line's end is scrolled out of view or there is no room left.
  if (start < gutterRight || maxWidth < 64) return null;
  return { top: middle - height / 2 - box.top, left: start - box.left, maxWidth, height, fontSize: style.fontSize };
}

function editorShadowRoot(container: HTMLElement | null): ShadowRoot | null {
  return container?.querySelector('diffs-container')?.shadowRoot ?? null;
}

function caretLine(root: ShadowRoot): number | null {
  const active = root.querySelector('[data-content] > [data-editor-active-line][data-line], [data-gutter] > [data-editor-active-line][data-column-number]');
  const value = Number(active?.getAttribute('data-line') ?? active?.getAttribute('data-column-number'));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

const inside = (rect: DOMRect | undefined, x: number, y: number) => Boolean(rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);

/**
 * GitLens-style blame for the Files editor: faint text after the hovered line,
 * or the caret's line while editing, and a card with the commit on hovering it.
 * The ghost text ignores the pointer, so clicking past a line still places the
 * caret there; the card follows the pointer's position over the text instead.
 */
export function LineBlameLayer({ path, text, savedText, layoutKey }: { path: string; text: string; savedText: string; layoutKey: string }) {
  const settings = useContext(LineBlameContext);
  const phone = useMobileChrome() !== null;
  const enabled = Boolean(settings?.enabled) && !phone;
  const result = useLineBlame({
    enabled,
    repositoryId: settings?.repositoryId ?? '',
    path,
    revision: settings?.revision ?? 0,
    text,
    savedText,
  });

  const layerRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [cardLine, setCardLine] = useState<number | null>(null);
  const [position, setPosition] = useState<GhostPosition | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const timers = useRef<Record<'clear' | 'open' | 'close', number | undefined>>({ clear: undefined, open: undefined, close: undefined });
  const overPopup = useRef(false);
  const target = cardLine ?? blameTargetLine({ hovered, caret, focused });
  const blame = target === null ? null : blameForLine(result, target);
  const targetRef = useRef(target);
  useLayoutEffect(() => { targetRef.current = target; }, [target]);

  // Pointer, focus and caret tracking on the editor's content element.
  useEffect(() => {
    const layer = layerRef.current;
    const container = layer?.parentElement;
    if (!enabled || !container) return;
    const pending = timers.current;
    const stop = (name: keyof typeof pending) => { window.clearTimeout(pending[name]); pending[name] = undefined; };
    const closeCardSoon = () => {
      stop('open');
      if (pending.close !== undefined) return;
      pending.close = window.setTimeout(() => {
        pending.close = undefined;
        if (!overPopup.current) setCardLine(null);
      }, CARD_CLOSE_DELAY_MS);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const line = lineNumberFromEventPath(event.composedPath());
      if (line !== null) { stop('clear'); setHovered(line); }
      else if (pending.clear === undefined) pending.clear = window.setTimeout(() => { pending.clear = undefined; setHovered(null); }, HOVER_CLEAR_DELAY_MS);
      if (inside(ghostRef.current?.getBoundingClientRect(), event.clientX, event.clientY)) {
        stop('close');
        const line = targetRef.current;
        if (pending.open === undefined && line !== null) pending.open = window.setTimeout(() => { pending.open = undefined; setNow(Date.now()); setCardLine(line); }, CARD_OPEN_DELAY_MS);
      } else closeCardSoon();
    };
    const leave = () => {
      stop('clear');
      setHovered(null);
      closeCardSoon();
    };
    const focusIn = () => setFocused(true);
    const focusOut = (event: FocusEvent) => { if (!(event.relatedTarget instanceof Node && container.contains(event.relatedTarget))) setFocused(false); };
    const scroller = container.parentElement;
    const scrolled = () => { stop('clear'); setHovered(null); stop('open'); setCardLine(null); };
    container.addEventListener('pointermove', move);
    container.addEventListener('pointerleave', leave);
    container.addEventListener('focusin', focusIn);
    container.addEventListener('focusout', focusOut);
    scroller?.addEventListener('scroll', scrolled, { passive: true });

    // The caret's line, as Pierre marks it on its rendered row. The shadow root
    // appears once the editor has rendered, so wait for it.
    let observer: MutationObserver | null = null;
    let frame = 0;
    const watchCaret = () => {
      const root = editorShadowRoot(container);
      if (!root) { frame = window.requestAnimationFrame(watchCaret); return; }
      setCaret(caretLine(root));
      setFocused(container.contains(document.activeElement));
      observer = new MutationObserver(() => setCaret(caretLine(root)));
      observer.observe(root, { subtree: true, attributes: true, attributeFilter: ['data-editor-active-line'] });
    };
    watchCaret();
    return () => {
      for (const name of ['clear', 'open', 'close'] as const) stop(name);
      container.removeEventListener('pointermove', move);
      container.removeEventListener('pointerleave', leave);
      container.removeEventListener('focusin', focusIn);
      container.removeEventListener('focusout', focusOut);
      scroller?.removeEventListener('scroll', scrolled);
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [enabled]);

  // Keep the ghost text at the end of its line as the layout changes.
  const visible = blame !== null;
  useLayoutEffect(() => {
    const container = layerRef.current?.parentElement;
    if (!visible || target === null || !container) { setPosition(null); return; }
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const root = editorShadowRoot(container);
        setPosition(root ? measureGhost(container, root, target) : null);
      });
    };
    const root = editorShadowRoot(container);
    setPosition(root ? measureGhost(container, root, target) : null);
    const resize = new ResizeObserver(update);
    resize.observe(container);
    // Pierre scrolls long lines sideways inside its own element.
    root?.addEventListener('scroll', update, { capture: true, passive: true });
    // A syntax problem's message appears, changes or leaves a moment after the text does.
    const problems = new MutationObserver(update);
    const problemsLayer = container.querySelector('.syntax-diagnostics-layer');
    if (problemsLayer) problems.observe(problemsLayer, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style'] });
    return () => {
      window.cancelAnimationFrame(frame);
      resize.disconnect();
      problems.disconnect();
      root?.removeEventListener('scroll', update, { capture: true });
    };
  }, [layoutKey, target, text, visible]);

  if (!enabled || !settings) return null;
  const ghostStyle: CSSProperties | undefined = position ? {
    top: position.top,
    left: position.left,
    maxWidth: position.maxWidth,
    height: position.height,
    lineHeight: `${position.height}px`,
    fontSize: position.fontSize,
  } : undefined;
  const cardOpen = cardLine !== null && blame !== null && position !== null;

  return (
    <div ref={layerRef} className="line-blame-layer">
      {blame && position && (
        <span ref={ghostRef} className="line-blame-ghost" style={ghostStyle} aria-hidden="true" data-line-blame={target ?? undefined}>
          {blameGhostText(blame.commit, now)}
        </span>
      )}
      <Popover.Root open={cardOpen} onOpenChange={(next) => { if (!next) setCardLine(null); }}>
        <Popover.Portal>
          <Popover.Positioner anchor={ghostRef} side="bottom" align="start" sideOffset={4} collisionPadding={12} className="isolate z-50 outline-none">
            <Popover.Popup
              initialFocus={false}
              finalFocus={false}
              className="line-blame-card"
              aria-label="Line blame"
              onPointerEnter={() => { overPopup.current = true; window.clearTimeout(timers.current.close); timers.current.close = undefined; }}
              onPointerLeave={() => {
                overPopup.current = false;
                if (timers.current.close === undefined) timers.current.close = window.setTimeout(() => { timers.current.close = undefined; setCardLine(null); }, CARD_CLOSE_DELAY_MS);
              }}
            >
              {blame && <LineBlameCard blame={blame} now={now} onOpenCommit={(oid, subject) => { setCardLine(null); overPopup.current = false; settings.openCommit(oid, subject); }} />}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

function LineBlameCard({ blame, now, onOpenCommit }: {
  blame: NonNullable<ReturnType<typeof blameForLine>>;
  now: number;
  onOpenCommit(oid: string, subject: string): void;
}) {
  const { commit, originalLine } = blame;
  if (commit.uncommitted) {
    return (
      <>
        <p className="line-blame-card-title">{NOT_COMMITTED_LABEL}</p>
        <p className="line-blame-card-meta">This line has changes, saved or unsaved, that are not in a commit yet.</p>
      </>
    );
  }
  return (
    <>
      <div className="line-blame-card-author">
        <p className="line-blame-card-title">{commit.authorName}</p>
        {commit.authorEmail && <p className="line-blame-card-meta">{commit.authorEmail}</p>}
      </div>
      <p className="line-blame-card-meta">{formatBlameAge(commit.authoredAt, now)} · {formatDateTime(commit.authoredAt)}</p>
      <p className="line-blame-card-summary">{commit.summary}</p>
      <div className="line-blame-card-footer">
        <span className="line-blame-card-oid">
          <code>{shortOid(commit.oid)}</code>
          <CopyButton value={commit.oid} label="Copy commit hash" />
          <span className="line-blame-card-meta">line {originalLine} in this commit</span>
        </span>
        <Button type="button" size="xs" variant="outline" onClick={() => onOpenCommit(commit.oid, commit.summary)}>
          <IconHistory /> Open in History
        </Button>
      </div>
    </>
  );
}

/** Turns line blame on or off for every file; the choice is saved with the other preferences. */
export function LineBlameToggle() {
  const settings = useContext(LineBlameContext);
  if (!settings) return null;
  const label = settings.enabled ? 'Hide line blame' : 'Show line blame';
  return (
    <FileViewerToolbarButton label={label} pressed={settings.enabled} onClick={() => settings.setEnabled(!settings.enabled)}>
      <IconUserCode />
    </FileViewerToolbarButton>
  );
}
