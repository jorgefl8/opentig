import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IconRefresh } from '@tabler/icons-react';
import type { DiffResult, DiffViewPreference, PullRequestCommit, PullRequestFileList, PullRequestFilesScope, ThemePreference } from '@shared/contracts';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { DiffWorkspace, PullRequestFilesWorkspace, type ListedFile } from '@/features/viewer/DiffWorkspace';
import { PierreWorkerPool } from '@/features/viewer/PierreWorkerPool';
import { createReadGate } from '@/features/viewer/read-gate';
import { hasImmutableDiff, immutableDiff, pullRequestFileDiffKey } from '@/features/viewer/viewer-prefetch';
import { queryKeys } from '@/lib/query-client';
import { withSignal } from '@/lib/websocket-transport';
import { serializedErrorFromReason } from '@shared/errors';
import { opentig } from '@/lib/opentig-api';
import { useServerFeatures } from '@/lib/server-features';
import { Spinner } from '@/components/ui/spinner';
import { noteViewState, restoredViewState } from '@/features/viewer/viewer-memory';
import { pullRequestFilesQueryOptions } from './pull-request-files-query';

interface PullRequestDiffProps {
  /** All of the pull request's changes: its files, each read when unfolded, or on a server without that, its whole diff. */
  code: { files: PullRequestFileList } | { diff: DiffResult };
  range: { baseOid: string; headOid: string };
  /** How many files GitHub says the pull request changes, so a diff that lacks some can say so. */
  changedFiles: number;
  /** False while the pull request's commits past GitHub's first page are still being read. */
  commitsSettled?: boolean | undefined;
  prNumber: number;
  repositoryId: string;
  commits: PullRequestCommit[];
  diffView: DiffViewPreference;
  themeType: ThemePreference;
  wrapLines: boolean;
  onDiffViewChange(value: DiffViewPreference): void;
  onWrapLinesChange(value: boolean): void;
  onClose(): void;
  /** Opens a changed file as it is in the local worktree, which may be on another branch. */
  onOpenFile?: ((path: string) => void) | undefined;
}

type CodeMode = 'all' | 'commit';

/** File diffs read at once while Expand all unfolds many: enough to keep the connection busy without queuing it up. */
const FILE_READS_AT_ONCE = 4;

