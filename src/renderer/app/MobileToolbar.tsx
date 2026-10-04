import { useState, useEffect, useRef, type ReactNode } from 'react';
import { IconArrowDown, IconArrowLeft, IconArrowUp, IconBrandGithub, IconDots, IconFiles, IconGitBranch, IconGitPullRequest, IconPlus, IconRefresh, IconSettings, IconX } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { MobileSheet } from '@/components/MobileSheet';
import { DesktopUpdateIndicator } from '@/features/settings/UpdateSettings';
import { openOnGitHub } from '@/features/pulls/gh-utils';
import { needsBranchPublication } from '@/features/repositories/project-sync';
import { getVsCodeFileIconUrl } from '@/lib/vscode-icons';
import { RepositoryFaviconImage } from '@/features/repositories/RepositoryFavicon';
import type { ToolbarProps } from './Toolbar';

export function MobileToolbar({ props, repositoryControl, worktreeControl, branchControl, favicon, contextOpen, onContextOpen, syncBusy }: {
  props: ToolbarProps;
  repositoryControl: ReactNode;
  worktreeControl: ReactNode;
  branchControl: ReactNode;
  favicon: string | undefined;
  contextOpen: boolean;
  onContextOpen(open: boolean): void;
  syncBusy: boolean;
}) {
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (props.mobileBackLabel) backRef.current?.focus(); }, [props.mobileBackLabel]);
  const [filesOpen, setFilesOpen] = useState(false);
  const publish = needsBranchPublication(props.status);
  const contextAction = (action: () => void) => { onContextOpen(false); action(); };
  return <>
    <header className="mobile-toolbar">
      {props.mobileBackLabel ? <button ref={backRef} className="mobile-toolbar-back" onClick={props.onMobileBack}><IconArrowLeft /><span>{props.mobileBackLabel}</span></button>
        : <button className="mobile-repository-context" aria-label="Repository context" aria-haspopup="dialog" aria-expanded={contextOpen} onClick={() => onContextOpen(true)}>
          <RepositoryFaviconImage src={favicon} /><span><strong>{props.repository.repositoryName}</strong><small><IconGitBranch />{props.status?.branch ?? 'Detached HEAD'}</small></span>
        </button>}
      <div className="mobile-toolbar-actions">
        {props.openFiles.tabs.length > 0 && <Button variant="ghost" size="sm" className="mobile-open-files-trigger" aria-label={`Open files (${props.openFiles.tabs.length})`} onClick={() => setFilesOpen(true)}><IconFiles /><span>{props.openFiles.tabs.length}</span>{props.openFiles.tabs.some((tab) => tab.dirty) && <span className="mobile-unsaved-dot" aria-label="Unsaved files" />}</Button>}
        <DesktopUpdateIndicator />
        <Button variant="ghost" size="icon" aria-label="Repository context and settings" onClick={() => onContextOpen(true)}><IconDots /></Button>
      </div>
    </header>
    <MobileSheet open={contextOpen} onOpenChange={onContextOpen} title="Repository" description="Switch checkout or manage the current repository.">
      <div className="mobile-context-selectors">
        <div><span>Repository</span>{repositoryControl}</div>
        <div><span>Branch</span>{branchControl}</div>
        <div><span>Worktree</span>{worktreeControl}</div>
      </div>
      <div className="mobile-context-sync">
        <Button variant="outline" size="sm" disabled={Boolean(props.busy) || syncBusy} onClick={() => contextAction(props.onRefresh)}><IconRefresh />Refresh</Button>
        <Button variant="outline" size="sm" disabled={Boolean(props.busy) || syncBusy || !props.status?.upstream || props.status.readOnly} onClick={() => contextAction(props.onPull)}><IconArrowDown />Pull{props.status?.behind ? ` (${props.status.behind})` : ''}</Button>
        <Button variant="outline" size="sm" disabled={Boolean(props.busy) || syncBusy || !props.status || props.status.readOnly || props.status.unborn || props.status.detached} onClick={() => contextAction(props.onPush)}><IconArrowUp />{publish ? 'Publish' : 'Push'}{props.status?.ahead ? ` (${props.status.ahead})` : ''}</Button>
      </div>
      <button className="mobile-sheet-action" onClick={() => contextAction(props.onOpen)}><IconPlus /><span>Open repository</span></button>
      {props.branchPullRequest && <button className="mobile-sheet-action" onClick={() => contextAction(() => openOnGitHub(props.branchPullRequest!.url))}><IconGitPullRequest /><span>Open PR #{props.branchPullRequest.number}</span></button>}
      {props.githubInfo?.isGitHub && props.githubInfo.nameWithOwner && <button className="mobile-sheet-action" onClick={() => contextAction(() => openOnGitHub(`https://github.com/${props.githubInfo!.nameWithOwner}`))}><IconBrandGithub /><span>Open on GitHub</span></button>}
      <button className="mobile-sheet-action" onClick={() => contextAction(() => props.onSettingsOpen(true))}><IconSettings /><span>Settings</span></button>
    </MobileSheet>
    <MobileSheet open={filesOpen} onOpenChange={setFilesOpen} title="Open files" description="Switch files or close tabs. Unsaved drafts stay in their tabs.">
      {props.openFiles.tabs.map((tab) => <div className={`mobile-open-file ${props.openFiles.activePath === tab.path ? 'active' : ''}`} key={tab.path}>
        <button className="mobile-sheet-action" aria-current={props.openFiles.activePath === tab.path ? 'true' : undefined} onClick={() => { setFilesOpen(false); props.onOpenFileTab(tab.path); }}>
          <img src={getVsCodeFileIconUrl(tab.path)} alt="" draggable={false} /><span><strong>{tab.path.split('/').pop()}</strong><small>{tab.path}{tab.missing ? ' · Missing' : tab.dirty ? ' · Unsaved' : props.openFiles.previewPath === tab.path ? ' · Preview' : ''}</small></span>
        </button>
        <Button variant="ghost" size="icon" aria-label={`Close ${tab.path}`} onClick={() => props.onCloseFileTab(tab.path)}><IconX /></Button>
      </div>)}
      {props.openFiles.tabs.length === 0 && <p className="mobile-list-message">No open files.</p>}
    </MobileSheet>
  </>;
}
