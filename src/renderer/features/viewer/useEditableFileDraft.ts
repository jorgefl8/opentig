import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { FileResult, WriteFileResult } from '@shared/contracts';

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

type SaveShortcutEvent = Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'key' | 'preventDefault'>;

export function handleEditableFileSaveShortcut(event: SaveShortcutEvent, save: () => void): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return false;
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
  // App owns cross-tab persistence. This initializer intentionally runs only
  // on mount so a refresh cannot reset Pierre's cursor, undo history or draft.
  const [draft, setDraft] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const dirty = draft !== file.content;

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
      onConflict: () => toast.error(messages.conflictTitle, {
        description: 'Your draft is still open. Copy it or reload the file before saving again.',
        duration: 10_000,
      }),
      onSuccess: () => toast.success(messages.successTitle, { description: file.path }),
      onError: (reason) => toast.error(messages.errorTitle, {
        description: reason instanceof Error ? reason.message : 'Unknown error',
        duration: 10_000,
      }),
    });
  }, [dirty, draft, file.content, file.path, messages, onSave, readOnly]);

  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);
  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      handleEditableFileSaveShortcut(event, () => { void saveRef.current(); });
    };
    window.addEventListener('keydown', handleSaveShortcut);
    return () => window.removeEventListener('keydown', handleSaveShortcut);
  }, []);

  return { draft, updateDraft, dirty, saving, save };
}
