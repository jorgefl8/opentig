import type { EditorKeymap, EditorShortcut } from '@pierre/diffs/edit';
import { DEFAULT_SHORTCUT_MAP } from '@shared/shortcuts';

/** Converts a `Ctrl+Shift+F`-style combo into Pierre's `cmdOrCtrl+shift+f` binding syntax. */
function toEditorShortcut(combo: string): EditorShortcut {
  const parts = combo.split('+');
  const key = parts.pop()!.toLowerCase();
  const modifiers = parts.map((part) => part === 'Ctrl' ? 'cmdOrCtrl' : part.toLowerCase());
  return [...modifiers, key].join('+') as EditorShortcut;
}

export function buildFileEditorKeymap(editorSearchCombo: string): EditorKeymap {
  return [{ bindings: { [toEditorShortcut(editorSearchCombo)]: 'openSearchReplacePanel' } }];
}

export const OPENTIG_FILE_EDITOR_KEYMAP = buildFileEditorKeymap(DEFAULT_SHORTCUT_MAP.editorSearch);
