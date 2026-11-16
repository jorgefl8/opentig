/**
 * One keyboard behavior for every list in the sidebar, read from the markup each
 * list already has. A list marks itself with `data-list-root`, each of its rows
 * with `data-list-item`, the row the viewer shows with `data-list-current`, the
 * row's button with `data-list-primary` (or the row is the button), and rows that
 * only fold and unfold, such as folders, with `data-list-folder`. Opening a row is
 * clicking its button: the same path, guards and reads as the pointer.
 */

export const LIST_ROOT = '[data-list-root]';
const LIST_ITEM = '[data-list-item]';

/** The rows of a list, in the order they are drawn; a list nested inside keeps its own. */
export function listRows(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(LIST_ITEM)].filter((row) => row.closest(LIST_ROOT) === root);
}

/** What a row's keyboard focus and click go to. */
export function rowTarget(row: HTMLElement): HTMLElement {
  return row.hasAttribute('data-list-primary') ? row : row.querySelector<HTMLElement>('[data-list-primary]') ?? row;
}

export function isFolderRow(row: HTMLElement): boolean {
  return row.hasAttribute('data-list-folder');
}

export function folderExpanded(row: HTMLElement): boolean {
  const value = row.getAttribute('aria-expanded') ?? rowTarget(row).getAttribute('aria-expanded');
  return value === 'true';
}

/** The row the viewer shows, if it is in this list. */
export function currentRow(root: Element): HTMLElement | null {
  return listRows(root).find((row) => row.hasAttribute('data-list-current')) ?? null;
}

/**
 * The row a key acts from when pressed on `target`: only the row itself or its
 * button, so a row's other buttons (copy, undo, open on GitHub) keep their own keys.
 */
export function rowAt(target: EventTarget | null): { root: HTMLElement; row: HTMLElement } | null {
  if (!target || typeof (target as Element).closest !== 'function') return null;
  const element = target as HTMLElement;
  const row = element.closest<HTMLElement>(LIST_ITEM);
  const root = row?.closest<HTMLElement>(LIST_ROOT);
  if (!row || !root) return null;
  return element === row || element === rowTarget(row) ? { root, row } : null;
}

/** The row one step away, or at either end. From no row, both directions start at the first. */
export function rowAfter(rows: readonly HTMLElement[], from: HTMLElement | null, to: 'next' | 'previous' | 'first' | 'last', skipFolders = false): HTMLElement | null {
  const candidates = skipFolders ? rows.filter((row) => !isFolderRow(row) || row === from) : rows;
  if (candidates.length === 0) return null;
  if (to === 'first') return candidates.find((row) => !skipFolders || !isFolderRow(row)) ?? null;
  if (to === 'last') return [...candidates].reverse().find((row) => !skipFolders || !isFolderRow(row)) ?? null;
  const index = from ? candidates.indexOf(from) : -1;
  if (index < 0) return candidates.find((row) => !skipFolders || !isFolderRow(row)) ?? null;
  const next = candidates[index + (to === 'next' ? 1 : -1)];
  return next && (!skipFolders || !isFolderRow(next)) ? next : null;
}

/** The folder a row sits in, by the depth each row of a tree states. */
export function parentRow(rows: readonly HTMLElement[], row: HTMLElement): HTMLElement | null {
  const depth = Number(row.dataset.listDepth);
  if (!Number.isFinite(depth) || depth <= 0) return null;
  for (let index = rows.indexOf(row) - 1; index >= 0; index -= 1) {
    const candidate = rows[index]!;
    if (Number(candidate.dataset.listDepth) < depth && isFolderRow(candidate)) return candidate;
  }
  return null;
}

/** Whether nothing between the element and `boundary` hides it. Hidden sections and tab panels say so on themselves. */
export function shownWithin(element: Element, boundary: Element | null): boolean {
  for (let node: Element | null = element; node && node !== boundary; node = node.parentElement) {
    if (node.hasAttribute('hidden')) return false;
    if (node instanceof HTMLElement && node.style.display === 'none') return false;
    if (typeof getComputedStyle === 'function' && getComputedStyle(node).display === 'none') return false;
  }
  return true;
}

/** The list of the section on screen, even while a phone shows the viewer over it. */
export function shownList(doc: Document = document): HTMLElement | null {
  const body = doc.querySelector('.sidebar-body');
  if (!body) return null;
  return [...body.querySelectorAll<HTMLElement>(LIST_ROOT)].find((root) => shownWithin(root, body)) ?? null;
}

/** Puts focus on a row and brings it into view, without scrolling past it. */
export function focusRow(row: HTMLElement): void {
  rowTarget(row).focus({ preventScroll: true });
  row.scrollIntoView?.({ block: 'nearest' });
}

/** The nearest element that scrolls the list, for reaching rows a virtual list has not drawn. */
export function listScroller(root: HTMLElement): HTMLElement | null {
  for (let node: HTMLElement | null = root; node; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight + 1) {
      const overflow = getComputedStyle(node).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') return node;
    }
    if (node.classList.contains('sidebar-body')) break;
  }
  return null;
}

const FILE_SECTION = '.diff-file-section';

/**
 * Moves between the files of the diff in the viewer: marks the file, scrolls its
 * header to the top and focuses its button, which unfolds it with Enter. Nothing
 * is read: a folded file stays folded until it is asked for.
 */
export function moveToFile(viewer: Element, to: 'next' | 'previous', fewest = 1): HTMLElement | null {
  const sections = [...viewer.querySelectorAll<HTMLElement>(FILE_SECTION)];
  if (sections.length < Math.max(1, fewest)) return null;
  const marked = sections.findIndex((section) => section.hasAttribute('data-keyboard-file'));
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  const holding = active ? sections.findIndex((section) => section.contains(active)) : -1;
  const from = marked >= 0 ? marked : holding >= 0 ? holding : firstInView(sections);
  const target = from < 0 ? 0 : Math.max(0, Math.min(sections.length - 1, from + (to === 'next' ? 1 : -1)));
  const section = sections[target]!;
  for (const other of sections) if (other !== section) other.removeAttribute('data-keyboard-file');
  section.setAttribute('data-keyboard-file', '');
  section.scrollIntoView?.({ block: 'start' });
  section.querySelector<HTMLElement>('.diff-file-toggle, button')?.focus({ preventScroll: true });
  return section;
}

/** The first file whose header is not above the top of its scroller; -1 before anything is marked or measured. */
function firstInView(sections: readonly HTMLElement[]): number {
  const scroller = sections[0]?.closest<HTMLElement>('.diff-workspace-scroll');
  if (!scroller || typeof scroller.getBoundingClientRect !== 'function') return -1;
  const top = scroller.getBoundingClientRect().top;
  const index = sections.findIndex((section) => section.getBoundingClientRect().bottom > top + 1);
  // Before the first file nothing is chosen yet, so `n` goes to it rather than past it.
  return index <= 0 ? -1 : index;
}
