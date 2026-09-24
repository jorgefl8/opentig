import { useCallback, useEffect, useState, type PropsWithChildren } from 'react';
import { EditProvider } from '@pierre/diffs/react';
import type { EditorOptions } from '@pierre/diffs/edit';
import { sileo } from 'sileo';
import { readClipboardText } from '@/lib/browser-capabilities';
import { EditReadyContext } from './edit-ready-context';

type EditorConstructor = typeof import('@pierre/diffs/edit').Editor;

/**
 * Pierre keeps one editor per stable editorOptions object. Mount this provider
 * above every file surface and keep it alive while the viewer changes files.
 * The standalone edit bundle is fetched only after an editable file is opened.
 */
export function PierreEditBoundary({ enabled, children }: PropsWithChildren<{ enabled: boolean }>) {
  const [EditorClass, setEditorClass] = useState<EditorConstructor | null>(null);

  useEffect(() => {
    if (!enabled || EditorClass) return;
    let active = true;
    void import('@pierre/diffs/edit').then((module) => {
      if (active) setEditorClass(() => module.Editor);
    }).catch((reason) => {
      if (!active) return;
      sileo.error({
        title: 'Could not load the code editor',
        description: reason instanceof Error ? reason.message : 'Unknown error',
      });
    });
    return () => { active = false; };
  }, [EditorClass, enabled]);

  const createEditor = useCallback((options: EditorOptions<undefined>) => {
    if (!EditorClass) throw new Error('Pierre edit mode has not loaded.');
    return new EditorClass({
      clipboard: { readText: () => readClipboardText() },
      ...options,
    });
  }, [EditorClass]);

  if (!EditorClass) return <EditReadyContext.Provider value={false}>{children}</EditReadyContext.Provider>;
  return (
    <EditProvider createEditor={createEditor}>
      <EditReadyContext.Provider value>{children}</EditReadyContext.Provider>
    </EditProvider>
  );
}
