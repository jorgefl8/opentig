import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  IconAlertTriangle, IconCheck, IconCopy, IconExternalLink, IconGitBranch, IconGitCommit, IconHierarchy2,
  IconLoader4, IconRefresh, IconSearch, IconTrash, IconX,
} from '@tabler/icons-react';
import type { PullRequestSummary, RecentRepository } from '../../../shared/contracts';
import type { BranchDetails, LocalRefsSnapshot, WorktreeDetails } from '../../../shared/git-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogClose, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  branchBadges, branchDeleteEligibility, branchDetailBadges, branchKey, filterBranches, filterWorktrees,
  localChangeSummary, nextSelectionKey, worktreeBadges, worktreeKey, worktreeName, worktreeRemoveEligibility,
  type LocalRefsTab, type RefBadge,
} from './local-refs-model';
import { openOnGitHub } from '@/features/pulls/gh-utils';
import { queryKeys } from '@/lib/query-client';

interface LocalRefsDialogProps {
  open: boolean;
  tab: LocalRefsTab;
  repositoryId: string;
  /** True while a destructive manager operation is pending anywhere in the app. */
  onOpenChange(open: boolean): void;
  onTabChange(tab: LocalRefsTab): void;
  /** Reuses the toolbar's existing worktree switching flow. */
  onOpenWorktree(path: string): void;
  /** Called after any successful mutation so the app can refresh in the background. */
  onMutated(recentRepositories: RecentRepository[] | null): void;
  onBusyChange(busy: boolean): void;
}

