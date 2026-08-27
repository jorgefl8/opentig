import { useContext, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, Ref } from 'react';
import { IconDeviceFloppy } from '@tabler/icons-react';
import { File, Virtualizer, useVirtualizer } from '@pierre/diffs/react';
import type { EditorOptions } from '@pierre/diffs/edit';
import type { FileResult, ThemePreference, WriteFileResult } from '@shared/contracts';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { OPENTIG_CODE_THEMES } from './diffThemes';
import { VIEWER_SCROLLBAR_CSS } from './patch-utils';
import { EditReadyContext } from './PierreEditBoundary';
import { PierreWorkerPool } from './PierreWorkerPool';
import { syncScrollFraction } from './scroll-sync';
import { buildFileEditorKeymap } from './source-editor-keymap';
import { shouldVirtualizeSourceEditor } from './source-editor-virtualization';
import { useEditableFileDraft } from './useEditableFileDraft';
import { useShortcuts } from '@/app/useShortcuts';
import './source-editor.css';

interface FileSaveControlsProps {
  dirty: boolean;
  saving: boolean;
  readOnly: boolean;
  onSave(): void;
}

export function FileSaveControls({ dirty, saving, readOnly, onSave }: FileSaveControlsProps) {
  const shortcuts = useShortcuts();
  if (!dirty && !saving) return null;

  // The dirty state already shows as a dot on the file's tab, so this floats
  // as an icon-only save button - no redundant "Unsaved" label next to it.
  const label = readOnly ? 'Read only' : saving ? 'Saving…' : `Save file (${shortcuts.saveFile})`;
  return (
    <Tooltip>
      <TooltipTrigger render={
        <button
          type="button"
          className="file-save-button"
          data-state={readOnly ? 'readonly' : saving ? 'saving' : 'dirty'}
          disabled={saving || readOnly}
          onClick={onSave}
          aria-label={label}
        />
      }>
        <IconDeviceFloppy aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
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
  ref?: Ref<SourceCodeEditorHandle>;
}

/** Imperative scroll access for syncing position with the Markdown preview tab. */
export interface SourceCodeEditorHandle {
  /** Current scroll position as a 0-1 fraction of the scrollable range. */
  getScrollFraction(): number;
  /** Scroll to a 0-1 fraction of the scrollable range, via the editor's own virtualizer. */
  scrollToFraction(fraction: number): void;
}

type VirtualizerHandle = ReturnType<typeof useVirtualizer>;

/**
 * Renders inside <Virtualizer> to capture its instance for imperative scrollTo calls.
 * A layout effect (not a plain effect) so the ref is populated before ancestor
 * layout effects run in the same commit, e.g. MarkdownFileViewer's scroll restore.
 */
function VirtualizerScrollBridge({ handleRef }: { handleRef: MutableRefObject<VirtualizerHandle> }) {
  const virtualizer = useVirtualizer();
  useLayoutEffect(() => {
    handleRef.current = virtualizer;
  }, [virtualizer, handleRef]);
  return null;
}

export function SourceCodeEditor({ path, cacheKey, value, themeType, wrapLines, readOnly, onChange, ref }: SourceCodeEditorProps) {
  const editReady = useContext(EditReadyContext);
  const shortcuts = useShortcuts();
  // Keep the surface type stable for this mount. Crossing the threshold while
  // typing must not replace the editor DOM, caret, history, or scroll position.
  const [virtualized] = useState(() => shouldVirtualizeSourceEditor(value));
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  const virtualizerRef = useRef<VirtualizerHandle>(undefined);
  const plainScrollRef = useRef<HTMLDivElement>(null);

  const file = useMemo(() => ({ name: path, contents: value, cacheKey }), [cacheKey, path, value]);
  const options = useMemo(() => ({
    disableFileHeader: true,
    themeType,
    theme: OPENTIG_CODE_THEMES,
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

  const cancelScrollSync = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelScrollSync.current?.(), []);

  useImperativeHandle(ref, () => ({
    getScrollFraction() {
      const root = virtualizerRef.current?.getRoot() ?? plainScrollRef.current;
      if (!(root instanceof HTMLElement)) return 0;
      const max = root.scrollHeight - root.clientHeight;
      return max > 0 ? root.scrollTop / max : 0;
    },
    scrollToFraction(fraction) {
      cancelScrollSync.current?.();
      // The virtualizer mounts near-empty and grows as rows are measured and
      // syntax highlighting streams in, so a single scroll would land far short
      // of the target line. Reapply until its height settles.
      cancelScrollSync.current = syncScrollFraction({
        getScrollRange() {
          const root = virtualizerRef.current?.getRoot() ?? plainScrollRef.current;
          return root instanceof HTMLElement ? Math.max(0, root.scrollHeight - root.clientHeight) : 0;
        },
        getScrollTop() {
          const root = virtualizerRef.current?.getRoot() ?? plainScrollRef.current;
          return root instanceof HTMLElement ? root.scrollTop : 0;
        },
        getContentHeight() {
          const root = virtualizerRef.current?.getRoot() ?? plainScrollRef.current;
          return root instanceof HTMLElement ? root.scrollHeight : 0;
        },
        scrollTo(top) {
          const virtualizer = virtualizerRef.current;
          if (virtualizer && virtualizer.getRoot() instanceof HTMLElement) virtualizer.scrollTo({ top });
          else plainScrollRef.current?.scrollTo({ top });
        },
      }, fraction);
    },
  }), []);

  const fileSurface = (
    <File
      file={file}
      options={options}
      editorOptions={editorOptions}
      edit={editReady && !readOnly}
    />
  );

  return (
    <PierreWorkerPool theme={OPENTIG_CODE_THEMES}>
      {virtualized ? (
      <Virtualizer className="source-code-editor" contentClassName="source-code-editor-content">
        <VirtualizerScrollBridge handleRef={virtualizerRef} />
        {fileSurface}
      </Virtualizer>
      ) : (
        <div ref={plainScrollRef} className="source-code-editor">
          <div className="source-code-editor-content">{fileSurface}</div>
        </div>
      )}
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
  conflictTitle: 'File was changed outside OpenTig',
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
        <div className="source-file-toolbar">
          <FileSaveControls dirty={dirty} saving={saving} readOnly={readOnly} onSave={() => void save()} />
        </div>
      )}
      <div className="source-editor-scroll">
        <SourceCodeEditor
          path={file.path}
          cacheKey={file.path}
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
