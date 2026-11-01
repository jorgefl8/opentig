import { useEffect, useRef, type ReactNode } from 'react';
import { IconArrowDown, IconArrowLeft, IconArrowUp, IconBrandGithub, IconFolder, IconGitBranch, IconHierarchy2, IconLoader4, IconPlus, IconRefresh, IconSelector, IconSettings } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { isDevProfile } from '@/lib/app-identity';
import { AppName } from '@/components/AppName';
import { OpenTigMark } from '@/components/OpenTigMark';
import { MobileSheet } from '@/components/MobileSheet';
import { DesktopUpdateIndicator } from '@/features/settings/UpdateSettings';
import { openOnGitHub } from '@/features/pulls/gh-utils';
import { mobileSyncPill, needsBranchPublication } from '@/features/repositories/project-sync';
import type { ToolbarProps } from './Toolbar';
import { RemoteAccessIndicator } from './RemoteAccessIndicator';
import { BranchPullRequestMenu } from './BranchPullRequestMenu';

export interface MobileViewerBarProps {
  onBack(): void;
  /** Where the viewer's title and actions go. */
  setTitleHost(element: HTMLElement | null): void;
  setActionsHost(element: HTMLElement | null): void;
}

/** Focus lands on the arrow when a viewer opens, so a keyboard or screen reader starts from the way out. */
function MobileViewerBar({ onBack, setTitleHost, setActionsHost, indicators, loadIndicator }: MobileViewerBarProps & { indicators: ReactNode; loadIndicator: ReactNode }) {
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { backRef.current?.focus(); }, []);
  return (
    <header className="mobile-toolbar in-viewer">
      <button ref={backRef} type="button" className="mobile-bar-button" aria-label="Back" onClick={onBack}><IconArrowLeft aria-hidden="true" /></button>
      <div ref={setTitleHost} className="mobile-viewer-title-slot" />
      <div className="mobile-toolbar-actions">
        <div ref={setActionsHost} className="contents" />
        {indicators}
      </div>
      {loadIndicator}
    </header>
  );
}

const commitCount = (count: number) => `${count} ${count === 1 ? 'commit' : 'commits'}`;