export function LocalRefsDialog(props: LocalRefsDialogProps) {
  const { open, tab, repositoryId, onMutated, onBusyChange } = props;
  const [query, setQuery] = useState('');
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [selectedWorktree, setSelectedWorktree] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // The previous ordering, so a deleted row hands its place to a neighbour.
  const snapshotRef = useRef<LocalRefsSnapshot | null>(null);

  const snapshotQuery = useQuery({
    queryKey: queryKeys.localRefs(repositoryId),
    queryFn: () => window.justgit.refs.localRefsSnapshot(repositoryId),
    enabled: open,
  });
  const snapshot = snapshotQuery.data ?? null;
  const loading = snapshotQuery.isFetching;
  const error = snapshotQuery.error ? messageOf(snapshotQuery.error) : null;

  const branches = useMemo(() => filterBranches(snapshot?.branches ?? [], query), [snapshot, query]);
  const worktrees = useMemo(() => filterWorktrees(snapshot?.worktrees ?? [], query), [snapshot, query]);
  const branch = branches.find((item) => branchKey(item) === selectedBranch) ?? null;
  const worktree = worktrees.find((item) => worktreeKey(item) === selectedWorktree) ?? null;
  const branchDetailsQuery = useQuery({
    queryKey: queryKeys.branchDetails(repositoryId, branch?.fullName ?? ''),
    queryFn: () => window.justgit.refs.branchDetails({ repositoryId, fullName: branch!.fullName }),
    enabled: open && tab === 'branches' && branch !== null,
  });
  const branchDetails = branchDetailsQuery.data ?? null;
  const branchPullRequestQuery = useQuery({
    queryKey: queryKeys.branchPullRequest(repositoryId, branchDetails?.name ?? ''),
    queryFn: () => window.justgit.github.findPullRequestForBranch(repositoryId, branchDetails!.name),
    enabled: open && tab === 'branches' && branchDetails !== null && (branchDetails.deletion === 'unknown' || branchDetails.deletion === 'unmerged'),
  });
  const branchPullRequest = branchPullRequestQuery.data ?? null;
  const worktreeDetailsQuery = useQuery({
    queryKey: queryKeys.worktreeDetails(repositoryId, worktree?.path ?? ''),
    queryFn: () => window.justgit.refs.worktreeDetails({ repositoryId, path: worktree!.path }),
    enabled: open && tab === 'worktrees' && worktree !== null,
  });
  const worktreeDetails = worktreeDetailsQuery.data ?? null;
  const activeDetailsQuery = tab === 'branches' ? branchDetailsQuery : worktreeDetailsQuery;
  const detailsLoading = activeDetailsQuery.isFetching;
  const detailsError = activeDetailsQuery.error ? messageOf(activeDetailsQuery.error) : null;

  const load = useCallback(async () => { await snapshotQuery.refetch(); }, [snapshotQuery]);

  useEffect(() => {
    if (!snapshot) return;
    const previous = snapshotRef.current;
    snapshotRef.current = snapshot;
    setSelectedBranch((selected) => nextSelectionKey(snapshot.branches.map(branchKey), (previous?.branches ?? []).map(branchKey), selected));
    setSelectedWorktree((selected) => nextSelectionKey(snapshot.worktrees.map(worktreeKey), (previous?.worktrees ?? []).map(worktreeKey), selected));
  }, [snapshot]);

  useEffect(() => {
    if (open) return;
    setQuery('');
    setConfirming(null);
    setActionError(null);
    setCopied(false);
  }, [open]);

  useEffect(() => {
    setConfirming(null);
    setActionError(null);
    setCopied(false);
  }, [tab, selectedBranch, selectedWorktree]);

  const run = async (operation: string, action: () => Promise<boolean>) => {
    setBusy(operation);
    onBusyChange(true);
    setActionError(null);
    try {
      if (await action()) setConfirming(null);
    } catch (reason) {
      setActionError(messageOf(reason));
    } finally {
      setBusy(null);
      onBusyChange(false);
    }
  };

  const deleteBranch = (target: BranchDetails, force: boolean) => run('delete-branch', async () => {
    const result = await window.justgit.refs.deleteBranch({ repositoryId, fullName: target.fullName, expectedOid: target.oid, force });
    if (result.status !== 'deleted') {
      setActionError(branchFailure(result.status));
      await load();
      return false;
    }
    onMutated(null);
    await load();
    return true;
  });

  const removeWorktree = (target: WorktreeDetails, force: boolean, deleteBranch: boolean) => run('remove-worktree', async () => {
    const result = await window.justgit.refs.removeWorktree({ repositoryId, path: target.path, expectedOid: target.oid, force, deleteBranch });
    if (result.status !== 'removed') {
      setActionError(worktreeFailure(result.status));
      await load();
      return false;
    }
    onMutated(result.recentRepositories);
    await load();
    return true;
  });

  const copyPath = async (value: string) => {
    try {
      await window.justgit.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (reason) {
      setActionError(messageOf(reason));
    }
  };

  const counts = { branches: snapshot?.branches.length ?? 0, worktrees: snapshot?.worktrees.length ?? 0 };
  const listEmpty = tab === 'branches' ? branches.length === 0 : worktrees.length === 0;

  return (
    <Dialog open={open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="local-refs-dialog">
        <header className="local-refs-header">
          <div>
            <DialogTitle>Local branches and worktrees</DialogTitle>
            <DialogDescription>Inspect what this repository holds locally, and retire what Git can safely remove.</DialogDescription>
          </div>
          <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label="Close the local refs manager" />}><IconX /></DialogClose>
        </header>

        <div className="local-refs-toolbar">
          <div className="local-refs-tabs" role="tablist" aria-label="Local refs">
            {(['branches', 'worktrees'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                id={`local-refs-tab-${value}`}
                aria-selected={tab === value}
                aria-controls={`local-refs-panel-${value}`}
                className="local-refs-tab"
                onClick={() => props.onTabChange(value)}
              >
                {value === 'branches' ? <IconGitBranch aria-hidden="true" /> : <IconHierarchy2 aria-hidden="true" />}
                <span>{value === 'branches' ? 'Branches' : 'Worktrees'}</span>
                <small>{counts[value]}</small>
              </button>
            ))}
          </div>
          <div className="local-refs-search">
            <IconSearch aria-hidden="true" />
            <label className="sr-only" htmlFor="local-refs-search-input">Search {tab}</label>
            <input
              id="local-refs-search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tab === 'branches' ? 'Search branches…' : 'Search worktrees…'}
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <Button variant="ghost" size="icon-xs" aria-label="Clear search" onClick={() => setQuery('')}><IconX /></Button>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || Boolean(busy)}>
            {loading ? <IconLoader4 className="animate-spin" /> : <IconRefresh />} Refresh
          </Button>
        </div>

        {error && <div className="local-refs-error" role="alert"><IconAlertTriangle aria-hidden="true" /><span>{error}</span></div>}

        <div
          key={tab}
          className="local-refs-body"
          role="tabpanel"
          id={`local-refs-panel-${tab}`}
          aria-labelledby={`local-refs-tab-${tab}`}
        >
          <div className="local-refs-list" role="listbox" aria-label={tab === 'branches' ? 'Local branches' : 'Worktrees'} tabIndex={-1}>
            {loading && !snapshot && <p className="local-refs-placeholder"><IconLoader4 className="animate-spin" aria-hidden="true" /> Reading the repository…</p>}
            {!loading && listEmpty && (
              <p className="local-refs-placeholder">{query ? 'No matches for this search.' : `This repository has no ${tab === 'branches' ? 'local branches' : 'worktrees'}.`}</p>
            )}
            {tab === 'branches' && branches.map((item) => (
              <Tooltip key={branchKey(item)}>
                <TooltipTrigger render={
                  <button
                    type="button"
                    role="option"
                    aria-selected={branchKey(item) === selectedBranch}
                    className="local-refs-row"
                    onClick={() => setSelectedBranch(branchKey(item))}
                  />
                }>
                  <span className="local-refs-row-head">
                    <IconGitBranch aria-hidden="true" />
                    <strong>{item.name}</strong>
                    <BadgeRow badges={branchBadges(item)} />
                  </span>
                  <small className="local-refs-row-meta">
                    <code>{item.shortOid}</code>
                    {item.subject && <span>{item.subject}</span>}
                    {item.date && <time dateTime={item.date}>{formatDate(item.date)}</time>}
                  </small>
                </TooltipTrigger>
                <TooltipContent>{item.name}{item.subject ? ` — ${item.subject}` : ''}</TooltipContent>
              </Tooltip>
            ))}
            {tab === 'worktrees' && worktrees.map((item) => (
              <Tooltip key={worktreeKey(item)}>
                <TooltipTrigger render={
                  <button
                    type="button"
                    role="option"
                    aria-selected={worktreeKey(item) === selectedWorktree}
                    className="local-refs-row"
                    onClick={() => setSelectedWorktree(worktreeKey(item))}
                  />
                }>
                  <span className="local-refs-row-head">
                    <IconHierarchy2 aria-hidden="true" />
                    <strong>{worktreeName(item.path)}</strong>
                    <BadgeRow badges={worktreeBadges(item)} />
                  </span>
                  <small className="local-refs-row-meta">
                    <span className="local-refs-row-branch">{item.branch ? `${item.branch}` : 'Detached HEAD'}</span>
                    <span>{item.path}</span>
                  </small>
                </TooltipTrigger>
                <TooltipContent>{worktreeName(item.path)} — {item.path}</TooltipContent>
              </Tooltip>
            ))}
          </div>

          <div className="local-refs-detail">
            {detailsError && <div className="local-refs-error" role="alert"><IconAlertTriangle aria-hidden="true" /><span>{detailsError}</span></div>}
            {detailsLoading && <p className="local-refs-placeholder"><IconLoader4 className="animate-spin" aria-hidden="true" /> Loading details…</p>}
            {!detailsLoading && !detailsError && tab === 'branches' && branchDetails && branch && (
              <BranchDetailPanel
                details={branchDetails}
                pullRequest={branchPullRequest}
                busy={busy === 'delete-branch'}
                anyBusy={Boolean(busy)}
                confirming={confirming === 'delete-branch'}
                actionError={actionError}
                onConfirm={() => setConfirming('delete-branch')}
                onCancel={() => setConfirming(null)}
                onDelete={(force) => void deleteBranch(branchDetails, force)}
              />
            )}
            {!detailsLoading && !detailsError && tab === 'worktrees' && worktreeDetails && worktree && (
              <WorktreeDetailPanel
                details={worktreeDetails}
                busy={busy === 'remove-worktree'}
                anyBusy={Boolean(busy)}
                confirming={confirming === 'remove-worktree'}
                actionError={actionError}
                copied={copied}
                onConfirm={() => setConfirming('remove-worktree')}
                onCancel={() => setConfirming(null)}
                onRemove={(force, deleteBranch) => void removeWorktree(worktreeDetails, force, deleteBranch)}
                onCopyPath={() => void copyPath(worktreeDetails.path)}
                onOpen={() => props.onOpenWorktree(worktreeDetails.path)}
                onShowBranch={() => {
                  if (!worktreeDetails.branch) return;
                  setSelectedBranch(`refs/heads/${worktreeDetails.branch}`);
                  props.onTabChange('branches');
                }}
              />
            )}
            {!detailsLoading && !detailsError && !branch && !worktree && (
              <p className="local-refs-placeholder">Select a {tab === 'branches' ? 'branch' : 'worktree'} to see its details.</p>
            )}
          </div>
        </div>

        <footer className="local-refs-footer">
          <small>Deleting a branch and removing a worktree are separate actions. A worktree removes its branch only when explicitly selected.</small>
          <DialogClose render={<Button variant="outline" size="sm" disabled={Boolean(busy)} />}>Done</DialogClose>
        </footer>
      </DialogPopup>
    </Dialog>
  );
}

