import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { IconChevronRight, IconLoader4, IconRestore, IconGitPullRequest, IconSearch, IconArrowDown } from '@tabler/icons-react';
import { sileo } from 'sileo';
import type { CommitFile, CommitInfo } from '../../../shared/git-types';
import { Button } from '@/components/ui/button';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { changeStatusCode } from '@/features/changes/change-status';
import { buildCommitGraph, type CommitGraphRow } from './commit-graph';
import { commitReference, historyColor, historyRows, matchesHistory } from './history-presentation';
import { readCommitFilesCache, writeCommitFilesCache } from './commit-files-cache';
import { writeClipboardText } from '@/lib/browser-capabilities';
import { getVsCodeFileIconUrl } from '@/lib/vscode-icons';
import { opentig } from '@/lib/opentig-api';

interface HistoryViewProps {
  repositoryId: string; upstream: string | null; readOnly: boolean; operation: string | null;
  canPublish: boolean; pushBusy: boolean; onPublish(): void;
  commits: CommitInfo[] | null; nextCursor: string | null; loading: boolean; undoing: boolean;
  baseRef?: string | null | undefined; activeOid?: string | null; onSelectReference?: ((number: number) => void) | undefined;
  onSelectCommit(commit: CommitInfo): void; onSelectFile(oid: string, file: CommitFile): void; onUndo(commit: CommitInfo): void; onMore(): void;
}

export function HistoryView({ repositoryId, upstream, readOnly, operation, canPublish, pushBusy, onPublish, commits, nextCursor, loading, undoing, baseRef, activeOid, onSelectReference, onSelectCommit, onSelectFile, onUndo, onMore }: HistoryViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());
  const [compact, setCompact] = useState(true);
  const [grouped, setGrouped] = useState(false);
  const [search, setSearch] = useState('');
  const [matchIndex, setMatchIndex] = useState(-1);
  const rowHeight = compact ? 42 : 56;
  // Search temporarily reveals grouped commits; it never removes graph context.
  const rows = useMemo(() => historyRows(commits ?? [], grouped && !search.trim()), [commits, grouped, search]);
  const graph = useMemo(() => buildCommitGraph(rows.map(({ commit, parentOids }) => ({ oid: commit.oid, parentOids, color: historyColor(commit) }))), [rows]);
  const matches = useMemo(() => rows.flatMap(({ commit }, index) => matchesHistory(commit, search) ? [index] : []), [rows, search]);
  const graphWidth = graphWidthForLanes(graph.laneCount);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is intentionally imperative.
  const commitVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    getItemKey: (index) => rows[index]!.commit.oid,
    overscan: 8,
  });
  useEffect(() => { commitVirtualizer.measure(); }, [commitVirtualizer, compact, grouped, search]);
  const nextMatch = () => {
    if (!matches.length) return;
    const next = (matchIndex + 1) % matches.length;
    setMatchIndex(next);
    commitVirtualizer.scrollToIndex(matches[next]!, { align: 'center' });
  };
  if (commits === null) return <div className="view-loading" role="status"><IconLoader4 className="spinner" /> <ShimmeringText text="Loading history…" /></div>;
  const localCount = commits.filter((commit) => commit.upstreamState === 'local-only').length;
  return (
    <div className="history-list" style={{ '--history-row-height': `${rowHeight}px` } as CSSProperties}>
      <div className="history-toolbar">
        <label className="history-search"><IconSearch aria-hidden="true" /><input type="search" aria-label="Search loaded commits" placeholder="Find commit…" value={search} onChange={(event) => { setSearch(event.target.value); setMatchIndex(-1); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); nextMatch(); } }} /></label>
        {search && <Tooltip><TooltipTrigger render={<button className="history-next-match" onClick={nextMatch} disabled={!matches.length} aria-label="Next matching commit" />}><IconArrowDown /></TooltipTrigger><TooltipContent>Next match in loaded history (Enter)</TooltipContent></Tooltip>}
        <Tooltip><TooltipTrigger render={<button className="history-option" aria-pressed={grouped} disabled={!commits.some((commit) => commit.parentCount > 1)} onClick={() => setGrouped(!grouped)} />}>Group merges</TooltipTrigger><TooltipContent>Collapse complete merge branches. Searching reveals their commits.</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger render={<button className="history-option" aria-pressed={compact} onClick={() => setCompact(!compact)} />}>{compact ? 'Compact' : 'Comfortable'}</TooltipTrigger><TooltipContent>Change row density without moving the diff viewer</TooltipContent></Tooltip>
      </div>
      {!upstream && commits.length > 0 && <div className="history-upstream-notice" role="status"><span>Publish this branch to configure an upstream and distinguish local from published commits.</span>
        {canPublish && <Button variant="outline" size="xs" disabled={pushBusy || readOnly || Boolean(operation)} onClick={onPublish}>{pushBusy ? 'Publishing…' : 'Publish branch'}</Button>}
      </div>}
      {upstream && localCount > 0 && <div className="history-local-summary">↑ {localCount} {localCount === 1 ? 'local commit' : 'local commits'} in loaded history</div>}
      <div ref={scrollRef} className="history-scroll" role="list" aria-label="Commit history">
        {rows.length === 0 ? <p className="empty-list">This repository has no commits yet.</p> : (
          <div className="virtual-list" style={{ height: commitVirtualizer.getTotalSize() + (nextCursor ? 52 : 0) }}>
            {commitVirtualizer.getVirtualItems().map((virtualRow) => {
              const { commit, grouped: groupedCommits } = rows[virtualRow.index]!;
              return (
                <div key={virtualRow.key} ref={commitVirtualizer.measureElement} data-index={virtualRow.index} className="virtual-row" style={{ transform: `translateY(${virtualRow.start}px)` }}>
                  <CommitRow repositoryId={repositoryId} upstream={upstream} baseRef={baseRef} commit={commit}
                    graphRow={graph.rows[virtualRow.index]!} graphWidth={graphWidth} rowHeight={rowHeight}
                    active={activeOid === commit.oid || groupedCommits.some((item) => item.oid === activeOid)} match={matchesHistory(commit, search)}
                    groupedCount={groupedCommits.length} onRevealGroup={() => setGrouped(false)} onSelectReference={onSelectReference}
                    expanded={expandedCommits.has(commit.oid)}
                    onExpandedChange={(expanded) => setExpandedCommits((current) => { const next = new Set(current); if (expanded) next.add(commit.oid); else next.delete(commit.oid); return next; })}
                    canUndo={!readOnly && !operation && !undoing && commit.upstreamState === 'local-only' && commit.isHead && commit.parentCount === 1}
                    onSelectCommit={onSelectCommit} onSelectFile={onSelectFile} onUndo={onUndo}
                  />
                </div>
              );
            })}
            {nextCursor && <Button variant="ghost" className="history-more" style={{ top: commitVirtualizer.getTotalSize() }} disabled={loading} onClick={onMore}>{loading ? 'Loading…' : 'Load more'}</Button>}
          </div>
        )}
      </div>
      {commits.length > 0 && <div className="history-legend">
        <span><i data-color="local" />Local</span><span><i data-color="published" />Published</span>
        {baseRef && <Tooltip><TooltipTrigger render={<span className="history-base-label" />}><i data-color="base" />{baseRef}</TooltipTrigger><TooltipContent>Primary-line commits reachable from {baseRef}, using the latest known local refs. Side branches retain their own colors.</TooltipContent></Tooltip>}
        <span className="history-count" role="status">{search ? `${matches.length} matches in ${commits.length} loaded` : `${commits.length} loaded`}</span>
      </div>}
    </div>
  );
}

