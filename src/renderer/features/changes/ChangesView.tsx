import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLongPress } from '@/lib/use-long-press';
import { useMobileLayout } from '@/lib/use-mobile-layout';
import { useTruncatedText } from '@/lib/use-truncated-text';
import { useVirtualizer } from '@tanstack/react-virtual';
import { IconChevronRight, IconFileArrowRight, IconGitCompare, IconMinus, IconPlus, IconRestore } from '@tabler/icons-react';
import type { ChangesLayoutPreference } from '../../../shared/contracts';
import type { FileChange } from '../../../shared/git-types';
import { FolderIcon } from '@/components/FolderIcon';
import { MobileRowSheetButton } from '@/components/MobileChrome';
import { MobileSheet } from '@/components/MobileSheet';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { shouldOpenChangePreview } from './change-preview';
import { changeStatusCode } from './change-status';
import { buildChangeTree, collectChangePaths, flattenChangeTree, type ChangeTreeEntry, type ChangeVirtualRow } from './change-tree';
import { shouldActivateChangeRow } from './row-activation';
import { getVsCodeFileIconUrl } from '@/lib/vscode-icons';

// Keep in sync with the .change-row and .tree-folder heights in styles/index.css and styles/mobile.css.
const ROW_HEIGHT = 28;
const MOBILE_ROW_HEIGHT = 52;

/** What the viewer is showing. A diff names its side, so a file staged and also edited marks only that row. */
export interface ChangeSelection { path: string; kind: 'staged' | 'unstaged' | null }

interface ChangesViewProps {
  conflicts: FileChange[]; staged: FileChange[]; changed: FileChange[]; readOnly: boolean;
  displayMode: ChangesLayoutPreference;
  /** Files, not rows: a file both staged and edited sits in two groups and counts once. */
  changeCount: number; insertions: number; deletions: number;
  selection: ChangeSelection | null;
  unpublishedCommits: number; branchNeedsPublication: boolean; publishDisabled: boolean; onPublish(): void;
  onSelect(path: string, kind: 'staged' | 'unstaged'): void; onOpenFile(path: string): void; onDiscard(paths: string[]): void;
  onConflict(path: string): void;
  onStage(paths: string[]): void; onUnstage(paths: string[]): void; onStageAll(): void; onUnstageAll(): void;
}

/** A phone row's sheet: what it isn't worth risking a slip on sits behind a long press. */
interface ChangeRowMenu { change: FileChange; kind: 'conflict' | 'staged' | 'unstaged' }

export function ChangesView(props: ChangesViewProps) {
  const mobile = useMobileLayout();
  // A phone has no room for a tree; the saved choice stays for the desktop layout.
  const displayMode = mobile ? 'list' : props.displayMode;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<ChangeRowMenu | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { if (!mobile) setMenuOpen(false); }, [mobile]);
  const openMenu = mobile ? (next: ChangeRowMenu) => { setMenu(next); setMenuOpen(true); } : undefined;
  const bothGroups = props.staged.length > 0 && props.changed.length > 0;
  // With no other group above it the list needs no label. Conflicts count as a
  // group here too, or these files would read as more conflicts.
  const notStagedLabel = props.staged.length > 0 || props.conflicts.length > 0 ? 'Not staged' : null;
  return (
    <div className="changes-view">
      {props.changeCount === 0
        ? <NoChanges unpublishedCommits={props.unpublishedCommits} branchNeedsPublication={props.branchNeedsPublication} publishDisabled={props.publishDisabled} onPublish={props.onPublish} />
        : <ChangesStrip count={props.changeCount} insertions={props.insertions} deletions={props.deletions} staged={props.staged.length} changed={props.changed.length} disabled={props.readOnly} onStageAll={props.onStageAll} onUnstageAll={props.onUnstageAll} />}
      <div ref={scrollRef} className="changes-scroll">
        <ConflictSection scrollRef={scrollRef} changes={props.conflicts} selection={props.selection} onSelect={props.onConflict} onOpenFile={props.onOpenFile} onMenu={openMenu && ((change) => openMenu({ change, kind: 'conflict' }))} />
        <ChangeSection scrollRef={scrollRef} displayMode={displayMode} label="Staged" showCount changes={props.staged} selection={props.selection} onSelect={(path) => props.onSelect(path, 'staged')} onOpenFile={props.onOpenFile} action="unstage" disabled={props.readOnly} onAction={props.onUnstage} onDiscard={props.onDiscard} onUnstageGroup={bothGroups ? props.onUnstageAll : undefined} onMenu={openMenu && ((change) => openMenu({ change, kind: 'staged' }))} />
        <ChangeSection scrollRef={scrollRef} displayMode={displayMode} label={notStagedLabel} changes={props.changed} selection={props.selection} onSelect={(path) => props.onSelect(path, 'unstaged')} onOpenFile={props.onOpenFile} action="stage" disabled={props.readOnly} onAction={props.onStage} onDiscard={props.onDiscard} onMenu={openMenu && ((change) => openMenu({ change, kind: 'unstaged' }))} />
      </div>
      {mobile && <ChangeRowSheet menu={menu} open={menuOpen} readOnly={props.readOnly} onOpenChange={setMenuOpen} onSelect={props.onSelect} onOpenFile={props.onOpenFile} onDiscard={props.onDiscard} />}
    </div>
  );
}