export default function PullRequestDiff({ code, range, changedFiles, commitsSettled = true, prNumber, repositoryId, commits, diffView, themeType, wrapLines, onDiffViewChange, onWrapLinesChange, onClose, onOpenFile }: PullRequestDiffProps) {
  // Back brings the code back grouped as it was at that step, on the same commit.
  const memoryKey = `${repositoryId}:pull:${prNumber}:code`;
  const [restored] = useState(() => restoredCodeView(restoredViewState(memoryKey)));
  const [chosenMode, setMode] = useState<CodeMode>(restored?.mode ?? 'all');
  const [selectedOid, setSelectedOid] = useState(restored?.commit ?? commits[0]?.oid ?? '');
  // A commit past GitHub's first page is only known once the rest of the list arrives: until then it is waited for.
  const awaitingCommit = !commitsSettled && selectedOid !== '' && !commits.some((commit) => commit.oid === selectedOid);
  const selectedCommit = useMemo(() => awaitingCommit ? null : commits.find((commit) => commit.oid === selectedOid) ?? commits[0] ?? null, [awaitingCommit, commits, selectedOid]);
  // A pull request with no commits left, after a force push, has nothing to show by commit.
  const mode: CodeMode = chosenMode === 'commit' && !selectedCommit && !awaitingCommit ? 'all' : chosenMode;
  const shownOid = selectedCommit?.oid ?? null;
  // What Back brings back is what is shown: a commit gone since gave way to the first one.
  useEffect(() => {
    if (!awaitingCommit) noteViewState(memoryKey, { mode, commit: mode === 'commit' ? shownOid : null });
  }, [awaitingCommit, memoryKey, mode, shownOid]);
  const byFile = 'files' in code;
  // A server that reads files one by one does so for a commit too; an older one sends the commit's whole diff.
  const commitFilesQuery = useQuery({
    ...pullRequestFilesQueryOptions(repositoryId, prNumber, { ...range, commitOid: selectedCommit?.oid ?? '' }),
    enabled: byFile && mode === 'commit' && selectedCommit !== null,
  });
  const commitDiffQuery = useQuery({
    queryKey: queryKeys.pullRequestCommitDiff(repositoryId, selectedCommit?.oid ?? ''),
    queryFn: () => opentig.github.getPullRequestCommitDiff(repositoryId, selectedCommit!.oid),
    enabled: !byFile && mode === 'commit' && selectedCommit !== null,
  });
  const commitQuery = byFile ? commitFilesQuery : commitDiffQuery;
  const active: { files: PullRequestFileList } | { diff: DiffResult } | null = mode === 'all' ? code
    : byFile ? commitFilesQuery.data ? { files: commitFilesQuery.data } : null
    : commitDiffQuery.data ? { diff: commitDiffQuery.data } : null;
  // Files are listed for Git to read one by one; otherwise the whole diff, from GitHub when Git had no commits.
  const listed = active && 'files' in active && active.files.source === 'git' ? active.files : null;
  const activeDiff = !active ? null : 'diff' in active ? active.diff : active.files.source === 'github' ? active.files.diff : null;
  const missing = mode === 'all' && active && 'files' in active && active.files.source === 'github' && !active.files.diff.truncated
    ? Math.max(0, changedFiles - (active.files.diff.patch.match(/^diff --git /gm)?.length ?? 0)) : 0;
  const commitError = commitQuery.error instanceof Error ? commitQuery.error.message : commitQuery.error ? 'Could not load the commit’s changes.' : null;
  // Only the commits make the scope, so a new read of the details or the commit list doesn't read the open files again.
  const { baseOid, headOid } = range;
  const scope = useMemo<PullRequestFilesScope>(() => mode === 'commit' && shownOid ? { baseOid, headOid, commitOid: shownOid } : { baseOid, headOid }, [baseOid, headOid, mode, shownOid]);
  const [gate] = useState(() => createReadGate(FILE_READS_AT_ONCE));
  // One read of the list again per scope, shared by every file waiting on it, and called off with the view.
  const [relisting] = useState(() => ({ controller: new AbortController(), reads: new Map<string, Promise<unknown>>() }));
  useEffect(() => () => relisting.controller.abort(), [relisting]);
  const readFile = useCallback((file: ListedFile, signal: AbortSignal, urgent: boolean) => {
    const key = pullRequestFileDiffKey(repositoryId, scope, file.path, file.oldPath);
    const read = () => immutableDiff(key, () => opentig.github.getPullRequestFileDiff(repositoryId, prNumber, scope, { path: file.path, oldPath: file.oldPath }), signal);
    // What was read already shows at once, without waiting its turn.
    const first = hasImmutableDiff(key) ? read() : gate(read, signal, urgent);
    // A file's diff is read straight from Git: when the commits have left the clone since the list was read,
    // and only then, reading the list again brings them back, and the file is read once more.
    return first.catch(async (reason: unknown) => {
      if (signal.aborted || serializedErrorFromReason(reason)?.code !== 'PULL_REQUEST_COMMITS_MISSING') throw reason;
      const listKey = JSON.stringify(scope);
      let relist = relisting.reads.get(listKey);
      if (!relist) {
        relist = withSignal(relisting.controller.signal, () => opentig.github.getPullRequestFiles(repositoryId, prNumber, scope))
          .finally(() => { if (relisting.reads.get(listKey) === relist) relisting.reads.delete(listKey); });
        relisting.reads.set(listKey, relist);
      }
      await untilAborted(relist, signal);
      return gate(read, signal, true);
    });
  }, [gate, prNumber, relisting, repositoryId, scope]);
  // Both versions of a file, from the clone, at the commits its diff compares.
  const readsFileVersions = useServerFeatures().fileVersions;
  const readFileVersions = useCallback((file: ListedFile, signal: AbortSignal, maxBytes: number) => withSignal(
    signal,
    () => opentig.github.getPullRequestFileVersions(repositoryId, prNumber, scope, { path: file.path, oldPath: file.oldPath }, maxBytes),
  ), [prNumber, repositoryId, scope]);
  const contentKey = mode === 'all' ? `pull:${prNumber}:all` : `pull:${prNumber}:commit:${selectedCommit?.oid ?? ''}`;

  const scopeControl = (
    <div className="pr-code-scope">
      <div className="pr-code-mode" role="group" aria-label="Pull request code grouping">
        <Button type="button" variant={mode === 'all' ? 'secondary' : 'ghost'} size="xs" aria-pressed={mode === 'all'} onClick={() => setMode('all')}>All changes</Button>
        <Button type="button" variant={mode === 'commit' ? 'secondary' : 'ghost'} size="xs" aria-pressed={mode === 'commit'} disabled={commits.length === 0} onClick={() => setMode('commit')}>By commit</Button>
      </div>
      {mode === 'commit' && selectedCommit && (
        <Select value={selectedCommit.oid} onValueChange={(value) => { if (value) setSelectedOid(value); }}>
          <Tooltip>
            <TooltipTrigger render={<SelectTrigger className="pr-commit-select" size="sm" aria-label="Commit" />}>
              <SelectValue>{selectedCommit.oid.slice(0, 7)} · {selectedCommit.messageHeadline || '(no commit message)'}</SelectValue>
            </TooltipTrigger>
            <TooltipContent>{selectedCommit.oid.slice(0, 7)} · {selectedCommit.messageHeadline || '(no commit message)'}</TooltipContent>
          </Tooltip>
          <SelectContent align="start" alignItemWithTrigger={false} className="pr-commit-menu">
            {commits.map((commit) => (
              <SelectItem key={commit.oid} value={commit.oid} label={`${commit.oid.slice(0, 7)} ${commit.messageHeadline || '(no commit message)'}`}>
                <span className="shrink-0 self-start font-mono text-xs text-muted-foreground">{commit.oid.slice(0, 7)}</span>
                <span className="min-w-0 whitespace-normal break-words">{commit.messageHeadline || '(no commit message)'}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {activeDiff?.truncated && <span className="pr-diff-truncated">Some files are not shown: the complete diff is too large.</span>}
      {missing > 0 && <span className="pr-diff-truncated">{missing} of {changedFiles} files are not shown: Git couldn’t read this pull request’s commits, and GitHub’s diff stops at 300 files.</span>}
    </div>
  );
  if (mode === 'commit' && commitError) {
    return (
      <DiffLoadingShell scopeControl={scopeControl}>
        <p className="text-destructive">{commitError}</p>
        <Button variant="outline" size="sm" onClick={() => void commitQuery.refetch()}><IconRefresh /> Try again</Button>
      </DiffLoadingShell>
    );
  }
  if (!active) {
    const waiting = awaitingCommit ? 'Loading the pull request’s commits…' : byFile ? 'Loading the commit’s files…' : 'Loading commit diff…';
    return <DiffLoadingShell scopeControl={scopeControl}><Spinner className="view-spinner" /> <ShimmeringText text={waiting} /></DiffLoadingShell>;
  }
  if (listed) {
    if (!listed.files.length) return <DiffLoadingShell scopeControl={scopeControl}>No differences to show.</DiffLoadingShell>;
    return (
      <PierreWorkerPool>
        <PullRequestFilesWorkspace
          key={contentKey}
          contentKey={contentKey}
          files={listed.files}
          diffView={diffView}
          themeType={themeType}
          wrapLines={wrapLines}
          scopeControl={scopeControl}
          notice={<UnlistedFiles listed={listed} changedFiles={mode === 'all' ? changedFiles : null} scope={mode === 'all' ? 'pull request' : 'commit'} />}
          foldMemoryKey={`${repositoryId}:${contentKey}`}
          readFile={readFile}
          readFileVersions={readsFileVersions ? readFileVersions : undefined}
          onDiffViewChange={onDiffViewChange}
          onWrapLinesChange={onWrapLinesChange}
          onClose={onClose}
          onOpenFile={onOpenFile}
        />
      </PierreWorkerPool>
    );
  }
  if (!activeDiff?.patch) return <DiffLoadingShell scopeControl={scopeControl}>{activeDiff?.truncated ? 'Every changed file is too large to show here.' : 'No differences to show.'}</DiffLoadingShell>;
  return (
    <PierreWorkerPool>
      <DiffWorkspace
        contentKey={contentKey}
        diff={activeDiff}
        diffView={diffView}
        themeType={themeType}
        wrapLines={wrapLines}
        initiallyCollapsed
        foldMemoryKey={`${repositoryId}:${contentKey}`}
        scopeControl={scopeControl}
        onDiffViewChange={onDiffViewChange}
        onWrapLinesChange={onWrapLinesChange}
        onClose={onClose}
        onOpenFile={onOpenFile}
      />
    </PierreWorkerPool>
  );
}

/** Says how many files the list leaves out: past the most it carries, or past what Git's listing could be read of. */
function UnlistedFiles({ listed, changedFiles, scope }: { listed: Extract<PullRequestFileList, { source: 'git' }>; changedFiles: number | null; scope: 'pull request' | 'commit' }) {
  if (listed.complete && listed.omitted === 0) return null;
  const missing = Math.max(listed.omitted, changedFiles === null ? 0 : changedFiles - listed.files.length);
  const why = listed.complete ? `a list stops at ${listed.files.length.toLocaleString('en-US')} files` : `this ${scope} changes too many files to list them all`;
  return (
    <p className="pr-files-omitted" role="status">
      {missing > 0 ? `${missing.toLocaleString('en-US')} more ${missing === 1 ? 'file is' : 'files are'} not listed: ${why}.` : `Not every file is listed: ${why}.`}
    </p>
  );
}

/** A shared read, given up by one caller whose signal aborts without stopping it for the others. */
function untilAborted<T>(read: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const leave = () => reject(new DOMException('The read was cancelled.', 'AbortError'));
    if (signal.aborted) { leave(); return; }
    signal.addEventListener('abort', leave, { once: true });
    read.then(resolve, reject).finally(() => signal.removeEventListener('abort', leave));
  });
}

function restoredCodeView(value: unknown): { mode: CodeMode; commit: string | null } | null {
  if (!value || typeof value !== 'object') return null;
  const view = value as Record<string, unknown>;
  if (view.mode !== 'all' && view.mode !== 'commit') return null;
  const commit = typeof view.commit === 'string' && /^[0-9a-f]{40,64}$/i.test(view.commit) ? view.commit : null;
  return { mode: view.mode === 'commit' && commit ? 'commit' : 'all', commit };
}

function DiffLoadingShell({ scopeControl, children }: { scopeControl: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="diff-workspace">
      <div className="diff-workspace-toolbar"><div className="diff-workspace-scope">{scopeControl}</div></div>
      <div className="viewer-message flex-col gap-3">{children}</div>
    </div>
  );
}
