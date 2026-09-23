import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IconLoader4, IconRefresh } from '@tabler/icons-react';
import type { DiffResult, DiffViewPreference, PullRequestCommit, ThemePreference } from '@shared/contracts';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { DiffWorkspace } from '@/features/viewer/DiffWorkspace';
import { PierreWorkerPool } from '@/features/viewer/PierreWorkerPool';
import { queryKeys } from '@/lib/query-client';
import { opentig } from '@/lib/opentig-api';

interface PullRequestDiffProps {
  diff: DiffResult;
  prNumber: number;
  repositoryId: string;
  commits: PullRequestCommit[];
  diffView: DiffViewPreference;
  themeType: ThemePreference;
  wrapLines: boolean;
  onDiffViewChange(value: DiffViewPreference): void;
  onWrapLinesChange(value: boolean): void;
  onClose(): void;
}

type CodeMode = 'all' | 'commit';

export default function PullRequestDiff({ diff, prNumber, repositoryId, commits, diffView, themeType, wrapLines, onDiffViewChange, onWrapLinesChange, onClose }: PullRequestDiffProps) {
  const [mode, setMode] = useState<CodeMode>('all');
  const [selectedOid, setSelectedOid] = useState(commits[0]?.oid ?? '');
  const selectedCommit = useMemo(() => commits.find((commit) => commit.oid === selectedOid) ?? commits[0] ?? null, [commits, selectedOid]);
  const commitDiffQuery = useQuery({
    queryKey: queryKeys.pullRequestCommitDiff(repositoryId, selectedCommit?.oid ?? ''),
    queryFn: () => opentig.github.getPullRequestCommitDiff(repositoryId, selectedCommit!.oid),
    enabled: mode === 'commit' && selectedCommit !== null,
  });
  const commitError = commitDiffQuery.error instanceof Error ? commitDiffQuery.error.message : commitDiffQuery.error ? 'Could not load the commit diff.' : null;

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
    </div>
  );

  const activeDiff = mode === 'all' ? diff : commitDiffQuery.data ?? null;
  if (mode === 'commit' && commitError) {
    return (
      <DiffLoadingShell scopeControl={scopeControl}>
        <p className="text-destructive">{commitError}</p>
        <Button variant="outline" size="sm" onClick={() => void commitDiffQuery.refetch()}><IconRefresh /> Try again</Button>
      </DiffLoadingShell>
    );
  }
  if (!activeDiff) {
    return <DiffLoadingShell scopeControl={scopeControl}><IconLoader4 className="spinner" /> <ShimmeringText text="Loading commit diff…" /></DiffLoadingShell>;
  }
  if (!activeDiff.patch) return <DiffLoadingShell scopeControl={scopeControl}>No differences to show.</DiffLoadingShell>;
  return (
    <PierreWorkerPool>
      <DiffWorkspace
        contentKey={mode === 'all' ? `pull:${prNumber}:all` : `pull:${prNumber}:commit:${selectedCommit?.oid ?? ''}`}
        diff={activeDiff}
        diffView={diffView}
        themeType={themeType}
        wrapLines={wrapLines}
        initiallyCollapsed
        scopeControl={scopeControl}
        onDiffViewChange={onDiffViewChange}
        onWrapLinesChange={onWrapLinesChange}
        onClose={onClose}
      />
    </PierreWorkerPool>
  );
}

function DiffLoadingShell({ scopeControl, children }: { scopeControl: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="diff-workspace">
      <div className="diff-workspace-toolbar"><div className="diff-workspace-scope">{scopeControl}</div></div>
      <div className="viewer-message flex-col gap-3">{children}</div>
    </div>
  );
}
