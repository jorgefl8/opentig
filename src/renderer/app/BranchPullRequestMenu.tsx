import { IconBrandGithub, IconGitMerge, IconGitPullRequest, IconGitPullRequestClosed, IconGitPullRequestDraft, IconPlus, IconTrash } from '@tabler/icons-react';
import type { PullRequestSummary } from '../../shared/contracts';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { PullRequestStackMenu } from '@/features/pulls/PullRequestStackMenu';
import { OpenTigMark } from '@/components/OpenTigMark';
import { openOnGitHub, prStateLabel, pullRequestStateTone } from '@/features/pulls/gh-utils';
import { commitCountLabel, mergedBranchCleanUpLabel, type MergedBranchCleanUp } from '@/features/pulls/merged-branch';

/**
 * The pull request of the checked-out branch, open or not. A merged one says so, and
 * whether the branch has moved on since: with nothing new it offers to clean the
 * branch up, with new commits it offers the next pull request.
 */
export function BranchPullRequestMenu({ repositoryId, pullRequest, onOpenPullRequest, mobile = false, onNavigate, newCommits = null, cleanUp = null, onCleanUp, onCreatePullRequest }: {
  repositoryId: string;
  pullRequest: PullRequestSummary;
  onOpenPullRequest(number: number): void;
  mobile?: boolean;
  onNavigate?(): void;
  /** Commits the branch gained after its merged pull request; null while that is unknown. */
  newCommits?: number | null | undefined;
  /** Where to go before deleting a merged branch, when there is such a place. */
  cleanUp?: MergedBranchCleanUp | null | undefined;
  onCleanUp?: ((cleanUp: MergedBranchCleanUp) => void) | undefined;
  onCreatePullRequest?: (() => void) | undefined;
}) {
  const merged = pullRequest.state === 'MERGED';
  const tone = pullRequestStateTone(pullRequest);
  const draft = tone === 'draft';
  const ahead = merged ? newCommits : null;
  const movedOn = ahead !== null && ahead > 0;
  const offersCleanUp = ahead === 0 && cleanUp !== null && onCleanUp !== undefined;
  const offersNewPullRequest = movedOn && onCreatePullRequest !== undefined;
  const StateIcon = merged ? IconGitMerge : tone === 'closed' ? IconGitPullRequestClosed : draft ? IconGitPullRequestDraft : IconGitPullRequest;
  return <div className={`toolbar-branch-pr-group${mobile ? ' is-mobile' : ''}`}><DropdownMenu>
    <DropdownMenuTrigger render={<button type="button"
      className={mobile ? `mobile-sheet-action mobile-branch-pr ${pullRequest.state.toLowerCase()}` : `toolbar-branch-pr pr-state-${tone}`}
      aria-label={`View ${prStateLabel(pullRequest).toLowerCase()} pull request #${pullRequest.number}${movedOn ? `, ${commitCountLabel(ahead)} on this branch came after it` : ''}`} />}>
      {mobile && !merged ? <IconGitPullRequest aria-hidden="true" /> : <StateIcon aria-hidden="true" />}
      <span>{mobile ? `${merged ? 'View merged' : tone === 'closed' ? 'View closed' : 'Open'} pull request #${pullRequest.number}` : `#${pullRequest.number}`}</span>
      {draft && !mobile && <span className="toolbar-pr-draft">Draft</span>}
      {!mobile && (merged || tone === 'closed') && <span className="toolbar-pr-tag">{prStateLabel(pullRequest)}</span>}
      {movedOn && (mobile ? <small className="mobile-sheet-value">+{ahead} new</small> : <span className="toolbar-pr-tag neutral">+{ahead} new</span>)}
    </DropdownMenuTrigger>
    <DropdownMenuContent aria-label={`Open pull request #${pullRequest.number}`} className="w-72 max-w-[calc(100vw-2rem)]">
      <div className="mb-1 space-y-1 border-b border-border px-2 pt-1.5 pb-2">
        <p className="text-xs leading-relaxed font-medium wrap-anywhere">{pullRequest.title}</p>
        <p className="text-(length:--text-meta) leading-relaxed text-muted-foreground wrap-anywhere">PR #{pullRequest.number} · {merged ? `Merged into ${pullRequest.baseRefName}` : prStateLabel(pullRequest)}
          {' · '}<span className="tabular-nums"><span className="text-(--diff-added)">+{pullRequest.additions}</span> <span className="text-(--diff-deleted)">−{pullRequest.deletions}</span></span></p>
      </div>
      {merged && <p className="branch-pr-note" data-tone={movedOn ? 'attention' : undefined}>
        {movedOn
          ? <>This branch's pull request is merged, but the branch has <strong>{commitCountLabel(ahead)}</strong> that came after it.</>
          : `This is the pull request of the branch you have checked out. It is already merged${ahead === 0 ? ' and the branch has nothing new' : ''}.`}
      </p>}
      <DropdownMenuItem onClick={() => { onNavigate?.(); onOpenPullRequest(pullRequest.number); }}>
        <OpenTigMark /> Open in OpenTig
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => { onNavigate?.(); openOnGitHub(pullRequest.url); }}>
        <IconBrandGithub aria-hidden="true" /> Open in GitHub
      </DropdownMenuItem>
      {(offersCleanUp || offersNewPullRequest) && <DropdownMenuSeparator />}
      {offersCleanUp && <DropdownMenuItem className="text-destructive data-highlighted:text-destructive" onClick={() => { onNavigate?.(); onCleanUp(cleanUp); }}>
        <IconTrash aria-hidden="true" /> {mergedBranchCleanUpLabel(cleanUp)}
      </DropdownMenuItem>}
      {offersNewPullRequest && <DropdownMenuItem onClick={() => { onNavigate?.(); onCreatePullRequest(); }}>
        <IconPlus aria-hidden="true" /> Create a new pull request
      </DropdownMenuItem>}
    </DropdownMenuContent>
  </DropdownMenu>
    {pullRequest.stack && <PullRequestStackMenu key={`${repositoryId}:${pullRequest.number}`} repositoryId={repositoryId} number={pullRequest.number} membership={pullRequest.stack}
      onSelect={number => { onNavigate?.(); onOpenPullRequest(number); }} />}
    {offersNewPullRequest && !mobile && <button type="button" className="toolbar-branch-pr toolbar-pr-create" onClick={onCreatePullRequest}>
      <IconPlus aria-hidden="true" /><span>Create PR</span>
    </button>}
  </div>;
}
