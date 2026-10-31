import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { IconChevronDown, IconDots, IconExternalLink, IconGitBranch, IconGitMerge, IconLoader4, IconRefresh } from '@tabler/icons-react';
import { sileo } from 'sileo';
import type { PullRequestAction, PullRequestActionInput, PullRequestActionResult, PullRequestDetails, PullRequestLiveState, PullRequestMergeMethod } from '../../../shared/contracts';
import { allowedPullRequestActions, canDeleteBranchWithMerge, resolvePullRequestPrimary } from '../../../shared/pull-request-actions';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { MobileActionsMenu, MobileMainAction, MobileSwitchRow, MobileViewerActions, type MobileMenuItem } from '@/components/MobileChrome';
import { useMobileChrome } from '@/components/mobile-chrome-context';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { mobileMainAction } from '@/lib/mobile-main-action';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { ConfirmPopover } from './ConfirmPopover';
import { ghDetail, ghErrorTitle, isUncertainFailure, openOnGitHub } from './gh-utils';
import { useGitHubAccount } from './useGitHubAccount';
import { pullRequestRevertUncertain, useViewerDraft } from './viewer-drafts';

const MERGE_VERBS: Record<PullRequestMergeMethod, string> = { MERGE: 'Merge', SQUASH: 'Squash and merge', REBASE: 'Rebase and merge' };
const MERGE_HELP: Record<PullRequestMergeMethod, string> = { MERGE: 'Keeps every commit and adds a merge commit', SQUASH: 'Combines the commits into one', REBASE: 'Replays the commits on the base branch' };

type ActionRequest = { action: 'merge'; method: PullRequestMergeMethod; deleteBranch?: boolean }
  | { action: 'enable-auto-merge'; method: PullRequestMergeMethod }
  | { action: 'update-branch'; method: 'MERGE' | 'REBASE' }
  | { action: Exclude<PullRequestAction, 'merge' | 'enable-auto-merge' | 'update-branch'> };

/** What each action asks before running. Reversible ones run straight away. */
type Panel = 'merge' | 'enable-auto-merge' | 'close' | 'delete-branch' | 'rebase-branch' | 'revert' | 'approve-workflows';

const MENU_LABELS: Partial<Record<PullRequestAction, string>> = {
  merge: 'Merge…',
  'enable-auto-merge': 'Enable auto-merge…',
  ready: 'Mark as ready for review',
  draft: 'Convert to draft',
  close: 'Close pull request…',
  reopen: 'Reopen pull request',
  'delete-branch': 'Delete branch…',
  revert: 'Revert…',
  'approve-workflows': 'Approve workflows…',
};

function successToast(request: ActionRequest, result: PullRequestActionResult, details: PullRequestDetails): void {
  const pull = `#${details.number}`;
  switch (result.outcome) {
    case 'merged':
      if (request.action === 'merge' && request.deleteBranch && !result.branchDeleted) {
        sileo.info({ title: 'Merged, but the branch was kept', description: `${pull} merged into ${details.baseRefName}. Delete ${details.headRefName} from the menu.`, duration: 10_000 });
      } else {
        sileo.success({ title: 'Merged', description: `${pull} merged into ${details.baseRefName}${result.branchDeleted ? ` and ${details.headRefName} deleted` : ''}.` });
      }
      return;
    case 'auto-merge-enabled': sileo.success({ title: 'Auto-merge enabled', description: `${pull} merges once its requirements are met.` }); return;
    case 'auto-merge-disabled': sileo.success({ title: 'Auto-merge disabled', description: pull }); return;
    case 'queued': sileo.success({ title: 'Added to merge queue', description: pull }); return;
    case 'updated': sileo.success({ title: 'Update requested', description: `${details.headRefName} is being updated from ${details.baseRefName}.` }); return;
    case 'unconfirmed': sileo.info({ title: 'GitHub accepted the request', description: "OpenTig couldn't confirm the result yet. Check the status before trying again.", duration: 10_000 }); return;
    case 'done':
      if (request.action === 'ready') sileo.success({ title: 'Ready for review', description: pull });
      else if (request.action === 'draft') sileo.success({ title: 'Converted to draft', description: pull });
      else if (request.action === 'close') sileo.success({ title: 'Pull request closed', description: pull });
      else if (request.action === 'reopen') sileo.success({ title: 'Pull request reopened', description: pull });
      else if (request.action === 'delete-branch') sileo.success({ title: 'Branch deleted', description: details.headRefName });
      else if (request.action === 'approve-workflows') sileo.success({ title: 'Workflows approved', description: `The workflows of ${pull} can run now.` });
      else if (request.action === 'revert') sileo.success({ title: 'Revert pull request opened', description: result.created?.url ?? pull });
  }
}

