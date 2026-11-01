import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { IconArrowBackUp, IconArrowForwardUp, IconArrowLeft, IconCheck, IconChecklist, IconChevronRight, IconClipboard, IconCopy, IconCut, IconDots, IconFilePlus, IconFiles, IconFolderPlus, IconFolderSymlink, IconLoader4, IconSearch, IconTrash } from '@tabler/icons-react';
import type { FileTreeEntry } from '@shared/git-types';
import { Button } from '@/components/ui/button';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { MobileRowSheetButton } from '@/components/MobileChrome';
import { MobileSheet } from '@/components/MobileSheet';
import { FolderIcon } from '@/components/FolderIcon';
import { useLongPress } from '@/lib/use-long-press';
import { getVsCodeFileIconUrl } from '@/lib/vscode-icons';
import { FileEntryActions } from './FileEntryActions';
import { MoveFilesDialog } from './MoveFilesDialog';
import { NameDialog, type NameDialogState } from './NameDialog';
import { OpenFilesSheet } from './OpenFilesSheet';
import { parentDirectory, snapshotPathPresence } from './file-tree';
import { useDirectoryLevel } from './use-directory-level';
import type { FilesViewProps } from './FilesView';

// Match .mobile-file-row in mobile.css.
const ROW_HEIGHT = 48;

/** What a row's sheet says under its name, now the row itself only shows the name. */
function entryDetails(entry: FileTreeEntry): string | undefined {
  const facts = [
    ...(entry.path !== entry.name ? [entry.path] : []),
    ...(entry.type === 'file' ? [`${Math.max(1, Math.ceil(entry.size / 1024))} KB`] : []),
    ...(entry.ignored ? ['Ignored'] : []),
  ];
  return facts.join(' · ') || undefined;
}

function MobileFileRow({ entry, top, height, selecting, selected, current, onOpen, onToggle, onMenu }: {
  entry: FileTreeEntry; top: number; height: number; selecting: boolean; selected: boolean; current: boolean;
  onOpen(): void; onToggle(): void; onMenu(): void;
}) {
  const longPress = useLongPress(onMenu, { disabled: selecting });
  return (
    <div role="listitem" className={`mobile-file-row ${selected ? 'selected' : ''} ${entry.ignored ? 'ignored' : ''}`} style={{ height, transform: `translateY(${top}px)` }}>
      <button className="mobile-file-open" aria-pressed={selecting ? selected : undefined} aria-current={current ? 'true' : undefined} {...longPress} onClick={selecting ? onToggle : onOpen}>
        {selecting ? <span className={`mobile-file-check ${selected ? 'checked' : ''}`}>{selected && <IconCheck aria-hidden="true" />}</span>
          : entry.type === 'directory' ? <FolderIcon path={entry.path} /> : <img src={getVsCodeFileIconUrl(entry.path)} alt="" aria-hidden="true" draggable={false} />}
        <span className="mobile-file-name">{entry.name}</span>
        {entry.ignored && <small>Ignored</small>}
        {!selecting && entry.type === 'directory' && <IconChevronRight aria-hidden="true" />}
      </button>
      {!selecting && <MobileRowSheetButton name={entry.name} onPress={onMenu} />}
    </div>
  );
}

