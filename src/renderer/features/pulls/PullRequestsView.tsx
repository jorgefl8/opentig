import { useRef } from 'react';
import { Popover } from '@base-ui/react/popover';
import { useVirtualizer } from '@tanstack/react-virtual';
import { IconBrandGithub, IconCircleCheck, IconCircleX, IconClock, IconCopy, IconExternalLink, IconFilter, IconGitMerge, IconGitPullRequest, IconLoader4, IconPlus, IconRefresh } from '@tabler/icons-react';
import type { GhCliStatus, GitHubRepositoryInfo, PullRequestCheckState, PullRequestState, PullRequestSummary } from '../../../shared/contracts';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { openOnGitHub } from './gh-utils';
import { GitHubAvatar } from './GitHubAvatar';

interface PullRequestsViewProps {
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
  onSelect(pr: PullRequestSummary): void;
  onCreate(): void;
  onCopyCommand(command: string): void;
}

export function PullRequestsView(props: PullRequestsViewProps) {
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
  if (props.ghStatus === null) {
    return <div className="view-loading" role="status"><IconLoader4 className="spinner" /> <ShimmeringText text="Checking GitHub CLI…" /></div>;
  }
  if (!props.ghStatus.installed) {
    return (
      <PullsNotice icon={<IconBrandGithub />} title="GitHub CLI is required">
        JustGit uses your local <code>gh</code> session to read and create pull requests. It does not copy or store credentials.
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
  return <PullsList {...props} nameWithOwner={props.info.nameWithOwner ?? ''} />;
}

function PullsList(props: PullRequestsViewProps & { nameWithOwner: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pulls = props.pulls;
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is intentionally imperative.
  const virtualizer = useVirtualizer({
    count: pulls?.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 68,
    getItemKey: (index) => pulls?.[index]?.number ?? index,
    overscan: 8,
  });
  return (
    <div className="pulls-view">
      <div className="pulls-toolbar">
        <span className="pulls-repo" title={props.nameWithOwner}><IconBrandGithub aria-hidden="true" /> {props.nameWithOwner}</span>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button" disabled={props.loading} onClick={props.onRefresh} aria-label="Refresh pull requests" />}>
            {props.loading ? <IconLoader4 className="animate-spin" /> : <IconRefresh />}
          </TooltipTrigger>
          <TooltipContent>Refresh pull requests</TooltipContent>
        </Tooltip>
        <Popover.Root>
          <Popover.Trigger
            render={<Button variant={isDefaultStateFilter(props.states) ? 'ghost' : 'secondary'} size="icon-xs" className="change-action-button" aria-label="Filter pull requests" aria-pressed={!isDefaultStateFilter(props.states)} />}
          >
            <IconFilter />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner side="bottom" align="end" sideOffset={4} className="isolate z-50 outline-none">
              <Popover.Popup className="pulls-filter-popup">
                <span className="pulls-filter-title">State</span>
                {(['OPEN', 'CLOSED', 'MERGED'] as PullRequestState[]).map((state) => (
                  <label key={state} htmlFor={`pulls-state-${state.toLowerCase()}`} className="pulls-filter-option">
                    <Checkbox
                      id={`pulls-state-${state.toLowerCase()}`}
                      checked={props.states.includes(state)}
                      onCheckedChange={(checked) => props.onStateChange(state, checked === true)}
                    />
                    <PullStateIcon state={state} className={state.toLowerCase()} />
                    <span>{state === 'OPEN' ? 'Open' : state === 'CLOSED' ? 'Closed' : 'Merged'}</span>
                  </label>
                ))}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
        <Tooltip>
          <TooltipTrigger render={
            <Button variant="outline" size="xs" disabled={Boolean(props.createDisabledReason) || props.loading} onClick={props.onCreate} aria-label="Create pull request" />
          }>
            <IconPlus /> New
          </TooltipTrigger>
          <TooltipContent>{props.createDisabledReason ?? 'Create a pull request from the current branch'}</TooltipContent>
        </Tooltip>
      </div>
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
              return (
                <div
                  key={virtualRow.key}
                  ref={virtualizer.measureElement}
                  data-index={virtualRow.index}
                  className="virtual-row"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <PullRow pr={pr} active={props.activeNumber === pr.number} onSelect={props.onSelect} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function PullRow({ pr, active, onSelect }: { pr: PullRequestSummary; active: boolean; onSelect(pr: PullRequestSummary): void }) {
  const stateClass = pr.state.toLowerCase();
  const relativeUpdate = formatRelativeUpdate(pr.updatedAt);
  return (
    <div className={`pull-item ${active ? 'active' : ''}`} role="listitem">
      <button className="pull-main" onClick={() => onSelect(pr)} aria-label={`View pull request #${pr.number}`}>
        <span className={`pull-state-icon ${stateClass}${pr.isDraft ? ' draft' : ''}`} title={pr.isDraft ? 'Draft' : stateLabel(pr.state)}><PullStateIcon state={pr.state} /></span>
        <span className="pull-content">
          <span className="pull-title">{pr.title || '(no title)'}</span>
          <span className="pull-meta">
            <span className="pull-number">#{pr.number}</span>
            <GitHubAvatar src={pr.authorAvatarUrl} className="pull-avatar" />
            <span className="pull-author">{pr.author}</span>
            <ChecksIcon state={pr.checksState} />
            {pr.isDraft && <span className="pull-draft-label">Draft</span>}
          </span>
        </span>
        <span className="pull-row-aside">
          {relativeUpdate && <span>{relativeUpdate}</span>}
          <span className="pull-line-stats"><span className="add">+{pr.additions}</span> <span className="del">−{pr.deletions}</span></span>
        </span>
      </button>
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button pull-open-external" onClick={() => openOnGitHub(pr.url)} aria-label={`Open #${pr.number} on GitHub`} />}>
          <IconExternalLink />
        </TooltipTrigger>
        <TooltipContent>Open on GitHub</TooltipContent>
      </Tooltip>
    </div>
  );
}

function PullStateIcon({ state, className }: { state: PullRequestState; className?: string }) {
  return state === 'MERGED' ? <IconGitMerge aria-hidden="true" className={className} /> : <IconGitPullRequest aria-hidden="true" className={className} />;
}

function ChecksIcon({ state }: { state: PullRequestCheckState }) {
  if (state === 'NONE') return null;
  const label = state === 'PASSING' ? 'Checks passing' : state === 'FAILING' ? 'Checks failing' : 'Checks pending';
  const Icon = state === 'PASSING' ? IconCircleCheck : state === 'FAILING' ? IconCircleX : IconClock;
  return <span className={`pull-checks ${state.toLowerCase()}`} title={label} aria-label={label}><Icon aria-hidden="true" /></span>;
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

const RELATIVE_DATE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3_600], ['minute', 60],
];

function formatRelativeUpdate(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return RELATIVE_DATE.format(Math.trunc(seconds / size), unit);
  }
  return 'right now';
}