function ChangesStrip({ count, insertions, deletions, staged, changed, disabled, onStageAll, onUnstageAll }: {
  count: number; insertions: number; deletions: number; staged: number; changed: number; disabled: boolean;
  onStageAll(): void; onUnstageAll(): void;
}) {
  return (
    <div className="changes-strip">
      <span>{count} {count === 1 ? 'change' : 'changes'}</span>
      {(insertions > 0 || deletions > 0) && (
        <Tooltip>
          <TooltipTrigger render={<span className="changes-line-stats" />}>
            <span className="add">+{insertions}</span><span className="del">−{deletions}</span>
          </TooltipTrigger>
          <TooltipContent>Lines added and removed in the worktree</TooltipContent>
        </Tooltip>
      )}
      {changed > 0
        ? <button type="button" className="quiet-action" disabled={disabled} onClick={onStageAll}>Stage all</button>
        : staged > 0 && <button type="button" className="quiet-action" disabled={disabled} onClick={onUnstageAll}>Unstage all</button>}
    </div>
  );
}

function NoChanges({ unpublishedCommits, branchNeedsPublication, publishDisabled, onPublish }: {
  unpublishedCommits: number; branchNeedsPublication: boolean; publishDisabled: boolean; onPublish(): void;
}) {
  const publish = (label: string) => <button type="button" className="inline-action" disabled={publishDisabled} onClick={onPublish}>{label}</button>;
  return (
    <div className="changes-empty">
      <div className="changes-strip">No changes</div>
      <p>
        {branchNeedsPublication
          ? <>This branch isn&apos;t published yet. {publish('Publish it')} when you&apos;re ready.</>
          : unpublishedCommits > 0
            ? <>{unpublishedCommits === 1 ? '1 commit isn\'t' : `${unpublishedCommits} commits aren't`} pushed yet. {publish(unpublishedCommits === 1 ? 'Push it' : 'Push them')} when you&apos;re ready.</>
            : 'Nothing to review or commit.'}
      </p>
    </div>
  );
}

/** The sheet a long press on a phone row opens. Discarding is here, away from the row's stage button. */
function ChangeRowSheet({ menu, open, readOnly, onOpenChange, onSelect, onOpenFile, onDiscard }: {
  menu: ChangeRowMenu | null; open: boolean; readOnly: boolean; onOpenChange(open: boolean): void;
  onSelect(path: string, kind: 'staged' | 'unstaged'): void; onOpenFile(path: string): void; onDiscard(paths: string[]): void;
}) {
  const { change, kind } = menu ?? { change: null, kind: null };
  const path = change?.path ?? '';
  const { name, directory, directorySummary } = changePathParts(path);
  const run = (action: () => void) => { onOpenChange(false); action(); };
  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} title={name} description={directory || undefined}>
      {change && kind !== 'conflict' && shouldOpenChangePreview(path, change.kind) && <button type="button" className="mobile-sheet-action" onClick={() => run(() => onSelect(path, kind!))}><IconGitCompare /><span>View changes</span></button>}
      {change && !directorySummary && <button type="button" className="mobile-sheet-action" onClick={() => run(() => onOpenFile(path))}><IconFileArrowRight /><span>Open file</span></button>}
      {kind === 'unstaged' && <button type="button" className="mobile-sheet-action destructive" disabled={readOnly} onClick={() => run(() => onDiscard([path]))}><IconRestore /><span>Discard changes</span></button>}
    </MobileSheet>
  );
}

function changePathParts(path: string) {
  const normalized = path.replace(/[\\/]+$/, '');
  const slash = normalized.lastIndexOf('/');
  return {
    normalized,
    name: slash < 0 ? normalized : normalized.slice(slash + 1),
    directory: slash < 0 ? '' : normalized.slice(0, slash),
    directorySummary: path.endsWith('/') || path.endsWith('\\'),
  };
}

