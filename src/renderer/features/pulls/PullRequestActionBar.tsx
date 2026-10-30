import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { IconDots, IconExternalLink, IconGitMerge, IconLoader4, IconRefresh } from '@tabler/icons-react';
import { sileo } from 'sileo';
import type { PullRequestAction, PullRequestActionInput, PullRequestActionResult, PullRequestDetails, PullRequestLiveState, PullRequestMergeMethod } from '../../../shared/contracts';
import { allowedPullRequestActions, canDeleteBranchWithMerge, resolvePullRequestPrimary } from '../../../shared/pull-request-actions';
import { ActionConfirmPanel } from '@/components/ActionConfirmPanel';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { ghDetail, ghErrorTitle, isUncertainFailure, openOnGitHub } from './gh-utils';
import { useGitHubAccount } from './useGitHubAccount';

const MERGE_VERBS: Record<PullRequestMergeMethod, string> = { MERGE: 'Merge', SQUASH: 'Squash and merge', REBASE: 'Rebase and merge' };

type ActionRequest = { action: 'merge'; method: PullRequestMergeMethod; deleteBranch?: boolean }
  | { action: 'enable-auto-merge'; method: PullRequestMergeMethod }
  | { action: 'update-branch'; method: 'MERGE' | 'REBASE' }
  | { action: Exclude<PullRequestAction, 'merge' | 'enable-auto-merge' | 'update-branch'> };

/** What each action asks before running. Reversible ones run straight away. */
type Panel = 'merge' | 'enable-auto-merge' | 'close' | 'delete-branch' | 'rebase-branch';

const MENU_LABELS: Partial<Record<PullRequestAction, string>> = {
  merge: 'Merge…',
  'enable-auto-merge': 'Enable auto-merge…',
  ready: 'Mark as ready for review',
  draft: 'Convert to draft',
  close: 'Close pull request…',
  reopen: 'Reopen pull request',
  'delete-branch': 'Delete branch…',
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
  }
}