/** On a list, where you are and what to sync. Inside a viewer, a back arrow plus what that viewer puts in the bar's two slots. */
export function MobileToolbar({ props, repositoryControl, worktreeControl, branchControl, pendingRepositoryName, loadIndicator, contextOpen, onContextOpen, syncBusy }: {
  props: ToolbarProps;
  repositoryControl: ReactNode;
  worktreeControl: ReactNode;
  branchControl: ReactNode;
  pendingRepositoryName: string | null;
  loadIndicator: ReactNode;
  contextOpen: boolean;
  onContextOpen(open: boolean): void;
  syncBusy: boolean;
}) {
  const viewer = props.mobileViewer;
  const status = props.status;
  const publish = needsBranchPublication(status);
  const syncDisabled = Boolean(props.busy) || syncBusy || !status || status.readOnly || status.unborn || status.detached;
  const pill = mobileSyncPill(status);
  const runPill = pill && (pill.action === 'pull' ? props.onPull : props.onPush);
  const pillRunning = pill && props.busy === (pill.action === 'pull' ? 'pull' : 'push');
  const contextAction = (action: () => void) => { onContextOpen(false); action(); };
  const indicators = <>
    {props.remoteProblem && <RemoteAccessIndicator compact problem={props.remoteProblem.access} message={props.remoteProblem.message} onAction={props.onRemoteAccessAction} />}
    <DesktopUpdateIndicator />
  </>;
  return <>
    {viewer ? <MobileViewerBar {...viewer} indicators={indicators} loadIndicator={loadIndicator} /> : (
      <header className="mobile-toolbar">
        <span className="mobile-toolbar-mark"><OpenTigMark /></span>
        <button className="mobile-repository-context" aria-label="Repository and branch" aria-haspopup="dialog" aria-expanded={contextOpen} onClick={() => onContextOpen(true)}>
          <strong><span>{pendingRepositoryName ? `Opening ${pendingRepositoryName}…` : props.repository.repositoryName}</span>{props.repositoryLoadPhase ? <IconLoader4 className="animate-spin" aria-hidden="true" /> : <IconSelector aria-hidden="true" />}</strong>
          <small>{status ? status.branch ?? 'Detached HEAD' : 'Loading…'}{props.branchPullRequest && ` · #${props.branchPullRequest.number}`}</small>
        </button>
        <div className="mobile-toolbar-actions">
          {isDevProfile && <AppName />}
          {indicators}
          {pill && runPill && (
            <button type="button" className="mobile-sync-pill" disabled={Boolean(props.busy) || syncBusy} aria-label={pill.action === 'publish' ? 'Publish branch' : `${pill.action === 'pull' ? 'Pull' : 'Push'} ${commitCount(pill.count)}`} onClick={runPill}>
              {pillRunning ? <IconLoader4 className="animate-spin" aria-hidden="true" /> : pill.action === 'pull' ? <IconArrowDown aria-hidden="true" /> : <IconArrowUp aria-hidden="true" />}
              <span>{pill.action === 'publish' ? 'Publish' : `${pill.action === 'pull' ? 'Pull' : 'Push'} ${pill.count}`}</span>
            </button>
          )}
          <Button variant="ghost" size="icon" className="mobile-bar-button" aria-label="Settings" onClick={() => props.onSettingsOpen(true)}><IconSettings /></Button>
        </div>
        {loadIndicator}
      </header>
    )}
    <MobileSheet open={contextOpen} onOpenChange={onContextOpen} title="Repository">
      <div className="mobile-picker-rows">
        <div><IconFolder aria-hidden="true" /><span>Repository</span>{repositoryControl}</div>
        <div><IconGitBranch aria-hidden="true" /><span>Branch</span>{branchControl}</div>
        {props.worktrees.length > 1 && <div><IconHierarchy2 aria-hidden="true" /><span>Worktree</span>{worktreeControl}</div>}
      </div>
      <hr />
      <div className="mobile-context-sync">
        {(publish || Boolean(status?.ahead)) && (
          <button className={`mobile-sheet-action${syncDisabled ? '' : ' go'}`} disabled={syncDisabled} onClick={() => contextAction(props.onPush)}>
            <IconArrowUp /><span>{publish ? 'Publish this branch' : 'Push'}</span>{Boolean(status?.ahead) && <small className="mobile-sheet-value">{commitCount(status!.ahead)}</small>}
          </button>
        )}
        {Boolean(status?.behind) && (
          <button className="mobile-sheet-action" disabled={syncDisabled || !status?.upstream} onClick={() => contextAction(props.onPull)}>
            <IconArrowDown /><span>Pull</span><small className="mobile-sheet-value">{commitCount(status!.behind)}</small>
          </button>
        )}
        <button className="mobile-sheet-action" disabled={Boolean(props.busy) || syncBusy} onClick={() => contextAction(props.onRefresh)}><IconRefresh /><span>Refresh</span></button>
      </div>
      <hr />
      {props.branchPullRequest && <BranchPullRequestMenu repositoryId={props.repository.id} key={props.branchPullRequest.url} pullRequest={props.branchPullRequest} onOpenPullRequest={props.onOpenPullRequest} mobile onNavigate={() => onContextOpen(false)} />}
      {props.githubInfo?.isGitHub && props.githubInfo.nameWithOwner && <button className="mobile-sheet-action" onClick={() => contextAction(() => openOnGitHub(`https://github.com/${props.githubInfo!.nameWithOwner}`))}><IconBrandGithub /><span>Open on GitHub</span></button>}
      <button className="mobile-sheet-action" onClick={() => contextAction(props.onOpen)}><IconPlus /><span>Open another repository</span></button>
    </MobileSheet>
  </>;
}