function BranchDetailPanel({ details, pullRequest, busy, anyBusy, confirming, actionError, onConfirm, onCancel, onDelete }: {
  details: BranchDetails; pullRequest: PullRequestSummary | null; busy: boolean; anyBusy: boolean; confirming: boolean; actionError: string | null;
  onConfirm(): void; onCancel(): void; onDelete(force: boolean): void;
}) {
  const eligibility = branchDeleteEligibility(details, pullRequest);
  const force = eligibility.forceAllowed === true;
  const deletionAllowed = eligibility.allowed || force;
  return (
    <>
      <div className="local-refs-detail-head">
        <h3><IconGitBranch aria-hidden="true" /><Tooltip><TooltipTrigger render={<span />}>{details.name}</TooltipTrigger><TooltipContent>{details.name}</TooltipContent></Tooltip></h3>
        <BadgeRow badges={branchDetailBadges(details)} />
      </div>
      <dl className="local-refs-facts">
        <Fact label="Full ref"><code className="local-refs-selectable">{details.fullName}</code></Fact>
        <Fact label="Tip"><code>{details.shortOid}</code> {details.subject}</Fact>
        <Fact label="Author">{details.author || '—'}</Fact>
        <Fact label="Last commit">{details.date ? formatDate(details.date, true) : '—'}</Fact>
        <Fact label="Upstream">{details.upstream ? `${details.upstream} · ↑${details.ahead} ↓${details.behind}` : 'Not configured'}</Fact>
        <Fact label="Compared with">{details.comparisonBase ?? 'Not compared'}</Fact>
        {pullRequest && (
          <Fact label="GitHub PR">
            <button type="button" className="local-refs-pr-link" onClick={() => openOnGitHub(pullRequest.url)}>
              #{pullRequest.number} · {pullRequest.state === 'MERGED' ? `Merged into ${pullRequest.baseRefName}` : pullRequest.state === 'OPEN' ? 'Open' : 'Closed'} <IconExternalLink aria-hidden="true" />
            </button>
          </Fact>
        )}
      </dl>
      <DestructiveSection
        tone={eligibility.allowed ? 'ready' : 'blocked'}
        reason={eligibility.reason}
        actionError={actionError}
        confirming={confirming}
        busy={busy}
        anyBusy={anyBusy}
        actionLabel={force ? 'Force delete branch' : 'Delete branch'}
        confirmLabel={busy ? 'Deleting…' : force ? 'Permanently delete' : 'Delete branch'}
        allowed={deletionAllowed}
        confirmation={force
          ? <>Force-delete the local branch <strong>{details.name}</strong>? This keeps any remote branch and pull request, but commits found only on this local branch may become inaccessible. {pullRequest?.state === 'MERGED' ? <>GitHub reports PR <strong>#{pullRequest.number}</strong> as merged into <strong>{pullRequest.baseRefName}</strong>, although local Git cannot verify the ancestry.</> : null}</>
          : <>Delete the local branch <strong>{details.name}</strong>? This removes only the local branch, keeping every worktree and any remote copy. Git confirmed it is fully merged into <strong>{details.comparisonBase}</strong>.</>}
        onConfirm={onConfirm}
        onCancel={onCancel}
        onAct={() => onDelete(force)}
      />
    </>
  );
}

function WorktreeDetailPanel({ details, busy, anyBusy, confirming, actionError, copied, onConfirm, onCancel, onRemove, onCopyPath, onOpen, onShowBranch }: {
  details: WorktreeDetails; busy: boolean; anyBusy: boolean; confirming: boolean; actionError: string | null; copied: boolean;
  onConfirm(): void; onCancel(): void; onRemove(force: boolean, deleteBranch: boolean): void; onCopyPath(): void; onOpen(): void; onShowBranch(): void;
}) {
  const [deleteBranch, setDeleteBranch] = useState(false);
  const eligibility = worktreeRemoveEligibility(details);
  const changes = localChangeSummary(details);
  const force = eligibility.forceAllowed === true;
  const removalAllowed = eligibility.allowed || force;
  useEffect(() => setDeleteBranch(false), [details.path]);
  return (
    <>
      <div className="local-refs-detail-head">
        <h3><IconHierarchy2 aria-hidden="true" /><Tooltip><TooltipTrigger render={<span />}>{worktreeName(details.path)}</TooltipTrigger><TooltipContent>{worktreeName(details.path)}</TooltipContent></Tooltip></h3>
        <BadgeRow badges={worktreeBadges(details)} />
      </div>
      <dl className="local-refs-facts">
        <Fact label="Folder"><span className="local-refs-path local-refs-selectable">{details.path}</span></Fact>
        <Fact label="Branch">{details.branch ?? 'Detached HEAD'}</Fact>
        <Fact label="HEAD">
          {details.lastCommit
            ? <><code>{details.lastCommit.shortOid}</code> {details.lastCommit.subject}</>
            : <code>{details.oid ? details.oid.slice(0, 7) : '—'}</code>}
        </Fact>
        <Fact label="Committed">{details.lastCommit?.date ? formatDate(details.lastCommit.date, true) : '—'}</Fact>
        <Fact label="Local changes">{details.available ? (changes ?? 'None') : 'Not readable'}</Fact>
      </dl>
      <div className="local-refs-detail-actions">
        <Button variant="outline" size="sm" onClick={onCopyPath} disabled={anyBusy}>
          {copied ? <IconCheck /> : <IconCopy />} {copied ? 'Copied' : 'Copy path'}
        </Button>
        {!details.current && details.available && !details.locked && (
          <Button variant="outline" size="sm" onClick={onOpen} disabled={anyBusy}><IconExternalLink /> Open worktree</Button>
        )}
        {details.branch && (
          <Button variant="ghost" size="sm" onClick={onShowBranch} disabled={anyBusy}><IconGitBranch /> Show branch</Button>
        )}
      </div>
      {details.branch && removalAllowed && (
        <label htmlFor="remove-worktree-delete-branch" className="local-refs-delete-branch">
          <Checkbox id="remove-worktree-delete-branch" checked={deleteBranch} onCheckedChange={(checked) => setDeleteBranch(checked === true)} disabled={anyBusy} />
          <span>Also delete branch <strong>{details.branch}</strong></span>
        </label>
      )}
      <DestructiveSection
        tone={eligibility.allowed ? 'ready' : 'blocked'}
        reason={eligibility.reason}
        actionError={actionError}
        confirming={confirming}
        busy={busy}
        anyBusy={anyBusy}
        actionLabel={force ? 'Force remove worktree' : 'Remove worktree'}
        confirmLabel={busy ? 'Removing…' : force ? 'Permanently remove' : 'Remove worktree'}
        allowed={removalAllowed}
        confirmation={<>
          {force
            ? <>Permanently remove the worktree at <strong className="local-refs-path">{details.path}</strong>? <strong>{changes ?? `The ${details.operation ?? 'current Git operation'}`}</strong> and every uncommitted file will be lost. The folder is deleted from disk and is <strong>not</strong> moved to the Recycle Bin. </>
            : <>Remove the worktree at <strong className="local-refs-path">{details.path}</strong>? The folder is deleted from disk and is <strong>not</strong> moved to the Recycle Bin. </>}
          {deleteBranch && details.branch
            ? <>The branch <strong>{details.branch}</strong> will also be force-deleted. Commits found only on that branch may become inaccessible.</>
            : details.branch ? <>The branch <strong>{details.branch}</strong> and its commits stay in the repository.</> : 'No branch is deleted.'}
        </>}
        onConfirm={onConfirm}
        onCancel={onCancel}
        onAct={() => onRemove(force, deleteBranch)}
      />
    </>
  );
}

/**
 * Renders the destructive control only for a backend state Git can act on;
 * every other state gets an explanation and no button at all.
 */
function DestructiveSection({ tone, reason, actionError, confirming, busy, anyBusy, allowed, actionLabel, confirmLabel, confirmation, onConfirm, onCancel, onAct }: {
  tone: 'ready' | 'blocked'; reason: string; actionError: string | null; confirming: boolean; busy: boolean; anyBusy: boolean;
  allowed: boolean; actionLabel: string; confirmLabel: string; confirmation: ReactNode;
  onConfirm(): void; onCancel(): void; onAct(): void;
}) {
  return (
    <div className={`local-refs-danger ${tone}`}>
      {actionError && <p className="local-refs-danger-error" role="alert"><IconAlertTriangle aria-hidden="true" /><span>{actionError}</span></p>}
      {confirming && allowed ? (
        <div className="local-refs-confirm" role="alert">
          <IconAlertTriangle aria-hidden="true" />
          <p>{confirmation}</p>
          <span className="local-refs-confirm-actions">
            <Button variant="destructive" size="sm" onClick={onAct} disabled={busy}>
              {busy ? <IconLoader4 className="animate-spin" /> : <IconTrash />} {confirmLabel}
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
          </span>
        </div>
      ) : (
        <>
          <p className="local-refs-reason">
            {tone === 'ready' ? <IconGitCommit aria-hidden="true" /> : <IconAlertTriangle aria-hidden="true" />}
            <span>{reason}</span>
          </p>
          {allowed && <Button variant="destructive" size="sm" onClick={onConfirm} disabled={anyBusy}><IconTrash /> {actionLabel}</Button>}
        </>
      )}
    </div>
  );
}

function BadgeRow({ badges }: { badges: RefBadge[] }) {
  if (badges.length === 0) return null;
  return (
    <span className="local-refs-badges">
      {badges.map((badge) => (
        <Badge key={badge.label} variant={badge.tone === 'current' ? 'default' : badge.tone === 'warning' ? 'destructive' : 'outline'}>{badge.label}</Badge>
      ))}
    </span>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="local-refs-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function branchFailure(status: string): string {
  switch (status) {
    case 'stale': return 'The branch moved since this view loaded. It was refreshed; check the new state before deleting.';
    case 'current': return 'This branch is now checked out here, so Git will not delete it.';
    case 'checked-out': return 'Another worktree now has this branch checked out.';
    case 'unmerged': return 'Git found commits that are not in the comparison base, so the branch was kept.';
    case 'unknown': return 'The comparison base is not available locally, so the branch was kept.';
    default: return 'The branch no longer exists.';
  }
}

function worktreeFailure(status: string): string {
  switch (status) {
    case 'stale': return 'The worktree moved since this view loaded. It was refreshed; check the new state before removing.';
    case 'main': return 'Git can never remove the main worktree.';
    case 'current': return 'JustGit has this worktree open. Switch to another one first.';
    case 'dirty': return 'The worktree has local changes or an operation in progress, so it was kept.';
    case 'locked': return 'The worktree is locked. Unlock it in Git first.';
    case 'prunable': return 'Git can no longer find this worktree on disk.';
    case 'bare': return 'This entry is a bare repository, not a removable worktree.';
    default: return 'The worktree no longer exists.';
  }
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function formatDate(value: string, withTime = false): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(date);
}
