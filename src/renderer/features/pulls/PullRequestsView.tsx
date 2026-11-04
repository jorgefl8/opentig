import type { GitHubRepositoryAccount } from '@shared/github-accounts';
import { formatTimeAgo } from '@shared/date-format';
import { PullRequestStackMenu } from './PullRequestStackMenu';
import { Suspense, useEffect, useRef } from 'react';
import { lazyWithPreload } from '@/lib/lazy-with-retry';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { IconBrandGithub, IconCopy, IconExternalLink, IconFilter, IconLoader4, IconPlus, IconRefresh } from '@tabler/icons-react';
import type { GhCliStatus, GitHubRepositoryInfo, PullRequestLiveState, PullRequestState, PullRequestSummary } from '../../../shared/contracts';
import { pullRequestStateLine, pullRequestStatusLine, pullRequestSummaryStatus } from '../../../shared/pull-request-actions';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useMobileLayout } from '@/lib/use-mobile-layout';
import { ViewerTabs, ViewerTabsList, ViewerTabsPanel } from '@/components/ui/viewer-tabs';
import { openOnGitHub } from './gh-utils';
import { GitHubAvatar } from './GitHubAvatar';
import { GitHubSectionMenu } from './GitHubSectionMenu';
import { pullRequestLiveStateQueryOptions } from './pull-request-live-state-query';
import { LazyPullRequestViewer } from './pull-request-viewer-chunks';

const ReleasesView = lazyWithPreload(() => import('./ReleasesView').then((module) => ({ default: module.ReleasesView })));
const ReleasesTools = lazyWithPreload(() => import('./ReleasesView').then((module) => ({ default: module.ReleasesTools })));

export type PullRequestsSection = 'pulls' | 'releases';

/** Two lines of text and the row's padding; rows are measured once rendered. */
const PULL_ROW_HEIGHT = 49;
const MOBILE_PULL_ROW_HEIGHT = 60;

interface PullRequestsViewProps {
  repositoryId: string;
  account: GitHubRepositoryAccount | null;
  onOpenGitHubSettings(): void;
  info: GitHubRepositoryInfo | null;
  ghStatus: GhCliStatus | null;
  pulls: PullRequestSummary[] | null;
  loading: boolean;
  error: string | null;
  states: PullRequestState[];
  activeNumber: number | null;
  createDisabledReason: string | null;
  onRefresh(): void;
  onStateChange(state: PullRequestState, checked: boolean): void;
  onSelect(number: number): void;
  onCreate(): void;
  onCopyCommand(command: string): void;
  section: PullRequestsSection;
  onSectionChange(section: PullRequestsSection): void;
  activeRelease: string | null;
  onSelectRelease(tagName: string): void;
}

