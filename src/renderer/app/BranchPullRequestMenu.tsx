import { IconBrandGithub, IconGitMerge, IconGitPullRequest } from '@tabler/icons-react';
import type { PullRequestSummary } from '../../shared/contracts';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { PullRequestStackMenu } from '@/features/pulls/PullRequestStackMenu';
import { OpenTigMark } from '@/components/OpenTigMark';
import { openOnGitHub, prStateLabel } from '@/features/pulls/gh-utils';

export function BranchPullRequestMenu({ repositoryId, pullRequest, onOpenPullRequest, mobile = false, onNavigate }: {
  repositoryId: string;
  pullRequest: PullRequestSummary;
  onOpenPullRequest(number: number): void;
  mobile?: boolean;
  onNavigate?(): void;
}) {
  const merged = pullRequest.state === 'MERGED';
  const draft = pullRequest.state === 'OPEN' && pullRequest.isDraft;
  return <div className={`toolbar-branch-pr-group${mobile ? ' is-mobile' : ''}`}><DropdownMenu>
    <DropdownMenuTrigger render={<button type="button"
      className={`${mobile ? 'mobile-sheet-action mobile-branch-pr' : 'toolbar-branch-pr'} ${pullRequest.state.toLowerCase()}${draft ? ' draft' : ''}`}
      aria-label={`View ${prStateLabel(pullRequest).toLowerCase()} pull request #${pullRequest.number}`} />}>
      {merged ? <IconGitMerge aria-hidden="true" /> : <IconGitPullRequest aria-hidden="true" />}
      <span className={mobile ? undefined : 'toolbar-pr-label'}>{mobile ? `${merged ? 'View merged' : 'Open'} PR #${pullRequest.number}` : `PR #${pullRequest.number}`}</span>
      {draft && !mobile && <span className="toolbar-pr-draft">Draft</span>}
    </DropdownMenuTrigger>
    <DropdownMenuContent aria-label={`Open pull request #${pullRequest.number}`} className="w-72 max-w-[calc(100vw-2rem)]">
      <div className="mb-1 space-y-1 border-b border-border px-2 pt-1.5 pb-2">
        <p className="text-xs leading-relaxed font-medium wrap-anywhere">{pullRequest.title}</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground wrap-anywhere">PR #{pullRequest.number} · {merged ? `Merged into ${pullRequest.baseRefName}` : prStateLabel(pullRequest)}</p>
      </div>
      <DropdownMenuItem onClick={() => { onNavigate?.(); onOpenPullRequest(pullRequest.number); }}>
        <OpenTigMark /> Open in OpenTig
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => { onNavigate?.(); openOnGitHub(pullRequest.url); }}>
        <IconBrandGithub aria-hidden="true" /> Open in GitHub
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
    {pullRequest.stack && <PullRequestStackMenu key={`${repositoryId}:${pullRequest.number}`} repositoryId={repositoryId} number={pullRequest.number} membership={pullRequest.stack}
      onSelect={number => { onNavigate?.(); onOpenPullRequest(number); }} />}
  </div>;
}
