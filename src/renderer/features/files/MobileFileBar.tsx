import { useState } from 'react';
import { IconDots } from '@tabler/icons-react';
import type { FileTreeEntry } from '@shared/git-types';
import { Button } from '@/components/ui/button';
import { MobileSheet } from '@/components/MobileSheet';
import { MobileViewerActions, MobileViewerTitle } from '@/components/MobileChrome';
import { FileEntryActions, type FileEntryActionProps } from './FileEntryActions';
import { findEntry, parentDirectory } from './file-tree';
import { MoveFilesDialog } from './MoveFilesDialog';
import { NameDialog, type NameDialogState } from './NameDialog';
import { OpenFilesSheet } from './OpenFilesSheet';
import type { FilesViewProps } from './FilesView';
import type { FileSession } from './open-files-model';

/** An open file's top bar on a phone: its name opens the open-files sheet, and `⋯` offers what its row in the list does. */
export function MobileFileBar({ path, files, session, revision, actions, onActivateFile, onCloseFile, onLoadDirectory, onMove, onRename, onCreate }: {
  path: string;
  files: FileTreeEntry[] | null;
  session: FileSession;
  revision: number;
  actions: FileEntryActionProps;
  onActivateFile(path: string): void;
  onCloseFile(path: string): void;
  onLoadDirectory: FilesViewProps['onLoadDirectory'];
  onMove: FilesViewProps['onMoveEntries'];
  onRename: FilesViewProps['onRename'];
  onCreate: FilesViewProps['onCreate'];
}) {
  const [openFiles, setOpenFiles] = useState(false);
  const [menu, setMenu] = useState(false);
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [moveEntries, setMoveEntries] = useState<FileTreeEntry[] | null>(null);
  const name = path.split('/').pop() ?? path;
  // A file opened from a change or a search may be in a folder the list hasn't loaded.
  const entry: FileTreeEntry = (files && findEntry(files, path)) ?? { type: 'file', path, name, size: 0, mtimeMs: 0 };
  const unsavedElsewhere = session.tabs.some((tab) => tab.dirty && tab.path !== path);
  return <>
    <MobileViewerTitle title={name} onPress={() => setOpenFiles(true)} pressLabel={`${name}. Open files (${session.tabs.length})`} indicator={unsavedElsewhere ? <i className="mobile-unsaved-dot" role="img" aria-label="Other files have unsaved changes" /> : undefined} />
    <MobileViewerActions>
      <Button variant="ghost" size="icon" className="mobile-bar-button" aria-label="More file actions" aria-haspopup="dialog" onClick={() => setMenu(true)}><IconDots /></Button>
    </MobileViewerActions>
    <OpenFilesSheet open={openFiles} onOpenChange={setOpenFiles} session={session} onOpenFile={onActivateFile} onCloseFile={onCloseFile} />
    <MobileSheet open={menu} onOpenChange={setMenu} title={name} description={path !== name ? path : undefined}>
      <FileEntryActions target={entry} actions={actions} run={(action) => { setMenu(false); action(); }} onMove={(target) => setMoveEntries([target])} onRename={(target) => setNameDialog({ mode: 'rename', entry: target })} />
    </MobileSheet>
    <NameDialog state={nameDialog} onClose={() => setNameDialog(null)} onRename={onRename} onCreate={onCreate} />
    {moveEntries && <MoveFilesDialog entries={moveEntries} initialDirectory={parentDirectory(path)} revision={revision} readOnly={actions.readOnly} onLoadDirectory={onLoadDirectory} onMove={onMove} onClose={() => setMoveEntries(null)} />}
  </>;
}