export function MobileFilesView(props: FilesViewProps) {
  const [directory, setDirectory] = useState(() => parentDirectory(props.activePath ?? ''));
  const [query, setQuery] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Map<string, FileTreeEntry>>(new Map());
  // The target outlives the open state, so a sheet keeps its title while it slides away.
  const [menuOpen, setMenuOpen] = useState(false);
  const [menu, setMenu] = useState<FileTreeEntry | 'tools'>('tools');
  const [openFiles, setOpenFiles] = useState(false);
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
  const openMenu = (target: FileTreeEntry | 'tools') => { setMenu(target); setMenuOpen(true); };
  const destination: FileTreeEntry = { type: 'directory', path: directory, name: directory.split('/').pop() ?? '', children: [] };
  const selectedEntries = [...selected.values()];
  const target = menu === 'tools' ? null : menu;
  const menuAction = (action: () => void) => { setMenuOpen(false); action(); };
  const endSelecting = () => { setSelecting(false); setSelected(new Map()); };

  return (
    <div className="mobile-files-view">
      <div className="mobile-files-tools">
        <label className="search-input mobile-file-filter"><IconSearch aria-hidden="true" /><input type="search" value={query} placeholder="Filter this folder…" aria-label="Filter this folder" onChange={(event) => { setQuery(event.target.value); scrollPositions.current.set(directory, 0); scrollRef.current?.scrollTo({ top: 0 }); }} /></label>
        {selecting
          ? <Button variant="ghost" size="sm" aria-label={`Cancel selection, ${selected.size} selected`} onClick={endSelecting}>Cancel</Button>
          : <Button variant="ghost" size="icon" className="mobile-bar-button" aria-label="File actions" aria-haspopup="dialog" onClick={() => openMenu('tools')}><IconDots /></Button>}
      </div>
      {directory && <button className="mobile-file-up" aria-label={`Back to ${parentDirectory(directory) || 'the top folder'}`} onClick={() => navigate(parentDirectory(directory))}><IconArrowLeft aria-hidden="true" /><span>{directory}</span></button>}
      <div className="mobile-files-scroll" ref={scrollRef} onScroll={(event) => scrollPositions.current.set(directory, event.currentTarget.scrollTop)}>
        {level === null ? <p className="mobile-list-message" role="status"><IconLoader4 className="animate-spin" aria-hidden="true" /><ShimmeringText text="Loading files…" /></p> : failed ? <p className="mobile-list-message" role="alert">Could not read this folder.</p>
          : entries.length === 0 ? <p className="mobile-list-message">{query ? 'No matching files in this folder.' : 'This folder is empty.'}</p>
          : <div className="virtual-list" role="list" aria-label="Files in this folder" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((row) => {
              const entry = entries[row.index]!;
              return <MobileFileRow key={entry.path} entry={entry} top={row.start} height={row.size} selecting={selecting} selected={selected.has(entry.path)} current={props.activePath === entry.path}
                onOpen={() => { if (entry.type === 'directory') navigate(entry.path); else props.onOpenFile(entry.path); }} onToggle={() => toggleSelected(entry)} onMenu={() => openMenu(entry)} />;
            })}
          </div>}
      </div>
      {selecting && <div className="mobile-file-selection-actions">
        <Button variant="ghost" size="sm" disabled={props.readOnly || selected.size === 0} onClick={() => setMoveEntries(selectedEntries)}><IconFolderSymlink /> Move to…</Button>
        <Button variant="ghost" size="sm" disabled={selected.size === 0} onClick={() => void (props.fileClipboardAvailable ? props.onCopyEntries(selectedEntries) : props.onCopyPath(selectedEntries))}><IconCopy /> {props.fileClipboardAvailable ? 'Copy' : 'Copy paths'}</Button>
        {props.fileClipboardAvailable && <Button variant="ghost" size="icon" aria-label="Cut selected items" disabled={props.readOnly || selected.size === 0} onClick={() => void props.onCutEntries(selectedEntries)}><IconCut /></Button>}
        <Button variant="ghost" size="icon" aria-label="Delete selected items" disabled={props.readOnly || selected.size === 0} onClick={() => void props.onDeleteEntries(selectedEntries)}><IconTrash /></Button>
      </div>}
      <MobileSheet open={menuOpen} onOpenChange={setMenuOpen} title={target?.name ?? 'Files'} description={target ? entryDetails(target) : undefined}>
        {target ? <FileEntryActions target={target} actions={props} run={menuAction} onOpenFolder={navigate} onMove={(entry) => setMoveEntries([entry])} onRename={(entry) => setNameDialog({ mode: 'rename', entry })} /> : <>
          <button className="mobile-sheet-action" onClick={() => menuAction(() => setOpenFiles(true))}><IconFiles /><span>Open files</span><small className="mobile-sheet-value">{props.openFiles.tabs.length}</small></button>
          <button className="mobile-sheet-action" onClick={() => menuAction(props.onQuickOpen)}><IconSearch /><span>Find a file by name</span></button>
          <hr />
          <button className="mobile-sheet-action" onClick={() => menuAction(() => setSelecting(true))}><IconChecklist /><span>Select</span></button>
          <button className="mobile-sheet-action" disabled={props.readOnly} onClick={() => menuAction(() => setNameDialog({ mode: 'new-file', entry: destination }))}><IconFilePlus /><span>New file</span></button>
          <button className="mobile-sheet-action" disabled={props.readOnly} onClick={() => menuAction(() => setNameDialog({ mode: 'new-folder', entry: destination }))}><IconFolderPlus /><span>New folder</span></button>
          {props.fileClipboardAvailable && <button className="mobile-sheet-action" disabled={props.readOnly} onClick={() => menuAction(() => { void props.onPaste(directory); })}><IconClipboard /><span>Paste here</span></button>}
          <hr />
          <button className="mobile-sheet-action" disabled={props.readOnly || !props.historyState.canUndo} onClick={() => menuAction(() => { void props.onUndo(); })}><IconArrowBackUp /><span>{props.historyState.undoLabel ? `Undo ${props.historyState.undoLabel}` : 'Undo'}</span></button>
          <button className="mobile-sheet-action" disabled={props.readOnly || !props.historyState.canRedo} onClick={() => menuAction(() => { void props.onRedo(); })}><IconArrowForwardUp /><span>{props.historyState.redoLabel ? `Redo ${props.historyState.redoLabel}` : 'Redo'}</span></button>
        </>}
      </MobileSheet>
      <OpenFilesSheet open={openFiles} onOpenChange={setOpenFiles} session={props.openFiles} onOpenFile={props.onActivateFile} onCloseFile={props.onCloseFile} />
      <NameDialog state={nameDialog} onClose={() => setNameDialog(null)} onRename={props.onRename} onCreate={props.onCreate} />
      {moveEntries && <MoveFilesDialog entries={moveEntries} initialDirectory={directory} revision={props.filesSnapshotRevision} readOnly={props.readOnly} onLoadDirectory={props.onLoadDirectory} onMove={props.onMoveEntries} onClose={() => { setMoveEntries(null); setSelected(new Map()); }} />}
    </div>
  );
}
