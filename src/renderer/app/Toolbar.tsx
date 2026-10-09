import { appDisplayName } from '@/lib/app-identity';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IconArrowDown, IconArrowUp, IconBrandGithub, IconHierarchy2, IconLoader4, IconPlus, IconRefresh, IconSettings,
} from '@tabler/icons-react';
import type { BootstrapData, GitHubRepositoryInfo, Preferences, PullRequestSummary, RecentRepository, RepositoryInfo, RepositoryOrganization, RepositoryProject } from '../../shared/contracts';
import type { BranchInfo, RepositoryStatus, WorktreeInfo } from '../../shared/git-types';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { SearchablePicker, type SearchablePickerItem } from '@/components/SearchablePicker';
import { OpenTigMark } from '@/components/OpenTigMark';
import { AppName } from '@/components/AppName';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { isEditableTarget } from '@/features/files/file-tree';
import { OpenFilesStrip } from '@/features/files/OpenFilesStrip';
import type { FileSession } from '@/features/files/open-files-model';
import type { LocalRefsTab } from '@/features/refs/local-refs-model';
import { samePath } from '@/features/refs/local-refs-model';
import { RepositoryFaviconImage } from '@/features/repositories/RepositoryFavicon';
import { useRepositoryFavicons } from '@/features/repositories/useRepositoryFavicons';
import { buildRepositoryPickerModel, formatRepositoryCheckout, getRepositoryPickerDisplayOrder, type RepositoryOption } from '@/features/repositories/repository-select-model';
import { needsBranchPublication, visibleRepositorySyncActions, type ProjectSyncAction, type RepositorySyncCounts } from '@/features/repositories/project-sync';
import { DesktopUpdateIndicator } from '@/features/settings/UpdateSettings';
import type { SettingsSection } from '@/features/settings/SettingsDialog';
import { normalizeRepositoryKey } from '../../shared/repository-projects';
import { opentig } from '@/lib/opentig-api';
import { useShortcuts } from './useShortcuts';
import { useMobileLayout } from '@/lib/use-mobile-layout';
import { MobileToolbar } from './MobileToolbar';
import { BranchCombobox } from './BranchCombobox';
import { openOnGitHub } from '@/features/pulls/gh-utils';
import { BranchPullRequestMenu } from './BranchPullRequestMenu';

export interface ToolbarProps {
  mobileBackLabel?: string | undefined;
  onMobileBack?(): void;
  repository: RepositoryInfo; recent: BootstrapData['recentRepositories']; repositoryProjects: RepositoryProject[]; status: RepositoryStatus | null;
  branches: BranchInfo[]; worktrees: WorktreeInfo[]; preferences: Preferences; busy: string | null;
  githubInfo: GitHubRepositoryInfo | null;
  branchPullRequest: PullRequestSummary | null;
  onOpenPullRequest(number: number): void;
  onOpen(): void; onRecent(id: string | null): void; onBranch(name: string | null): void; onWorktree(path: string | null): void;
  onRefresh(): void; onPreference(partial: Partial<Preferences>): void;
  onForgetRepository(repository: RepositoryOption): Promise<RepositoryOrganization>;
  onRelocateRepository(repository: RepositoryOption, path: string): Promise<void>;
  onOrganizationChange(organization: RepositoryOrganization): void;
  onRefsManaged(recentRepositories: RecentRepository[] | null): void;
  openFiles: FileSession;
  onOpenFileTab(path: string): void;
  onPinFileTab(path: string): void;
  onCloseFileTab(path: string): void;
  onReorderFileTab(path: string, toIndex: number): void;
  onPull(): void; onPush(): void;
  repositorySyncOperations: ReadonlyMap<string, ProjectSyncAction>;
  onRepositorySync(repository: RepositoryOption, projectName: string | null, action: ProjectSyncAction): Promise<void>;
  settingsOpen: boolean; settingsSection: SettingsSection;
  onSettingsOpen(open: boolean): void; onSettingsSection(section: SettingsSection): void;
}