export function PullRequestActionBar({ repositoryId, details, live, refreshing, statusLabel, onRefresh }: {
  repositoryId: string;
  details: PullRequestDetails;
  live: PullRequestLiveState;
  refreshing: boolean;
  /** Already on screen, so a primary that would only repeat it stays out. */
  statusLabel: string | null;
  onRefresh(): void;
}) {
  const queryClient = useQueryClient();
  const accountQuery = useGitHubAccount(repositoryId);
  const account = accountQuery.data;
  const [panel, setPanel] = useState<Panel | null>(null);
  const [method, setMethod] = useState<PullRequestMergeMethod>(live.repository.defaultMethod);
  const [deleteBranch, setDeleteBranch] = useState(false);
  const closePanel = useCallback(() => setPanel(null), []);

  // A question about a state that no longer holds would mislead, so it goes away with that state.
  const stateKey = [live.state, live.isDraft, live.headRefOid, live.mergeable, live.mergeStateStatus, live.autoMerge?.method, live.mergeQueue.queued].join('|');
  useEffect(() => { setPanel(null); }, [stateKey]);

  const mutation = useMutation({
    mutationFn: (request: ActionRequest) => {
      if (account?.state !== 'ready' || !account.login) throw new Error('Check the GitHub account in Settings and try again.');
      return opentig.github.runPullRequestAction({ ...request, repositoryId, number: details.number, expectedHeadOid: live.headRefOid, expectedAccount: { login: account.login, revision: account.revision } } as PullRequestActionInput);
    },
    onSuccess: (result, request) => {
      setPanel(null);
      if (result.state) queryClient.setQueryData(queryKeys.pullRequestLiveState(repositoryId, details.number), result.state);
      successToast(request, result, details);
      // Merging or removing a branch changes the remote refs even when periodic fetches are off.
      if (result.outcome === 'merged' || request.action === 'delete-branch') void opentig.refs.fetch(repositoryId).catch(() => undefined);
    },
    onError: (reason) => {
      const detail = ghDetail(reason);
      if (isUncertainFailure(reason)) {
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
  const run = (request: ActionRequest) => mutation.mutate(request);

  const open = (next: Panel) => {
    setMethod(live.repository.methods.includes(method) ? method : live.repository.defaultMethod);
    setDeleteBranch(false);
    setPanel(next);
  };
  const start = (action: PullRequestAction) => {
    switch (action) {
      case 'merge': case 'enable-auto-merge': case 'close': case 'delete-branch': open(action); return;
      case 'update-branch': run({ action, method: 'MERGE' }); return;
      default: run({ action });
    }
  };

  const primary = resolvePullRequestPrimary(live);
  const primaryAction = primary.kind === 'action' ? primary.action : null;
  const allowed = allowedPullRequestActions(live);
  const menuActions = allowed.filter((action) => action !== primaryAction && action !== 'update-branch' && action !== 'disable-auto-merge');
  const canUpdateBranch = allowed.includes('update-branch');
  const canDisableAutoMerge = allowed.includes('disable-auto-merge');
  const accountReady = account?.state === 'ready' && Boolean(account.login);
  const hasMenu = menuActions.length > 0 || canUpdateBranch;

  return (
    <>
      <span className="pr-action-bar">
        {primary.kind === 'text' && primary.label !== statusLabel && primary.label !== 'Draft' && <span className="pr-action-reason">{primary.label}</span>}
        {primary.kind === 'retry' && <>
          <span className="pr-action-reason">{primary.label}</span>
          <Button variant="ghost" size="xs" disabled={refreshing} onClick={onRefresh}>{refreshing ? <IconLoader4 className="animate-spin" /> : <IconRefresh />} Retry</Button>
        </>}
        {primary.kind === 'github' && details.url && <Button variant="outline" size="xs" onClick={() => openOnGitHub(details.url)}><IconExternalLink /> {primary.label}</Button>}
        {canDisableAutoMerge && <Button variant="outline" size="xs" disabled={busy || !accountReady} onClick={() => run({ action: 'disable-auto-merge' })}>Disable auto-merge</Button>}
        {primary.kind === 'action' && (
          <Button size="xs" disabled={busy || !accountReady || panel !== null} onClick={() => start(primary.action)}>
            {busy ? <IconLoader4 className="animate-spin" /> : primary.action === 'merge' || primary.action === 'enable-auto-merge' ? <IconGitMerge /> : null}
            {busy ? <ShimmeringText text="Working…" /> : primary.label}
          </Button>
        )}
        {hasMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label="More pull request actions" disabled={busy || !accountReady} />}><IconDots /></DropdownMenuTrigger>
            <DropdownMenuContent>
              {canUpdateBranch && primaryAction !== 'update-branch' && <DropdownMenuItem onClick={() => run({ action: 'update-branch', method: 'MERGE' })}>Update branch with merge</DropdownMenuItem>}
              {canUpdateBranch && <DropdownMenuItem onClick={() => open('rebase-branch')}>Update branch with rebase…</DropdownMenuItem>}
              {menuActions.map((action) => <DropdownMenuItem key={action} onClick={() => start(action)}>{MENU_LABELS[action]}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </span>
      {panel && (
        <div className="pr-action-panel">
          <ConfirmPanel panel={panel} live={live} details={details} login={account?.login ?? ''} busy={busy} method={method} deleteBranch={deleteBranch} onMethodChange={setMethod} onDeleteBranchChange={setDeleteBranch} onCancel={closePanel} onConfirm={run} />
        </div>
      )}
    </>
  );
}

function ConfirmPanel({ panel, live, details, login, busy, method, deleteBranch, onMethodChange, onDeleteBranchChange, onCancel, onConfirm }: {
  panel: Panel;
  live: PullRequestLiveState;
  details: PullRequestDetails;
  login: string;
  busy: boolean;
  method: PullRequestMergeMethod;
  deleteBranch: boolean;
  onMethodChange(method: PullRequestMergeMethod): void;
  onDeleteBranchChange(value: boolean): void;
  onCancel(): void;
  onConfirm(request: ActionRequest): void;
}) {
  const working = (label: string) => busy ? <><IconLoader4 className="animate-spin" /> <ShimmeringText text="Working…" /></> : label;
  const pull = `#${details.number}`;
  const base = <code>{live.baseRefName}</code>;
  const branch = <code>{live.headRefName}</code>;
  const asViewer = login ? <> as <strong>@{login}</strong></> : null;
  const methodPicker = live.repository.methods.length > 1 && (
    <Select value={method} onValueChange={(next) => { if (next) onMethodChange(next); }} disabled={busy}>
      <SelectTrigger size="sm" className="pr-merge-method" aria-label="Merge method"><SelectValue>{MERGE_VERBS[method]}</SelectValue></SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}>
        {live.repository.methods.map((option) => <SelectItem key={option} value={option} label={MERGE_VERBS[option]}>{MERGE_VERBS[option]}</SelectItem>)}
      </SelectContent>
    </Select>
  );
  switch (panel) {
    case 'merge': {
      if (live.mergeQueue.enabled) {
        return (
          <ActionConfirmPanel tone="neutral" busy={busy} onCancel={onCancel} confirm={<Button size="sm" disabled={busy} onClick={() => onConfirm({ action: 'merge', method: live.repository.defaultMethod })}>{working('Add to merge queue')}</Button>}>
            <p>Add <strong>{pull}</strong> to the merge queue of {base}{asViewer}?</p>
            <p className="pr-action-note">The queue decides how and when it merges. Take it out of the queue on GitHub.</p>
          </ActionConfirmPanel>
        );
      }
      const canDelete = canDeleteBranchWithMerge(live);
      return (
        <ActionConfirmPanel tone="neutral" busy={busy} onCancel={onCancel} confirm={<Button size="sm" disabled={busy} onClick={() => onConfirm({ action: 'merge', method, ...(canDelete && deleteBranch ? { deleteBranch: true } : {}) })}>{working(MERGE_VERBS[method])}</Button>}>
          <p>{MERGE_VERBS[method]} <strong>{pull}</strong> into {base}{asViewer}?</p>
          {(methodPicker || canDelete) && <div className="action-confirm-fields">
            {methodPicker}
            {canDelete && <label className="pr-delete-branch-option"><Checkbox checked={deleteBranch} disabled={busy} onCheckedChange={(checked) => onDeleteBranchChange(checked === true)} /> Delete branch after merging</label>}
          </div>}
          {live.repository.deleteBranchOnMerge && <p className="pr-action-note">GitHub deletes {branch} after merging.</p>}
        </ActionConfirmPanel>
      );
    }
    case 'enable-auto-merge':
      return (
        <ActionConfirmPanel tone="neutral" busy={busy} onCancel={onCancel} confirm={<Button size="sm" disabled={busy} onClick={() => onConfirm({ action: 'enable-auto-merge', method })}>{working('Enable auto-merge')}</Button>}>
          <p>Merge <strong>{pull}</strong> into {base} automatically{asViewer}, once its requirements are met?</p>
          {methodPicker && <div className="action-confirm-fields">{methodPicker}</div>}
        </ActionConfirmPanel>
      );
    case 'close':
      return (
        <ActionConfirmPanel busy={busy} onCancel={onCancel} confirm={<Button variant="destructive" size="sm" disabled={busy} onClick={() => onConfirm({ action: 'close' })}>{working('Close pull request')}</Button>}>
          <p>Close <strong>{pull}</strong> without merging{asViewer}? You can reopen it later.</p>
        </ActionConfirmPanel>
      );
    case 'delete-branch':
      return (
        <ActionConfirmPanel busy={busy} onCancel={onCancel} confirm={<Button variant="destructive" size="sm" disabled={busy} onClick={() => onConfirm({ action: 'delete-branch' })}>{working('Delete branch')}</Button>}>
          <p>Delete {branch} from <strong>{live.head.owner ?? 'the source repository'}</strong>{asViewer}? This fails if the branch has moved. Local branches are kept.</p>
        </ActionConfirmPanel>
      );
    case 'rebase-branch':
      return (
        <ActionConfirmPanel tone="warning" busy={busy} onCancel={onCancel} confirm={<Button size="sm" disabled={busy} onClick={() => onConfirm({ action: 'update-branch', method: 'REBASE' })}>{working('Rebase branch')}</Button>}>
          <p>Rebase {branch} onto {base}{asViewer}? This rewrites its commits, so anyone working on the branch has to reset to the new history.</p>
        </ActionConfirmPanel>
      );
  }
}
