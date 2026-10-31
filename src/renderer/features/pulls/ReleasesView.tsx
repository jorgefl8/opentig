import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IconBrandGithub, IconLoader4, IconPlayerPlay, IconPlus, IconRefresh, IconTag } from '@tabler/icons-react';
import { formatDate } from '@shared/date-format';
import { Button } from '@/components/ui/button';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { CreateReleaseDialog } from './CreateReleaseDialog';
import { releaseStateLabel } from './gh-utils';
import { RunWorkflowDialog } from './RunWorkflowDialog';

export function ReleasesView({ repositoryId, activeTag, onSelect }: { repositoryId: string; activeTag: string | null; onSelect(tagName: string): void }) {
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState(false);
  const query = useQuery({ queryKey: queryKeys.releases(repositoryId), queryFn: () => opentig.github.listReleases(repositoryId) });
  const releases = query.data ?? null;
  const error = query.error instanceof Error ? query.error.message : query.error ? 'Could not load the releases.' : null;
  return (
    <div className="pulls-view">
      <div className="pulls-toolbar">
        <span className="pulls-repo"><IconBrandGithub aria-hidden="true" /> Releases</span>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button" disabled={query.isFetching} onClick={() => void query.refetch()} aria-label="Refresh releases" />}>
            {query.isFetching ? <IconLoader4 className="animate-spin" /> : <IconRefresh />}
          </TooltipTrigger>
          <TooltipContent>Refresh releases</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="xs" onClick={() => setRunning(true)} aria-label="Run a workflow" />}><IconPlayerPlay /> Run</TooltipTrigger>
          <TooltipContent>Run a workflow, such as the one that prepares a release</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button variant="outline" size="xs" onClick={() => setCreating(true)} aria-label="Create a draft release" />}><IconPlus /> New</TooltipTrigger>
          <TooltipContent>Create a draft release for an existing tag</TooltipContent>
        </Tooltip>
      </div>
      {error && <div className="pulls-error" role="alert"><span>{error}</span><Button variant="ghost" size="xs" onClick={() => void query.refetch()}>Retry</Button></div>}
      <div className="pulls-scroll" role="list" aria-label="Releases">
        {releases === null && !error && <div className="view-loading" role="status"><IconLoader4 className="spinner" /> <ShimmeringText text="Loading releases…" /></div>}
        {releases?.length === 0 && <p className="empty-list">No releases yet.</p>}
        {releases?.map((release) => {
          const label = releaseStateLabel(release);
          return (
            <div key={release.tagName} role="listitem">
              <button className={`release-item ${release.isDraft ? 'draft' : 'published'}${activeTag === release.tagName ? ' active' : ''}`} onClick={() => onSelect(release.tagName)} aria-label={`View release ${release.name}`}>
                <IconTag aria-hidden="true" />
                <span className="release-item-text">
                  <strong>{release.name}</strong>
                  <span className="release-item-meta">
                    <code>{release.tagName}</code>
                    <Badge variant={release.isLatest ? 'default' : 'outline'}>{label}</Badge>
                    <time dateTime={release.publishedAt ?? release.createdAt}>{formatDate(release.publishedAt ?? release.createdAt)}</time>
                  </span>
                </span>
              </button>
            </div>
          );
        })}
      </div>
      {running && <RunWorkflowDialog repositoryId={repositoryId} onClose={() => setRunning(false)} />}
      {creating && <CreateReleaseDialog repositoryId={repositoryId} onClose={() => setCreating(false)} onCreated={onSelect} />}
    </div>
  );
}
