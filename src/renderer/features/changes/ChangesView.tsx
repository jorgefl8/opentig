import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { IconChevronRight, IconFileArrowRight, IconGitCompare, IconMinus, IconPlus, IconRestore } from '@tabler/icons-react';
import type { ChangesLayoutPreference } from '../../../shared/contracts';
import type { FileChange } from '../../../shared/git-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { shouldOpenChangePreview } from './change-preview';
import { changeStatusCode } from './change-status';
import { buildChangeTree, collectChangePaths, flattenChangeTree, type ChangeTreeEntry, type ChangeVirtualRow } from './change-tree';
import { shouldActivateChangeRow } from './row-activation';
import { getVsCodeFileIconUrl, getVsCodeFolderIconUrl } from '@/lib/vscode-icons';

interface ChangesViewProps {
  conflicts: FileChange[]; staged: FileChange[]; changed: FileChange[]; readOnly: boolean;
  displayMode: ChangesLayoutPreference;
  onSelect(path: string, kind: 'staged' | 'unstaged'): void; onOpenFile(path: string): void; onDiscard(paths: string[]): void;
  onConflict(path: string): void;
  onStage(paths: string[]): void; onUnstage(paths: string[]): void; onStageAll(): void; onUnstageAll(): void;
}

export function ChangesView(props: ChangesViewProps) {
  const displayMode = props.displayMode;
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <div className="changes-view">
      <div ref={scrollRef} className="changes-scroll">
        <ConflictSection scrollRef={scrollRef} changes={props.conflicts} onSelect={props.onConflict} onOpenFile={props.onOpenFile} />
        <ChangeSection scrollRef={scrollRef} displayMode={displayMode} title="Staged Changes" changes={props.staged} onSelect={(path) => props.onSelect(path, 'staged')} onOpenFile={props.onOpenFile} action="unstage" disabled={props.readOnly} onAction={props.onUnstage} onDiscard={props.onDiscard} onAll={props.onUnstageAll} />
        <ChangeSection scrollRef={scrollRef} displayMode={displayMode} title="Changes" changes={props.changed} onSelect={(path) => props.onSelect(path, 'unstaged')} onOpenFile={props.onOpenFile} action="stage" disabled={props.readOnly} onAction={props.onStage} onDiscard={props.onDiscard} onAll={props.onStageAll} />
      </div>
    </div>
  );
}

