export type PierreEditorConstructor = typeof import('@pierre/diffs/edit').Editor;

// Kept for the session: an edit boundary mounted later starts with the editor it needs.
let loadedEditor: PierreEditorConstructor | null = null;
let editorLoad: Promise<PierreEditorConstructor> | null = null;

/** The editor, once its bundle has arrived. */
export function loadedPierreEditor(): PierreEditorConstructor | null {
  return loadedEditor;
}

/** Fetches the standalone edit bundle once. A failed download can be tried again. */
export function loadPierreEditor(): Promise<PierreEditorConstructor> {
  return editorLoad ??= import('@pierre/diffs/edit').then(
    (module) => loadedEditor = module.Editor,
    (reason: unknown) => { editorLoad = null; throw reason; },
  );
}
