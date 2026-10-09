import { useEffect, useState } from 'react';
import { IconAlertTriangle, IconCloud, IconExternalLink, IconGitBranch, IconGitMerge, IconGitPullRequest, IconGitPullRequestClosed, IconLoader4, IconRefresh, IconTrash } from '@tabler/icons-react';
import type { RemoteBranchDetails } from '@shared/git-types';
import type { PullRequestSummary } from '@shared/contracts';
import { formatDateTime } from '@shared/date-format';
import { Button } from '@/components/ui/button';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { openOnGitHub, prStateLabel } from '@/features/pulls/gh-utils';

interface Props {
  details: RemoteBranchDetails;
  pullRequest: PullRequestSummary | null;
  anyBusy: boolean;
  creating: boolean;
  deleting: boolean;
  fetching: boolean;
  confirming: boolean;
  onConfirm(): void;
  onCancel(): void;
  onDelete(): void;
  onCreate(name: string): void;
  onFetch(): void;
  onShowLocal(fullName: string): void;
}

export function RemoteBranchDetailPanel(props: Props) {
  const { details, pullRequest, anyBusy } = props;
  const missing = details.remoteState === 'missing';
  const [createOpen, setCreateOpen] = useState(false);
  const [localName, setLocalName] = useState(details.branchName);
  useEffect(() => { setCreateOpen(false); setLocalName(details.branchName); }, [details.fullName, details.branchName]);
  return <>
    <div className="local-refs-detail-head">
      <h3><IconCloud aria-hidden="true" /><span>{details.remote}/{details.branchName}</span></h3>
      <small className="local-refs-remote-label">{missing ? 'Deleted on remote · Cached reference' : `Remote branch${details.defaultBranch === details.branchName ? ' · Default' : ''}`}</small>
    </div>
    <dl className="local-refs-facts">
      <div className="local-refs-fact"><dt>Remote</dt><dd>{details.remote}</dd></div>
      <div className="local-refs-fact"><dt>Full ref</dt><dd><code className="local-refs-selectable">{details.fullName}</code></dd></div>
      <div className="local-refs-fact"><dt>Fetched tip</dt><dd><code>{details.shortOid}</code> {details.subject}</dd></div>
      <div className="local-refs-fact"><dt>Author</dt><dd>{details.author || '—'}</dd></div>
      <div className="local-refs-fact"><dt>Last commit</dt><dd>{details.date ? formatDateTime(details.date) : '—'}</dd></div>
      <div className="local-refs-fact"><dt>Local branches</dt><dd>{details.localBranches.length
        ? details.localBranches.map(branch => <button key={branch.fullName} type="button" className="local-refs-local-link" disabled={anyBusy} onClick={() => props.onShowLocal(branch.fullName)}><IconGitBranch aria-hidden="true" />{branch.name}{branch.worktreePath ? ' · In a worktree' : ''}</button>)
        : 'No local tracking branch'}
        {!missing && !createOpen && <div className="local-refs-tracking-action">
          <button type="button" className="local-refs-local-link" disabled={anyBusy} onClick={() => setCreateOpen(true)}><IconGitBranch aria-hidden="true" />{details.localBranches.length ? 'Create another local tracking branch…' : 'Create local tracking branch…'}</button>
          <small>Work on this branch locally without switching your checkout.</small>
        </div>}
      </dd></div>
      {pullRequest && <div className="local-refs-fact"><dt>GitHub PR</dt><dd>
        <button type="button" className={`local-refs-pr-link ${pullRequest.state.toLowerCase()}${pullRequest.state === 'OPEN' && pullRequest.isDraft ? ' draft' : ''}`} onClick={() => openOnGitHub(pullRequest.url)}>
          {pullRequest.state === 'MERGED' ? <IconGitMerge aria-hidden="true" /> : pullRequest.state === 'CLOSED' ? <IconGitPullRequestClosed aria-hidden="true" /> : <IconGitPullRequest aria-hidden="true" />}
          #{pullRequest.number} · {pullRequest.state === 'MERGED' ? `Merged into ${pullRequest.baseRefName}` : prStateLabel(pullRequest)}<IconExternalLink aria-hidden="true" />
        </button>
      </dd></div>}
    </dl>
    {createOpen && !missing && <form className="local-refs-create-branch" onSubmit={(event) => { event.preventDefault(); if (!anyBusy && localName.trim()) props.onCreate(localName.trim()); }}>
      <label htmlFor="tracking-branch-name">Local branch name</label>
      <input id="tracking-branch-name" value={localName} onChange={(event) => setLocalName(event.target.value)} disabled={anyBusy} autoFocus autoComplete="off" spellCheck={false} />
      <p>Creates a tracking branch at the fetched tip. Your checkout and uncommitted changes stay intact.</p>
      <div className="local-refs-detail-actions"><Button type="submit" variant="outline" size="sm" disabled={anyBusy || !localName.trim()}>{props.creating ? <IconLoader4 className="animate-spin" /> : <IconGitBranch />} {props.creating ? <ShimmeringText text="Creating…" /> : 'Create local branch'}</Button><Button type="button" variant="ghost" size="sm" disabled={anyBusy} onClick={() => setCreateOpen(false)}>Cancel</Button></div>
    </form>}
    <div className={`local-refs-danger ${details.deletionBlockedReason ? 'blocked' : 'ready'}`}>
      {details.deletionBlockedReason ? <>
        <p className="local-refs-reason"><IconAlertTriangle aria-hidden="true" /><span>{missing ? `This branch was already deleted from ${details.remote}. Only its cached reference remains; there is no remote branch to delete.` : details.deletionBlockedReason}</span></p>
        {missing && <Button variant="outline" size="sm" disabled={anyBusy} onClick={props.onFetch}>{props.fetching ? <IconLoader4 className="animate-spin" /> : <IconRefresh />}{props.fetching ? <ShimmeringText text="Fetching…" /> : 'Fetch and clean up'}</Button>}
      </>
        : props.confirming ? <div className="local-refs-confirm" role="alert">
          <IconAlertTriangle aria-hidden="true" />
          <p>Delete <strong>{details.branchName}</strong> from <strong>{details.remote}</strong>? This removes the branch on the remote server. Your local branches, commits and worktrees stay intact.</p>
          <span className="local-refs-confirm-actions"><Button variant="destructive" size="sm" disabled={anyBusy} onClick={props.onDelete}>{props.deleting ? <IconLoader4 className="animate-spin" /> : <IconTrash />}{props.deleting ? <ShimmeringText text="Deleting…" /> : `Delete from ${details.remote}`}</Button><Button variant="ghost" size="sm" disabled={anyBusy} onClick={props.onCancel}>Cancel</Button></span>
        </div> : <>
          <p className="local-refs-reason"><IconCloud aria-hidden="true" /><span>Delete only this branch from {details.remote}. Local branches and worktrees are kept.</span></p>
          <Button variant="destructive" size="sm" disabled={anyBusy} onClick={props.onConfirm}><IconTrash />Delete from {details.remote}</Button>
        </>}
    </div>
  </>;
}
