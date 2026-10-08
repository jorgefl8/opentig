import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEventHandler, type ReactNode, type Ref } from 'react';
import { IconAlertCircle, IconArrowRight, IconArrowUp, IconBook2, IconCheck, IconChevronRight, IconClock, IconDeviceDesktop, IconFileText, IconFolder, IconGitBranch, IconHome, IconInbox, IconLoader4, IconPencil, IconSearch, IconServer, IconX } from '@tabler/icons-react';
import type { RecentRepository, ServerDirectoryListing } from '../../../shared/contracts';
import { Button } from '@/components/ui/button';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { folderBreadcrumbs, folderName, parentFolderPath, sameFolder } from './directory-navigation';

type Folder = ServerDirectoryListing['directories'][number];
const NO_RECENTS: RecentRepository[] = [];

/** Paths and Git inspection always belong to the backend, including in a browser. */
export function OpenRepositoryDialog({ open, onOpenChange, onOpen, onBrowse, recent = NO_RECENTS, initialPath, onPick, title = 'Open a repository', description = onPick ? 'Browse folders or paste a path to an existing Git repository.' : 'Browse folders on your server or paste a Git repository path.', confirmLabel = 'Open repository' }: {
  title?: string;
  description?: string;
  confirmLabel?: string;
  recent?: RecentRepository[] | undefined;
  initialPath?: string | undefined;
  onPick?: (() => Promise<string | null>) | undefined;
  open: boolean;
  onOpenChange(open: boolean): void;
  onOpen(path: string): Promise<void>;
  onBrowse(path?: string): Promise<ServerDirectoryListing>;
}) {
  const [listing, setListing] = useState<ServerDirectoryListing | null>(null);
  const [location, setLocation] = useState('');
  const [draftPath, setDraftPath] = useState('');
  const [editingPath, setEditingPath] = useState(false);
  const [selected, setSelected] = useState<Folder | null>(null);
  const [filter, setFilter] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const request = useRef(0);
  const opening = useRef(false);
  const pathInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef<'path' | 'folders' | null>(null);
  const recentFolders = useMemo(() => {
    const byLastUse = [...recent].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
    return byLastUse.filter((item, index) => byLastUse.findIndex(other => sameFolder(other.path, item.path)) === index).slice(0, 4);
  }, [recent]);
  const workspacePath = recentFolders[0] ? parentFolderPath(recentFolders[0].path) : null;
  const startPath = initialPath ?? workspacePath ?? undefined;
  const browse = useCallback(async (nextPath?: string) => {
    if (opening.current) return;
    restoreFocus.current = document.activeElement === pathInput.current ? 'path' : list.current?.contains(document.activeElement) ? 'folders' : null;
    const current = ++request.current;
    setLoading(true);
    setSelected(null);
    setBrowseError(null);
    setOpenError(null);
    setFilter('');
    setEditingPath(false);
    setLocation(nextPath ?? '');
    setDraftPath(nextPath ?? '');
    try {
      const result = await onBrowse(nextPath);
      if (current !== request.current) return;
      setListing(result);
      setLocation(result.path);
      setDraftPath(result.path);
      if (result.repository) setSelected({ name: folderName(result.path), path: result.path, repository: result.repository });
    } catch (reason) {
      if (current === request.current) setBrowseError(messageOf(reason, 'Could not browse this folder.'));
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, [onBrowse]);

  useEffect(() => {
    if (open) {
      setListing(null);
      setShowHidden(false);
      void browse(startPath);
    }
    const requests = request;
    return () => { requests.current++; };
  }, [open, browse, startPath]);

  useEffect(() => { if (editingPath) { pathInput.current?.focus(); pathInput.current?.select(); } }, [editingPath]);
  useEffect(() => {
    if (loading || !restoreFocus.current) return;
    const target = restoreFocus.current === 'path' && listing?.repository && !browseError ? confirmButton.current : list.current?.querySelector<HTMLButtonElement>('.repository-folder-select') ?? editButton.current;
    restoreFocus.current = null;
    target?.focus();
  }, [loading, listing, browseError]);

  const select = (folder: Folder) => { setSelected(folder); setOpenError(null); };
  const openSelected = async (folder = selected) => {
    if (!folder?.repository || loading || editingPath || browseError || opening.current) return;
    opening.current = true;
    setBusy(true);
    setOpenError(null);
    try { await onOpen(folder.path); onOpenChange(false); }
    catch (reason) { setOpenError(messageOf(reason, 'Could not open this repository.')); }
    finally { opening.current = false; setBusy(false); }
  };
  const pickFolder = async () => {
    if (!onPick || opening.current) return;
    opening.current = true;
    setBusy(true);
    setOpenError(null);
    try {
      const path = await onPick();
      opening.current = false;
      if (path) await browse(path);
    } catch (reason) { setOpenError(messageOf(reason, 'Could not choose a folder.')); }
    finally { opening.current = false; setBusy(false); }
  };
  const visibleFolders = (listing?.directories ?? []).filter(folder => (showHidden || !folder.name.startsWith('.')) && folder.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  const parentPath = location ? parentFolderPath(location) : null;
  const canOpen = Boolean(selected?.repository && !loading && !busy && !browseError && !editingPath);
  const currentRepository = listing && sameFolder(location, listing.path) && listing.repository;
  const locations = listing?.locations ?? [{ name: 'Home', path: '', kind: 'home' as const }];
  const editPath = () => { if (!busy) { setDraftPath(location); setEditingPath(true); } };
  const cancelEditPath = () => {
    // Move focus before removing the input so the dialog does not restore it elsewhere.
    editButton.current?.focus();
    setEditingPath(false);
    setDraftPath(location);
  };
  const clickEditPath: MouseEventHandler<HTMLButtonElement> = event => {
    // This click must not submit after React turns the pencil into a submit button.
    event.preventDefault();
    editPath();
  };

  const handleKeys = (event: KeyboardEvent) => {
    if (busy) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') { event.preventDefault(); editPath(); return; }
    if ((event.target as HTMLElement).closest('input, textarea, select')) return;
    if ((event.key === 'Backspace' || (event.altKey && event.key === 'ArrowUp')) && parentPath) { event.preventDefault(); void browse(parentPath); return; }
    const rows = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('.repository-folder-select') ?? []);
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (['ArrowDown', 'ArrowUp'].includes(event.key) && rows.length) {
      event.preventDefault();
      const next = index < 0 ? event.key === 'ArrowDown' ? 0 : rows.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      rows[next]?.focus();
      const folder = visibleFolders[next];
      if (folder) select(folder);
    } else if (index >= 0 && (event.key === 'Enter' || event.key === 'ArrowRight')) {
      event.preventDefault();
      const folder = visibleFolders[index];
      if (!folder) return;
      if (event.key === 'Enter' && folder.repository) { select(folder); void openSelected(folder); }
      else void browse(folder.path);
    }
  };

  return <Dialog open={open} onOpenChange={next => { if (!opening.current) onOpenChange(next); }}>
    <DialogPopup className="repository-browser" initialFocus={closeButton} onKeyDown={handleKeys}>
      <header className="repository-browser-header">
        <div className="repository-browser-heading"><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></div>
        <FolderIconButton label="Close dialog" buttonRef={closeButton} disabled={busy} onClick={() => onOpenChange(false)}><IconX /></FolderIconButton>
      </header>
      <div className="repository-browser-body">
        <nav className="repository-browser-places" aria-label="Folder locations">
          <section><h3>Locations</h3>
            {locations.map(place => <button type="button" key={place.kind} className={`repository-place${place.path && sameFolder(place.path, location) ? ' active' : ''}`} disabled={busy} onClick={() => void browse(place.path || undefined)}>
              {place.kind === 'home' ? <IconHome aria-hidden="true" /> : place.kind === 'documents' ? <IconFileText aria-hidden="true" /> : <IconInbox aria-hidden="true" />}<span>{place.name}</span>
            </button>)}
            {workspacePath && !locations.some(place => sameFolder(place.path, workspacePath)) && <button type="button" className={`repository-place${sameFolder(workspacePath, location) ? ' active' : ''}`} disabled={busy} onClick={() => void browse(workspacePath)}><IconFolder aria-hidden="true" /><span>Workspaces</span></button>}
          </section>
          {recentFolders.length > 0 && <section className="repository-browser-recents"><h3>Recent repositories</h3>{recentFolders.map(item => <Tooltip key={item.id}><TooltipTrigger render={<button type="button" className="repository-place" disabled={busy} onClick={() => void browse(item.path)} />}><IconClock aria-hidden="true" /><span>{item.name}</span></TooltipTrigger><TooltipContent>{item.path}</TooltipContent></Tooltip>)}</section>}
          <div className="repository-browser-source">{onPick ? <IconDeviceDesktop aria-hidden="true" /> : <IconServer aria-hidden="true" />}<span>{onPick ? 'Folders on this computer' : 'Folders on your server'}</span></div>
          {onPick && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void pickFolder()}>Choose a folder…</Button>}
        </nav>
        <section className="repository-browser-main" aria-label="Folder browser">
          <div className="repository-browser-navigation">
            <FolderIconButton label="Go to parent folder" disabled={busy || !parentPath} onClick={() => { if (parentPath) void browse(parentPath); }}><IconArrowUp /></FolderIconButton>
            <form className="repository-browser-location" onSubmit={event => { event.preventDefault(); if (draftPath.trim() && !busy) void browse(draftPath.trim()); }}>
              {editingPath ? <input ref={pathInput} id="repository-path" className="repository-browser-path-input" aria-label="Folder path" value={draftPath} onChange={event => setDraftPath(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelEditPath(); } }} placeholder="Paste an absolute folder path" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={busy} /> : <nav className="repository-browser-breadcrumbs" aria-label="Current folder">
                {location ? folderBreadcrumbs(location).map((crumb, index, crumbs) => <span key={crumb.path} className={index > 0 && index < crumbs.length - 2 ? 'repository-breadcrumb-middle' : undefined}>{index > 0 && <IconChevronRight aria-hidden="true" />}{index === crumbs.length - 2 && crumbs.length > 3 && <button type="button" className="repository-breadcrumb-elision" aria-label="Enter full folder path" disabled={busy} onClick={editPath}>…</button>}{index === crumbs.length - 2 && crumbs.length > 3 && <IconChevronRight className="repository-breadcrumb-elision-icon" aria-hidden="true" />}<Tooltip><TooltipTrigger render={<button type="button" disabled={busy} aria-current={index === crumbs.length - 1 ? 'location' : undefined} onClick={() => void browse(crumb.path)} />}>{index === 0 && crumb.name === '/' ? <IconServer aria-label="Filesystem root" /> : crumb.name}</TooltipTrigger><TooltipContent>{crumb.path}</TooltipContent></Tooltip></span>) : <span className="repository-browser-home-label">Home</span>}
              </nav>}
              {!editingPath && <kbd className="repository-path-shortcut">Ctrl L</kbd>}
              <FolderIconButton buttonRef={editButton} label={editingPath ? 'Go to folder' : 'Enter a folder path'} type={editingPath ? 'submit' : 'button'} disabled={busy || (editingPath && !draftPath.trim())} onClick={editingPath ? undefined : clickEditPath}>{editingPath ? <IconArrowRight /> : <IconPencil />}</FolderIconButton>
            </form>
          </div>
          <div className="repository-browser-tools"><strong>Folders <span>{loading ? '' : browseError ? '0' : visibleFolders.length}</span></strong><label className="repository-browser-filter"><IconSearch aria-hidden="true" /><input aria-label="Filter folders" placeholder="Filter folders…" value={filter} onChange={event => { setFilter(event.target.value); setSelected(null); setOpenError(null); }} disabled={busy || loading || Boolean(browseError)} /></label></div>
          {!loading && !browseError && currentRepository && <div className="repository-current-banner"><span><IconCheck aria-hidden="true" />This folder is a Git repository</span><button type="button" disabled={busy} onClick={() => { if (listing) select({ name: folderName(listing.path), path: listing.path, repository: listing.repository }); }}>Select this repository</button></div>}
          <div className="repository-browser-folders" ref={list} aria-label="Folders" aria-busy={loading}>
            {loading ? <div className="repository-browser-loading" role="status"><span className="sr-only">Loading folders…</span>{[0, 1, 2, 3].map(index => <div className="repository-folder-skeleton" key={index} />)}</div> : browseError ? <div className="repository-browser-state" role="alert"><IconAlertCircle aria-hidden="true" /><strong>Could not browse this folder</strong><p>{browseError}</p><div><button type="button" disabled={busy} onClick={editPath}>Edit path</button><button type="button" disabled={busy} onClick={() => void browse(location || undefined)}>Try again</button></div></div> : visibleFolders.length === 0 ? <div className="repository-browser-state">{filter ? <IconSearch aria-hidden="true" /> : <IconFolder aria-hidden="true" />}<strong>{filter ? 'No matching folders' : 'No subfolders here'}</strong><p>{filter ? 'Try a different name or clear the filter.' : currentRepository ? 'You can open this repository below.' : 'Browse another location or paste the path to your repository.'}</p>{filter ? <button type="button" onClick={() => setFilter('')}>Clear filter</button> : parentPath && <button type="button" disabled={busy} onClick={() => void browse(parentPath)}>Go to parent folder</button>}</div> : visibleFolders.map(folder => <div key={folder.path} className={`repository-folder-row${selected && sameFolder(selected.path, folder.path) ? ' selected' : ''}`} onDoubleClick={() => { if (!busy) void browse(folder.path); }}>
              <Tooltip><TooltipTrigger render={<button type="button" className="repository-folder-select" aria-pressed={Boolean(selected && sameFolder(selected.path, folder.path))} aria-label={`Select ${folder.repository ? 'repository' : 'folder'} ${folder.name}`} disabled={busy} onClick={() => select(folder)} />}>
                <span className={`repository-folder-icon${folder.repository ? ' git' : ''}`}>{folder.repository ? <IconBook2 aria-hidden="true" /> : <IconFolder aria-hidden="true" />}</span><span className="repository-folder-copy"><strong>{folder.name}</strong><small>{folder.repository ? 'Git repository' : 'Folder'}</small></span>
                {folder.repository && <span className="repository-folder-branch"><IconGitBranch aria-hidden="true" /><span>{folder.repository.branch ?? 'Detached HEAD'}</span></span>}
              </TooltipTrigger><TooltipContent><div className="repository-folder-tooltip"><span>{folder.path}</span>{folder.repository && <span>Branch: {folder.repository.branch ?? 'Detached HEAD'}</span>}</div></TooltipContent></Tooltip>
              <FolderIconButton label={`Browse ${folder.name}`} disabled={busy} onClick={() => void browse(folder.path)}><IconChevronRight /></FolderIconButton>
            </div>)}
          </div>
          <div className="repository-browser-list-footer"><label><input type="checkbox" checked={showHidden} onChange={event => { setShowHidden(event.target.checked); setSelected(null); setOpenError(null); }} disabled={busy} />Show hidden folders</label><span>Select a repository to open it</span></div>
        </section>
      </div>
      {openError && <p role="alert" className="repository-browser-open-error"><IconAlertCircle aria-hidden="true" />{openError}</p>}
      <footer className="repository-browser-footer">
        <div className="repository-browser-selection" aria-live="polite"><span className={`repository-selection-icon${selected?.repository ? ' ready' : ''}`}>{selected?.repository ? <IconCheck aria-hidden="true" /> : <IconFolder aria-hidden="true" />}</span><div><strong>{selected?.name ?? (loading ? <ShimmeringText text="Loading folders…" /> : 'Choose a repository')}{selected?.repository && <span>Git repository</span>}</strong><Tooltip><TooltipTrigger render={<span className="repository-selection-path" tabIndex={selected ? 0 : undefined} />}>{editingPath ? 'Press Enter to browse the path before opening.' : selected?.path ?? 'Select a Git repository from the list.'}</TooltipTrigger><TooltipContent>{selected?.path ?? 'Select a Git repository from the list.'}</TooltipContent></Tooltip></div></div>
        <div className="repository-browser-actions"><Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button><Button ref={confirmButton} type="button" disabled={!canOpen} onClick={() => void openSelected()}>{busy ? <><IconLoader4 className="animate-spin" /><ShimmeringText text="Working…" /></> : <>{confirmLabel}<IconArrowRight aria-hidden="true" /></>}</Button></div>
      </footer>
    </DialogPopup>
  </Dialog>;
}

function FolderIconButton({ label, disabled, onClick, children, type = 'button', buttonRef }: { label: string; disabled?: boolean; onClick?: MouseEventHandler<HTMLButtonElement> | undefined; children: ReactNode; type?: 'button' | 'submit'; buttonRef?: Ref<HTMLButtonElement> }) {
  return <Tooltip><TooltipTrigger render={<button ref={buttonRef} type={type} className="repository-browser-icon-button" aria-label={label} disabled={disabled} onClick={onClick} />}>{children}</TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}
function messageOf(reason: unknown, fallback: string): string { return reason instanceof Error ? reason.message : fallback; }