function ConflictSection({ scrollRef, changes, selection, onSelect, onOpenFile, onMenu }: { scrollRef: React.RefObject<HTMLDivElement | null>; changes: FileChange[]; selection: ChangeSelection | null; onSelect(path: string): void; onOpenFile(path: string): void; onMenu?: ((change: FileChange) => void) | undefined }) {
  const mobile = useMobileLayout();
  const sortedChanges = useMemo(() => [...changes].sort((a, b) => a.path.localeCompare(b.path)), [changes]);
  const { listRef, scrollMargin } = useVirtualScrollMargin(scrollRef);
  // oxlint-disable-next-line react/incompatible-library -- TanStack Virtual is intentionally imperative.
  const virtualizer = useVirtualizer({
    count: sortedChanges.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => mobile ? MOBILE_ROW_HEIGHT : ROW_HEIGHT,
    getItemKey: (index) => sortedChanges[index]?.path ?? index,
    scrollMargin,
    overscan: 8,
  });
  useEffect(() => { virtualizer.measure(); }, [virtualizer, mobile]);
  if (changes.length === 0) return null;
  return (
    <section className="change-section conflict-section">
      <div className="change-group-label"><span>Conflicts</span><span className="plain-count">{changes.length}</span></div>
      <div ref={listRef} role="list" aria-label="Conflicts" className="virtual-list" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const change = sortedChanges[virtualRow.index]!;
          return (
            <div key={virtualRow.key} className="virtual-row" style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start - scrollMargin}px)` }}>
              <ConflictRow change={change} current={selection?.path === change.path} onSelect={onSelect} onOpenFile={onOpenFile} onMenu={onMenu} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ConflictRow({ change, current, onSelect, onOpenFile, onMenu }: { change: FileChange; current: boolean; onSelect(path: string): void; onOpenFile(path: string): void; onMenu?: ((change: FileChange) => void) | undefined }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [textRef, truncated] = useTruncatedText(change.path);
  const { normalized, name, directory } = changePathParts(change.path);
  const longPress = useLongPress(() => onMenu?.(change), { disabled: !onMenu });
  return (
    <div ref={rowRef} role="listitem" className="change-row" aria-current={current ? 'true' : undefined} {...longPress} onClick={(event) => {
      if (shouldActivateChangeRow(event.target)) onSelect(change.path);
    }}>
      <Tooltip disabled={!truncated}>
        <TooltipTrigger render={<button className="file-label" data-long-press-target="" onClick={() => onSelect(change.path)} aria-label={`Resolve conflict in ${change.path}`} />}>
          <img className="vscode-tree-icon" src={getVsCodeFileIconUrl(normalized)} alt="" aria-hidden="true" draggable={false} />
          <span ref={textRef} className="change-file-text"><span>{name}</span>{directory && <small>{directory}</small>}</span>
        </TooltipTrigger>
        <TooltipContent anchor={rowRef} side="right" sideOffset={10}>{change.path}</TooltipContent>
      </Tooltip>
      <span className="status-code" data-kind="conflicted">C</span>
      {onMenu
        ? <MobileRowSheetButton name={name} onPress={() => onMenu(change)} />
        : <span className="change-row-actions">
            <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button" onClick={() => onOpenFile(change.path)} aria-label="Open file" />}><IconFileArrowRight /></TooltipTrigger><TooltipContent>Open file</TooltipContent></Tooltip>
          </span>}
    </div>
  );
}

interface ChangeSectionProps {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  displayMode: 'list' | 'tree'; label: string | null; showCount?: boolean | undefined; changes: FileChange[]; selection: ChangeSelection | null; disabled: boolean; action: 'stage' | 'unstage';
  onSelect(path: string): void; onOpenFile(path: string): void; onAction(paths: string[]): void; onDiscard(paths: string[]): void; onUnstageGroup?: (() => void) | undefined;
  /** Set on a phone: the row shows one action and a long press offers the rest. */
  onMenu?: ((change: FileChange) => void) | undefined;
}

function ChangeSection({ scrollRef, displayMode, label, showCount = false, changes, selection, disabled, action, onSelect, onOpenFile, onAction, onDiscard, onUnstageGroup, onMenu }: ChangeSectionProps) {
  const tree = useMemo(() => buildChangeTree(changes), [changes]);
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const sortedChanges = useMemo(() => [...changes].sort((a, b) => a.path.localeCompare(b.path)), [changes]);
  const treeRows = useMemo(() => flattenChangeTree(tree, collapsedPaths), [collapsedPaths, tree]);
  const rows: ChangeVirtualRow[] = displayMode === 'list'
    ? sortedChanges.map((change) => ({ kind: 'file', change, depth: 0 }))
    : treeRows;
  const mobile = useMobileLayout();
  const { listRef, scrollMargin } = useVirtualScrollMargin(scrollRef);
  const rowHeight = mobile ? MOBILE_ROW_HEIGHT : ROW_HEIGHT;
  // oxlint-disable-next-line react/incompatible-library -- TanStack Virtual is intentionally imperative.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    getItemKey: (index) => {
      const row = rows[index];
      return row?.kind === 'directory' ? `directory:${row.node.path}` : `${action}:${row?.change.path ?? index}`;
    },
    scrollMargin,
    overscan: 10,
  });
  useEffect(() => { virtualizer.measure(); }, [virtualizer, rowHeight]);
  if (changes.length === 0) return null;
  const sectionKind = action === 'stage' ? 'unstaged' : 'staged';
  return (
    <section className="change-section">
      {label && (
        <div className="change-group-label">
          <span>{label}</span>{showCount && <span className="plain-count">{changes.length}</span>}
          {onUnstageGroup && <button type="button" className="quiet-action" disabled={disabled} onClick={onUnstageGroup}>Unstage all</button>}
        </div>
      )}
      <div
        ref={listRef}
        role={displayMode === 'list' ? 'list' : 'tree'}
        aria-label={label ?? 'Changes'}
        className="virtual-list"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index]!;
          return (
            <div key={virtualRow.key} className="virtual-row" style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start - scrollMargin}px)` }}>
              {row.kind === 'directory' ? (
                <ChangeTreeFolderRow
                  node={row.node}
                  depth={row.depth}
                  expanded={!collapsedPaths.has(row.node.path)}
                  disabled={disabled}
                  action={action}
                  onToggle={() => setCollapsedPaths((current) => {
                    const next = new Set(current);
                    if (next.has(row.node.path)) next.delete(row.node.path);
                    else next.add(row.node.path);
                    return next;
                  })}
                  onDiscard={onDiscard}
                  onAction={onAction}
                />
              ) : (
                <ChangeFileRow change={row.change} current={selection?.path === row.change.path && (selection.kind ?? sectionKind) === sectionKind} disabled={disabled} action={action} depth={row.depth} showDirectory={displayMode === 'list'} onSelect={onSelect} onOpenFile={onOpenFile} onDiscard={onDiscard} onAction={onAction} onMenu={onMenu} />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function useVirtualScrollMargin(scrollRef: React.RefObject<HTMLDivElement | null>) {
  // A callback ref restarts measurement when an initially empty section gains
  // its list, or when that list is removed and replaced after a refresh.
  const [list, listRef] = useState<HTMLDivElement | null>(null);
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!list || !scroll) return;
    const measure = () => {
      const next = list.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
      setMargin((current) => current === next ? current : next);
    };
    const observer = new ResizeObserver(measure);
    const observeSections = () => {
      observer.disconnect();
      observer.observe(scroll);
      observer.observe(list);
      for (const section of scroll.children) observer.observe(section);
      measure();
    };
    // Inserting/removing a conflict section moves the lists without resizing
    // them. Observe the new section too, so subsequent conflict changes count.
    const sectionsObserver = new MutationObserver(observeSections);
    sectionsObserver.observe(scroll, { childList: true });
    observeSections();
    return () => {
      observer.disconnect();
      sectionsObserver.disconnect();
    };
  }, [list, scrollRef]);
  return { listRef, scrollMargin: margin };
}

