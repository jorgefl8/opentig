import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { IconDeviceFloppy } from '@tabler/icons-react';
import { EditProvider, File, Virtualizer } from '@pierre/diffs/react';
import type { EditorOptions } from '@pierre/diffs/edit';
import { sileo } from 'sileo';
import type { FileResult, ThemePreference, WriteFileResult } from '@shared/contracts';
import { JUSTGIT_CODE_THEMES } from './diffThemes';
import { VIEWER_SCROLLBAR_CSS } from './patch-utils';
import { PierreWorkerPool } from './PierreWorkerPool';
import { buildFileEditorKeymap } from './source-editor-keymap';
import { useEditableFileDraft } from './useEditableFileDraft';
import { useShortcuts } from '@/app/useShortcuts';
import './source-editor.css';

type EditorConstructor = typeof import('@pierre/diffs/edit').Editor;

const EditReadyContext = createContext(false);

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
      clipboard: { readText: () => window.justgit.clipboard.readText() },
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

interface FileSaveControlsProps {
  dirty: boolean;
  saving: boolean;
  readOnly: boolean;
  onSave(): void;
}

export function FileSaveControls({ dirty, saving, readOnly, onSave }: FileSaveControlsProps) {
  const shortcuts = useShortcuts();
  if (!dirty && !saving) return null;

  return (
    <div className="file-save-controls">
      <span className="file-save-status" data-state={readOnly ? 'readonly' : saving ? 'saving' : 'dirty'} role="status" aria-live="polite">
        {readOnly ? 'Read only' : saving ? 'Saving…' : 'Unsaved'}
      </span>
      <button
        type="button"
        className="file-save-button"
        disabled={saving || readOnly}
        onClick={onSave}
        title={`Save file (${shortcuts.saveFile})`}
      >
        <IconDeviceFloppy aria-hidden="true" />
        Save
      </button>
    </div>
  );
}

interface SourceCodeEditorProps {
  path: string;
  cacheKey: string;
  value: string;
  themeType: ThemePreference;
  wrapLines: boolean;
  readOnly: boolean;
  onChange(value: string): void;
}

export function SourceCodeEditor({ path, cacheKey, value, themeType, wrapLines, readOnly, onChange }: SourceCodeEditorProps) {
  const editReady = useContext(EditReadyContext);
  const shortcuts = useShortcuts();
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const file = useMemo(() => ({ name: path, contents: value, cacheKey }), [cacheKey, path, value]);
  const options = useMemo(() => ({
    disableFileHeader: true,
    themeType,
    theme: JUSTGIT_CODE_THEMES,
    overflow: wrapLines ? 'wrap' as const : 'scroll' as const,
    unsafeCSS: VIEWER_SCROLLBAR_CSS,
  }), [themeType, wrapLines]);
  // This object must stay stable: EditProvider uses its identity to retain the
  // editor instance and its undo/redo history while the surface rerenders. It is
  // only rebuilt when the find-and-replace binding itself is rebound in Settings.
  const editorOptions = useMemo<EditorOptions<undefined>>(() => ({
    historyMaxEntries: 500,
    keymap: buildFileEditorKeymap(shortcuts.editorSearch),
    onChange(nextFile) { onChangeRef.current(nextFile.contents); },
  }), [shortcuts.editorSearch]);

  return (
    <PierreWorkerPool theme={JUSTGIT_CODE_THEMES}>
      <Virtualizer className="source-code-editor" contentClassName="source-code-editor-content">
        <File
          file={file}
          options={options}
          editorOptions={editorOptions}
          edit={editReady && !readOnly}
        />
      </Virtualizer>
    </PierreWorkerPool>
  );
}

interface EditableFileViewerProps {
  file: FileResult;
  /** The draft App is holding for this path, or the file's own content. */
  initialContent: string;
  themeType: ThemePreference;
  wrapLines: boolean;
  readOnly: boolean;
  onDirtyChange(dirty: boolean): void;
  onDraftChange(content: string): void;
  onSave(path: string, content: string, expectedContent: string): Promise<WriteFileResult>;
}

const FILE_SAVE_MESSAGES = {
  conflictTitle: 'File was changed outside JustGit',
  successTitle: 'File saved',
  errorTitle: 'Could not save file',
};

export function EditableFileViewer({ file, initialContent, themeType, wrapLines, readOnly, onDirtyChange, onDraftChange, onSave }: EditableFileViewerProps) {
  const { draft, updateDraft, dirty, saving, save } = useEditableFileDraft({
    file, initialContent, readOnly, messages: FILE_SAVE_MESSAGES, onDirtyChange, onDraftChange, onSave,
  });

  return (
    <div className="source-file-viewer">
      {(dirty || saving) && (
        <div className="file-viewer-pill source-file-toolbar">
          <FileSaveControls dirty={dirty} saving={saving} readOnly={readOnly} onSave={() => void save()} />
        </div>
      )}
      <div className="source-editor-scroll">
        <SourceCodeEditor
          path={file.path}
          cacheKey={`${file.path}:${file.mtimeMs}`}
          value={draft}
          themeType={themeType}
          wrapLines={wrapLines}
          readOnly={readOnly || saving}
          onChange={updateDraft}
        />
      </div>
    </div>
  );
}
