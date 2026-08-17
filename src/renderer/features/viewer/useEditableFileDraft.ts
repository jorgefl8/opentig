import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sileo } from 'sileo';
import type { FileResult, WriteFileResult } from '@shared/contracts';
import { DEFAULT_SHORTCUT_MAP, matchesCombo } from '@shared/shortcuts';
import { useShortcuts } from '@/app/useShortcuts';

interface SaveMessages {
  conflictTitle: string;
  successTitle: string;
  errorTitle: string;
}

interface UseEditableFileDraftOptions {
  file: FileResult;
  initialContent: string;
  readOnly: boolean;
  messages: SaveMessages;
  onDirtyChange(dirty: boolean): void;
  onDraftChange(content: string): void;
  onSave(path: string, content: string, expectedContent: string): Promise<WriteFileResult>;
}

interface ExecuteSaveOptions {
  dirty: boolean;
  readOnly: boolean;
  claim(): boolean;
  release(): void;
  persist(): Promise<WriteFileResult>;
  onConflict(): void;
  onSuccess(): void;
  onError(reason: unknown): void;
}

export type EditableFileSaveOutcome = 'skipped' | 'saved' | 'conflict' | 'error';

type SaveShortcutEvent = Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'key' | 'preventDefault'> & Partial<Pick<KeyboardEvent, 'shiftKey' | 'altKey'>>;

export function handleEditableFileSaveShortcut(event: SaveShortcutEvent, save: () => void, combo: string = DEFAULT_SHORTCUT_MAP.saveFile): boolean {
  const matches = matchesCombo({
    key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey ?? false, altKey: event.altKey ?? false,
  }, combo);
  if (!matches) return false;
  event.preventDefault();
  save();
  return true;
}

/** Pure save lifecycle used by the hook and its characterization tests. */
export async function executeEditableFileSave(options: ExecuteSaveOptions): Promise<EditableFileSaveOutcome> {
  if (!options.dirty || options.readOnly || !options.claim()) return 'skipped';
  try {
    const result = await options.persist();
    if (result.status === 'conflict') {
      options.onConflict();
      return 'conflict';
    }
    options.onSuccess();
    return 'saved';
  } catch (reason) {
    options.onError(reason);
    return 'error';
  } finally {
    options.release();
  }
}

export function useEditableFileDraft({ file, initialContent, readOnly, messages, onDirtyChange, onDraftChange, onSave }: UseEditableFileDraftOptions) {
  const shortcuts = useShortcuts();
  // App owns cross-tab persistence. This initializer intentionally runs only
  // on mount so a refresh cannot reset Pierre's cursor, undo history or draft.
  const [draft, setDraft] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const dirty = draft !== file.content;

  // `file.content`/`file.mtimeMs` change both on our own successful saves and
  // on a genuine external edit to the file on disk. The mount key and
  // Pierre's own `cacheKey` upstream stay pinned to the file's path (see
  // `Viewer.tsx`), so neither ever forces a remount here - that used to be
  // what reset the editor's scroll position to the top on every Ctrl+S.
  // A save needs no help: `draft` already equals the new `file.content`, so
  // `dirty` above already recomputes to `false` on its own. A genuine
  // external change is the one case that still needs a hand, since the draft
  // was clean against the *old* content: adopt the new content in place
  // instead, so there is nothing to remount for that either.
  const syncedContentRef = useRef(file.content);
  useLayoutEffect(() => {
    if (draft === syncedContentRef.current && file.content !== syncedContentRef.current) {
      setDraft(file.content);
    }
    syncedContentRef.current = file.content;
  }, [file.content, draft]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const updateDraft = useCallback((value: string) => {
    setDraft(value);
    onDirtyChange(value !== file.content);
    onDraftChange(value);
  }, [file.content, onDirtyChange, onDraftChange]);

  const save = useCallback(async () => {
    await executeEditableFileSave({
      dirty,
      readOnly,
      claim: () => {
        if (savingRef.current) return false;
        savingRef.current = true;
        setSaving(true);
        return true;
      },
      release: () => {
        savingRef.current = false;
        setSaving(false);
      },
      persist: () => onSave(file.path, draft, file.content),
      onConflict: () => sileo.error({
        title: messages.conflictTitle,
        description: 'Your draft is still open. Copy it or reload the file before saving again.',
        duration: 10_000,
      }),
      onSuccess: () => sileo.success({ title: messages.successTitle, description: file.path }),
      onError: (reason) => sileo.error({
        title: messages.errorTitle,
        description: reason instanceof Error ? reason.message : 'Unknown error',
        duration: 10_000,
      }),
    });
  }, [dirty, draft, file.content, file.path, messages, onSave, readOnly]);

  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);
  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      handleEditableFileSaveShortcut(event, () => { void saveRef.current(); }, shortcuts.saveFile);
    };
    window.addEventListener('keydown', handleSaveShortcut);
    return () => window.removeEventListener('keydown', handleSaveShortcut);
  }, [shortcuts.saveFile]);

  return { draft, updateDraft, dirty, saving, save };
}
