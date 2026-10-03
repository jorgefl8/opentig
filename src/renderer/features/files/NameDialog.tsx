import { useEffect, useState } from 'react';
import type { FileTreeEntry } from '@shared/git-types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { parentDirectory } from './file-tree';

export interface NameDialogState {
  mode: 'rename' | 'new-file' | 'new-folder';
  entry: FileTreeEntry;
}

type EntryKind = 'file' | 'directory';

export function NameDialog({
  state,
  onClose,
  onRename,
  onCreate,
}: {
  state: NameDialogState | null;
  onClose(): void;
  onRename(entry: FileTreeEntry, newName: string): Promise<void>;
  onCreate(targetDirectory: string, name: string, kind: EntryKind): Promise<void>;
}) {
  const [name, setName] = useState('');

  useEffect(() => {
    if (!state) return;
    setName(state.mode === 'rename' ? state.entry.name : '');
  }, [state]);

  if (!state) return null;

  const isRename = state.mode === 'rename';
  const kind: EntryKind = state.mode === 'new-folder' ? 'directory' : 'file';
  const destination = state.entry.type === 'directory' ? state.entry.path : parentDirectory(state.entry.path);
  const title = isRename ? 'Rename' : kind === 'directory' ? 'New Folder' : 'New File';
  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !/[\\/]/.test(trimmed) && !(isRename && trimmed === state.entry.name);

  const submit = () => {
    if (!canSubmit) return;
    if (isRename) void onRename(state.entry, trimmed);
    else void onCreate(destination, trimmed, kind);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPopup className="name-dialog">
        <form className="name-dialog-content" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isRename
              ? <>Enter a new name for <code>{state.entry.name}</code>.</>
              : <>Create a new {kind === 'directory' ? 'folder' : 'file'} in <code>{destination || 'the repository root'}</code>.</>}
          </DialogDescription>
          <input
            autoFocus
            className="name-dialog-input"
            value={name}
            maxLength={255}
            placeholder={isRename ? 'New name' : kind === 'directory' ? 'Folder name' : 'File name'}
            onChange={(event) => setName(event.target.value)}
            onFocus={(event) => {
              if (!isRename) return;
              const dot = state.entry.name.lastIndexOf('.');
              event.target.setSelectionRange(0, dot > 0 ? dot : state.entry.name.length);
            }}
          />
          <div className="name-dialog-actions">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!canSubmit}>{isRename ? 'Rename' : 'Create'}</Button>
          </div>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
