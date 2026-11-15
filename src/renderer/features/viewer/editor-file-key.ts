import { useCallback, useId, useState } from 'react';
import { fileHighlightKey } from './highlight-cache-key';

interface EditorFileKeyState {
  key: string;
  /** The text Pierre was given when `key` was issued. */
  issuedText: string;
  /** The latest text the editor produced itself, or the issued text. */
  editorText: string;
  /** The value of the last render, to tell a new value from one the editor's text has not reached yet. */
  seenValue: string;
  /** The editor has typed in this mount. */
  edited: boolean;
  version: number;
}

/**
 * Pierre identifies the file it renders by `cacheKey` alone and ignores later
 * contents under the same key: leaving edit mode restores the text it was
 * first given, and its highlight cache serves whatever was tokenized under a
 * key to every later mount that carries it.
 *
 * Text only this hook has handed to Pierre gets a key made from the path and
 * the text itself, so another mount of the same file finds its colors in the
 * cache. Once the editor has typed in this mount, a key no longer names one
 * text, and every key issued afterwards is unique to the mount. A new key is
 * issued whenever the text is replaced from outside the editor or editing
 * stops with text Pierre has not been given. It is chosen while rendering, so
 * Pierre never highlights a key with text it does not name. The editor's own
 * keystrokes keep the key, so its caret, undo history and scroll position
 * survive typing and saving.
 */
export function useEditorFileKey(baseKey: string, value: string, editing: boolean) {
  const instance = useId();
  const [state, setState] = useState<EditorFileKeyState>(() => ({
    key: fileHighlightKey(baseKey, value), issuedText: value, editorText: value, seenValue: value, edited: false, version: 0,
  }));
  let current = state;
  const settled = !editing && value !== state.issuedText;
  if (value !== state.seenValue || settled) {
    // A value the editor did not type replaces its text. One that has not changed is only behind it.
    if (value !== state.editorText || settled) {
      const version = state.version + 1;
      current = {
        key: state.edited ? `${baseKey}\u0000${instance}\u0000${version}` : fileHighlightKey(baseKey, value),
        issuedText: value,
        editorText: value,
        seenValue: value,
        edited: state.edited,
        version,
      };
    } else {
      current = { ...state, seenValue: value };
    }
    setState(current);
  }
  /** Records text the editor produced itself, before it reaches `value`. */
  const noteEditorText = useCallback((text: string) => {
    setState((previous) => previous.editorText === text ? previous : { ...previous, editorText: text, edited: true });
  }, []);
  return { key: current.key, noteEditorText };
}
