import { MAX_SCROLL_MARKS, type ScrollMark } from './location';

export interface ScrollAreas {
  /** Holds one child per section kept in the sidebar; the visible one is the list on screen. */
  list(): HTMLElement | null;
  viewer(): HTMLElement | null;
}

export interface ScrollKeeper {
  /** The step on screen changed: from now on its scroll positions are these. */
  reset(marks: readonly ScrollMark[]): void;
  /** Scrolls back to where a step was left, as its content arrives, until the user moves the view. */
  restore(marks: readonly ScrollMark[]): void;
  /** Stops a restore in progress, as when the user goes somewhere else. */
  cancel(): void;
  dispose(): void;
}

/** How long a restore keeps trying while the content it scrolls is still arriving. */
const RESTORE_TIMEOUT_MS = 4_000;
/** Frames a position has to hold, at an unchanged height, before it counts as reached. */
const STEADY_FRAMES = 8;
/** Input that means the user is moving the view, so a restore gives it back. */
const USER_INPUT = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

function identityOf(element: Element): string {
  const first = element.classList[0];
  return first ? `${element.tagName.toLowerCase()}.${first}` : element.tagName.toLowerCase();
}

function visible(element: Element): boolean {
  return element.getClientRects().length > 0;
}

/** The sidebar section that holds an element, or the visible one when looking for where to scroll. */
function sectionRoot(list: HTMLElement, element: Element | null): Element | null {
  if (element) {
    let current: Element | null = element;
    while (current && current.parentElement !== list) current = current.parentElement;
    return current;
  }
  for (const child of list.children) if (visible(child)) return child;
  return null;
}

function pathFrom(root: Element, element: Element): number[] | null {
  const path: number[] = [];
  let current: Element | null = element;
  while (current && current !== root) {
    const parent: Element | null = current.parentElement;
    if (!parent) return null;
    path.unshift(Array.prototype.indexOf.call(parent.children, current));
    current = parent;
  }
  return current === root ? path : null;
}

function follow(root: Element, path: readonly number[]): Element | null {
  let current: Element | undefined = root;
  for (const index of path) {
    current = current.children[index];
    if (!current) return null;
  }
  return current;
}

/**
 * Notes where the list and the viewer were scrolled, by the place of the
 * scrolled element under them, and scrolls there again when a step is brought
 * back. The content of a step arrives over several frames (read from memory,
 * parsed, highlighted, measured), so a restore keeps applying the position until
 * it holds, and stops as soon as the user scrolls, clicks or types.
 */
export function createScrollKeeper(areas: ScrollAreas, onMarks: (marks: ScrollMark[]) => void): ScrollKeeper {
  let marks: ScrollMark[] = [];
  const queued = new Map<Element, ScrollMark['area']>();
  let flushFrame: number | null = null;
  let restoring: { frame: number | null; stop(): void } | null = null;

  const rootFor = (area: ScrollMark['area'], element: Element | null): Element | null => {
    if (area === 'viewer') return areas.viewer();
    const list = areas.list();
    return list ? sectionRoot(list, element) : null;
  };

  const flush = () => {
    flushFrame = null;
    if (restoring) { queued.clear(); return; }
    let changed = false;
    for (const [element, area] of queued) {
      const root = rootFor(area, element);
      const path = root && element.isConnected ? pathFrom(root, element) : null;
      if (!path) continue;
      const mark: ScrollMark = { area, path, identity: identityOf(element), top: Math.round(element.scrollTop), left: Math.round(element.scrollLeft) };
      const same = (other: ScrollMark) => other.area === area && other.path.length === path.length && other.path.every((index, position) => index === path[position]);
      const previous = marks.find(same);
      if (previous && previous.top === mark.top && previous.left === mark.left) continue;
      marks = [...marks.filter((other) => !same(other)), mark].slice(-MAX_SCROLL_MARKS);
      changed = true;
    }
    queued.clear();
    if (changed) onMarks(marks);
  };

  const onScroll = (event: Event) => {
    if (restoring) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const area = areas.list()?.contains(target) ? 'list' : areas.viewer()?.contains(target) ? 'viewer' : null;
    if (!area) return;
    queued.set(target, area);
    flushFrame ??= requestAnimationFrame(flush);
  };
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });

  const cancel = () => {
    if (!restoring) return;
    const current = restoring;
    restoring = null;
    current.stop();
  };

  return {
    reset(next) {
      cancel();
      queued.clear();
      marks = [...next];
    },
    restore(targets) {
      cancel();
      if (targets.length === 0) return;
      const deadline = performance.now() + RESTORE_TIMEOUT_MS;
      const steady = new Map<ScrollMark, { frames: number; height: number }>();
      const pending = new Set(targets);
      const giveBack = () => cancel();
      const session = {
        frame: null as number | null,
        stop() {
          if (session.frame !== null) cancelAnimationFrame(session.frame);
          for (const type of USER_INPUT) window.removeEventListener(type, giveBack, { capture: true });
        },
      };
      for (const type of USER_INPUT) window.addEventListener(type, giveBack, { capture: true, passive: true });
      const tick = () => {
        session.frame = null;
        if (restoring !== session) return;
        for (const mark of pending) {
          const root = rootFor(mark.area, null);
          const element = root ? follow(root, mark.path) : null;
          if (!element || identityOf(element) !== mark.identity || element.clientHeight === 0) { steady.delete(mark); continue; }
          const reachable = element.scrollHeight - element.clientHeight >= mark.top - 1;
          // Content still arriving: wait for it rather than scroll part of the way and jump later.
          if (!reachable) { steady.delete(mark); continue; }
          if (Math.abs(element.scrollTop - mark.top) > 1) element.scrollTop = mark.top;
          if (Math.abs(element.scrollLeft - mark.left) > 1) element.scrollLeft = mark.left;
          const held = steady.get(mark);
          const frames = held && held.height === element.scrollHeight && Math.abs(element.scrollTop - mark.top) <= 1 ? held.frames + 1 : 0;
          steady.set(mark, { frames, height: element.scrollHeight });
          if (frames >= STEADY_FRAMES) pending.delete(mark);
        }
        if (pending.size === 0 || performance.now() > deadline) { cancel(); return; }
        session.frame = requestAnimationFrame(tick);
      };
      restoring = session;
      session.frame = requestAnimationFrame(tick);
    },
    cancel,
    dispose() {
      cancel();
      document.removeEventListener('scroll', onScroll, { capture: true });
      if (flushFrame !== null) cancelAnimationFrame(flushFrame);
    },
  };
}
