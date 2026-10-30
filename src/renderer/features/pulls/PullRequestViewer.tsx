import { formatDateTime } from '@shared/date-format';
import { PullRequestStackMenu } from './PullRequestStackMenu';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IconAlertTriangle, IconCircleCheck, IconCircleX, IconExternalLink, IconGitBranch, IconGitCommit, IconLoader4, IconRefresh, IconTag } from '@tabler/icons-react';
import { GITHUB_PR_COMMIT_PAGE, type DiffResult, type DiffViewPreference, type PullRequestCommitList, type PullRequestDetails, type PullRequestLiveState, type ThemePreference } from '../../../shared/contracts';
import { pullRequestStatusLine, type PullRequestStatusTone } from '../../../shared/pull-request-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ViewerTabs, ViewerTabsList, ViewerTabsPanel } from '@/components/ui/viewer-tabs';
import { LinkedMarkdown } from '@/features/markdown/LinkedMarkdown';
import { LinkedText } from '@/components/LinkedText';

import { ghDetail, MERGE_METHOD_LABELS, openOnGitHub, prStateLabel, reviewDecisionLabel } from './gh-utils';
import { GitHubAvatar } from './GitHubAvatar';
import { EditPullRequestDialog } from './EditPullRequestDialog';
import { PullRequestActionBar } from './PullRequestActionBar';
import { PullRequestChecksMenu, PullRequestChecksSummary } from './PullRequestChecksMenu';
import { pullRequestLiveStateQueryOptions, queriesOutdatedByLiveState } from './pull-request-live-state-query';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import '@/features/markdown/markdown.css';

const PullRequestDiff = lazy(() => import('./PullRequestDiff'));

interface PullRequestViewerProps {
  repositoryId: string;
  prNumber: number;
  diffView: DiffViewPreference;
  themeType: ThemePreference;
  wrapLines: boolean;
  onDiffViewChange(value: DiffViewPreference): void;
  onWrapLinesChange(value: boolean): void;
  onClose(): void;
  onSelectPullRequest(number: number): void;
}