export function PullRequestActionBar({ repositoryId, details, live, refreshing, statusLabel, tab = 'summary', onRefresh, onEdit, onSelectPullRequest }: {
  repositoryId: string;
  details: PullRequestDetails;
  live: PullRequestLiveState;
  refreshing: boolean;
  /** Already on screen, so a primary that would only repeat it stays out. */
  statusLabel: string | null;
  /** On a phone the primary action floats, only where it's what the screen is for. */
  tab?: 'summary' | 'timeline' | 'diff';
  onRefresh(): void;
  onEdit(): void;
  onSelectPullRequest(number: number): void;
}) {
  const queryClient = useQueryClient();
  const phone = useMobileChrome() !== null;
  const accountQuery = useGitHubAccount(repositoryId);
  const account = accountQuery.data;
  const [question, setQuestion] = useState<{ panel: Panel; anchor: HTMLElement } | null>(null);
  const [moreButton, setMoreButton] = useState<HTMLButtonElement | null>(null);
  const [method, setMethod] = useState<PullRequestMergeMethod>(live.repository.defaultMethod);
  const [deleteBranch, setDeleteBranch] = useState(false);
  // A revert with no answer may already exist. Offering it again could open a second one.
  const [revertUncertain, setRevertUncertain] = useViewerDraft(pullRequestRevertUncertain(repositoryId, details.number), () => false);

  // A question about a state that no longer holds would mislead, so it goes away with that state.
  const stateKey = [live.state, live.isDraft, live.headRefOid, live.mergeable, live.mergeStateStatus, live.autoMerge?.method, live.mergeQueue.queued].join('|');
  useEffect(() => { setQuestion(null); }, [stateKey]);

  const mutation = useMutation({
    mutationFn: (request: ActionRequest) => {
      if (account?.state !== 'ready' || !account.login) throw new Error('Check the GitHub account in Settings and try again.');
      return opentig.github.runPullRequestAction({ ...request, repositoryId, number: details.number, expectedHeadOid: live.headRefOid, expectedAccount: { login: account.login, revision: account.revision } } as PullRequestActionInput);
    },
    onSuccess: (result, request) => {
      setQuestion(null);
      if (result.state) queryClient.setQueryData(queryKeys.pullRequestLiveState(repositoryId, details.number), result.state);
      successToast(request, result, details);
      // Merging or removing a branch changes the remote refs even when periodic fetches are off.
      if (result.outcome === 'merged' || request.action === 'delete-branch') void opentig.refs.fetch(repositoryId).catch(() => undefined);
      if (result.created?.number) onSelectPullRequest(result.created.number);
    },
    onError: (reason, request) => {
      const detail = ghDetail(reason);
      if (isUncertainFailure(reason)) {
        // It may be done already, so the question goes and what's on screen says how things stand.
        setQuestion(null);
        if (request.action === 'revert') setRevertUncertain(true);
        sileo.info({ title: 'No answer from GitHub yet', description: 'The action may have completed. OpenTig is checking the current status.', duration: 10_000 });
      } else {
        sileo.error({ title: ghErrorTitle(detail), description: detail?.message ?? (reason instanceof Error ? reason.message : 'An unexpected error occurred.'), duration: 10_000 });
      }
      if (detail?.code === 'GH_ACCOUNT_UNRESOLVED') void accountQuery.refetch();
    },
    onSettled: () => {
      for (const resource of ['pull-request-state', 'pull-request', 'pulls', 'branch-pull-request', 'pull-request-stack']) {
        void queryClient.invalidateQueries({ queryKey: ['repository', repositoryId, resource] });
      }
    },
  });
  const busy = mutation.isPending;
  // A sheet's rows stay pressable while it slides away, so a second tap must not send a second request.
  const run = (request: ActionRequest) => {
    if (!mutation.isPending) mutation.mutate(request);
  };

  /** A question asked from the menu hangs from the menu's button, because the item that asked it is gone. */
  const ask = (panel: Panel, anchor: HTMLElement | null) => {
    if (!anchor) return;
    setMethod(live.repository.methods.includes(method) ? method : live.repository.defaultMethod);
    setDeleteBranch(false);
    setQuestion({ panel, anchor });
  };
  const start = (action: PullRequestAction, anchor: HTMLElement | null) => {
    switch (action) {
      case 'merge': case 'enable-auto-merge': case 'close': case 'delete-branch': case 'revert': case 'approve-workflows': ask(action, anchor); return;
      case 'update-branch': run({ action, method: 'MERGE' }); return;
      default: run({ action });
    }
  };
  const fromPrimary = (action: PullRequestAction) => (event: MouseEvent<HTMLElement>) => start(action, event.currentTarget);

  const primary = resolvePullRequestPrimary(live);
  const primaryAction = primary.kind === 'action' ? primary.action : null;
  const allowed = allowedPullRequestActions(live);
  const menuActions = allowed.filter((action) => action !== primaryAction && action !== 'update-branch' && action !== 'disable-auto-merge' && !(action === 'revert' && revertUncertain));
  const canUpdateBranch = allowed.includes('update-branch');
  const canDisableAutoMerge = allowed.includes('disable-auto-merge');
  const accountReady = account?.state === 'ready' && Boolean(account.login);
  const hasMenu = menuActions.length > 0 || canUpdateBranch || live.viewer.canUpdate || Boolean(details.url);
  // A merge queue decides the method by itself, so only a plain merge has options to open.
  const splitMerge = primaryAction === 'merge' && !live.mergeQueue.enabled;
  const menu: MobileMenuItem[] = [
    ...(details.url ? [{ label: 'Open on GitHub', onSelect: () => openOnGitHub(details.url) }] : []),
    ...(canUpdateBranch && primaryAction !== 'update-branch' ? [{ label: 'Update branch with merge', disabled: !accountReady, onSelect: () => run({ action: 'update-branch', method: 'MERGE' }) }] : []),
    ...(canUpdateBranch ? [{ label: 'Update branch with rebase…', disabled: !accountReady, onSelect: () => ask('rebase-branch', moreButton) }] : []),
    ...(live.viewer.canUpdate ? [{ label: 'Edit title and description…', disabled: !accountReady, onSelect: onEdit }] : []),
    ...menuActions.map((action) => ({ label: MENU_LABELS[action] ?? action, disabled: !accountReady, danger: action === 'close' || action === 'delete-branch', onSelect: () => start(action, moreButton) })),
  ];

  const reasons = <>
    {primary.kind === 'text' && primary.label !== statusLabel && primary.label !== 'Draft' && <span className="pr-action-reason">{primary.label}</span>}
    {primary.kind === 'retry' && <>
      <span className="pr-action-reason">{primary.label}</span>
      <Button variant="ghost" size="xs" disabled={refreshing} onClick={onRefresh}>{refreshing ? <IconLoader4 className="animate-spin" /> : <IconRefresh />} Retry</Button>
    </>}
    {revertUncertain && <span className="pr-action-reason">The revert may have been created. Check GitHub first.<Button variant="ghost" size="xs" onClick={() => { setRevertUncertain(false); onRefresh(); }}>Refresh</Button></span>}
  </>;

  if (phone) {
    const floating = mobileMainAction({ screen: 'pull-request', tab, primary: primary.kind }) === 'pull-request-primary';
    return (
      <span className="pr-action-bar">
        {reasons}
        <MobileViewerActions>
          {(hasMenu || canDisableAutoMerge) && <MobileActionsMenu
            label="More pull request actions"
            title="Pull request"
            triggerRef={setMoreButton}
            triggerClassName="pr-more-actions"
            disabled={busy}
            items={canDisableAutoMerge ? [...menu, { label: 'Disable auto-merge', disabled: !accountReady, onSelect: () => run({ action: 'disable-auto-merge' }) }] : menu}
          />}
        </MobileViewerActions>
        {floating && <MobileMainAction>
          {primary.kind === 'github' && <Button className="mobile-main-action" disabled={!details.url} onClick={() => openOnGitHub(details.url)}><IconExternalLink /> {primary.label}</Button>}
          {primary.kind === 'action' && (
            <Button className="mobile-main-action" disabled={busy || !accountReady} onClick={fromPrimary(primary.action)}>
              {busy ? <IconLoader4 className="animate-spin" /> : primary.action === 'merge' || primary.action === 'enable-auto-merge' ? <IconGitMerge /> : null}
              {busy ? <ShimmeringText text="Working…" /> : primary.label}
            </Button>
          )}
        </MobileMainAction>}
        {question && <Confirmation question={question} live={live} details={details} login={account?.login ?? ''} busy={busy} method={method} deleteBranch={deleteBranch} phone onMethodChange={setMethod} onDeleteBranchChange={setDeleteBranch} onCancel={() => setQuestion(null)} onConfirm={run} />}
      </span>
    );
  }

  return (
    <span className="pr-action-bar">
      {reasons}
      {canDisableAutoMerge && <Button variant="ghost" size="xs" disabled={busy || !accountReady} onClick={() => run({ action: 'disable-auto-merge' })}>Disable auto-merge</Button>}
      {primary.kind === 'github' && details.url && <Button size="xs" onClick={() => openOnGitHub(details.url)}><IconExternalLink /> {primary.label}</Button>}
      {primary.kind === 'action' && (
        <span className={splitMerge ? 'pr-split-button' : 'contents'}>
          <Button size="xs" className={splitMerge ? 'rounded-r-none' : undefined} disabled={busy || !accountReady} onClick={fromPrimary(primary.action)}>
            {busy ? <IconLoader4 className="animate-spin" /> : primary.action === 'merge' || primary.action === 'enable-auto-merge' ? <IconGitMerge /> : null}
            {busy ? <ShimmeringText text="Working…" /> : primary.label}
          </Button>
          {splitMerge && <Button size="xs" className="w-5.5 rounded-l-none border-l-primary-foreground/25 px-0" aria-label="Merge options" disabled={busy || !accountReady} onClick={fromPrimary(primary.action)}><IconChevronDown /></Button>}
        </span>
      )}
      {hasMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button ref={setMoreButton} variant="ghost" size="icon-xs" className="change-action-button pr-more-actions" aria-label="More pull request actions" disabled={busy} />}><IconDots /></DropdownMenuTrigger>
          <DropdownMenuContent>
            {menu.map((item) => <DropdownMenuItem key={item.label} disabled={item.disabled} onClick={item.onSelect}>{item.label}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {question && <Confirmation question={question} live={live} details={details} login={account?.login ?? ''} busy={busy} method={method} deleteBranch={deleteBranch} onMethodChange={setMethod} onDeleteBranchChange={setDeleteBranch} onCancel={() => setQuestion(null)} onConfirm={run} />}
    </span>
  );
}

function Confirmation({ question, live, details, login, busy, method, deleteBranch, phone = false, onMethodChange, onDeleteBranchChange, onCancel, onConfirm }: {
  question: { panel: Panel; anchor: HTMLElement };
  live: PullRequestLiveState;
  details: PullRequestDetails;
  login: string;
  busy: boolean;
  method: PullRequestMergeMethod;
  deleteBranch: boolean;
  phone?: boolean;
  onMethodChange(method: PullRequestMergeMethod): void;
  onDeleteBranchChange(value: boolean): void;
  onCancel(): void;
  onConfirm(request: ActionRequest): void;
}) {
  const working = (label: string) => busy ? <><IconLoader4 className="animate-spin" /> <ShimmeringText text="Working…" /></> : label;
  const pull = `#${details.number}`;
  const base = <code>{live.baseRefName}</code>;
  const branch = <code>{live.headRefName}</code>;
  // A phone says who this acts as once, under the button, instead of in each sentence.
  const asViewer = login && !phone ? <> as <strong>@{login}</strong></> : null;
  const popover = (label: string, confirm: ReactNode, children: ReactNode, title?: string) => (
    <ConfirmPopover anchor={question.anchor} label={label} {...(title ? { title } : {})} footnote={login ? `as @${login}` : undefined} busy={busy} confirm={confirm} onCancel={onCancel}>{children}</ConfirmPopover>
  );
  const methodPicker = live.repository.methods.length > 1 && (phone ? (
    <div className="mobile-picker-rows">
      <div>
        <IconGitMerge aria-hidden="true" />
        <span>Method</span>
        <Select value={method} disabled={busy} onValueChange={(next) => { if (next) onMethodChange(next as PullRequestMergeMethod); }}>
          <SelectTrigger aria-label="Merge method"><SelectValue>{MERGE_VERBS[method]}</SelectValue></SelectTrigger>
          <SelectContent align="end" alignItemWithTrigger={false} className="pr-merge-method-menu">
            {live.repository.methods.map((option) => (
              <SelectItem key={option} value={option} label={MERGE_VERBS[option]}>
                <span className="pr-merge-method-option">{MERGE_VERBS[option]}<small>{MERGE_HELP[option]}</small></span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  ) : (
    <RadioGroup className="pr-merge-methods" aria-label="Merge method" value={method} disabled={busy} onValueChange={(next) => onMethodChange(next as PullRequestMergeMethod)}>
      {live.repository.methods.map((option) => (
        <label key={option} className="pr-merge-method">
          <Radio.Root value={option} className="pr-merge-radio"><Radio.Indicator className="pr-merge-radio-dot" /></Radio.Root>
          <span>{MERGE_VERBS[option]}<small>{MERGE_HELP[option]}</small></span>
        </label>
      ))}
    </RadioGroup>
  ));
  switch (question.panel) {
    case 'merge': {
      if (live.mergeQueue.enabled) {
        return popover('Confirm adding to the merge queue', <Button size="xs" disabled={busy} onClick={() => onConfirm({ action: 'merge', method: live.repository.defaultMethod })}>{working('Add to merge queue')}</Button>, <>
          <p>Add <strong>{pull}</strong> to the merge queue of {base}{asViewer}?</p>
          <p className="pr-action-note">The queue decides how and when it merges. Take it out of the queue on GitHub.</p>
        </>, 'Add to merge queue');
      }
      const canDelete = canDeleteBranchWithMerge(live);
      return popover('Confirm merge', <Button size="xs" disabled={busy} onClick={() => onConfirm({ action: 'merge', method, ...(canDelete && deleteBranch ? { deleteBranch: true } : {}) })}>{working(MERGE_VERBS[method])}</Button>, <>
        {!phone && <p>{MERGE_VERBS[method]} <strong>{pull}</strong> into {base}{asViewer}?</p>}
        {methodPicker}
        {canDelete && (phone
          ? <MobileSwitchRow label="Delete branch" detail={live.headRefName} icon={<IconGitBranch aria-hidden="true" />} checked={deleteBranch} disabled={busy} onChange={onDeleteBranchChange} />
          : <label className="pr-delete-branch-option"><Checkbox checked={deleteBranch} disabled={busy} onCheckedChange={(checked) => onDeleteBranchChange(checked === true)} /> <span>Delete {branch} after merging</span></label>)}
        {live.repository.deleteBranchOnMerge && <p className="pr-action-note">GitHub deletes {branch} after merging.</p>}
      </>, `Merge ${pull} into ${live.baseRefName}`);
    }
    case 'enable-auto-merge':
      return popover('Confirm auto-merge', <Button size="xs" disabled={busy} onClick={() => onConfirm({ action: 'enable-auto-merge', method })}>{working('Enable auto-merge')}</Button>, <>
        <p>Merge <strong>{pull}</strong> into {base} automatically{asViewer}, once its requirements are met?</p>
        {methodPicker}
      </>, `Auto-merge ${pull}`);
    case 'close':
      return popover('Confirm closing', <Button variant="destructive" size="xs" disabled={busy} onClick={() => onConfirm({ action: 'close' })}>{working('Close pull request')}</Button>,
        <p>Close <strong>{pull}</strong> without merging{asViewer}? You can reopen it later.</p>, `Close ${pull}`);
    case 'delete-branch':
      return popover('Confirm deleting the branch', <Button variant="destructive" size="xs" disabled={busy} onClick={() => onConfirm({ action: 'delete-branch' })}>{working('Delete branch')}</Button>,
        <p>Delete {branch} from <strong>{live.head.owner ?? 'the source repository'}</strong>{asViewer}? This fails if the branch has moved. Local branches are kept.</p>, 'Delete branch');
    case 'revert':
      return popover('Confirm revert', <Button size="xs" disabled={busy} onClick={() => onConfirm({ action: 'revert' })}>{working('Create revert pull request')}</Button>,
        <p>Open a pull request that reverts <strong>{pull}</strong> on {base}{asViewer}? Nothing changes until that pull request is merged.</p>, `Revert ${pull}`);
    case 'approve-workflows':
      return popover('Confirm approving workflows', <Button size="xs" disabled={busy} onClick={() => onConfirm({ action: 'approve-workflows' })}>{working('Approve workflows')}</Button>,
        <p>Let the workflows of <strong>{pull}</strong> from <strong>{live.head.owner ?? 'this fork'}</strong> run{asViewer}? They run this fork's code at <code>{live.headRefOid.slice(0, 7)}</code>. Review it first.</p>, 'Approve workflows');
    case 'rebase-branch':
      return popover('Confirm rebasing the branch', <Button size="xs" disabled={busy} onClick={() => onConfirm({ action: 'update-branch', method: 'REBASE' })}>{working('Rebase branch')}</Button>,
        <p>Rebase {branch} onto {base}{asViewer}? This rewrites its commits, so anyone working on the branch has to reset to the new history.</p>, 'Rebase branch');
  }
}
