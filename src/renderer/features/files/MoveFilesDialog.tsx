import { useState } from 'react';
import { IconArrowLeft, IconChevronRight, IconFolder, IconLoader4 } from '@tabler/icons-react';
import type { FileTreeEntry } from '@shared/git-types';
import { MobileSheet } from '@/components/MobileSheet';
import { Button } from '@/components/ui/button';
import { canMovePathsToDirectory, parentDirectory, pathContains } from './file-tree';
import { useDirectoryLevel } from './use-directory-level';

export function MoveFilesDialog({ entries, initialDirectory, revision, readOnly, onLoadDirectory, onMove, onClose }: {
  entries: FileTreeEntry[];
  initialDirectory: string;
  revision: number;
  readOnly: boolean;
  onLoadDirectory(path: string): Promise<FileTreeEntry[]>;
  onMove(entries: FileTreeEntry[], destination: string): Promise<void>;
  onClose(): void;
}) {
  const [destination, setDestination] = useState(initialDirectory);
  const [moving, setMoving] = useState(false);
  const { entries: level, failed } = useDirectoryLevel(destination, revision, onLoadDirectory);
  const sourcePaths = entries.map((entry) => entry.path);
  const folders = level?.filter((entry) => entry.type === 'directory'
    && !sourcePaths.some((source) => pathContains(source, entry.path))) ?? [];
  const canMove = !readOnly && !moving && level !== null && !failed && canMovePathsToDirectory(sourcePaths, destination);
  const move = async () => {
    if (!canMove) return;
    setMoving(true);
    try { await onMove(entries, destination); onClose(); }
    finally { setMoving(false); }
  };
  return (
    <MobileSheet open onOpenChange={(open) => { if (!open && !moving) onClose(); }} title="Move to…" description={`${entries.length} selected ${entries.length === 1 ? 'item' : 'items'}. Choose a destination folder.`}>
      <div className="mobile-folder-location">
        {destination && <Button variant="ghost" size="icon" aria-label="Parent folder" disabled={moving} onClick={() => setDestination(parentDirectory(destination))}><IconArrowLeft /></Button>}
        <span>{destination || 'Repository root'}</span>
      </div>
      <div className="mobile-destination-list">
        {level === null ? <p className="mobile-list-message" role="status"><IconLoader4 className="animate-spin" /> Loading folders…</p>
          : failed ? <p className="mobile-list-message" role="alert">Could not read this folder.</p>
          : folders.length === 0 ? <p className="mobile-list-message">No subfolders. You can choose this folder below.</p>
          : folders.map((folder) => <button key={folder.path} className="mobile-sheet-action" disabled={moving} onClick={() => setDestination(folder.path)}><IconFolder /><span>{folder.name}</span><IconChevronRight /></button>)}
      </div>
      <div className="mobile-sheet-footer">
        <Button variant="ghost" disabled={moving} onClick={onClose}>Cancel</Button>
        <Button disabled={!canMove} onClick={() => void move()}>{moving && <IconLoader4 className="animate-spin" />} Move here</Button>
      </div>
    </MobileSheet>
  );
}
