import { IconClipboard, IconCopy, IconCut, IconEdit, IconExternalLink, IconFilePlus, IconFolder, IconFolderSymlink, IconTrash } from '@tabler/icons-react';
import type { FileTreeEntry } from '@shared/git-types';
import { parentDirectory } from './file-tree';
import type { FilesViewProps } from './FilesView';

export type FileEntryActionProps = Pick<FilesViewProps, 'readOnly' | 'fileClipboardAvailable' | 'revealAvailable' | 'onOpenFile' | 'onCopyEntries' | 'onCutEntries' | 'onCopyPath' | 'onCopyContents' | 'onReveal' | 'onPaste' | 'onDeleteEntries'>;

/** What a phone offers for a file or folder, from its row in the list and from its top bar once it's open. */
export function FileEntryActions({ target, actions, run, onOpenFolder, onMove, onRename }: {
  target: FileTreeEntry;
  actions: FileEntryActionProps;
  /** Closes the sheet these rows are in, then runs the action. */
  run(action: () => void): void;
  onOpenFolder?(path: string): void;
  onMove(entry: FileTreeEntry): void;
  onRename(entry: FileTreeEntry): void;
}) {
  return <>
    {target.type === 'file' && <button className="mobile-sheet-action" onClick={() => run(() => actions.onOpenFile(target.path, 'pinned'))}><IconFilePlus /><span>Keep file open</span></button>}
    {target.type === 'directory' && onOpenFolder && <button className="mobile-sheet-action" onClick={() => run(() => onOpenFolder(target.path))}><IconFolder /><span>Open folder</span></button>}
    <button className="mobile-sheet-action" disabled={actions.readOnly} onClick={() => run(() => onMove(target))}><IconFolderSymlink /><span>Move to…</span></button>
    <button className="mobile-sheet-action" disabled={actions.readOnly} onClick={() => run(() => onRename(target))}><IconEdit /><span>Rename</span></button>
    {actions.fileClipboardAvailable && <button className="mobile-sheet-action" onClick={() => run(() => { void actions.onCopyEntries([target]); })}><IconCopy /><span>Copy</span></button>}
    {actions.fileClipboardAvailable && <button className="mobile-sheet-action" disabled={actions.readOnly} onClick={() => run(() => { void actions.onCutEntries([target]); })}><IconCut /><span>Cut</span></button>}
    <button className="mobile-sheet-action" onClick={() => run(() => { void actions.onCopyPath([target]); })}><IconCopy /><span>Copy path</span></button>
    {target.type === 'file' && <button className="mobile-sheet-action" onClick={() => run(() => { void actions.onCopyContents(target); })}><IconCopy /><span>Copy contents</span></button>}
    {actions.revealAvailable && <button className="mobile-sheet-action" onClick={() => run(() => { void actions.onReveal(target); })}><IconExternalLink /><span>Reveal in file manager</span></button>}
    {actions.fileClipboardAvailable && <button className="mobile-sheet-action" disabled={actions.readOnly} onClick={() => run(() => { void actions.onPaste(target.type === 'directory' ? target.path : parentDirectory(target.path)); })}><IconClipboard /><span>Paste here</span></button>}
    <button className="mobile-sheet-action destructive" disabled={actions.readOnly} onClick={() => run(() => { void actions.onDeleteEntries([target]); })}><IconTrash /><span>Delete</span></button>
  </>;
}
