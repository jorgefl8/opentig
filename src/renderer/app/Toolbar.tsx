import { appDisplayName } from '@/lib/app-identity';
import { Suspense, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { lazyWithRetry } from '@/lib/lazy-with-retry';
import {
  IconArrowDown, IconArrowUp, IconBrandGithub, IconChevronDown, IconChevronLeft, IconChevronRight, IconHierarchy2, IconPlus, IconSettings,
} from '@tabler/icons-react';
import type { BootstrapData, GitHubRepositoryInfo, Preferences, PullRequestSummary, RecentRepository, RepositoryInfo, RepositoryOrganization, RepositoryProject } from '../../shared/contracts';
import type { BranchInfo, RepositoryStatus, WorktreeAgents, WorktreeInfo } from '../../shared/git-types';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { SearchablePicker, type SearchablePickerItem } from '@/components/SearchablePicker';
import { AppName } from '@/components/AppName';
import { OpenTigMark } from '@/components/OpenTigMark';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { isEditableTarget } from '@/features/files/file-tree';
import type { LocalRefsFocus, LocalRefsTab } from '@/features/refs/local-refs-model';
import { agentsAt, listAgents, samePath } from '@/features/refs/local-refs-model';
import { describeDetachedHead, detachedHeadLabel } from '@/features/refs/detached-head';
import { AgentLabel } from '@/features/refs/AgentLabel';
import { RepositoryFaviconImage } from '@/features/repositories/RepositoryFavicon';
import { useRepositoryFavicons } from '@/features/repositories/useRepositoryFavicons';
import { buildRepositoryPickerModel, formatRepositoryCheckout, getRepositoryPickerDisplayOrder, shortenRepositoryPath, type RepositoryOption } from '@/features/repositories/repository-select-model';
import { countsAfterFailedFetch, needsBranchPublication, syncCountsOf, visibleRepositorySyncActions, type ProjectSyncAction, type RepositorySyncCounts } from '@/features/repositories/project-sync';
import { createBackgroundSyncPool, type BackgroundSyncPool } from '@/features/repositories/background-sync-pool';
import { DesktopUpdateIndicator } from '@/features/settings/UpdateSettings';
import type { SettingsSection } from '@/features/settings/SettingsDialog';
import { normalizeRepositoryKey } from '../../shared/repository-projects';
import { opentig } from '@/lib/opentig-api';
import { inBackground } from '@/lib/websocket-transport';
import { useShortcuts } from './useShortcuts';
import { useNavigationKeys } from './navigation-keys';
import { useMobileLayout } from '@/lib/use-mobile-layout';
import { MobileToolbar, type MobileViewerBarProps } from './MobileToolbar';
import { TrailButton, type ListTrailSteps } from './TrailMenu';
import { RepositoryLoadIndicator, type RepositoryLoadPhase } from './RepositoryLoadIndicator';
import { RemoteAccessIndicator } from './RemoteAccessIndicator';
import type { RemoteAccessProblem, UpstreamNameMismatch } from '@shared/repository-access';
import type { RemoteAccessAction } from '@/features/repositories/remote-access';
import { BranchCombobox } from './BranchCombobox';
import { openOnGitHub } from '@/features/pulls/gh-utils';
import { BranchPullRequestMenu } from './BranchPullRequestMenu';
import { mergedBranchCleanUp, mergedBranchCleanUpStep, type MergedBranchCleanUp } from '@/features/pulls/merged-branch';
import { Spinner } from '@/components/ui/spinner';
import { RefreshIcon } from '@/components/ui/refresh-icon';

export interface ToolbarProps {
  onOnboarding?(): void;
  /** On a phone with a viewer showing, the top bar becomes that viewer's. */
  mobileViewer?: MobileViewerBarProps | undefined;
  repository: RepositoryInfo; recent: BootstrapData['recentRepositories']; repositoryProjects: RepositoryProject[]; status: RepositoryStatus | null;
  branches: BranchInfo[]; worktrees: WorktreeInfo[]; preferences: Preferences; busy: string | null;
  /** A manual refresh is still reading what GitHub shows, after its Git part is done. */
  githubRefreshing?: boolean;
  /** Worktrees in which coding agents are working. */
  worktreeAgents?: readonly WorktreeAgents[] | undefined;
  githubInfo: GitHubRepositoryInfo | null;
  branchPullRequest: PullRequestSummary | null;
  /** Commits the branch gained after its merged pull request; null while that is unknown. */
  branchPullRequestNewCommits?: number | null | undefined;
  /** A branch switch is running or waiting for the user's answer to one of its prompts. */
  branchSwitchPending?: boolean | undefined;
  /** What is shown has not been confirmed by a read yet: no branch or worktree is switched on its strength. */
  unconfirmed?: boolean | undefined;
  onCreatePullRequest?: (() => void) | undefined;
  /** The current branch tracks a branch with another name on the remote it pushes to. */
  upstreamMismatch?: UpstreamNameMismatch | null | undefined;
  onOpenPullRequest(number: number): void;
  onOpen(): void; onRecent(id: string | null): void; onBranch(name: string | null): void; onWorktree(path: string | null): void;
  /** The repository being opened from the picker, before it replaces the current one. */
  pendingRepositoryId: string | null;
  repositoryLoadPhase: RepositoryLoadPhase | null;
  repositoryLoadVisible: boolean;
  repositoryLoadSlow: boolean;
  /** The last background fetch was refused by GitHub. */
  remoteProblem: { access: RemoteAccessProblem; message: string } | null;
  onRemoteAccessAction(action: RemoteAccessAction): void;
  onRefresh(): void; onPreference(partial: Partial<Preferences>): void;
  /** Back and Forward through the places visited; the phone's own arrow walks the same trail. */
  canGoBack: boolean;
  canGoForward: boolean;
  onBack(): void;
  onForward(): void;
  /** The steps each way, for the lists Back and Forward open, and a jump to one of them. */
  listTrailSteps: ListTrailSteps;
  onGo(offset: number): void;
  onForgetRepository(repository: RepositoryOption): Promise<RepositoryOrganization>;
  onRelocateRepository(repository: RepositoryOption, path: string): Promise<void>;
  /** Saved repositories whose folder no longer exists; picking one asks for its new folder. */
  unavailableRepositoryIds: ReadonlySet<string>;
  /** The picker opened, a good moment to recheck which saved folders still exist. */
  onRepositoryPickerOpen(): void;
  onOrganizationChange(organization: RepositoryOrganization): void;
  /** `commonDir` is the Git folder of the repository the branch or worktree was managed in, which may no longer be open when it is done. */
  onRefsManaged(recentRepositories: RecentRepository[] | null, commonDir: string): void;
  onPull(): void; onPush(): void;
  repositorySyncOperations: ReadonlyMap<string, ProjectSyncAction>;
  /**
   * `settled` reads the row's counts again after the action, and after any follow-up the user
   * takes from its notice. The operation holds the row until it has.
   */
  onRepositorySync(repository: RepositoryOption, projectName: string | null, action: ProjectSyncAction, settled: () => Promise<void>): Promise<void>;
  settingsOpen: boolean; settingsSection: SettingsSection;
  onSettingsOpen(open: boolean): void; onSettingsSection(section: SettingsSection): void;
}

/** Saved repositories fetched at once while the picker is open. */
const PICKER_SYNC_CONCURRENCY = 4;

const SettingsDialog = lazyWithRetry(() => import('@/features/settings/SettingsDialog').then((module) => ({ default: module.SettingsDialog })));
const LocalRefsDialog = lazyWithRetry(() => import('@/features/refs/LocalRefsDialog').then((module) => ({ default: module.LocalRefsDialog })));
const RepositoryProjectsDialog = lazyWithRetry(() => import('@/features/repositories/RepositoryProjectsDialog').then((module) => ({ default: module.RepositoryProjectsDialog })));

/** Memoized: it redraws when one of its props changes, which `App` keeps the same otherwise. */
export const Toolbar = memo(function Toolbar(props: ToolbarProps) {
  const { onRecent } = props;
  const mobile = useMobileLayout();
  const [mobileContextOpen, setMobileContextOpen] = useState(false);
  useEffect(() => { if (!mobile) setMobileContextOpen(false); }, [mobile]);
  const publishBranch = needsBranchPublication(props.status);
  const shortcuts = useShortcuts();
  const navigation = useNavigationKeys();
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
  const [refsFocus, setRefsFocus] = useState<LocalRefsFocus | undefined>(undefined);
  const openRefsManager = (tab: LocalRefsTab) => { setMobileContextOpen(false); setRefsTab(tab); setRefsFocus(undefined); setRefsOpen(true); };
  const currentWorktree = props.worktrees.find((item) => samePath(item.path, props.repository.path));
  // Cleaning up a merged branch leaves it first, through the usual switch and its prompts,
  // and only then opens the manager on it, where the deletion is reviewed and confirmed.
  const branchCleanUp = props.branchPullRequest?.state === 'MERGED' && props.status?.branch
    ? mergedBranchCleanUp({ pullRequest: props.branchPullRequest, branch: props.status.branch, repositoryPath: props.repository.path, branches: props.branches, worktrees: props.worktrees })
    : null;
  const [startedCleanUp, setStartedCleanUp] = useState<MergedBranchCleanUp | null>(null);
  const startCleanUp = (cleanUp: MergedBranchCleanUp) => {
    setStartedCleanUp(cleanUp);
    if (cleanUp.kind === 'worktree') props.onWorktree(cleanUp.mainPath);
    else props.onBranch(cleanUp.base.fullName);
  };
  const cleanUpStep = startedCleanUp && mergedBranchCleanUpStep(startedCleanUp, {
    repositoryPath: props.repository.path,
    branch: props.status?.branch ?? null,
    switching: startedCleanUp.kind === 'worktree' ? props.busy === 'worktree' : props.branchSwitchPending === true,
    conflicts: props.status?.changes.some((change) => change.conflict) ?? false,
  });
  useEffect(() => {
    if (!startedCleanUp || !cleanUpStep || cleanUpStep === 'wait') return;
    setStartedCleanUp(null);
    if (cleanUpStep !== 'open') return;
    setMobileContextOpen(false);
    setRefsTab(startedCleanUp.kind === 'worktree' ? 'worktrees' : 'branches');
    setRefsFocus(startedCleanUp.kind === 'worktree' ? { worktree: startedCleanUp.from } : { branch: startedCleanUp.branch });
    setRefsOpen(true);
  }, [startedCleanUp, cleanUpStep]);
  const picker = useMemo(() => buildRepositoryPickerModel(props.recent, props.repositoryProjects), [props.recent, props.repositoryProjects]);
  const visibleRepositories = useMemo(() => getRepositoryPickerDisplayOrder(picker), [picker]);
  const repositoryIndex = useMemo(
    () => new Map(visibleRepositories.map((repository, index) => [repository.key, index + 1])),
    [visibleRepositories],
  );
  const currentRepositoryKey = normalizeRepositoryKey(props.repository.commonDir);
  const pendingRepository = picker.repositories.find((group) => group.recent.id === props.pendingRepositoryId) ?? null;
  const loadingRepositoryName = pendingRepository?.name ?? props.repository.repositoryName;
  const loadIndicator = <RepositoryLoadIndicator phase={props.repositoryLoadPhase} visible={props.repositoryLoadVisible} slow={props.repositoryLoadSlow} name={loadingRepositoryName} />;
  const currentRepositorySyncBusy = props.repositorySyncOperations.has(props.repository.id);
  const faviconSources = useMemo(
    () => [{ key: currentRepositoryKey, recent: { id: props.repository.id } }, ...picker.repositories],
    [currentRepositoryKey, picker.repositories, props.repository.id],
  );
  const favicons = useRepositoryFavicons(faviconSources);

  // A ref, so the availability check that runs as the picker opens does not fetch every repository twice.
  const unavailableRepositoryIds = useRef(props.unavailableRepositoryIds);
  useEffect(() => { unavailableRepositoryIds.current = props.unavailableRepositoryIds; }, [props.unavailableRepositoryIds]);
  const shownStatus = useRef({ repositoryId: props.repository.id, status: props.status });
  useEffect(() => { shownStatus.current = { repositoryId: props.repository.id, status: props.status }; }, [props.repository.id, props.status]);
  const syncRepositoryCounts = useCallback(async (repositoryId: string) => {
    const version = (repositoryStatusVersions.current.get(repositoryId) ?? 0) + 1;
    repositoryStatusVersions.current.set(repositoryId, version);
    try {
      const fetched = await inBackground(() => opentig.refs.fetch(repositoryId));
      if (repositoryStatusVersions.current.get(repositoryId) !== version) return;
      const status = await inBackground(() => opentig.repository.getStatus(repositoryId, false));
      if (repositoryStatusVersions.current.get(repositoryId) !== version) return;
      setRepositorySyncCounts((current) => {
        const next = new Map(current);
        next.set(repositoryId, fetched.status === 'success' ? { ...syncCountsOf(status), ahead: fetched.ahead, behind: fetched.behind } : syncCountsOf(status));
        return next;
      });
    } catch {
      if (repositoryStatusVersions.current.get(repositoryId) !== version) return;
      const open = shownStatus.current;
      setRepositorySyncCounts((current) => countsAfterFailedFetch(current, repositoryId, open));
    }
  }, []);
  const syncPool = useRef<BackgroundSyncPool | null>(null);
  const refreshRepositorySyncCounts = useCallback((repositories: RepositoryOption[]) => {
    syncPool.current ??= createBackgroundSyncPool(PICKER_SYNC_CONCURRENCY, syncRepositoryCounts);
    syncPool.current.request(repositories.filter((item) => !unavailableRepositoryIds.current.has(item.recent.id)).map((item) => item.recent.id));
  }, [syncRepositoryCounts]);
  // After a pull or push the repository's own status is enough: the operation has just talked to the
  // remote, so a fetch would add nothing. A list fetch that began before it is not kept over this read.
  const recountRepository = useCallback(async (repositoryId: string) => {
    const version = (repositoryStatusVersions.current.get(repositoryId) ?? 0) + 1;
    repositoryStatusVersions.current.set(repositoryId, version);
    try {
      const status = await opentig.repository.getStatus(repositoryId, false);
      if (repositoryStatusVersions.current.get(repositoryId) !== version) return;
      setRepositorySyncCounts((current) => new Map(current).set(repositoryId, syncCountsOf(status)));
    } catch {
      if (repositoryStatusVersions.current.get(repositoryId) !== version) return;
      const open = shownStatus.current;
      setRepositorySyncCounts((current) => countsAfterFailedFetch(current, repositoryId, open));
    }
  }, []);

  useEffect(() => {
    const currentStatus = props.status;
    if (!currentStatus) return;
    const repositoryId = props.repository.id;
    repositoryStatusVersions.current.set(repositoryId, (repositoryStatusVersions.current.get(repositoryId) ?? 0) + 1);
    setRepositorySyncCounts((current) => new Map(current).set(repositoryId, syncCountsOf(currentStatus)));
  }, [props.repository.id, props.status]);

  useEffect(() => {
    if (repositorySelectOpen) refreshRepositorySyncCounts(picker.repositories);
  }, [picker.repositories, refreshRepositorySyncCounts, repositorySelectOpen]);
  const { onRepositoryPickerOpen } = props;
  useEffect(() => {
    if (repositorySelectOpen) onRepositoryPickerOpen();
  }, [onRepositoryPickerOpen, repositorySelectOpen]);

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
          '[data-slot="dialog-popup"][data-open], [data-slot="select-content"][data-open], [data-slot="combobox-content"][data-open], [data-slot="dropdown-menu-content"][data-open], .mobile-sheet, .confirm-popover',
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
    if (props.unavailableRepositoryIds.has(group.recent.id)) {
      return {
        value: group.key,
        label: group.name,
        description: shortenRepositoryPath(group.recent.path),
        search: group.recent.path,
        tooltip: `Not found at ${group.recent.path}. Choose it to locate its new folder.`,
        icon: <RepositoryFaviconImage src={favicons.get(group.key)} />,
        trailing: <>
          <span className="repository-missing-badge">Not found</span>
          <Kbd className="repo-select-index">{repositoryIndex.get(group.key)}</Kbd>
        </>,
      };
    }
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
                  data-sync={action === 'pull' ? 'pull' : publishing ? 'publish' : 'push'}
                  disabled={disabled}
                  aria-label={`${label} ${group.name}`}
                  onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
                  onKeyDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void props.onRepositorySync(group, projectName, action, () => recountRepository(group.recent.id));
                  }}
                />
              )}>
                {running === action ? <Spinner data-icon="inline-start" /> : action === 'pull' ? <IconArrowDown data-icon="inline-start" /> : <IconArrowUp data-icon="inline-start" />}
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
  const githubUrl = props.githubInfo?.isGitHub && props.githubInfo.nameWithOwner ? `https://github.com/${props.githubInfo.nameWithOwner}` : null;
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
        value={pendingRepository?.key ?? currentRepositoryKey}
        onValueChange={(key) => { setMobileContextOpen(false); onRecent(picker.repositories.find((group) => group.key === key)?.recent.id ?? null); }}
        label="Select project or repository"
        triggerLabel={pendingRepository ? `Opening ${pendingRepository.name}…` : props.repository.repositoryName}
        icon={props.repositoryLoadPhase ? <Spinner /> : <RepositoryFaviconImage src={favicons.get(currentRepositoryKey)} />}
        triggerHint={`Switch repository (${repoSwitcherKey.toUpperCase()})`}
        shortcut={repoSwitcherKey.toUpperCase()}
        triggerClassName={mobile ? 'max-w-[240px]' : 'toolbar-crumb toolbar-crumb-repository'}
        triggerIndicator={mobile ? undefined : <><Kbd aria-hidden="true">{repoSwitcherKey.toUpperCase()}</Kbd><IconChevronDown className="toolbar-crumb-chevron" /></>}
        contentClassName="repository-picker"
        align="start"
        placeholder="Search repositories…"
        management={[
          // The phone sheet has its own rows for these two.
          ...(mobile ? [] : [{ label: 'Open repository…', icon: <IconPlus />, shortcut: shortcuts.openRepository, onClick: props.onOpen }]),
          ...(mobile || !githubUrl ? [] : [{ label: 'Open on GitHub', icon: <IconBrandGithub />, onClick: () => openOnGitHub(githubUrl) }]),
          { label: 'Manage projects…', onClick: () => { setMobileContextOpen(false); setProjectsOpen(true); } },
        ]}
      />
  );
  const currentWorktreeName = currentWorktree?.path.split(/[\\/]/).pop() ?? props.repository.name;
  const worktreeControl = (
      <SearchablePicker
        groups={[{ id: 'worktrees', label: 'Worktrees', items: props.worktrees.map((item) => ({ item, agents: agentsAt(props.worktreeAgents, item.path) })).map(({ item, agents }) => ({
          value: item.path,
          label: item.path.split(/[\\/]/).pop() ?? item.path,
          description: `${item.branch ?? detachedHeadLabel(item.oid, props.branches)}${item.locked ? ' · Locked' : item.prunable ? ' · Prunable' : item.bare ? ' · Bare' : ''}`,
          trailing: <AgentLabel agents={agents} compact />,
          search: item.path,
          // A locked worktree opens like any other; the lock says why it can't be removed, often a tool's session using it.
          tooltip: `${item.locked && item.locked !== 'locked' ? `${item.path} · Locked: ${item.locked}` : item.path}${agents.length > 0 ? ` · ${listAgents(agents)} working here` : ''}`,
          icon: <IconHierarchy2 />,
          disabled: Boolean(item.prunable || item.bare),
        })) }]}
        value={currentWorktree?.path ?? props.repository.path}
        onValueChange={props.onWorktree}
        label={mobile ? 'Select worktree' : `Select worktree, in ${currentWorktreeName}`}
        triggerLabel={mobile ? currentWorktreeName : String(props.worktrees.length)}
        {...(mobile ? {} : { triggerHint: `Worktree: ${currentWorktreeName}`, triggerIndicator: <span className="hidden" />, align: 'start' as const })}
        icon={<IconHierarchy2 />}
        triggerClassName={mobile ? 'max-w-[190px]' : 'toolbar-worktree-count'}
        placeholder="Search worktrees…"
        management={[{ label: 'Manage worktrees…', onClick: () => openRefsManager('worktrees') }]}
        disabled={refsBusy}
      />
  );
  const detachedHead = useMemo(() => describeDetachedHead(props.status, props.branches), [props.status, props.branches]);
  const checkout = detachedHead?.label ?? props.status?.branch ?? 'Detached HEAD';
  const branchControl = (
      <BranchCombobox
        branches={props.branches}
        currentLabel={checkout}
        detached={detachedHead}
        disabled={refsBusy || props.unconfirmed === true}
        readOnly={props.status?.readOnly}
        crumb={!mobile}
        worktrees={{ items: props.worktrees, agents: props.worktreeAgents, onSelect: props.onWorktree, onManage: () => openRefsManager('worktrees') }}
        onBranch={props.onBranch}
        onManage={() => openRefsManager('branches')}
      />
  );
  return (
    <>
    {mobile ? <MobileToolbar props={props} branchCleanUp={branchCleanUp} onBranchCleanUp={startCleanUp} repositoryControl={repositoryControl} worktreeControl={worktreeControl} branchControl={branchControl} pendingRepositoryName={pendingRepository?.name ?? null} loadIndicator={loadIndicator} contextOpen={mobileContextOpen} onContextOpen={(open) => { setMobileContextOpen(open); if (!open) setRepositorySelectOpen(false); }} syncBusy={currentRepositorySyncBusy} /> : <header className="toolbar">
      <div className="toolbar-brand" aria-label={appDisplayName}>
        <OpenTigMark />
        <AppName />
      </div>
      <span className="toolbar-brand-divider" aria-hidden="true" />
      <div className="toolbar-crumbs">
        {repositoryControl}
        {props.worktrees.length > 1 && worktreeControl}
        <span className="toolbar-crumb-separator" aria-hidden="true">/</span>
        {branchControl}
        {props.upstreamMismatch && (
          <span className="toolbar-upstream-chip"><span className="sr-only">Tracks </span><span aria-hidden="true">→ </span>{props.upstreamMismatch.remote}/{props.upstreamMismatch.branch}</span>
        )}
        {props.branchPullRequest && (
          <BranchPullRequestMenu repositoryId={props.repository.id} key={props.branchPullRequest.url} pullRequest={props.branchPullRequest} onOpenPullRequest={props.onOpenPullRequest}
            newCommits={props.branchPullRequestNewCommits} cleanUp={branchCleanUp} onCleanUp={startCleanUp} onCreatePullRequest={props.onCreatePullRequest} />
        )}
      </div>
      <div className="toolbar-spacer" />
      {props.status && (props.status.behind > 0 || props.busy === 'pull') && (
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="sm" data-sync="pull" focusableWhenDisabled disabled={Boolean(props.busy) || currentRepositorySyncBusy} onClick={props.onPull} aria-label={`Pull ${props.status.behind} commits`} />}>
            {props.busy === 'pull' ? <Spinner data-icon="inline-start" /> : <IconArrowDown data-icon="inline-start" />}
            {props.status.behind > 0 && <span>{props.status.behind}</span>}
          </TooltipTrigger>
          <TooltipContent>{props.busy === 'pull' ? 'Pulling changes…' : `Pull ${props.status.behind} ${props.status.behind === 1 ? 'commit' : 'commits'}`}</TooltipContent>
        </Tooltip>
      )}
      {props.status && (publishBranch || props.status.unborn || props.status.ahead > 0 || props.busy === 'push') && (
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="sm" data-sync={publishBranch || props.status.unborn ? 'publish' : 'push'} focusableWhenDisabled disabled={Boolean(props.busy) || currentRepositorySyncBusy || props.status.readOnly || props.status.unborn || props.status.detached} onClick={props.onPush} aria-label={publishBranch || props.status.unborn ? 'Publish branch' : `Push ${props.status.ahead} commits`} />}>
            {props.busy === 'push' ? <Spinner data-icon="inline-start" /> : <IconArrowUp data-icon="inline-start" />}
            {publishBranch || props.status.unborn ? <span>Publish</span> : props.status.ahead > 0 && <span>{props.status.ahead}</span>}
          </TooltipTrigger>
          <TooltipContent>{props.status.unborn ? 'Create the first commit before publishing this branch' : props.busy === 'push' ? 'Pushing…' : publishBranch ? 'Publish branch and set upstream' : `Push ${props.status.ahead} ${props.status.ahead === 1 ? 'commit' : 'commits'}`}</TooltipContent>
        </Tooltip>
      )}
      <div className="toolbar-history" role="group" aria-label="Navigation history">
        <TrailButton direction="back" enabled={props.canGoBack} keys={navigation.back} keysAria={navigation.backAria} onStep={props.onBack} listSteps={props.listTrailSteps} onGo={props.onGo}><IconChevronLeft /></TrailButton>
        <TrailButton direction="forward" enabled={props.canGoForward} keys={navigation.forward} keysAria={navigation.forwardAria} onStep={props.onForward} listSteps={props.listTrailSteps} onGo={props.onGo}><IconChevronRight /></TrailButton>
      </div>
      <span className="toolbar-history-divider" aria-hidden="true" />
      <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Refresh" onClick={props.onRefresh} disabled={Boolean(props.busy) || currentRepositorySyncBusy} />}><RefreshIcon turning={props.busy === 'refresh' || props.githubRefreshing === true} /></TooltipTrigger><TooltipContent>Refresh (Ctrl+R)</TooltipContent></Tooltip>
      <DesktopUpdateIndicator />
      {props.remoteProblem && <RemoteAccessIndicator problem={props.remoteProblem.access} message={props.remoteProblem.message} onAction={props.onRemoteAccessAction} />}
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Settings" onClick={() => props.onSettingsOpen(true)} />}><IconSettings /></TooltipTrigger>
        <TooltipContent>Settings</TooltipContent>
      </Tooltip>
      {loadIndicator}
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
            focus={refsFocus}
            repositoryId={props.repository.id}
            worktreeAgents={props.worktreeAgents}
            onOpenChange={setRefsOpen}
            onTabChange={setRefsTab}
            onOpenWorktree={(path) => { setRefsOpen(false); props.onWorktree(path); }}
            onMutated={(recentRepositories) => props.onRefsManaged(recentRepositories, props.repository.commonDir)}
            onBusyChange={setRefsBusy}
          />
        </Suspense>
      )}
      {props.settingsOpen && (
        <Suspense fallback={null}>
          <SettingsDialog
            onOnboarding={props.onOnboarding}
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
});
