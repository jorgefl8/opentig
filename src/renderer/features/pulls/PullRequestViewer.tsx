import { formatDateTime } from '@shared/date-format';
import { PullRequestStackMenu } from './PullRequestStackMenu';
import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { lazyWithRetry } from '@/lib/lazy-with-retry';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IconExternalLink, IconLoader4, IconRefresh } from '@tabler/icons-react';
import { GITHUB_PR_COMMIT_PAGE, type DiffResult, type DiffViewPreference, type PullRequestCommitList, type PullRequestDetails, type PullRequestLatestReview, type PullRequestLiveState, type ThemePreference } from '../../../shared/contracts';
import { pullRequestStateLine, pullRequestStatusLine } from '../../../shared/pull-request-actions';
import { Button } from '@/components/ui/button';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ViewerTabs, ViewerTabsList, ViewerTabsPanel } from '@/components/ui/viewer-tabs';
import { LinkedMarkdown } from '@/features/markdown/LinkedMarkdown';
import { LinkedText } from '@/components/LinkedText';
import { MobileViewerActions, MobileViewerTitle } from '@/components/MobileChrome';
import { useMobileChrome } from '@/components/mobile-chrome-context';
import type { PullRequestTab } from '@/lib/mobile-main-action';

import { ghDetail, MERGE_METHOD_LABELS, openOnGitHub, reviewDecisionLabel } from './gh-utils';
import { GitHubAvatar } from './GitHubAvatar';
import { PullRequestActionBar } from './PullRequestActionBar';
import { PullRequestConversationView } from './PullRequestConversationView';
import { PullRequestChecksLink, PullRequestChecksPanel, PullRequestChecksSummary } from './PullRequestChecks';
import { PullRequestEditor } from './PullRequestEditor';
import { hasViewerDraft, pullRequestCommentDraft, pullRequestEditDraft, useViewerDraft } from './viewer-drafts';
import { pullRequestLiveStateQueryOptions, queriesOutdatedByLiveState } from './pull-request-live-state-query';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import '@/features/markdown/markdown.css';

const PullRequestDiff = lazyWithRetry(() => import('./PullRequestDiff'));

interface PullRequestViewerProps {
  repositoryId: string;
  prNumber: number;
  diffView: DiffViewPreference;
  themeType: ThemePreference;
  wrapLines: boolean;
  onDiffViewChange(value: DiffViewPreference): void;
  onWrapLinesChange(value: boolean): void;
  onClose(): void;
  onOpenFile?: ((path: string) => void) | undefined;
  onSelectPullRequest(number: number): void;
}

