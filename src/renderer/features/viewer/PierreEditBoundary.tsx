import { useCallback, useEffect, useState, type PropsWithChildren } from 'react';
import { EditProvider } from '@pierre/diffs/react';
import type { EditorFactory } from '@pierre/diffs/react';
import { sileo } from 'sileo';
import { readClipboardText } from '@/lib/browser-capabilities';
import { EditReadyContext } from './edit-ready-context';
import { loadedPierreEditor, loadPierreEditor } from './pierre-editor';

/**
 * Pierre keeps one editor per stable editorOptions object. Mount this provider
 * above every file surface and keep it alive while the viewer changes files.
 * The standalone edit bundle is fetched only after an editable file is opened.
 *
 * The tree it renders never changes shape: when the bundle arrives only the
 * `EditReadyContext` value flips, so the file below turns editable in place
 * instead of being mounted, and highlighted, a second time.
 */
export function PierreEditBoundary({ enabled, children }: PropsWithChildren<{ enabled: boolean }>) {
  const [ready, setReady] = useState(() => loadedPierreEditor() !== null);

  useEffect(() => {
    if (!enabled || ready) return;
    let active = true;
    void loadPierreEditor().then(() => {
      if (active) setReady(true);
    }).catch((reason) => {
      if (!active) return;
      sileo.error({
        title: 'Could not load the code editor',
        description: reason instanceof Error ? reason.message : 'Unknown error',
      });
    });
    return () => { active = false; };
  }, [enabled, ready]);

  const createEditor = useCallback<EditorFactory<undefined, undefined>>((editorType, options, editStateKey) => {
    const Editor = loadedPierreEditor();
    if (!Editor) throw new Error('Pierre edit mode has not loaded.');
    return new Editor(editorType, {
      clipboard: { readText: () => readClipboardText() },
      ...options,
    }, editStateKey);
  }, []);

  return (
    <EditProvider createEditor={createEditor}>
      <EditReadyContext.Provider value={ready}>{children}</EditReadyContext.Provider>
    </EditProvider>
  );
}