const SettingsDialog = lazy(() => import('@/features/settings/SettingsDialog').then((module) => ({ default: module.SettingsDialog })));
const LocalRefsDialog = lazy(() => import('@/features/refs/LocalRefsDialog').then((module) => ({ default: module.LocalRefsDialog })));
const RepositoryProjectsDialog = lazy(() => import('@/features/repositories/RepositoryProjectsDialog').then((module) => ({ default: module.RepositoryProjectsDialog })));

export function Toolbar(props: ToolbarProps) {
  const { onRecent } = props;
  const mobile = useMobileLayout();
  const [mobileContextOpen, setMobileContextOpen] = useState(false);
  const publishBranch = needsBranchPublication(props.status);
  const shortcuts = useShortcuts();
  const repoSwitcherKey = shortcuts.repoSwitcher.toLowerCase();
  const [repositorySelectOpen, setRepositorySelectOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [refsOpen, setRefsOpen] = useState(false);
  const [refsTab, setRefsTab] = useState<LocalRefsTab>('branches');
  const [repositorySyncCounts, setRepositorySyncCounts] = useState<ReadonlyMap<string, RepositorySyncCounts>>(() => new Map());
  const repositoryNumberBuffer = useRef('');
  const repositoryNumberTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repositoryStatusVersions = useRef<Map<string, number>>(new Map());
  const [refsBusy, setRefsBusy] = useState(false);
  const openRefsManager = (tab: LocalRefsTab) => { setMobileContextOpen(false); setRefsTab(tab); setRefsOpen(true); };
  const currentWorktree = props.worktrees.find((item) => samePath(item.path, props.repository.path));
  const picker = useMemo(() => buildRepositoryPickerModel(props.recent, props.repositoryProjects), [props.recent, props.repositoryProjects]);
  const visibleRepositories = useMemo(() => getRepositoryPickerDisplayOrder(picker), [picker]);
  const repositoryIndex = useMemo(
    () => new Map(visibleRepositories.map((repository, index) => [repository.key, index + 1])),
    [visibleRepositories],
  );
  const currentRepositoryKey = normalizeRepositoryKey(props.repository.commonDir);
  const currentRepositorySyncBusy = props.repositorySyncOperations.has(props.repository.id);
  const faviconSources = useMemo(
    () => [{ key: currentRepositoryKey, recent: { id: props.repository.id } }, ...picker.repositories],
    [currentRepositoryKey, picker.repositories, props.repository.id],
  );
  const favicons = useRepositoryFavicons(faviconSources);

  const refreshRepositorySyncCounts = useCallback(async (repositories: RepositoryOption[]) => {
    await Promise.all(repositories.map(async (item) => {
      const repositoryId = item.recent.id;
      const version = (repositoryStatusVersions.current.get(repositoryId) ?? 0) + 1;
      repositoryStatusVersions.current.set(repositoryId, version);
      try {
        const fetched = await opentig.refs.fetch(repositoryId);
        if (repositoryStatusVersions.current.get(repositoryId) !== version) return;
        const status = await opentig.repository.getStatus(repositoryId, false);
        if (repositoryStatusVersions.current.get(repositoryId) !== version) return;
        setRepositorySyncCounts((current) => {
          const next = new Map(current);
          next.set(repositoryId, {
            ahead: fetched.status === 'success' ? fetched.ahead : status.ahead,
            behind: fetched.status === 'success' ? fetched.behind : status.behind,
            branch: status.branch,
            detached: status.detached,
            upstream: status.upstream, unborn: status.unborn, readOnly: status.readOnly, operation: status.operation,
          });
          return next;
        });
      } catch {
        if (repositoryStatusVersions.current.get(repositoryId) !== version) return;
        setRepositorySyncCounts((current) => {
          const next = new Map(current);
          next.delete(repositoryId);
          return next;
        });
      }
    }));
  }, []);

  useEffect(() => {
    const currentStatus = props.status;
    if (!currentStatus) return;
    const repositoryId = props.repository.id;
    repositoryStatusVersions.current.set(repositoryId, (repositoryStatusVersions.current.get(repositoryId) ?? 0) + 1);
    setRepositorySyncCounts((current) => {
      const next = new Map(current);
      next.set(repositoryId, {
        ahead: currentStatus.ahead,
        behind: currentStatus.behind,
        branch: currentStatus.branch,
        detached: currentStatus.detached,
        upstream: currentStatus.upstream, unborn: currentStatus.unborn, readOnly: currentStatus.readOnly, operation: currentStatus.operation,
      });
      return next;
    });
  }, [props.repository.id, props.status]);

  useEffect(() => {
    if (repositorySelectOpen) void refreshRepositorySyncCounts(picker.repositories);
  }, [picker.repositories, refreshRepositorySyncCounts, repositorySelectOpen]);

  const clearRepositoryNumberShortcut = useCallback(() => {
    repositoryNumberBuffer.current = '';
    if (repositoryNumberTimer.current !== null) {
      clearTimeout(repositoryNumberTimer.current);
      repositoryNumberTimer.current = null;
    }
  }, []);

  const selectRepositoryAt = useCallback((oneBasedIndex: number) => {
    const repository = visibleRepositories[oneBasedIndex - 1];
    if (!repository) return false;
    clearRepositoryNumberShortcut();
    setRepositorySelectOpen(false);
    onRecent(repository.recent.id);
    return true;
  }, [clearRepositoryNumberShortcut, onRecent, visibleRepositories]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || isEditableTarget(event.target)) return;

      if (!repositorySelectOpen && event.key.toLowerCase() === repoSwitcherKey) {
        const anotherPopupIsOpen = document.querySelector(
          '[data-slot="dialog-popup"][data-open], [data-slot="select-content"][data-open], [data-slot="combobox-content"][data-open], [data-slot="dropdown-menu-content"][data-open]',
        );
        if (projectsOpen || refsOpen || props.settingsOpen || anotherPopupIsOpen) return;
        event.preventDefault();
        if (mobile) setMobileContextOpen(true);
        setRepositorySelectOpen(true);
        return;
      }

      if (!repositorySelectOpen) return;
      if (event.key.toLowerCase() === repoSwitcherKey) {
        event.preventDefault();
        event.stopPropagation();
        clearRepositoryNumberShortcut();
        setRepositorySelectOpen(false);
        return;
      }
      if (event.key === 'Enter' && repositoryNumberBuffer.current) {
        event.preventDefault();
        event.stopPropagation();
        selectRepositoryAt(Number(repositoryNumberBuffer.current));
        return;
      }
      if (!/^\d$/.test(event.key)) return;

      event.preventDefault();
      event.stopPropagation();
      const availableIndices = visibleRepositories.map((_, index) => String(index + 1));
      let nextBuffer = repositoryNumberBuffer.current + event.key;
      if (!availableIndices.some((index) => index.startsWith(nextBuffer))) nextBuffer = event.key;
      if (!availableIndices.some((index) => index.startsWith(nextBuffer))) {
        clearRepositoryNumberShortcut();
        return;
      }

      repositoryNumberBuffer.current = nextBuffer;
      if (repositoryNumberTimer.current !== null) clearTimeout(repositoryNumberTimer.current);
      const exactMatch = availableIndices.includes(nextBuffer);
      const hasLongerMatch = availableIndices.some((index) => index !== nextBuffer && index.startsWith(nextBuffer));
      if (exactMatch && !hasLongerMatch) {
        selectRepositoryAt(Number(nextBuffer));
      } else if (exactMatch) {
        repositoryNumberTimer.current = setTimeout(() => selectRepositoryAt(Number(nextBuffer)), 650);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      clearRepositoryNumberShortcut();
    };
  }, [mobile, clearRepositoryNumberShortcut, projectsOpen, props.settingsOpen, refsOpen, repoSwitcherKey, repositorySelectOpen, selectRepositoryAt, visibleRepositories]);

  const repositoryItem = (group: RepositoryOption, projectName: string | null = null): SearchablePickerItem => {
    const counts = repositorySyncCounts.get(group.recent.id);
    const checkout = counts && (counts.branch !== undefined || counts.detached !== undefined)
      ? { branch: counts.branch ?? null, detached: counts.detached === true }
      : group.recent.id === props.repository.id && props.status
        ? { branch: props.status.branch, detached: props.status.detached }
        : undefined;
    const checkoutLabel = formatRepositoryCheckout(group, checkout);
    return {
      value: group.key,
      label: group.name,
      description: checkoutLabel || 'Repository',
      search: group.recent.path,
      tooltip: group.recent.path,
      icon: <RepositoryFaviconImage src={favicons.get(group.key)} />,
      trailing: <>
      <span className="repository-sync-actions">
        {visibleRepositorySyncActions(counts, props.repositorySyncOperations.get(group.recent.id)).map((action) => {
          const running = props.repositorySyncOperations.get(group.recent.id);
          const disabled = Boolean(running) || Boolean(counts?.readOnly || counts?.operation) || (Boolean(props.busy) && group.recent.id === props.repository.id);
          const publishing = action === 'push' && needsBranchPublication(counts);
          const label = action === 'pull' ? 'Pull' : publishing ? 'Publish branch' : 'Push';
          const count = action === 'pull' ? counts?.behind ?? 0 : counts?.ahead ?? 0;
          return (
            <Tooltip key={action}>
              <TooltipTrigger render={(
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={disabled}
                  aria-label={`${label} ${group.name}`}
                  onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
                  onKeyDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void props.onRepositorySync(group, projectName, action).finally(() => refreshRepositorySyncCounts([group]));
                  }}
                />
              )}>
                {running === action ? <IconLoader4 data-icon="inline-start" className="animate-spin" /> : action === 'pull' ? <IconArrowDown data-icon="inline-start" /> : <IconArrowUp data-icon="inline-start" />}
                <span>{publishing ? 'Publish' : count}</span>
              </TooltipTrigger>
              <TooltipContent>{publishing ? 'Publish branch' : `${label} ${count} ${count === 1 ? 'commit' : 'commits'}`} · {checkoutLabel}</TooltipContent>
            </Tooltip>
          );
        })}
      </span>
      <Kbd className="repo-select-index">{repositoryIndex.get(group.key)}</Kbd>
      </>,
    };
  };
  const repositoryControl = (
      <SearchablePicker
        groups={[
          ...picker.projectSections.map((section) => ({
            id: section.id,
            label: section.name,
            items: section.repositories.map((repository) => repositoryItem(repository, section.name)),
          })),
          { id: 'unassigned', label: 'Repositories', items: picker.unassigned.map((repository) => repositoryItem(repository)) },
        ]}
        open={repositorySelectOpen}
        onOpenChange={(open) => { setRepositorySelectOpen(open); if (!open) clearRepositoryNumberShortcut(); }}
        onSearchChange={clearRepositoryNumberShortcut}
        focusSearch={false}
        value={currentRepositoryKey}
        onValueChange={(key) => { setMobileContextOpen(false); onRecent(picker.repositories.find((group) => group.key === key)?.recent.id ?? null); }}
        label="Select project or repository"
        triggerLabel={props.repository.repositoryName}
        icon={<RepositoryFaviconImage src={favicons.get(currentRepositoryKey)} />}
        triggerHint={<Kbd className="repo-select-shortcut" aria-hidden="true">{repoSwitcherKey.toUpperCase()}</Kbd>}
        shortcut={repoSwitcherKey.toUpperCase()}
        triggerClassName="repo-select max-w-[240px]"
        contentClassName="repository-picker"
        align="start"
        placeholder="Search repositories…"
        management={{ label: 'Manage projects…', onClick: () => { setMobileContextOpen(false); setProjectsOpen(true); } }}
      />
  );
  const worktreeControl = (
      <SearchablePicker
        groups={[{ id: 'worktrees', label: 'Worktrees', items: props.worktrees.map((item) => ({
          value: item.path,
          label: item.path.split(/[\\/]/).pop() ?? item.path,
          description: `${item.branch ?? 'Detached HEAD'}${item.locked ? ' · Locked' : item.prunable ? ' · Prunable' : item.bare ? ' · Bare' : ''}`,
          search: item.path,
          tooltip: item.path,
          icon: <IconHierarchy2 />,
          disabled: Boolean(item.locked || item.prunable || item.bare),
        })) }]}
        value={currentWorktree?.path ?? props.repository.path}
        onValueChange={props.onWorktree}
        label="Select worktree"
        triggerLabel={currentWorktree?.path.split(/[\\/]/).pop() ?? props.repository.name}
        icon={<IconHierarchy2 />}
        triggerClassName="toolbar-worktree max-w-[190px]"
        placeholder="Search worktrees…"
        management={{ label: 'Manage worktrees…', onClick: () => openRefsManager('worktrees') }}
        disabled={refsBusy}
      />
  );
  const branchControl = (
      <BranchCombobox
        branches={props.branches}
        currentLabel={props.status?.branch ?? 'Detached HEAD'}
        disabled={props.status?.readOnly || refsBusy}
        onBranch={props.onBranch}
        onManage={() => openRefsManager('branches')}
      />
  );
  return (
    <>
    {mobile ? <MobileToolbar props={props} repositoryControl={repositoryControl} worktreeControl={worktreeControl} branchControl={branchControl} favicon={favicons.get(currentRepositoryKey)} contextOpen={mobileContextOpen} onContextOpen={(open) => { setMobileContextOpen(open); if (!open) setRepositorySelectOpen(false); }} syncBusy={currentRepositorySyncBusy} /> : <header className="toolbar">
      <div className="toolbar-brand" aria-label={appDisplayName}>
        <OpenTigMark />
        <AppName />
      </div>
      {repositoryControl}

      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={props.onOpen} aria-label="Open repository" aria-keyshortcuts="Control+O" />}><IconPlus /></TooltipTrigger>
        <TooltipContent>Open repository (Ctrl+O)</TooltipContent>
      </Tooltip>
      <OpenFilesStrip
        session={props.openFiles}
        onActivate={props.onOpenFileTab}
        onPin={props.onPinFileTab}
        onClose={props.onCloseFileTab}
        onReorder={props.onReorderFileTab}
      />
      <div className="toolbar-spacer" />
      {props.status && (publishBranch || props.status.unborn || props.status.ahead > 0 || props.status.behind > 0 || props.status.insertions > 0 || props.status.deletions > 0 || props.busy === 'push' || props.busy === 'pull') && (
        <div className="branch-stats" aria-label="Branch and local changes summary">
          {(props.status.behind > 0 || props.busy === 'pull') && (
            <Tooltip>
              <TooltipTrigger render={<button className="branch-sync" disabled={Boolean(props.busy) || currentRepositorySyncBusy} onClick={props.onPull} aria-label={`Pull ${props.status.behind} commits`} />}>
                {props.busy === 'pull' ? <IconLoader4 className="animate-spin" /> : <span>↓{props.status.behind}</span>}
              </TooltipTrigger>
              <TooltipContent>{props.busy === 'pull' ? 'Pulling changes…' : `Pull ${props.status.behind} ${props.status.behind === 1 ? 'commit' : 'commits'}`}</TooltipContent>
            </Tooltip>
          )}
          {(publishBranch || props.status.unborn || props.status.ahead > 0 || props.busy === 'push') && (
            <Tooltip>
              <TooltipTrigger render={<button className="branch-push" disabled={Boolean(props.busy) || currentRepositorySyncBusy || props.status.readOnly || props.status.unborn || props.status.detached} onClick={props.onPush} aria-label={publishBranch || props.status.unborn ? 'Publish branch' : `Push ${props.status.ahead} commits`} />}>
                {props.busy === 'push' ? <IconLoader4 className="animate-spin" /> : <span>{publishBranch || props.status.unborn ? '↑ Publish' : `↑${props.status.ahead}`}</span>}
              </TooltipTrigger>
              <TooltipContent>{props.status.unborn ? 'Create the first commit before publishing this branch' : props.busy === 'push' ? 'Pushing…' : publishBranch ? 'Publish branch and set upstream' : `Push ${props.status.ahead} ${props.status.ahead === 1 ? 'commit' : 'commits'}`}</TooltipContent>
            </Tooltip>
          )}
          {(props.status.insertions > 0 || props.status.deletions > 0) && (
            <Tooltip>
              <TooltipTrigger render={<span className="line-stats" />}>
                <strong className="line-additions">+{props.status.insertions}</strong>
                <span>/</span>
                <strong className="line-deletions">-{props.status.deletions}</strong>
              </TooltipTrigger>
              <TooltipContent>Lines added and removed in the worktree</TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
      {worktreeControl}
      {branchControl}
      {props.branchPullRequest && (
        <BranchPullRequestMenu key={props.branchPullRequest.url} pullRequest={props.branchPullRequest} onOpenPullRequest={props.onOpenPullRequest} />
      )}

      <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Refresh" onClick={props.onRefresh} disabled={Boolean(props.busy) || currentRepositorySyncBusy} />}><IconRefresh className={props.busy === 'refresh' ? 'animate-spin' : undefined} /></TooltipTrigger><TooltipContent>Refresh (Ctrl+R)</TooltipContent></Tooltip>
      {props.githubInfo?.isGitHub && props.githubInfo.nameWithOwner && (
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Open repository on GitHub" onClick={() => openOnGitHub(`https://github.com/${props.githubInfo!.nameWithOwner}`)} />}>
            <IconBrandGithub aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>Open on GitHub · {props.githubInfo.nameWithOwner}</TooltipContent>
        </Tooltip>
      )}
      <DesktopUpdateIndicator />
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Settings" onClick={() => props.onSettingsOpen(true)} />}><IconSettings /></TooltipTrigger>
        <TooltipContent>Settings</TooltipContent>
      </Tooltip>

    </header>}
      {projectsOpen && (
        <Suspense fallback={null}>
          <RepositoryProjectsDialog open={projectsOpen} onOpenChange={setProjectsOpen} projects={props.repositoryProjects} repositories={picker.repositories} onOrganizationChange={props.onOrganizationChange} onForgetRepository={props.onForgetRepository} onRelocateRepository={props.onRelocateRepository} />
        </Suspense>
      )}
      {refsOpen && (
        <Suspense fallback={null}>
          <LocalRefsDialog
            open={refsOpen}
            tab={refsTab}
            repositoryId={props.repository.id}
            onOpenChange={setRefsOpen}
            onTabChange={setRefsTab}
            onOpenWorktree={(path) => { setRefsOpen(false); props.onWorktree(path); }}
            onMutated={props.onRefsManaged}
            onBusyChange={setRefsBusy}
          />
        </Suspense>
      )}
      {props.settingsOpen && (
        <Suspense fallback={null}>
          <SettingsDialog
            repository={props.repository}
            preferences={props.preferences}
            onPreference={props.onPreference}
            open={props.settingsOpen}
            onOpenChange={props.onSettingsOpen}
            section={props.settingsSection}
            onSectionChange={props.onSettingsSection}
          />
        </Suspense>
      )}
    </>
  );
}