export function PullRequestViewer({ repositoryId, prNumber, diffView, themeType, wrapLines, onDiffViewChange, onWrapLinesChange, onClose, onOpenFile, onSelectPullRequest }: PullRequestViewerProps) {
  const [tab, setTab] = useState<PullRequestTab>('summary');
  const [editing, setEditing] = useState(() => hasViewerDraft(pullRequestEditDraft(repositoryId, prNumber)));
  const [commentDraft, setCommentDraft] = useViewerDraft(pullRequestCommentDraft(repositoryId, prNumber), () => '');
  const header = useRef<HTMLElement>(null);
  const phone = useMobileChrome() !== null;
  const scroller = useRef<HTMLDivElement>(null);
  const overview = useRef<HTMLDivElement>(null);
  const closeEditor = () => {
    setEditing(false);
    // The menu that opened the editor comes back with the header, or in the top bar on a phone.
    requestAnimationFrame(() => (header.current?.querySelector<HTMLElement>('.pr-more-actions') ?? document.querySelector<HTMLElement>('.mobile-toolbar .pr-more-actions'))?.focus());
  };
  // On a phone the tabs stay stuck when changing panel, which starts right under them.
  useLayoutEffect(() => {
    if (phone && scroller.current && overview.current) scroller.current.scrollTop = Math.min(scroller.current.scrollTop, overview.current.offsetHeight);
  }, [phone, tab]);
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
    enabled: firstPageOnly && (tab === 'timeline' || tab === 'diff'),
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

  const bar = <MobileViewerTitle title={`#${prNumber}`} subtitle={details && <span className="mobile-viewer-mono">{details.headRefName} → {details.baseRefName}</span>} />;
  if (detailsError) {
    return (
      <div className="viewer-message flex-col gap-3">
        {bar}
        <p className="text-destructive">{detailsError}</p>
        <Button variant="outline" size="sm" onClick={() => void detailsQuery.refetch()}><IconRefresh /> Try again</Button>
      </div>
    );
  }
  if (!details) {
    return <div className="viewer-message">{bar}<IconLoader4 className="spinner" /> <ShimmeringText text={`Loading pull request #${prNumber}…`} /></div>;
  }

  if (editing && live) {
    return <>{bar}<PullRequestEditor repositoryId={repositoryId} details={details} onClose={closeEditor} /></>;
  }

  const review = reviewDecisionLabel(live ? live.reviewDecision : details.reviewDecision);
  const status = live ? pullRequestStatusLine(live) ?? pullRequestStateLine(live) : pullRequestStateLine(details);
  const reviewers = live?.latestReviews ?? [];
  const counters = (
    <span className="pr-counters">
      {details.changedFiles} {details.changedFiles === 1 ? 'file' : 'files'}
      {' '}<span className="add">+{details.additions}</span> <span className="del">−{details.deletions}</span>
    </span>
  );
  const labelsAndStack = <>
    {details.labels.length > 0 && <span className="pr-labels" aria-label="Pull request labels">{details.labels.map((label) => label.name).join(', ')}</span>}
    {details.stack && <PullRequestStackMenu repositoryId={repositoryId} number={prNumber} membership={details.stack} onSelect={onSelectPullRequest} />}
  </>;
  const updated = <span>updated <time dateTime={details.updatedAt}>{formatDateTime(details.updatedAt)}</time></span>;
  return (
    <ViewerTabs ref={scroller} value={tab} onValueChange={(value) => setTab(value as typeof tab)} className="pr-viewer" data-tab={tab}>
      {bar}
      <header ref={header} className="pr-viewer-header">
        <div ref={overview} className="pr-viewer-overview">
          <div className="pr-viewer-top">
            <div className="pr-viewer-heading">
              <h2><LinkedText text={details.title || '(no title)'} />{!phone && <> <span className="pr-number">#{details.number}</span></>}</h2>
              {!phone && <div className="pr-viewer-meta">
                <span className="pr-branches">{details.headRefName} → {details.baseRefName}</span>
                {counters}
                <span>{details.author}</span>
                {updated}
                {labelsAndStack}
              </div>}
            </div>
            {live
              ? <PullRequestActionBar repositoryId={repositoryId} details={details} live={live} refreshing={liveQuery.isFetching} statusLabel={status.label} tab={tab} onRefresh={() => void liveQuery.refetch()} onEdit={() => setEditing(true)} onSelectPullRequest={onSelectPullRequest} />
              : details.url && (phone
                ? <MobileViewerActions><Button variant="ghost" size="icon" className="mobile-bar-button" onClick={() => openOnGitHub(details.url)} aria-label="Open on GitHub"><IconExternalLink /></Button></MobileViewerActions>
                : <Tooltip>
                  <TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button" onClick={() => openOnGitHub(details.url)} aria-label="Open on GitHub" />}><IconExternalLink /></TooltipTrigger>
                  <TooltipContent>Open on GitHub</TooltipContent>
                </Tooltip>)}
          </div>
          <div className="pr-viewer-status">
            {liveQuery.isPending && details.state === 'OPEN'
              ? <span className="pr-status tone-progress" role="status"><span className="status-dot" aria-hidden="true" /> <ShimmeringText text="Checking status…" /></span>
              : <span className={`pr-status tone-${status.tone}`} role="status"><span className="status-dot" aria-hidden="true" /> {status.label}</span>}
            {status.detail && <span>{status.detail}</span>}
            {live ? <PullRequestChecksLink checks={live.checks} onOpen={() => setTab('checks')} /> : <PullRequestChecksSummary state={details.checksState} />}
            {review && review !== status.label && !reviewers.some((reviewer) => verdictLabel(reviewer) === review) && <span className="pr-review">{review}</span>}
            {reviewers.map((reviewer) => <span key={reviewer.author.login} className="pr-reviewer">{verdictLabel(reviewer)} by {reviewer.author.login}{reviewer.outdated ? ', before the latest commit' : ''}</span>)}
            {live?.autoMerge && <span className="pr-auto-merge">Auto-merge · {MERGE_METHOD_LABELS[live.autoMerge.method]}</span>}
            {liveQuery.isError && <PullRequestLiveNotice error={liveQuery.error} hasState={live !== null} open={details.state === 'OPEN'} retrying={liveQuery.isFetching} onRetry={() => void liveQuery.refetch()} />}
          </div>
          {phone && <div className="pr-viewer-meta">
            <span>{details.author}</span>
            {updated}
            {counters}
            {labelsAndStack}
          </div>}
        </div>
        <ViewerTabsList
          label="Pull request view"
          className="pr-viewer-tabs"
          items={[
            { value: 'summary', label: 'Summary' },
            { value: 'comments', label: 'Comments' },
            { value: 'checks', label: 'Checks' },
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
      <ViewerTabsPanel value="comments" className="markdown-preview-scroll pr-description-scroll">
          <PullRequestConversationView repositoryId={repositoryId} number={details.number} url={details.url} live={live} draft={commentDraft} onDraftChange={setCommentDraft} />
      </ViewerTabsPanel>
      <ViewerTabsPanel value="checks" className="markdown-preview-scroll pr-description-scroll">
          <PullRequestChecksPanel checks={live?.checks ?? null} loading={liveQuery.isPending} url={details.url} />
      </ViewerTabsPanel>
      <ViewerTabsPanel value="timeline" className="markdown-preview-scroll pr-description-scroll">
          <section className="pr-timeline standalone" aria-label="Commit timeline">
            <h3>Commits <span className="plain-count">{commits.length}{commitsIncomplete ? '+' : ''}</span></h3>
            {commitsIncomplete && !commitsQuery.isFetching && (
              <p className="pr-empty-description">Showing the first {commits.length} commits from GitHub. The rest could not be read from the local clone.</p>
            )}
            {commits.length ? commits.map((commit) => (
              <article key={commit.oid} className="pr-timeline-item">
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
            <PullRequestDiff diff={diff} prNumber={details.number} repositoryId={repositoryId} commits={commits} diffView={diffView} themeType={themeType} wrapLines={wrapLines} onDiffViewChange={onDiffViewChange} onWrapLinesChange={onWrapLinesChange} onClose={onClose} onOpenFile={onOpenFile} />
          </Suspense>
        )}
      </ViewerTabsPanel>
    </ViewerTabs>
  );
}

function verdictLabel(review: PullRequestLatestReview): string {
  return review.verdict === 'APPROVED' ? 'Approved' : 'Changes requested';
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
