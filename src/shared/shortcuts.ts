export type ShortcutId =
  | 'openRepository'
  | 'refresh'
  | 'quickOpen'
  | 'repoSwitcher'
  | 'commit'
  | 'saveFile'
  | 'editorSearch'
  | 'undoFileChange'
  | 'redoFileChange'
  | 'closeTab'
  | 'nextTab'
  | 'prevTab'
  | 'moveTabLeft'
  | 'moveTabRight';

export type ShortcutCategory = 'General' | 'Commit' | 'Editor' | 'Tabs';

export interface ShortcutDefinition {
  id: ShortcutId;
  label: string;
  description: string;
  category: ShortcutCategory;
  defaultCombo: string;
  /** Only `repoSwitcher` may bind to an unmodified key; every other command requires a modifier. */
  allowBare: boolean;
}

export const SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] = [
  { id: 'openRepository', label: 'Open repository', description: 'Open a repository from disk.', category: 'General', defaultCombo: 'Ctrl+O', allowBare: false },
  { id: 'refresh', label: 'Refresh', description: 'Refresh the current repository.', category: 'General', defaultCombo: 'Ctrl+R', allowBare: false },
  { id: 'quickOpen', label: 'Quick open', description: 'Search and open a file by name.', category: 'General', defaultCombo: 'Ctrl+P', allowBare: false },
  { id: 'repoSwitcher', label: 'Repository switcher', description: 'Open the repository switcher. Type a number, or press again to close.', category: 'General', defaultCombo: 'Q', allowBare: true },
  { id: 'commit', label: 'Commit', description: 'Commit the staged changes.', category: 'Commit', defaultCombo: 'Ctrl+Enter', allowBare: false },
  { id: 'saveFile', label: 'Save file', description: 'Save the active file draft.', category: 'Editor', defaultCombo: 'Ctrl+S', allowBare: false },
  { id: 'editorSearch', label: 'Find and replace', description: 'Open find and replace in the file editor. Ctrl+Alt+F always works too, as a built-in alternative.', category: 'Editor', defaultCombo: 'Ctrl+F', allowBare: false },
  { id: 'undoFileChange', label: 'Undo file operation', description: 'Undo the last file create, rename, move, or delete.', category: 'Editor', defaultCombo: 'Ctrl+Z', allowBare: false },
  { id: 'redoFileChange', label: 'Redo file operation', description: 'Redo the last undone file operation.', category: 'Editor', defaultCombo: 'Ctrl+Shift+Z', allowBare: false },
  { id: 'closeTab', label: 'Close tab', description: 'Close the active file tab.', category: 'Tabs', defaultCombo: 'Ctrl+W', allowBare: false },
  { id: 'nextTab', label: 'Next tab', description: 'Switch to the next file tab.', category: 'Tabs', defaultCombo: 'Ctrl+Tab', allowBare: false },
  { id: 'prevTab', label: 'Previous tab', description: 'Switch to the previous file tab.', category: 'Tabs', defaultCombo: 'Ctrl+Shift+Tab', allowBare: false },
  { id: 'moveTabLeft', label: 'Move tab left', description: 'Move the active tab one position left.', category: 'Tabs', defaultCombo: 'Ctrl+Shift+PageUp', allowBare: false },
  { id: 'moveTabRight', label: 'Move tab right', description: 'Move the active tab one position right.', category: 'Tabs', defaultCombo: 'Ctrl+Shift+PageDown', allowBare: false },
];

export type ShortcutOverrides = Partial<Record<ShortcutId, string>>;
export type ShortcutMap = Record<ShortcutId, string>;

/** Combos a shortcut may never be reassigned to: they belong to fixed, non-rebindable commands. */
export const RESERVED_COMBOS: ReadonlySet<string> = new Set([
  'Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Ctrl+4', 'Ctrl+5', 'Ctrl+6', 'Ctrl+7', 'Ctrl+8', 'Ctrl+9',
  'Ctrl+A', 'Ctrl+C', 'Ctrl+X', 'Ctrl+V',
]);

export interface FixedShortcutReference {
  combo: string;
  label: string;
  category: string;
}