export function PullRequestsView(props: PullRequestsViewProps) {
  // So opening a PR or the Releases tab doesn't wait for its code.
  useEffect(() => { LazyPullRequestViewer.preload(); ReleasesView.preload(); ReleasesTools.preload(); }, []);
  if (props.info === null) {
    return <div className="view-loading" role="status"><IconLoader4 className="spinner" /> <ShimmeringText text="Checking repository…" /></div>;
  }
  if (!props.info.isGitHub) {
    return (
      <PullsNotice icon={<IconBrandGithub />} title="Not a GitHub repository">
        The <code>origin</code> remote does not point to github.com, so pull requests are unavailable here.
      </PullsNotice>
    );
  }
  if (props.account?.state === 'error' || (props.error && props.ghStatus === null)) {
    return <PullsNotice icon={<IconBrandGithub />} title="GitHub account unavailable">
      {props.account?.message ?? props.error}
      <span className="pulls-notice-actions"><Button variant="outline" size="sm" onClick={props.onOpenGitHubSettings}>Open GitHub settings</Button><Button variant="ghost" size="sm" onClick={props.onRefresh}><IconRefresh /> Check again</Button></span>
    </PullsNotice>;
  }
  if (props.ghStatus === null) {
    return <div className="view-loading" role="status"><IconLoader4 className="spinner" /> <ShimmeringText text="Checking GitHub CLI…" /></div>;
  }
  if (!props.ghStatus.installed) {
    return (
      <PullsNotice icon={<IconBrandGithub />} title="GitHub CLI is required">
        OpenTig uses your local <code>gh</code> session to read and create pull requests. It does not copy or store credentials.
        <span className="pulls-notice-actions">
          <Button variant="outline" size="sm" onClick={() => props.onCopyCommand('winget install GitHub.cli')}><IconCopy /> Copy install command</Button>
          <Button variant="ghost" size="sm" onClick={props.onRefresh}><IconRefresh /> Check again</Button>
        </span>
        <small>Download from cli.github.com, then check again.</small>
      </PullsNotice>
    );
  }
  if (props.ghStatus.authStatus === 'unauthenticated') {
    return (
      <PullsNotice icon={<IconBrandGithub />} title="Sign in to GitHub CLI">
        Run <code>gh auth login</code> in a terminal to authenticate, then check again.
        <span className="pulls-notice-actions">
          <Button variant="outline" size="sm" onClick={() => props.onCopyCommand('gh auth login')}><IconCopy /> Copy command</Button>
          <Button variant="ghost" size="sm" onClick={props.onRefresh}><IconRefresh /> Check again</Button>
        </span>
      </PullsNotice>
    );
  }
  return (
    <ViewerTabs value={props.section} onValueChange={props.onSectionChange} className="pulls-section">
      <div className="pulls-section-head">
        <ViewerTabsList label="GitHub" items={[{ value: 'pulls', label: 'Pull requests' }, { value: 'releases', label: 'Releases' }]} />
        <span className="pulls-section-tools">
          {props.section === 'pulls'
            ? <PullsTools {...props} nameWithOwner={props.info.nameWithOwner} />
            : <Suspense fallback={null}><ReleasesTools repositoryId={props.repositoryId} nameWithOwner={props.info.nameWithOwner} account={props.account} onOpenGitHubSettings={props.onOpenGitHubSettings} onSelect={props.onSelectRelease} /></Suspense>}
        </span>
      </div>
      <ViewerTabsPanel value="pulls" className="pulls-section-panel" tabIndex={-1}><PullsList {...props} /></ViewerTabsPanel>
      <ViewerTabsPanel value="releases" className="pulls-section-panel" tabIndex={-1}>
        <Suspense fallback={<div className="view-loading" role="status"><IconLoader4 className="spinner" /> <ShimmeringText text="Loading releases…" /></div>}>
          <ReleasesView repositoryId={props.repositoryId} activeTag={props.activeRelease} onSelect={props.onSelectRelease} />
        </Suspense>
      </ViewerTabsPanel>
    </ViewerTabs>
  );
}

function PullsTools(props: PullRequestsViewProps & { nameWithOwner: string | null }) {
  return (
    <>
      <GitHubSectionMenu
        label="Filter pull requests"
        icon={<IconFilter />}
        filtered={!isDefaultStateFilter(props.states)}
        refreshing={props.loading}
        refreshLabel="Refresh pull requests"
        onRefresh={props.onRefresh}
        nameWithOwner={props.nameWithOwner}
        githubPath="pulls"
        account={props.account}
        onOpenGitHubSettings={props.onOpenGitHubSettings}
      >
        <span className="pulls-filter-title">State</span>
        {(['OPEN', 'CLOSED', 'MERGED'] as PullRequestState[]).map((state) => (
          <label key={state} htmlFor={`pulls-state-${state.toLowerCase()}`} className="pulls-filter-option">
            <Checkbox
              id={`pulls-state-${state.toLowerCase()}`}
              checked={props.states.includes(state)}
              onCheckedChange={(checked) => props.onStateChange(state, checked === true)}
            />
            <span>{stateLabel(state)}</span>
          </label>
        ))}
        <span className="pulls-menu-separator" />
      </GitHubSectionMenu>
      <Tooltip>
        <TooltipTrigger render={
          <Button variant="ghost" size="icon-xs" className="change-action-button" disabled={Boolean(props.createDisabledReason) || props.loading} focusableWhenDisabled onClick={props.onCreate} aria-label="Create pull request" />
        }>
          <IconPlus />
        </TooltipTrigger>
        <TooltipContent>{props.createDisabledReason ?? 'Create a pull request from the current branch'}</TooltipContent>
      </Tooltip>
    </>
  );
}