function ChangeTreeFolderRow({ node, depth, expanded, disabled, action, onToggle, onDiscard, onAction }: {
  node: ChangeTreeEntry; depth: number; expanded: boolean; disabled: boolean; action: 'stage' | 'unstage';
  onToggle(): void; onDiscard(paths: string[]): void; onAction(paths: string[]): void;
}) {
  const paths = collectChangePaths(node);
  return (
    <div role="treeitem" aria-expanded={expanded} className="tree-folder" style={{ paddingLeft: 12 + depth * 14 }} onClick={(event) => {
      if (shouldActivateChangeRow(event.target)) onToggle();
    }}>
      <button className="folder-toggle" onClick={onToggle} aria-label={expanded ? 'Collapse folder' : 'Expand folder'}><IconChevronRight className={`folder-chevron ${expanded ? 'open' : ''}`} /></button>
      <FolderIcon />
      <button className="folder-name" onClick={onToggle}>{node.name}</button>
      <span className="change-row-actions">
        <ChangeActions paths={paths} action={action} disabled={disabled} onDiscard={onDiscard} onAction={onAction} />
      </span>
    </div>
  );
}

function ChangeFileRow({ change, current, disabled, action, depth = 0, showDirectory = false, onSelect, onOpenFile, onDiscard, onAction, onMenu }: {
  change: FileChange; current: boolean; disabled: boolean; action: 'stage' | 'unstage'; depth?: number; showDirectory?: boolean;
  onSelect(path: string): void; onOpenFile(path: string): void; onDiscard(paths: string[]): void; onAction(paths: string[]): void; onMenu?: ((change: FileChange) => void) | undefined;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [textRef, truncated] = useTruncatedText(`${change.path}\u0000${showDirectory}`);
  const { normalized: normalizedPath, name, directory, directorySummary } = changePathParts(change.path);
  const previewable = shouldOpenChangePreview(change.path, change.kind);
  const longPress = useLongPress(() => onMenu?.(change), { disabled: !onMenu });
  return (
    <div ref={rowRef} role={showDirectory ? 'listitem' : 'treeitem'} className="change-row" aria-current={current ? 'true' : undefined} style={onMenu ? undefined : { paddingLeft: 12 + depth * 14 }} {...longPress} onClick={(event) => {
      if (!shouldActivateChangeRow(event.target)) return;
      if (previewable) onOpenFile(change.path);
      else onSelect(change.path);
    }}>
      {!showDirectory && <span className="tree-spacer" />}
      <Tooltip disabled={!truncated}>
        <TooltipTrigger render={<button className="file-label" data-long-press-target="" onClick={() => previewable ? onOpenFile(change.path) : onSelect(change.path)} aria-label={`${previewable ? 'Preview' : 'View changes for'} ${change.path}`} />}>
          {directorySummary ? <FolderIcon /> : <img className="vscode-tree-icon" src={getVsCodeFileIconUrl(normalizedPath)} alt="" aria-hidden="true" draggable={false} />}
          <span ref={textRef} className="change-file-text"><span>{name}</span>{showDirectory && directory && <small>{directory}</small>}</span>
        </TooltipTrigger>
        <TooltipContent anchor={rowRef} side="right" sideOffset={10}>{change.path}</TooltipContent>
      </Tooltip>
      <span className="status-code" data-kind={change.kind}>{changeStatusCode(change.kind)}</span>
      {onMenu && <MobileRowSheetButton name={name} onPress={() => onMenu(change)} />}
      <span className="change-row-actions">
        {!onMenu && !directorySummary && previewable && <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button" onClick={() => onSelect(change.path)} aria-label="View changes" />}><IconGitCompare /></TooltipTrigger><TooltipContent>View changes</TooltipContent></Tooltip>}
        {!onMenu && !directorySummary && !previewable && <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button" disabled={disabled} onClick={() => onOpenFile(change.path)} aria-label="Open file" />}><IconFileArrowRight /></TooltipTrigger><TooltipContent>Open file</TooltipContent></Tooltip>}
        <ChangeActions paths={[change.path]} action={action} disabled={disabled} onDiscard={onMenu ? undefined : onDiscard} onAction={onAction} />
      </span>
    </div>
  );
}

function ChangeActions({ paths, action, disabled, onDiscard, onAction }: {
  paths: string[]; action: 'stage' | 'unstage'; disabled: boolean;
  /** Left out on a phone, where discarding isn't beside staging. */
  onDiscard?: ((paths: string[]) => void) | undefined; onAction(paths: string[]): void;
}) {
  return (
    <>
      {action === 'stage' && onDiscard && <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button change-action-discard" disabled={disabled} onClick={() => onDiscard(paths)} aria-label="Discard changes" />}><IconRestore /></TooltipTrigger><TooltipContent>Discard changes</TooltipContent></Tooltip>}
      <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button" disabled={disabled} onClick={() => onAction(paths)} aria-label={action === 'stage' ? 'Stage changes' : 'Unstage changes'} />}>{action === 'stage' ? <IconPlus /> : <IconMinus />}</TooltipTrigger><TooltipContent>{action === 'stage' ? 'Stage changes' : 'Unstage changes'}</TooltipContent></Tooltip>
    </>
  );
}