function ConflictSection({ scrollRef, changes, onSelect, onOpenFile }: { scrollRef: React.RefObject<HTMLDivElement | null>; changes: FileChange[]; onSelect(path: string): void; onOpenFile(path: string): void }) {
  const listRef = useRef<HTMLDivElement>(null);
  const sortedChanges = useMemo(() => [...changes].sort((a, b) => a.path.localeCompare(b.path)), [changes]);
  const scrollMargin = useVirtualScrollMargin(listRef, scrollRef);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is intentionally imperative.
  const virtualizer = useVirtualizer({
    count: sortedChanges.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 38,
    getItemKey: (index) => sortedChanges[index]?.path ?? index,
    scrollMargin,
    overscan: 8,
  });
  if (changes.length === 0) return null;
  return (
    <section className="change-section conflict-section">
      <div className="section-heading"><span>Conflicts</span><Badge variant="destructive">{changes.length}</Badge></div>
      <div ref={listRef} role="list" aria-label="Conflicts" className="change-list virtual-list" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div key={virtualRow.key} className="virtual-row" style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start - scrollMargin}px)` }}>
            <ConflictRow change={sortedChanges[virtualRow.index]!} onSelect={onSelect} onOpenFile={onOpenFile} />
          </div>
        ))}
      </div>
    </section>
  );
}

function ConflictRow({ change, onSelect, onOpenFile }: { change: FileChange; onSelect(path: string): void; onOpenFile(path: string): void }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const normalized = change.path.replace(/[\\/]+$/, '');
  const slash = normalized.lastIndexOf('/');
  const name = slash < 0 ? normalized : normalized.slice(slash + 1);
  const directory = slash < 0 ? '' : normalized.slice(0, slash);
  return (
    <div ref={rowRef} role="listitem" className="change-row conflict-row" onClick={(event) => {
      if (shouldActivateChangeRow(event.target)) onSelect(change.path);
    }}>
      <Tooltip>
        <TooltipTrigger render={<button className="file-label" onClick={() => onSelect(change.path)} aria-label={`Resolve conflict in ${change.path}`} />}>
          <VsCodeTreeIcon path={normalized} type="file" />
          <span className="change-file-text"><span>{name}</span>{directory && <small>{directory}</small>}</span>
        </TooltipTrigger>
        <TooltipContent anchor={rowRef} side="right" sideOffset={10}>Resolve {change.path}</TooltipContent>
      </Tooltip>
      <span className="change-row-actions">
        <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button" onClick={() => onOpenFile(change.path)} aria-label="Open file" />}><IconFileArrowRight /></TooltipTrigger><TooltipContent>Open file</TooltipContent></Tooltip>
      </span>
      <span className="status-code conflict">C</span>
    </div>
  );
}

interface ChangeSectionProps {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  displayMode: 'list' | 'tree'; title: string; changes: FileChange[]; disabled: boolean; action: 'stage' | 'unstage';
  onSelect(path: string): void; onOpenFile(path: string): void; onAction(paths: string[]): void; onDiscard(paths: string[]): void; onAll(): void;
}

function ChangeSection({ scrollRef, displayMode, title, changes, disabled, action, onSelect, onOpenFile, onAction, onDiscard, onAll }: ChangeSectionProps) {
  const tree = useMemo(() => buildChangeTree(changes), [changes]);
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const sortedChanges = useMemo(() => [...changes].sort((a, b) => a.path.localeCompare(b.path)), [changes]);
  const treeRows = useMemo(() => flattenChangeTree(tree, collapsedPaths), [collapsedPaths, tree]);
  const rows: ChangeVirtualRow[] = displayMode === 'list'
    ? sortedChanges.map((change) => ({ kind: 'file', change, depth: 0 }))
    : treeRows;
  const listRef = useRef<HTMLDivElement>(null);
  const scrollMargin = useVirtualScrollMargin(listRef, scrollRef);
  const rowHeight = displayMode === 'list' ? 38 : 30;
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is intentionally imperative.
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
  return (
    <section className="change-section">
      <div className="section-heading">
        <span>{title}</span><Badge variant="secondary">{changes.length}</Badge>
        <div className="heading-actions">
          <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button" disabled={disabled || changes.length === 0} onClick={onAll} />}>{action === 'stage' ? <IconPlus /> : <IconMinus />}</TooltipTrigger><TooltipContent>{action === 'stage' ? 'Stage all' : 'Unstage all'}</TooltipContent></Tooltip>
        </div>
      </div>
      {changes.length === 0 ? <p className="empty-list">No changes</p> : (
        <div
          ref={listRef}
          role={displayMode === 'list' ? 'list' : 'tree'}
          aria-label={title}
          className={`${displayMode === 'list' ? 'change-list' : 'change-tree'} virtual-list`}
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
                  <ChangeFileRow change={row.change} disabled={disabled} action={action} depth={row.depth} showDirectory={displayMode === 'list'} onSelect={onSelect} onOpenFile={onOpenFile} onDiscard={onDiscard} onAction={onAction} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function useVirtualScrollMargin(listRef: React.RefObject<HTMLDivElement | null>, scrollRef: React.RefObject<HTMLDivElement | null>): number {
  const [margin, setMargin] = useState(0);
  useEffect(() => {
    const list = listRef.current;
    const scroll = scrollRef.current;
    if (!list || !scroll) return;
    const measure = () => {
      const next = list.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
      setMargin((current) => current === next ? current : next);
    };
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    for (const section of scroll.children) observer.observe(section);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [listRef, scrollRef]);
  return margin;
}

function ChangeTreeFolderRow({ node, depth, expanded, disabled, action, onToggle, onDiscard, onAction }: {
  node: ChangeTreeEntry; depth: number; expanded: boolean; disabled: boolean; action: 'stage' | 'unstage';
  onToggle(): void; onDiscard(paths: string[]): void; onAction(paths: string[]): void;
}) {
  const paths = collectChangePaths(node);
  return (
    <div role="treeitem" aria-expanded={expanded} className="tree-folder" style={{ paddingLeft: 8 + depth * 14 }} onClick={(event) => {
      if (shouldActivateChangeRow(event.target)) onToggle();
    }}>
      <button className="folder-toggle" onClick={onToggle} aria-label={expanded ? 'Collapse folder' : 'Expand folder'}><IconChevronRight className={`folder-chevron ${expanded ? 'open' : ''}`} /></button>
      <VsCodeTreeIcon path={node.path} type="directory" expanded={expanded} />
      <button className="folder-name" onClick={onToggle}>{node.name}</button>
      <ChangeActions paths={paths} action={action} disabled={disabled} onDiscard={onDiscard} onAction={onAction} />
    </div>
  );
}

function ChangeFileRow({ change, disabled, action, depth = 0, showDirectory = false, onSelect, onOpenFile, onDiscard, onAction }: {
  change: FileChange; disabled: boolean; action: 'stage' | 'unstage'; depth?: number; showDirectory?: boolean;
  onSelect(path: string): void; onOpenFile(path: string): void; onDiscard(paths: string[]): void; onAction(paths: string[]): void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const normalizedPath = change.path.replace(/[\\/]+$/, '');
  const slash = normalizedPath.lastIndexOf('/');
  const name = slash < 0 ? normalizedPath : normalizedPath.slice(slash + 1);
  const directory = slash < 0 ? '' : normalizedPath.slice(0, slash);
  const directorySummary = change.path.endsWith('/') || change.path.endsWith('\\');
  const previewable = shouldOpenChangePreview(change.path, change.kind);
  return (
    <div ref={rowRef} role={showDirectory ? 'listitem' : 'treeitem'} className="change-row" style={{ paddingLeft: 12 + depth * 14 }} onClick={(event) => {
      if (!shouldActivateChangeRow(event.target)) return;
      if (previewable) onOpenFile(change.path);
      else onSelect(change.path);
    }}>
      {!showDirectory && <span className="tree-spacer" />}
      <Tooltip>
        <TooltipTrigger render={<button className="file-label" onClick={() => previewable ? onOpenFile(change.path) : onSelect(change.path)} aria-label={`${previewable ? 'Preview' : 'View changes for'} ${change.path}`} />}>
          <VsCodeTreeIcon path={normalizedPath} type={directorySummary ? 'directory' : 'file'} />
          <span className="change-file-text"><span>{name}</span>{showDirectory && directory && <small>{directory}</small>}</span>
        </TooltipTrigger>
        <TooltipContent anchor={rowRef} side="right" sideOffset={10}>{change.path}</TooltipContent>
      </Tooltip>
      <span className="change-row-actions">
        {!directorySummary && previewable && <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button" onClick={() => onSelect(change.path)} aria-label="View changes" />}><IconGitCompare /></TooltipTrigger><TooltipContent>View changes</TooltipContent></Tooltip>}
        {!directorySummary && !previewable && <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button" disabled={disabled} onClick={() => onOpenFile(change.path)} aria-label="Open file" />}><IconFileArrowRight /></TooltipTrigger><TooltipContent>Open file</TooltipContent></Tooltip>}
        <ChangeActions paths={[change.path]} action={action} disabled={disabled} onDiscard={onDiscard} onAction={onAction} />
      </span>
      <span className={`status-code ${change.conflict ? 'conflict' : ''}`} data-kind={change.kind}>{changeStatusCode(change.kind)}</span>
    </div>
  );
}

function ChangeActions({ paths, action, disabled, onDiscard, onAction }: {
  paths: string[]; action: 'stage' | 'unstage'; disabled: boolean;
  onDiscard(paths: string[]): void; onAction(paths: string[]): void;
}) {
  return (
    <span className="change-actions">
      {action === 'stage' && <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button change-action-discard" disabled={disabled} onClick={() => onDiscard(paths)} aria-label="Discard changes" />}><IconRestore /></TooltipTrigger><TooltipContent>Discard changes</TooltipContent></Tooltip>}
      <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button" disabled={disabled} onClick={() => onAction(paths)} aria-label={action === 'stage' ? 'Stage changes' : 'Unstage changes'} />}>{action === 'stage' ? <IconPlus /> : <IconMinus />}</TooltipTrigger><TooltipContent>{action === 'stage' ? 'Stage changes' : 'Unstage changes'}</TooltipContent></Tooltip>
    </span>
  );
}

function VsCodeTreeIcon({ path, type, expanded = false }: { path: string; type: 'file' | 'directory'; expanded?: boolean }) {
  const src = type === 'file' ? getVsCodeFileIconUrl(path) : getVsCodeFolderIconUrl(path, expanded);
  return <img className="vscode-tree-icon" src={src} alt="" aria-hidden="true" draggable={false} />;
}
