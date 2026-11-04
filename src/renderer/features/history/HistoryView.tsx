import { formatDate, formatDateTime } from '@shared/date-format';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { IconArrowDown, IconChevronRight, IconFilter, IconLoader4, IconRestore, IconSearch } from '@tabler/icons-react';
import type { CommitFile, CommitInfo } from '../../../shared/git-types';
import { Button } from '@/components/ui/button';
import { MobileSwitchRow } from '@/components/MobileChrome';
import { MobileSheet } from '@/components/MobileSheet';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { LinkedText } from '@/components/LinkedText';
import { RepositoryLink } from '@/components/RepositoryLink';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { changeStatusCode } from '@/features/changes/change-status';
import { buildCommitGraph, type CommitGraphRow } from './commit-graph';
import { canUndoCommit, commitPublication, commitReference, historyRows, matchesHistory, showsBranchLine } from './history-presentation';
import { readCommitFilesCache, writeCommitFilesCache } from './commit-files-cache';
import { copyCommitHash } from './copy-commit-hash';
import { getVsCodeFileIconUrl } from '@/lib/vscode-icons';
import { useMobileLayout } from '@/lib/use-mobile-layout';
import { opentig } from '@/lib/opentig-api';

interface HistoryViewProps {
  repositoryId: string; upstream: string | null; readOnly: boolean; operation: string | null;
  commits: CommitInfo[] | null; nextCursor: string | null; loading: boolean; undoing: boolean;
  baseRef?: string | null | undefined; activeOid?: string | null;
  onSelectCommit(commit: CommitInfo): void; onSelectFile(oid: string, file: CommitFile): void; onUndo(commit: CommitInfo): void; onMore(): void;
}

// Match .history-more in index.css and mobile.css.
const LOAD_MORE_HEIGHT = 36;
const MOBILE_LOAD_MORE_HEIGHT = 48;