/** Shown in Settings as read-only reference: structural or OS-convention keys that stay fixed. */
export const FIXED_SHORTCUTS: readonly FixedShortcutReference[] = [
  { combo: 'Ctrl + 1..5', label: 'Jump to a sidebar section', category: 'General' },
  { combo: 'Ctrl + Ctrl', label: 'Show and focus JustGit from anywhere (double-tap Control)', category: 'General' },
  { combo: 'Ctrl + A', label: 'Select all files', category: 'Files' },
  { combo: 'Ctrl + C', label: 'Copy selected files', category: 'Files' },
  { combo: 'Ctrl + X', label: 'Cut selected files', category: 'Files' },
  { combo: 'Ctrl + V', label: 'Paste files', category: 'Files' },
  { combo: 'F2', label: 'Rename file', category: 'Files' },
  { combo: 'Delete', label: 'Delete file', category: 'Files' },
  { combo: 'Enter / Space', label: 'Activate the focused tab in the open-files strip', category: 'Files' },
  { combo: 'Delete', label: 'Close the focused tab in the open-files strip', category: 'Files' },
  { combo: 'Ctrl + Alt + F', label: 'Find and replace (always works, alongside the rebindable shortcut above)', category: 'Editor' },
  { combo: '+ / -', label: 'Zoom image preview', category: 'Image preview' },
  { combo: '0', label: 'Reset image zoom', category: 'Image preview' },
  { combo: 'F', label: 'Fit image to window', category: 'Image preview' },
];

const MODIFIER_ORDER = ['Ctrl', 'Shift', 'Alt'] as const;
const NAMED_KEYS = ['Enter', 'Tab', 'PageUp', 'PageDown'] as const;

function keyToken(key: string): string | null {
  if (key.length === 1) {
    if (/[a-zA-Z]/.test(key)) return key.toUpperCase();
    if (/[0-9]/.test(key)) return key;
    return null;
  }
  return (NAMED_KEYS as readonly string[]).includes(key) ? key : null;
}

function isKeyToken(token: string): boolean {
  return /^[A-Z]$/.test(token) || /^[0-9]$/.test(token) || (NAMED_KEYS as readonly string[]).includes(token);
}

/** Builds the canonical combo string (e.g. `Ctrl+Shift+Tab`) for a keydown event, or null if the key alone cannot be bound. */
export function normalizeCombo(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>): string | null {
  const token = keyToken(event.key);
  if (!token) return null;
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
  if (event.shiftKey) parts.push('Shift');
  if (event.altKey) parts.push('Alt');
  parts.push(token);
  return parts.join('+');
}

export function matchesCombo(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>, combo: string): boolean {
  return normalizeCombo(event) === combo;
}

export function formatCombo(combo: string): string {
  return combo.split('+').join(' + ');
}

/** Validates a stored or captured combo string against a shortcut's grammar (modifier order, allowed keys, bare-key policy). */
export function isValidCombo(combo: string, allowBare: boolean): boolean {
  if (typeof combo !== 'string' || combo.length === 0 || combo.length > 32) return false;
  const parts = combo.split('+');
  const token = parts.pop();
  if (!token || !isKeyToken(token)) return false;
  if (parts.length === 0) return allowBare && /^[A-Z]$/.test(token);
  if (allowBare) return false;
  let lastIndex = -1;
  for (const part of parts) {
    const index = MODIFIER_ORDER.indexOf(part as (typeof MODIFIER_ORDER)[number]);
    if (index === -1 || index <= lastIndex) return false;
    lastIndex = index;
  }
  return true;
}

/** Resolves the effective combo for every shortcut, falling back to the default for a missing or invalid override. */
export function resolveShortcuts(overrides: ShortcutOverrides | undefined): ShortcutMap {
  const result = {} as ShortcutMap;
  for (const def of SHORTCUT_DEFINITIONS) {
    const override = overrides?.[def.id];
    result[def.id] = override && isValidCombo(override, def.allowBare) ? override : def.defaultCombo;
  }
  return result;
}

export const DEFAULT_SHORTCUT_MAP: ShortcutMap = resolveShortcuts(undefined);

/** Returns the id of the shortcut already using `combo`, `'reserved'` if it belongs to a fixed shortcut, or null if free. */
export function findShortcutConflict(id: ShortcutId, combo: string, resolved: ShortcutMap): ShortcutId | 'reserved' | null {
  if (RESERVED_COMBOS.has(combo)) return 'reserved';
  for (const def of SHORTCUT_DEFINITIONS) {
    if (def.id !== id && resolved[def.id] === combo) return def.id;
  }
  return null;
}

/** Disk input is permissive: an invalid or colliding override is dropped independently, never resets sibling overrides. */
export function sanitizeShortcutOverrides(value: unknown): ShortcutOverrides {
  const result: ShortcutOverrides = {};
  if (!value || typeof value !== 'object') return result;
  const record = value as Record<string, unknown>;
  const usedCombos = new Set<string>();
  for (const def of SHORTCUT_DEFINITIONS) {
    const combo = record[def.id];
    if (typeof combo !== 'string' || combo === def.defaultCombo) continue;
    if (!isValidCombo(combo, def.allowBare)) continue;
    if (RESERVED_COMBOS.has(combo) || usedCombos.has(combo)) continue;
    usedCombos.add(combo);
    result[def.id] = combo;
  }
  return result;
}
