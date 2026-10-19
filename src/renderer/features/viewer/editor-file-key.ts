import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';

/**
 * Pierre identifies the file it renders by `cacheKey` alone and ignores later
 * contents under the same key: leaving edit mode restores the text it was
 * first given, and its worker highlight cache can serve that text to a later
 * mount of the same path. Issue a new key, unique to this mount, whenever the
 * text is replaced from outside the editor or editing stops with text Pierre
 * has not been given. The editor's own keystrokes keep the key, so its caret,
 * undo history and scroll position survive typing and saving.
 */
export function useEditorFileKey(baseKey: string, value: string, editing: boolean) {
  const instance = useId();
  const [version, setVersion] = useState(0);
  const editorText = useRef(value);
  const issuedText = useRef(value);
  useLayoutEffect(() => {
    const replaced = value !== editorText.current;
    const settled = !editing && value !== issuedText.current;
    editorText.current = value;
    if (!replaced && !settled) return;
    issuedText.current = value;
    setVersion((current) => current + 1);
  }, [editing, value]);
  /** Records text the editor produced itself, before it reaches `value`. */
  const noteEditorText = useCallback((text: string) => { editorText.current = text; }, []);
  return { key: `${baseKey}\u0000${instance}\u0000${version}`, noteEditorText };
}
