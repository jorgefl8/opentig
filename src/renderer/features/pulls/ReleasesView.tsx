import { useState } from 'react';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { IconDots, IconLoader4, IconPlayerPlay, IconPlus } from '@tabler/icons-react';
import { formatDate } from '@shared/date-format';
import type { GitHubRepositoryAccount } from '@shared/github-accounts';
import type { ReleaseSummary } from '../../../shared/contracts';
import { Button } from '@/components/ui/button';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { CreateReleaseDialog } from './CreateReleaseDialog';
import { releaseStateLabel, releaseStateTone } from './gh-utils';
import { GitHubSectionMenu } from './GitHubSectionMenu';
import { RunWorkflowDialog } from './RunWorkflowDialog';

function releasesQueryOptions(repositoryId: string) {
  return queryOptions({ queryKey: queryKeys.releases(repositoryId), queryFn: () => opentig.github.listReleases(repositoryId) });
}

export function ReleasesTools({ repositoryId, nameWithOwner, account, onOpenGitHubSettings, onSelect }: {
  repositoryId: string;
  nameWithOwner: string | null;
  account: GitHubRepositoryAccount | null;
  onOpenGitHubSettings(): void;
  onSelect(tagName: string): void;
}) {
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState(false);
  const query = useQuery(releasesQueryOptions(repositoryId));
  return (
    <>
      <GitHubSectionMenu
        label="More release options"
        icon={<IconDots />}
        refreshing={query.isFetching}
        refreshLabel="Refresh releases"
        onRefresh={() => void query.refetch()}
        nameWithOwner={nameWithOwner}
        githubPath="releases"
        account={account}
        onOpenGitHubSettings={onOpenGitHubSettings}
      />
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button" onClick={() => setRunning(true)} aria-label="Run a workflow" />}><IconPlayerPlay /></TooltipTrigger>
        <TooltipContent>Run a workflow, such as the one that prepares a release</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button" onClick={() => setCreating(true)} aria-label="Create a draft release" />}><IconPlus /></TooltipTrigger>
        <TooltipContent>Create a draft release for an existing tag</TooltipContent>
      </Tooltip>
      {running && <RunWorkflowDialog repositoryId={repositoryId} onClose={() => setRunning(false)} />}
      {creating && <CreateReleaseDialog repositoryId={repositoryId} onClose={() => setCreating(false)} onCreated={onSelect} />}
    </>
  );
}

/** The list only knows the state, tag and dates: assets and whether the tag exists come with the viewer. */
function releaseNote(release: ReleaseSummary): string {
  const label = releaseStateLabel(release);
  return `${label} · ${release.isDraft ? release.tagName : formatDate(release.publishedAt ?? release.createdAt)}`;
}

export function ReleasesView({ repositoryId, activeTag, onSelect }: { repositoryId: string; activeTag: string | null; onSelect(tagName: string): void }) {
  const query = useQuery(releasesQueryOptions(repositoryId));
  const releases = query.data ?? null;
  const error = query.error instanceof Error ? query.error.message : query.error ? 'Could not load the releases.' : null;
  return (
    <div className="pulls-view">
      {error && <div className="pulls-error" role="alert"><span>{error}</span><Button variant="ghost" size="xs" onClick={() => void query.refetch()}>Retry</Button></div>}
      <div className="pulls-scroll" role="list" aria-label="Releases">
        {releases === null && !error && <div className="view-loading" role="status"><IconLoader4 className="spinner" /> <ShimmeringText text="Loading releases…" /></div>}
        {releases?.length === 0 && <p className="empty-list">No releases yet.</p>}
        {releases?.map((release) => (
          <div key={release.tagName} className={`pull-item ${activeTag === release.tagName ? 'active' : ''}`} role="listitem">
            <button className="pull-main" onClick={() => onSelect(release.tagName)}>
              <span className={`status-dot tone-${releaseStateTone(release)}`} aria-hidden="true" />
              <span className="pull-title">{release.name}</span>
              <span className="pull-meta">{releaseNote(release)}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