function CommitRow({ repositoryId, upstream, baseRef, commit, graphRow, graphWidth, rowHeight, active, match, groupedCount, onRevealGroup, onSelectReference, expanded, onExpandedChange, canUndo, onSelectCommit, onSelectFile, onUndo }: {
  repositoryId: string; upstream: string | null; baseRef?: string | null | undefined; commit: CommitInfo; expanded: boolean; canUndo: boolean;
  graphRow: CommitGraphRow; graphWidth: number; rowHeight: number; active: boolean; match: boolean; groupedCount: number;
  onRevealGroup(): void; onSelectReference?: ((number: number) => void) | undefined;
  onExpandedChange(expanded: boolean): void;
  onSelectCommit(commit: CommitInfo): void; onSelectFile(oid: string, file: CommitFile): void; onUndo(commit: CommitInfo): void;
}) {
  const cacheKey = `${repositoryId}:${commit.oid}`;
  const [files, setFiles] = useState<CommitFile[] | null>(() => readCommitFilesCache(cacheKey) ?? null);
  const [filesError, setFilesError] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded || files || filesError) return;
    let active = true;
    opentig.commits.files(repositoryId, commit.oid).then((value) => {
      if (!active) return;
      writeCommitFilesCache(cacheKey, value);
      setFiles(value);
    }).catch((reason) => { if (active) setFilesError(messageOf(reason)); });
    return () => { active = false; };
  }, [cacheKey, commit.oid, expanded, files, filesError, repositoryId]);

  const reference = commitReference(commit);
  const refs = parseDecorations(commit.decorations);
  const shownRefs = refs.slice(0, 3);
  const hiddenRefs = refs.slice(3);
  const additions = files?.reduce((total, file) => total + file.additions, 0) ?? 0;
  const deletions = files?.reduce((total, file) => total + file.deletions, 0) ?? 0;

  const copyOid = async () => {
    try { await writeClipboardText(commit.oid); sileo.success({ title: 'Hash copied', description: commit.oid }); }
    catch { sileo.error({ title: 'Could not copy hash' }); }
  };

  return (
    <div className={`commit-item${active ? ' active' : ''}${match ? ' search-match' : ''}`} role="listitem">
      <div className="commit-header">
        <CommitGraph graph={graphRow} width={graphWidth} height={rowHeight} merge={commit.parentCount > 1} head={commit.isHead} />
        <button className="commit-expand" aria-expanded={expanded} aria-label={expanded ? 'Collapse commit' : 'Expand commit'} onClick={() => onExpandedChange(!expanded)}>
          <IconChevronRight className={`folder-chevron ${expanded ? 'open' : ''}`} />
        </button>
        <div className="commit-main">
          <span className="commit-title-row">
            <Tooltip>
              <TooltipTrigger render={<button className="commit-subject" aria-pressed={active} onClick={() => onSelectCommit(commit)} />}>{commit.subject || '(no subject)'}</TooltipTrigger>
              <TooltipContent side="right">{commit.subject || '(no subject)'}<br />Open the full commit diff</TooltipContent>
            </Tooltip>
            {reference && <Tooltip>
              <TooltipTrigger render={onSelectReference ? <button className="ref-chip commit-pr" onClick={() => onSelectReference(reference.number)} aria-label={`Open pull request #${reference.number}`} /> : <span className="ref-chip commit-pr" />}><IconGitPullRequest aria-hidden="true" />#{reference.number}</TooltipTrigger>
              <TooltipContent>{reference.source === 'merge' ? 'Pull request reference from the merge message.' : 'Reference from the commit subject; it may identify a pull request or issue.'}{onSelectReference ? ' Open as a pull request in the right-hand viewer.' : ''} No merge method is inferred from the number.</TooltipContent>
            </Tooltip>}
            <Tooltip>
              <TooltipTrigger render={<span className="commit-date" />}>{formatRelativeDate(commit.date)}</TooltipTrigger>
              <TooltipContent>{formatDate(commit.date)}</TooltipContent>
            </Tooltip>
          </span>
          <span className="commit-meta">
            {(refs.length > 0 || commit.parentCount > 1 || commit.upstreamState === 'local-only') && (
              <span className="commit-refs">
                {commit.upstreamState === 'local-only' && (
                  <Tooltip>
                    <TooltipTrigger render={<span className="ref-chip local-only" />}>Local</TooltipTrigger>
                    <TooltipContent>{commit.isHead ? `Not in ${upstream ?? 'the upstream'} according to the latest known remote state.` : 'Not published. To avoid rewriting multiple commits, only the latest can be undone.'}</TooltipContent>
                  </Tooltip>
                )}
                {commit.parentCount > 1 && <span className="ref-chip merge">merge</span>}
                {shownRefs.map((ref) => <Tooltip key={`${ref.kind}:${ref.label}`}><TooltipTrigger render={<span className={`ref-chip ${ref.kind}`} data-base={ref.label === baseRef || (ref.label.endsWith('/HEAD') && commit.baseState === 'included')} />}>{ref.label}</TooltipTrigger><TooltipContent>{ref.label}</TooltipContent></Tooltip>)}
                {hiddenRefs.length > 0 && (
                  <Tooltip>
                    <TooltipTrigger render={<span className="ref-chip more" />}>+{hiddenRefs.length}</TooltipTrigger>
                    <TooltipContent>{hiddenRefs.map((ref) => ref.label).join(' · ')}</TooltipContent>
                  </Tooltip>
                )}
              </span>
            )}
            <Tooltip>
              <TooltipTrigger render={<button className="commit-oid" onClick={() => void copyOid()} aria-label={`Copiar hash ${commit.shortOid}`} />}>{commit.shortOid}</TooltipTrigger>
              <TooltipContent>Copy full hash</TooltipContent>
            </Tooltip>
            <Tooltip><TooltipTrigger render={<span className="commit-author" />}>{commit.author}</TooltipTrigger><TooltipContent>{commit.author}</TooltipContent></Tooltip>
            {groupedCount > 0 && <Tooltip><TooltipTrigger render={<button className="commit-group-count" onClick={onRevealGroup} />}>{groupedCount} grouped</TooltipTrigger><TooltipContent>Show the {groupedCount} commits in this merge branch</TooltipContent></Tooltip>}
          </span>
        </div>
        {canUndo && (
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button commit-undo" onClick={(event) => { event.stopPropagation(); onUndo(commit); }} aria-label={`Undo commit ${commit.shortOid}`} />}><IconRestore /></TooltipTrigger>
            <TooltipContent>Undo commit and keep its changes staged</TooltipContent>
          </Tooltip>
        )}
      </div>
      {expanded && graphRow.continuations.length > 0 && <CommitGraphContinuation graph={graphRow} width={graphWidth} />}
      {expanded && (
        <div className="commit-files" style={{ paddingLeft: graphWidth + 31 }}>
          {commit.body && <p className="commit-description">{commit.body}</p>}
          {filesError && <div className="commit-files-message error">{filesError}</div>}
          {!files && !filesError && <div className="commit-files-message"><IconLoader4 className="spinner" /> <ShimmeringText text="Loading files…" /></div>}
          {files && files.length === 0 && <div className="commit-files-message">This commit does not modify its own files (merge).</div>}
          {files && files.length > 0 && (
            <>
              <div className="commit-files-summary">
                {files.length} {files.length === 1 ? 'file' : 'files'}
                {(additions > 0 || deletions > 0) && <> · <span className="add">+{additions}</span> <span className="del">−{deletions}</span></>}
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

const GRAPH_LANE_GAP = 14;
const GRAPH_COLORS = ['var(--history-local)', 'var(--history-published)', 'var(--history-base)', 'var(--history-side-1)', 'var(--history-side-2)', 'var(--history-side-3)'];

function graphWidthForLanes(laneCount: number): number {
  return 14 + Math.max(0, laneCount - 1) * GRAPH_LANE_GAP;
}

function graphX(lane: number): number {
  return 7 + lane * GRAPH_LANE_GAP;
}

function graphColor(index: number): string {
  return GRAPH_COLORS[index % GRAPH_COLORS.length]!;
}

function CommitGraph({ graph, width, height, merge, head }: { graph: CommitGraphRow; width: number; height: number; merge: boolean; head: boolean }) {
  const nodeY = height / 2;
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
        return <path key={`${index}:${d}`} d={d} stroke={graphColor(segment.color)} />;
      })}
      <circle cx={graphX(graph.lane)} cy={nodeY} r={merge || head ? 4.5 : 3} fill={merge || head ? 'var(--sidebar)' : graphColor(graph.color)} stroke={graphColor(graph.color)} />
      {merge && <circle cx={graphX(graph.lane)} cy={nodeY} r="1.6" fill={graphColor(graph.color)} />}
    </svg>
  );
}

function CommitGraphContinuation({ graph, width }: { graph: CommitGraphRow; width: number }) {
  return (
    <svg className="commit-graph-continuation" width={width} viewBox={`0 0 ${width} 100`} preserveAspectRatio="none" aria-hidden="true">
      {graph.continuations.map((lane) => (
        <line key={lane.lane} x1={graphX(lane.lane)} y1="0" x2={graphX(lane.lane)} y2="100" stroke={graphColor(lane.color)} />
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
        <TooltipTrigger render={<button className="commit-file-label" onClick={onSelect} aria-label={`Ver el diff de ${file.path}`} />}>
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

type RefChipInfo = { label: string; kind: 'head' | 'branch' | 'remote' | 'tag' };

function parseDecorations(decorations: string[]): RefChipInfo[] {
  return decorations.map((decoration) => {
    if (decoration.startsWith('tag: ')) return { label: decoration.slice(5), kind: 'tag' as const };
    if (decoration.startsWith('HEAD -> ')) return { label: decoration.slice(8), kind: 'head' as const };
    if (decoration === 'HEAD') return { label: 'HEAD', kind: 'head' as const };
    return { label: decoration, kind: decoration.includes('/') ? 'remote' as const : 'branch' as const };
  });
}

const RELATIVE_DATE = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'narrow' });
const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3_600], ['minute', 60],
];

function formatRelativeDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return RELATIVE_DATE.format(Math.trunc(seconds / size), unit);
  }
  return 'right now';
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function VsCodeTreeIcon({ path }: { path: string; type: 'file' | 'directory'; expanded?: boolean }) {
  return <img className="vscode-tree-icon" src={getVsCodeFileIconUrl(path)} alt="" aria-hidden="true" draggable={false} />;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'An unexpected error occurred.';
}
