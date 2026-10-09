import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { IconArrowBackUp, IconArrowForwardUp, IconCheck, IconChevronRight, IconClipboard, IconCopy, IconCut, IconDots, IconEdit, IconExternalLink, IconFilePlus, IconFolder, IconFolderPlus, IconFolderSymlink, IconLoader4, IconSearch, IconTrash } from '@tabler/icons-react';
import type { FileTreeEntry } from '@shared/git-types';
import { Button } from '@/components/ui/button';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { MobileSheet } from '@/components/MobileSheet';
import { getVsCodeFileIconUrl, getVsCodeFolderIconUrl } from '@/lib/vscode-icons';
import { MoveFilesDialog } from './MoveFilesDialog';
import { NameDialog, type NameDialogState } from './NameDialog';
import { parentDirectory, snapshotPathPresence } from './file-tree';
import { useDirectoryLevel } from './use-directory-level';
import type { FilesViewProps } from './FilesView';

const ROW_HEIGHT = 56;

export function MobileFilesView(props: FilesViewProps) {
  const [directory, setDirectory] = useState(() => parentDirectory(props.activePath ?? ''));
  const [query, setQuery] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Map<string, FileTreeEntry>>(new Map());
  const [menu, setMenu] = useState<FileTreeEntry | 'tools' | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [moveEntries, setMoveEntries] = useState<FileTreeEntry[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const lastActivePath = useRef(props.activePath);
  const { entries: level, failed } = useDirectoryLevel(directory, props.filesSnapshotRevision, props.onLoadDirectory, props.active);
  const entries = useMemo(() => (level ?? []).filter((entry) => (props.showDotEnvFiles || !entry.ignored)
    && entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [level, props.showDotEnvFiles, query]);
  // oxlint-disable-next-line react/incompatible-library -- Virtual rows use an imperative scroll instance.
  const virtualizer = useVirtualizer({
    count: entries.length,
    enabled: props.active && level !== null,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => entries[index]!.path,
    overscan: 8,
    paddingEnd: 12,
  });

  useEffect(() => {
    if (props.activePath === lastActivePath.current) return;
    lastActivePath.current = props.activePath;
    if (props.activePath) { setDirectory(parentDirectory(props.activePath)); setQuery(''); }
  }, [props.activePath]);
  useEffect(() => {
    if (!level) return;
    const paths = new Set(level.map((entry) => entry.path));
    setSelected((current) => {
      const next = new Map([...current].filter(([path]) => paths.has(path)));
      return next.size === current.size ? current : next;
    });
  }, [level]);
  useEffect(() => {
    if (level && scrollRef.current) scrollRef.current.scrollTop = scrollPositions.current.get(directory) ?? 0;
  }, [directory, level]);

  useEffect(() => {
    if (!props.files || !directory || snapshotPathPresence(props.files, directory) !== 'missing') return;
    let parent = parentDirectory(directory);
    while (parent && snapshotPathPresence(props.files, parent) === 'missing') parent = parentDirectory(parent);
    setDirectory(parent);
    setQuery('');
    setSelected(new Map());
  }, [props.files, directory]);

  const navigate = (path: string) => { setDirectory(path); setQuery(''); setSelected(new Map()); };
  const toggleSelected = (entry: FileTreeEntry) => setSelected((current) => {
    const next = new Map(current);
    if (next.has(entry.path)) next.delete(entry.path); else next.set(entry.path, entry);
    return next;
  });
  const destination: FileTreeEntry = { type: 'directory', path: directory, name: directory.split('/').pop() ?? '', children: [] };
  const selectedEntries = [...selected.values()];
  const target = menu && menu !== 'tools' ? menu : null;
  const menuAction = (action: () => void) => { setMenu(null); action(); };

  return (
    <div className="mobile-files-view">
      <div className="mobile-view-heading">
        <h2>{selecting ? 'Select items' : 'Files'}{selecting && <small>{selected.size}</small>}</h2>
        <div>
          <Button variant="ghost" size="sm" aria-pressed={selecting} onClick={() => { setSelecting(!selecting); setSelected(new Map()); }}>{selecting ? 'Cancel' : 'Select'}</Button>
          <Button variant="ghost" size="icon" aria-label="File browser actions" onClick={() => setMenu('tools')}><IconDots /></Button>
        </div>
      </div>
      <label className="mobile-file-filter"><IconSearch aria-hidden="true" /><input type="search" value={query} placeholder="Filter this folder…" aria-label="Filter this folder" onChange={(event) => { setQuery(event.target.value); scrollPositions.current.set(directory, 0); scrollRef.current?.scrollTo({ top: 0 }); }} /></label>
      <nav className="mobile-file-breadcrumb" aria-label="Folder location">
        <button onClick={() => navigate('')} aria-current={directory === '' ? 'location' : undefined}><IconFolder aria-hidden="true" /> Root</button>
        {directory.split('/').filter(Boolean).map((part, index, parts) => {
          const path = parts.slice(0, index + 1).join('/');
          return <span key={path}><IconChevronRight aria-hidden="true" /><button aria-current={path === directory ? 'location' : undefined} onClick={() => navigate(path)}>{part}</button></span>;
        })}
      </nav>
      <div className="mobile-files-scroll" ref={scrollRef} onScroll={(event) => scrollPositions.current.set(directory, event.currentTarget.scrollTop)}>
        {level === null ? <p className="mobile-list-message" role="status"><IconLoader4 className="animate-spin" aria-hidden="true" /><ShimmeringText text="Loading files…" /></p> : failed ? <p className="mobile-list-message" role="alert">Could not read this folder.</p>
          : entries.length === 0 ? <p className="mobile-list-message">{query ? 'No matching files in this folder.' : 'This folder is empty.'}</p>
          : <div className="virtual-list" role="list" aria-label="Files in this folder" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((row) => {
              const entry = entries[row.index]!;
              const isSelected = selected.has(entry.path);
              return <div key={entry.path} role="listitem" className={`mobile-file-row ${isSelected ? 'selected' : ''}`} style={{ height: row.size, transform: `translateY(${row.start}px)` }}>
                <button className="mobile-file-open" aria-pressed={selecting ? isSelected : undefined} aria-current={props.activePath === entry.path ? 'true' : undefined} onClick={() => selecting ? toggleSelected(entry) : entry.type === 'directory' ? navigate(entry.path) : props.onOpenFile(entry.path)}>
                  {selecting ? <span className={`mobile-file-check ${isSelected ? 'checked' : ''}`}>{isSelected && <IconCheck aria-hidden="true" />}</span>
                    : <img src={entry.type === 'directory' ? getVsCodeFolderIconUrl(entry.path, false) : getVsCodeFileIconUrl(entry.path)} alt="" aria-hidden="true" draggable={false} />}
                  <span className="mobile-file-copy"><strong>{entry.name}</strong><small>{entry.type === 'directory' ? (entry.ignored ? 'Ignored folder' : 'Folder') : `${entry.ignored ? 'Ignored · ' : ''}${Math.max(1, Math.ceil(entry.size / 1024))} KB`}</small></span>
                  {!selecting && entry.type === 'directory' && <IconChevronRight aria-hidden="true" />}
                </button>
                {!selecting && <Button variant="ghost" size="icon" className="mobile-file-menu" aria-label={`Actions for ${entry.name}`} onClick={() => setMenu(entry)}><IconDots /></Button>}
              </div>;
            })}
          </div>}
      </div>
      {selecting && <div className="mobile-file-selection-actions">
        <Button variant="ghost" size="sm" disabled={props.readOnly || selected.size === 0} onClick={() => setMoveEntries(selectedEntries)}><IconFolderSymlink /> Move to…</Button>
        <Button variant="ghost" size="sm" disabled={selected.size === 0} onClick={() => void (props.fileClipboardAvailable ? props.onCopyEntries(selectedEntries) : props.onCopyPath(selectedEntries))}><IconCopy /> {props.fileClipboardAvailable ? 'Copy' : 'Copy paths'}</Button>
        {props.fileClipboardAvailable && <Button variant="ghost" size="icon" aria-label="Cut selected items" disabled={props.readOnly || selected.size === 0} onClick={() => void props.onCutEntries(selectedEntries)}><IconCut /></Button>}
        <Button variant="ghost" size="icon" aria-label="Delete selected items" disabled={props.readOnly || selected.size === 0} onClick={() => void props.onDeleteEntries(selectedEntries)}><IconTrash /></Button>
      </div>}
      <MobileSheet open={menu !== null} onOpenChange={(open) => { if (!open) setMenu(null); }} title={target?.name ?? 'File browser actions'} description={target?.path ?? 'Actions for the current folder.'}>
        {target ? <>
          {target.type === 'file' && <button className="mobile-sheet-action" onClick={() => menuAction(() => props.onOpenFile(target.path, 'pinned'))}><IconFilePlus /><span>Keep file open</span></button>}
          {target.type === 'directory' && <button className="mobile-sheet-action" onClick={() => menuAction(() => navigate(target.path))}><IconFolder /><span>Open folder</span></button>}
          <button className="mobile-sheet-action" disabled={props.readOnly} onClick={() => menuAction(() => setMoveEntries([target]))}><IconFolderSymlink /><span>Move to…</span></button>
          <button className="mobile-sheet-action" disabled={props.readOnly} onClick={() => menuAction(() => setNameDialog({ mode: 'rename', entry: target }))}><IconEdit /><span>Rename</span></button>
          {props.fileClipboardAvailable && <button className="mobile-sheet-action" onClick={() => menuAction(() => { void props.onCopyEntries([target]); })}><IconCopy /><span>Copy</span></button>}
          {props.fileClipboardAvailable && <button className="mobile-sheet-action" disabled={props.readOnly} onClick={() => menuAction(() => { void props.onCutEntries([target]); })}><IconCut /><span>Cut</span></button>}
          <button className="mobile-sheet-action" onClick={() => menuAction(() => { void props.onCopyPath([target]); })}><IconCopy /><span>Copy path</span></button>
          {target.type === 'file' && <button className="mobile-sheet-action" onClick={() => menuAction(() => { void props.onCopyContents(target); })}><IconCopy /><span>Copy contents</span></button>}
          {props.revealAvailable && <button className="mobile-sheet-action" onClick={() => menuAction(() => { void props.onReveal(target); })}><IconExternalLink /><span>Reveal in file manager</span></button>}
          {props.fileClipboardAvailable && <button className="mobile-sheet-action" disabled={props.readOnly} onClick={() => menuAction(() => { void props.onPaste(target.type === 'directory' ? target.path : parentDirectory(target.path)); })}><IconClipboard /><span>Paste here</span></button>}
          <button className="mobile-sheet-action destructive" disabled={props.readOnly} onClick={() => menuAction(() => { void props.onDeleteEntries([target]); })}><IconTrash /><span>Delete</span></button>
        </> : <>
          <button className="mobile-sheet-action" onClick={() => menuAction(props.onQuickOpen)}><IconSearch /><span>Find file in repository</span></button>
          <button className="mobile-sheet-action" disabled={props.readOnly} onClick={() => menuAction(() => setNameDialog({ mode: 'new-file', entry: destination }))}><IconFilePlus /><span>New file</span></button>
          <button className="mobile-sheet-action" disabled={props.readOnly} onClick={() => menuAction(() => setNameDialog({ mode: 'new-folder', entry: destination }))}><IconFolderPlus /><span>New folder</span></button>
          {props.fileClipboardAvailable && <button className="mobile-sheet-action" disabled={props.readOnly} onClick={() => menuAction(() => { void props.onPaste(directory); })}><IconClipboard /><span>Paste here</span></button>}
          <button className="mobile-sheet-action" disabled={props.readOnly || !props.historyState.canUndo} onClick={() => menuAction(() => { void props.onUndo(); })}><IconArrowBackUp /><span>{props.historyState.undoLabel ? `Undo ${props.historyState.undoLabel}` : 'Undo'}</span></button>
          <button className="mobile-sheet-action" disabled={props.readOnly || !props.historyState.canRedo} onClick={() => menuAction(() => { void props.onRedo(); })}><IconArrowForwardUp /><span>{props.historyState.redoLabel ? `Redo ${props.historyState.redoLabel}` : 'Redo'}</span></button>
        </>}
      </MobileSheet>
      <NameDialog state={nameDialog} onClose={() => setNameDialog(null)} onRename={props.onRename} onCreate={props.onCreate} />
      {moveEntries && <MoveFilesDialog entries={moveEntries} initialDirectory={directory} revision={props.filesSnapshotRevision} readOnly={props.readOnly} onLoadDirectory={props.onLoadDirectory} onMove={props.onMoveEntries} onClose={() => { setMoveEntries(null); setSelected(new Map()); }} />}
    </div>
  );
}