function PullsList(props: PullRequestsViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const mobile = useMobileLayout();
  const pulls = props.pulls;
  // Never asks GitHub: this only reads what the viewer of the selected PR keeps current.
  const activeLive = useQuery(pullRequestLiveStateQueryOptions(props.repositoryId, props.activeNumber ?? -1, false)).data ?? null;
  // oxlint-disable-next-line react/incompatible-library -- TanStack Virtual is intentionally imperative.
  const virtualizer = useVirtualizer({
    count: pulls?.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => mobile ? MOBILE_PULL_ROW_HEIGHT : PULL_ROW_HEIGHT,
    getItemKey: (index) => pulls?.[index]?.number ?? index,
    overscan: 8,
  });
  return (
    <div className="pulls-view">
      {props.error && (
        <div className="pulls-error" role="alert">
          <span>{props.error}</span>
          <Button variant="ghost" size="xs" onClick={props.onRefresh}>Retry</Button>
        </div>
      )}
      <div ref={scrollRef} className="pulls-scroll" role="list" aria-label={`${props.states.map(stateLabel).join(', ') || 'No'} pull requests`}>
        {pulls === null && !props.error ? (
          <div className="view-loading" role="status"><IconLoader4 className="spinner" /> <ShimmeringText text="Loading pull requests…" /></div>
        ) : pulls !== null && pulls.length === 0 ? (
          <p className="empty-list">{props.states.length ? `No ${props.states.map((state) => stateLabel(state).toLowerCase()).join(', ')} pull requests.` : 'Select at least one PR state.'}</p>
        ) : pulls !== null && (
          <div className="virtual-list" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const pr = pulls[virtualRow.index]!;
              const active = props.activeNumber === pr.number;
              return (
                <div
                  key={virtualRow.key}
                  ref={virtualizer.measureElement}
                  data-index={virtualRow.index}
                  className="virtual-row"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <PullRow repositoryId={props.repositoryId} pr={pr} active={active} live={active ? activeLive : null} phone={mobile} onSelect={props.onSelect} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function PullRow({ repositoryId, pr, active, live, phone, onSelect }: { repositoryId: string; pr: PullRequestSummary; active: boolean; live: PullRequestLiveState | null; phone: boolean; onSelect(number: number): void }) {
  // The selected row agrees with the viewer beside it; the others say what the list knows.
  const status = live ? pullRequestStatusLine(live) ?? pullRequestStateLine(live) : pullRequestSummaryStatus(pr);
  return (
    <div className={`pull-item ${active ? 'active' : ''}`} role="listitem">
      <button className="pull-main" onClick={() => onSelect(pr.number)}>
        <span className="pull-avatar-status">
          <GitHubAvatar key={pr.authorAvatarUrl} src={pr.authorAvatarUrl} className="pull-avatar" />
          <span className={`status-dot tone-${status.tone}`} aria-hidden="true" />
        </span>
        <span className="pull-line">
          <span className="pull-title">{pr.title || '(no title)'}</span>
          <time className="pull-age" dateTime={pr.updatedAt}>{formatTimeAgo(pr.updatedAt)}</time>
        </span>
        <span className="pull-line">
          <span className="pull-meta">#{pr.number} · {status.label}{phone && pr.stack && ` · Layer ${pr.stack.position} of ${pr.stack.size}`}</span>
          <span className="pull-author">· {pr.author}</span>
          <span className="pull-lines"><span className="add">+{pr.additions}</span> <span className="del">−{pr.deletions}</span></span>
        </span>
      </button>
      {/* On a phone the whole row is the target, and the viewer has its stack and link. */}
      {!phone && pr.stack && <PullRequestStackMenu repositoryId={repositoryId} number={pr.number} membership={pr.stack} onSelect={onSelect} />}
      {!phone && pr.url && <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button pull-open-external" onClick={() => openOnGitHub(pr.url)} aria-label={`Open #${pr.number} on GitHub`} />}>
          <IconExternalLink />
        </TooltipTrigger>
        <TooltipContent>Open on GitHub</TooltipContent>
      </Tooltip>}
    </div>
  );
}

function stateLabel(state: PullRequestState): string {
  return state === 'OPEN' ? 'Open' : state === 'CLOSED' ? 'Closed' : 'Merged';
}

function isDefaultStateFilter(states: PullRequestState[]): boolean {
  return states.length === 1 && states[0] === 'OPEN';
}

function PullsNotice({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="pulls-notice">
      <span className="pulls-notice-icon" aria-hidden="true">{icon}</span>
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}