export function HistoryView({ repositoryId, upstream, readOnly, operation, commits, nextCursor, loading, undoing, baseRef, activeOid, onSelectCommit, onSelectFile, onUndo, onMore }: HistoryViewProps) {
  const mobile = useMobileLayout();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());
  const [compact, setCompact] = useState(true);
  const [grouped, setGrouped] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  useEffect(() => { if (!mobile) setOptionsOpen(false); }, [mobile]);
  const [search, setSearch] = useState('');
  const [matchIndex, setMatchIndex] = useState(-1);
  const rowHeight = mobile ? 60 : compact ? 46 : 56;
  const loadMoreHeight = mobile ? MOBILE_LOAD_MORE_HEIGHT : LOAD_MORE_HEIGHT;
  const searching = search.trim().length > 0;
  // Search temporarily reveals grouped commits; it never removes graph context.
  const rows = useMemo(() => historyRows(commits ?? [], grouped && !searching), [commits, grouped, searching]);
  const branchLine = showsBranchLine(upstream, baseRef);
  const graph = useMemo(() => buildCommitGraph(rows.map(({ commit, parentOids }) => ({ oid: commit.oid, parentOids, branch: branchLine && commit.baseState === 'outside' }))), [rows, branchLine]);
  // One plain lane says nothing, but a branch line marks where the base starts.
  const showGraph = graph.laneCount > 1 || graph.hasBranch;
  const matches = useMemo(() => rows.flatMap(({ commit }, index) => matchesHistory(commit, search) ? [index] : []), [rows, search]);
  const graphWidth = graphWidthForLanes(graph.laneCount);
  // oxlint-disable-next-line react/incompatible-library -- TanStack Virtual is intentionally imperative.
  const commitVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    getItemKey: (index) => rows[index]!.commit.oid,
    overscan: 8,
  });
  // Search and grouping retain heights by commit oid. Clearing measurements
  // would replace unchanged expanded rows with estimates until another resize.
  useEffect(() => { commitVirtualizer.measure(); }, [commitVirtualizer, rowHeight]);
  // A refresh can leave fewer matches than the one the user had reached.
  const currentMatch = matchIndex < matches.length ? matchIndex : -1;
  const nextMatch = () => {
    if (!matches.length) return;
    const next = (currentMatch + 1) % matches.length;
    setMatchIndex(next);
    commitVirtualizer.scrollToIndex(matches[next]!, { align: 'center' });
  };
  if (commits === null) return <div className="view-loading" role="status"><IconLoader4 className="spinner" /> <ShimmeringText text="Loading history…" /></div>;
  const canGroup = grouped || commits.some((commit) => commit.parentCount > 1);
  return (
    <div className="history-list" data-searching={searching || undefined} style={{ '--history-row-height': `${rowHeight}px` } as CSSProperties}>
      <div className="history-toolbar">
        <label className="search-input history-search">
          <IconSearch aria-hidden="true" />
          <input type="search" aria-label="Search loaded commits" placeholder="Find commit…" value={search} onChange={(event) => { setSearch(event.target.value); setMatchIndex(-1); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); nextMatch(); } }} />
          {searching && <Tooltip>
            <TooltipTrigger render={<span className="plain-count" role="status" />}>{currentMatch >= 0 ? `${currentMatch + 1} of ${matches.length}` : `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`}</TooltipTrigger>
            <TooltipContent>{matches.length} {matches.length === 1 ? 'match' : 'matches'} in {commits.length} loaded {commits.length === 1 ? 'commit' : 'commits'}</TooltipContent>
          </Tooltip>}
        </label>
        {searching && <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button" onClick={nextMatch} disabled={!matches.length} aria-label="Next matching commit" />}><IconArrowDown /></TooltipTrigger><TooltipContent>Next match in loaded history (Enter)</TooltipContent></Tooltip>}
        {mobile ? <>
          <Button variant={grouped ? 'secondary' : 'ghost'} size="icon" className="mobile-bar-button" aria-label="History options" aria-haspopup="dialog" onClick={() => setOptionsOpen(true)}><IconFilter /></Button>
          <MobileSheet open={optionsOpen} onOpenChange={setOptionsOpen} title="History">
            <MobileSwitchRow label="Group merges" checked={grouped} disabled={!canGroup} onChange={setGrouped} />
          </MobileSheet>
        </> : <DropdownMenu>
          <Tooltip>
            <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant={grouped ? 'secondary' : 'ghost'} size="icon-xs" className="change-action-button" aria-label="History options" />} />}><IconFilter /></TooltipTrigger>
            <TooltipContent>History options</TooltipContent>
          </Tooltip>
          <DropdownMenuContent>
            <DropdownMenuCheckboxItem checked={grouped} disabled={!canGroup} onCheckedChange={setGrouped}>Group merges</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={compact} onCheckedChange={setCompact}>Compact</DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>}
      </div>
      <div ref={scrollRef} className="history-scroll" role="list" aria-label="Commit history">
        {rows.length === 0 ? <p className="empty-list">This repository has no commits yet.</p> : (
          <div className="virtual-list" style={{ height: commitVirtualizer.getTotalSize() + (nextCursor ? loadMoreHeight : 0) }}>
            {commitVirtualizer.getVirtualItems().map((virtualRow) => {
              const { commit, grouped: groupedCommits } = rows[virtualRow.index]!;
              return (
                <div key={virtualRow.key} ref={commitVirtualizer.measureElement} data-index={virtualRow.index} className="virtual-row" style={{ transform: `translateY(${virtualRow.start}px)` }}>
                  <CommitRow phone={mobile} repositoryId={repositoryId} upstream={upstream} baseRef={baseRef} commit={commit}
                    graphRow={graph.rows[virtualRow.index]!} showGraph={showGraph} branchRefs={graph.hasBranch} graphWidth={graphWidth} rowHeight={rowHeight}
                    active={activeOid === commit.oid || groupedCommits.some((item) => item.oid === activeOid)} match={matchesHistory(commit, search)} currentMatch={matches[currentMatch] === virtualRow.index}
                    groupedCount={groupedCommits.length} onRevealGroup={() => setGrouped(false)}
                    expanded={expandedCommits.has(commit.oid)}
                    onExpandedChange={(expanded) => setExpandedCommits((current) => { const next = new Set(current); if (expanded) next.add(commit.oid); else next.delete(commit.oid); return next; })}
                    canUndo={!readOnly && !operation && !undoing && canUndoCommit(commit)}
                    onSelectCommit={onSelectCommit} onSelectFile={onSelectFile} onUndo={onUndo}
                  />
                </div>
              );
            })}
            {nextCursor && <button className="history-more" style={{ top: commitVirtualizer.getTotalSize() }} disabled={loading} onClick={onMore}>{loading ? <ShimmeringText text="Loading…" /> : 'Load more'}</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function CommitRow({ phone, repositoryId, upstream, baseRef, commit, graphRow, showGraph, branchRefs, graphWidth, rowHeight, active, match, currentMatch, groupedCount, onRevealGroup, expanded, onExpandedChange, canUndo, onSelectCommit, onSelectFile, onUndo }: {
  /** The whole row is the target there: what's on the row elsewhere is in the commit viewer. */
  phone: boolean;
  repositoryId: string; upstream: string | null; baseRef?: string | null | undefined; commit: CommitInfo; expanded: boolean; canUndo: boolean;
  graphRow: CommitGraphRow; showGraph: boolean;
  /** The current branch's name takes the branch line's color. */
  branchRefs: boolean;
  graphWidth: number; rowHeight: number; active: boolean; match: boolean; currentMatch: boolean; groupedCount: number;
  onRevealGroup(): void;
  onExpandedChange(expanded: boolean): void;
  onSelectCommit(commit: CommitInfo): void; onSelectFile(oid: string, file: CommitFile): void; onUndo(commit: CommitInfo): void;
}) {
  const cacheKey = `${repositoryId}:${commit.oid}`;
  const [files, setFiles] = useState<CommitFile[] | null>(() => readCommitFilesCache(cacheKey) ?? null);
  const [filesError, setFilesError] = useState<string | null>(null);

  useEffect(() => {
    if (phone || !expanded || files || filesError) return;
    let active = true;
    opentig.commits.files(repositoryId, commit.oid).then((value) => {
      if (!active) return;
      writeCommitFilesCache(cacheKey, value);
      setFiles(value);
    }).catch((reason) => { if (active) setFilesError(messageOf(reason)); });
    return () => { active = false; };
  }, [cacheKey, commit.oid, expanded, files, filesError, phone, repositoryId]);

  const reference = commitReference(commit);
  const refs = commit.decorations.map((decoration) => ({ name: decoration.replace(/^(tag: |HEAD -> )/, ''), current: decoration.startsWith('HEAD -> ') }));
  const refNames = refs.map((ref) => ref.name);
  const refLabels = refs.map((ref, index) => <span key={`${index}:${ref.name}`} className={branchRefs && ref.current ? 'commit-ref-branch' : undefined}>{index > 0 && ' '}{ref.name}</span>);
  const publication = commitPublication(commit, upstream, baseRef);
  const nodeY = graphNodeY(rowHeight);
  const additions = files?.reduce((total, file) => total + file.additions, 0) ?? 0;
  const deletions = files?.reduce((total, file) => total + file.deletions, 0) ?? 0;
  const open = expanded && !phone;
  const className = ['commit-item', active && 'active', open && 'expanded', match && 'commit-search-match', currentMatch && 'commit-current-match'].filter(Boolean).join(' ');

  return (
    <div className={className} role="listitem">
      {/* The whole row selects the commit for the pointer; the subject is what the keyboard reaches. */}
      <div className="commit-header" onClick={(event) => { if (!(event.target as Element).closest('button, a')) onSelectCommit(commit); }}>
        <span className="commit-lane" style={{ width: graphWidth }}>
          {showGraph && <CommitGraph graph={graphRow} width={graphWidth} height={rowHeight} />}
          <Tooltip>
            <TooltipTrigger render={<span className="commit-dot" role="img" aria-label={publication.label} data-publication={commit.upstreamState} data-merge={commit.parentCount > 1 || undefined} style={{ left: graphX(graphRow.lane), top: nodeY }} />} />
            <TooltipContent>{publication.hint}</TooltipContent>
          </Tooltip>
        </span>
        <div className="commit-main">
          <button className="commit-subject" aria-pressed={active} onClick={() => onSelectCommit(commit)}>{commit.subject || '(no subject)'}</button>
          {phone ? <span className="commit-meta">
            <time dateTime={commit.date}>{formatDate(commit.date)}</time>
            <MetaSeparator />
            <span className="commit-author">{commit.author}</span>
            <MetaSeparator />
            <span className="commit-oid">{commit.shortOid}</span>
            {commit.upstreamState === 'local-only' && <><MetaSeparator /><span className="commit-local-label">Not published</span></>}
            {reference && <><MetaSeparator /><span className="commit-pr">#{reference.number}</span></>}
            {groupedCount > 0 && <><MetaSeparator /><span>{groupedCount} grouped</span></>}
            {refs.length > 0 && <span className="commit-refs">{refLabels}</span>}
          </span> : <span className="commit-meta">
            <Tooltip>
              <TooltipTrigger render={<time dateTime={commit.date} />}>{formatDate(commit.date)}</TooltipTrigger>
              <TooltipContent>{formatDateTime(commit.date)}</TooltipContent>
            </Tooltip>
            <MetaSeparator />
            <Tooltip><TooltipTrigger render={<span className="commit-author" />}>{commit.author}</TooltipTrigger><TooltipContent>{commit.email ? `${commit.author} <${commit.email}>` : commit.author}</TooltipContent></Tooltip>
            <MetaSeparator />
            <Tooltip>
              <TooltipTrigger render={<button className="commit-oid" onClick={() => void copyCommitHash(commit.oid)} aria-label={`Copy hash ${commit.shortOid}`} />}>{commit.shortOid}</TooltipTrigger>
              <TooltipContent>Copy full hash</TooltipContent>
            </Tooltip>
            {reference && <>
              <MetaSeparator />
              <RepositoryLink
                target={{ kind: 'pull', number: reference.number }}
                className="commit-pr"
                label={`Open pull request #${reference.number}`}
                note={reference.source === 'merge' ? 'From the merge message.' : 'From the commit subject, so it may be an issue rather than a pull request.'}
                fallback={<span className="commit-pr">#{reference.number}</span>}
              >#{reference.number}</RepositoryLink>
            </>}
            {groupedCount > 0 && <>
              <MetaSeparator />
              <Tooltip><TooltipTrigger render={<button className="commit-group-count" onClick={onRevealGroup} />}>{groupedCount} grouped</TooltipTrigger><TooltipContent>Show the {groupedCount} commits in this merge branch</TooltipContent></Tooltip>
            </>}
            {refs.length > 0 && <Tooltip><TooltipTrigger render={<span className="commit-refs" />}>{refLabels}</TooltipTrigger><TooltipContent>{refNames.join(' · ')}</TooltipContent></Tooltip>}
          </span>}
        </div>
        {!phone && <div className="commit-row-actions">
          {canUndo && (
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button commit-undo size-5" onClick={() => onUndo(commit)} aria-label={`Undo commit ${commit.shortOid}`} />}><IconRestore /></TooltipTrigger>
              <TooltipContent>Undo commit and keep its changes staged</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger render={<button className="commit-expand" aria-expanded={expanded} aria-label={expanded ? 'Collapse commit' : 'Expand commit'} onClick={() => onExpandedChange(!expanded)} />}><IconChevronRight className={`folder-chevron ${expanded ? 'open' : ''}`} /></TooltipTrigger>
            <TooltipContent>{expanded ? 'Hide files' : 'Show files'}</TooltipContent>
          </Tooltip>
        </div>}
      </div>
      {open && showGraph && graphRow.continuations.length > 0 && <CommitGraphContinuation graph={graphRow} width={graphWidth} />}
      {open && (
        <div className="commit-files" style={{ paddingLeft: graphWidth + COMMIT_TEXT_INSET }}>
          {commit.body && <p className="commit-description"><LinkedText text={commit.body} /></p>}
          {filesError && <div className="commit-files-message error">{filesError}</div>}
          {!files && !filesError && <div className="commit-files-message"><IconLoader4 className="spinner" /> <ShimmeringText text="Loading files…" /></div>}
          {files && files.length === 0 && <div className="commit-files-message">{commit.parentCount > 1 ? 'This merge commit has no changes of its own.' : 'This commit has no file changes.'}</div>}
          {files && files.length > 0 && (
            <>
              <div className="commit-files-summary">
                {files.length} {files.length === 1 ? 'file' : 'files'}
                {(additions > 0 || deletions > 0) && ` · +${additions} −${deletions}`}
              </div>
              {files.map((file) => (
                <CommitFileRow key={file.path} file={file} onSelect={() => onSelectFile(commit.oid, file)} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MetaSeparator() {
  return <span aria-hidden="true">·</span>;
}

// Match .commit-header: its left padding plus the gap after the lane, where the row's text starts.
const COMMIT_TEXT_INSET = 14;
const GRAPH_LANE_GAP = 14;

function graphWidthForLanes(laneCount: number): number {
  return 14 + Math.max(0, laneCount - 1) * GRAPH_LANE_GAP;
}

function graphX(lane: number): number {
  return 7 + lane * GRAPH_LANE_GAP;
}

/** The node sits in the middle of the row, between its title and the line under it. */
function graphNodeY(rowHeight: number): number {
  return rowHeight / 2;
}

function CommitGraph({ graph, width, height }: { graph: CommitGraphRow; width: number; height: number }) {
  const nodeY = graphNodeY(height);
  return (
    <svg className="commit-graph" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {graph.segments.map((segment, index) => {
        const fromX = graphX(segment.fromLane);
        const toX = graphX(segment.toLane);
        const fromY = segment.from === 'top' ? 0 : nodeY;
        const toY = segment.to === 'node' ? nodeY : height;
        const middleY = (fromY + toY) / 2;
        const d = fromX === toX
          ? `M ${fromX} ${fromY} L ${toX} ${toY}`
          : `M ${fromX} ${fromY} C ${fromX} ${middleY}, ${toX} ${middleY}, ${toX} ${toY}`;
        return <path key={`${index}:${d}`} d={d} data-branch={segment.branch} />;
      })}
    </svg>
  );
}

function CommitGraphContinuation({ graph, width }: { graph: CommitGraphRow; width: number }) {
  return (
    <svg className="commit-graph-continuation" width={width} viewBox={`0 0 ${width} 100`} preserveAspectRatio="none" aria-hidden="true">
      {graph.continuations.map((lane) => (
        <line key={lane} x1={graphX(lane)} y1="0" x2={graphX(lane)} y2="100" data-branch={graph.branchLanes.includes(lane) || undefined} />
      ))}
    </svg>
  );
}

function CommitFileRow({ file, onSelect }: { file: CommitFile; onSelect(): void }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const slash = file.path.lastIndexOf('/');
  const name = slash < 0 ? file.path : file.path.slice(slash + 1);
  const oldName = file.oldPath?.split('/').pop();
  return (
    <div ref={rowRef} className="commit-file-row">
      <Tooltip>
        <TooltipTrigger render={<button className="commit-file-label" onClick={onSelect} aria-label={`Open the diff of ${file.path}`} />}>
          <VsCodeTreeIcon path={file.path} type="file" />
          <span className="commit-file-text">
            <span>{name}</span>
            {oldName && <small className="commit-file-rename">{oldName} →</small>}
          </span>
        </TooltipTrigger>
        <TooltipContent anchor={rowRef} side="right" sideOffset={10}>{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</TooltipContent>
      </Tooltip>
      <span className="commit-file-stats">
        {file.binary ? <span className="binary">bin</span> : (
          <>
            {file.additions > 0 && <span className="add">+{file.additions}</span>}
            {file.deletions > 0 && <span className="del">−{file.deletions}</span>}
          </>
        )}
      </span>
      <span className="status-code" data-kind={file.kind}>{changeStatusCode(file.kind)}</span>
    </div>
  );
}

function VsCodeTreeIcon({ path }: { path: string; type: 'file' | 'directory'; expanded?: boolean }) {
  return <img className="vscode-tree-icon" src={getVsCodeFileIconUrl(path)} alt="" aria-hidden="true" draggable={false} />;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'An unexpected error occurred.';
}