export function PullRequestViewer({ repositoryId, prNumber, diffView, themeType, wrapLines, onDiffViewChange, onWrapLinesChange, onClose, onSelectPullRequest }: PullRequestViewerProps) {
  const [tab, setTab] = useState<'summary' | 'timeline' | 'diff'>('summary');
  const [editing, setEditing] = useState(false);
  const detailsQuery = useQuery<{ details: PullRequestDetails; bodyHtml: string }>({
    queryKey: queryKeys.pullRequest(repositoryId, prNumber),
    queryFn: async () => {
      const details = await opentig.github.getPullRequest(repositoryId, prNumber);
      const bodyHtml = details.body.trim()
        ? await import('@/features/markdown/render-markdown')
          .then(({ renderMarkdown }) => renderMarkdown(details.body))
          .catch(() => '<p>Could not render the description.</p>')
        : '';
      return { details, bodyHtml };
    },
  });
  const details = detailsQuery.data?.details ?? null;
  const bodyHtml = detailsQuery.data?.bodyHtml ?? '';
  const detailsError = detailsQuery.error instanceof Error ? detailsQuery.error.message : detailsQuery.error ? 'Could not load the pull request.' : null;
  const diffQuery = useQuery<DiffResult>({
    queryKey: queryKeys.pullRequestDiff(repositoryId, prNumber),
    queryFn: () => opentig.github.getPullRequestDiff(repositoryId, prNumber),
    enabled: tab === 'diff' && details !== null,
  });
  const diff = diffQuery.data ?? null;
  // GitHub CLI returns one page of commits; past it, the local clone lists them all.
  const firstPageOnly = (details?.commits.length ?? 0) >= GITHUB_PR_COMMIT_PAGE;
  const commitsQuery = useQuery<PullRequestCommitList>({
    queryKey: queryKeys.pullRequestCommits(repositoryId, prNumber),
    queryFn: () => opentig.github.getPullRequestCommits(repositoryId, prNumber),
    enabled: firstPageOnly && tab !== 'summary',
  });
  const commits = commitsQuery.data?.commits ?? details?.commits ?? [];
  const commitsIncomplete = firstPageOnly && commitsQuery.data?.complete !== true;
  const diffError = diffQuery.error instanceof Error ? diffQuery.error.message : diffQuery.error ? 'Could not load the diff.' : null;
  const liveQuery = useQuery(pullRequestLiveStateQueryOptions(repositoryId, prNumber, details !== null));
  const live = liveQuery.data ?? null;
  const queryClient = useQueryClient();
  const previousLive = useRef<PullRequestLiveState | null>(null);
  useEffect(() => {
    const previous = previousLive.current;
    previousLive.current = live;
    if (!previous || !live) return;
    for (const queryKey of queriesOutdatedByLiveState(repositoryId, previous, live)) void queryClient.invalidateQueries({ queryKey });
  }, [live, queryClient, repositoryId]);

  if (detailsError) {
    return (
      <div className="viewer-message flex-col gap-3">
        <p className="text-destructive">{detailsError}</p>
        <Button variant="outline" size="sm" onClick={() => void detailsQuery.refetch()}><IconRefresh /> Try again</Button>
      </div>
    );
  }
  if (!details) {
    return <div className="viewer-message"><IconLoader4 className="spinner" /> <ShimmeringText text={`Loading pull request #${prNumber}…`} /></div>;
  }

  const stateLabel = prStateLabel(details);
  const review = reviewDecisionLabel(live ? live.reviewDecision : details.reviewDecision);
  const status = live ? pullRequestStatusLine(live) : null;
  return (
    <ViewerTabs value={tab} onValueChange={(value) => setTab(value as typeof tab)} className="pr-viewer">
      <header className="pr-viewer-header">
        <div className="pr-viewer-overview">
        <div className="pr-viewer-title">
          <Badge variant={details.state === 'OPEN' && !details.isDraft ? 'default' : 'secondary'} className={`pr-state-badge ${stateLabel.toLowerCase().replace(/\s+/g, '-')}`}>{stateLabel}</Badge>
          <h2><LinkedText text={details.title || '(no title)'} /> <span className="pr-number">#{details.number}</span></h2>
        </div>
        <div className="pr-viewer-meta">
          <span className="pr-author-with-avatar">
            <GitHubAvatar key={details.authorAvatarUrl} src={details.authorAvatarUrl} className="pr-author-avatar" />
            <span className="pr-author">{details.author}</span>
          </span>
          <span aria-hidden="true">·</span>
          <span>updated <time dateTime={details.updatedAt}>{formatDateTime(details.updatedAt)}</time></span>
          <span aria-hidden="true">·</span>
          <span className="pr-branches"><IconGitBranch aria-hidden="true" /> {details.headRefName} → {details.baseRefName}</span>
          <span aria-hidden="true">·</span>
          <span className="pr-counters">
            {details.changedFiles} {details.changedFiles === 1 ? 'file' : 'files'}
            {' '}<span className="add">+{details.additions}</span> <span className="del">−{details.deletions}</span>
          </span>
          {details.stack && <PullRequestStackMenu repositoryId={repositoryId} number={prNumber} membership={details.stack} onSelect={onSelectPullRequest} />}
          {details.url && <span className="pr-viewer-actions">
            <Button variant="outline" size="xs" onClick={() => openOnGitHub(details.url)}><IconExternalLink /> Open on GitHub</Button>
          </span>}
        </div>
        <div className="pr-viewer-status">
          {status && <span className={`pr-status ${status.tone}`} role="status">
            <PullRequestStatusIcon tone={status.tone} /> {status.label}
            {status.detail && <small>{status.detail}</small>}
          </span>}
          {liveQuery.isPending && details.state === 'OPEN' && <span className="pr-status progress" role="status"><IconLoader4 className="animate-spin" aria-hidden="true" /> <ShimmeringText text="Checking status…" /></span>}
          {live ? <PullRequestChecksMenu checks={live.checks} url={details.url} /> : <PullRequestChecksSummary state={details.checksState} />}
          {review && review !== status?.label && <Badge variant="outline" className="pr-review-badge">{review}</Badge>}
          {live?.autoMerge && <Badge variant="outline" className="pr-auto-merge-badge">Auto-merge · {MERGE_METHOD_LABELS[live.autoMerge.method]}</Badge>}
          {liveQuery.isError && <PullRequestLiveNotice error={liveQuery.error} hasState={live !== null} open={details.state === 'OPEN'} retrying={liveQuery.isFetching} onRetry={() => void liveQuery.refetch()} />}
          {live && <PullRequestActionBar repositoryId={repositoryId} details={details} live={live} refreshing={liveQuery.isFetching} statusLabel={status?.label ?? null} onRefresh={() => void liveQuery.refetch()} onEdit={() => setEditing(true)} onSelectPullRequest={onSelectPullRequest} />}
        </div>
        {details.labels.length > 0 && (
          <div className="pr-labels" aria-label="Pull request labels">
            <IconTag aria-hidden="true" />
            {details.labels.map((label) => (
              <span key={`${label.name}-${label.color}`} className="pr-label" style={{ borderColor: `#${label.color}`, backgroundColor: `#${label.color}22` }}>{label.name}</span>
            ))}
          </div>
        )}
        </div>
        <ViewerTabsList
          label="Pull request view"
          className="markdown-viewer-tabs pr-viewer-tabs"
          items={[
            { value: 'summary', label: 'Summary' },
            { value: 'timeline', label: 'Timeline' },
            { value: 'diff', label: 'Code' },
          ]}
        />
      </header>
      <ViewerTabsPanel value="summary" className="markdown-preview-scroll pr-description-scroll">
          <section className="pr-summary-section">
            {bodyHtml
              ? <LinkedMarkdown html={bodyHtml} />
              : <p className="pr-empty-description">This pull request has no description.</p>}
          </section>
      </ViewerTabsPanel>
      <ViewerTabsPanel value="timeline" className="markdown-preview-scroll pr-description-scroll">
          <section className="pr-timeline standalone" aria-label="Commit timeline">
            <h3><IconGitCommit aria-hidden="true" /> Commits <span>{commits.length}{commitsIncomplete ? '+' : ''}</span></h3>
            {commitsIncomplete && !commitsQuery.isFetching && (
              <p className="pr-empty-description">Showing the first {commits.length} commits from GitHub. The rest could not be read from the local clone.</p>
            )}
            {commits.length ? commits.map((commit) => (
              <article key={commit.oid} className="pr-timeline-item">
                <span className="pr-timeline-rail"><span /></span>
                <GitHubAvatar src={commit.authorAvatarUrl} className="pr-commit-avatar" />
                <span className="pr-commit-content">
                  <strong><LinkedText text={commit.messageHeadline || '(no commit message)'} /></strong>
                  <span><b>{commit.author}</b> committed <time dateTime={commit.authoredAt}>{formatDateTime(commit.authoredAt)}</time></span>
                </span>
                <Tooltip>
                  <TooltipTrigger render={<code />}>{commit.oid.slice(0, 7)}</TooltipTrigger>
                  <TooltipContent>{commit.oid}</TooltipContent>
                </Tooltip>
              </article>
            )) : <p className="pr-empty-description">No commits were returned by GitHub.</p>}
          </section>
      </ViewerTabsPanel>
      <ViewerTabsPanel value="diff" className="pr-diff-panel">
        {diffError ? (
          <div className="viewer-message flex-col gap-3">
            <p className="pr-diff-error text-destructive">{diffError}</p>
            <Button variant="outline" size="sm" onClick={() => void diffQuery.refetch()}><IconRefresh /> Try again</Button>
          </div>
        ) : !diff ? (
          <div className="viewer-message"><IconLoader4 className="spinner" /> <ShimmeringText text="Loading diff…" /></div>
        ) : (
          <Suspense fallback={<div className="viewer-message"><IconLoader4 className="spinner" /> <ShimmeringText text="Loading diff viewer…" /></div>}>
            <PullRequestDiff diff={diff} prNumber={details.number} repositoryId={repositoryId} commits={commits} diffView={diffView} themeType={themeType} wrapLines={wrapLines} onDiffViewChange={onDiffViewChange} onWrapLinesChange={onWrapLinesChange} onClose={onClose} />
          </Suspense>
        )}
      </ViewerTabsPanel>
      {editing && live && <EditPullRequestDialog repositoryId={repositoryId} details={details} expectedUpdatedAt={live.updatedAt} onClose={() => setEditing(false)} />}
    </ViewerTabs>
  );
}

function PullRequestStatusIcon({ tone }: { tone: PullRequestStatusTone }) {
  if (tone === 'ready') return <IconCircleCheck aria-hidden="true" />;
  if (tone === 'danger') return <IconCircleX aria-hidden="true" />;
  if (tone === 'progress') return <IconLoader4 className="animate-spin" aria-hidden="true" />;
  return <IconAlertTriangle aria-hidden="true" />;
}

function PullRequestLiveNotice({ error, hasState, open, retrying, onRetry }: { error: Error; hasState: boolean; open: boolean; retrying: boolean; onRetry(): void }) {
  const message = ghDetail(error)?.code === 'GH_RATE_LIMITED'
    ? 'GitHub rate limit reached. Checks resume when you return to this window.'
    : hasState ? "Couldn't refresh. Showing the last status." : open ? "Actions unavailable: couldn't load the current status." : "Couldn't load the current status.";
  return (
    <span className="pr-live-notice" role="status">
      {message}
      <Button variant="ghost" size="xs" disabled={retrying} onClick={onRetry}>Retry</Button>
    </span>
  );
}
