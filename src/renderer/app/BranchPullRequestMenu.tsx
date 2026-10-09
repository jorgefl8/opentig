import { useState } from 'react';
import { IconBrandGithub, IconGitMerge, IconGitPullRequest } from '@tabler/icons-react';
import type { PullRequestSummary } from '../../shared/contracts';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { OpenTigMark } from '@/components/OpenTigMark';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { openOnGitHub, prStateLabel } from '@/features/pulls/gh-utils';

export function BranchPullRequestMenu({ pullRequest, onOpenPullRequest, mobile = false, onNavigate }: {
  pullRequest: PullRequestSummary;
  onOpenPullRequest(number: number): void;
  mobile?: boolean;
  onNavigate?(): void;
}) {
  const [open, setOpen] = useState(false);
  const merged = pullRequest.state === 'MERGED';
  const draft = pullRequest.state === 'OPEN' && pullRequest.isDraft;
  return <DropdownMenu open={open} onOpenChange={setOpen}>
    <Tooltip disabled={open || mobile}>
      <TooltipTrigger render={<DropdownMenuTrigger render={<button type="button"
        className={`${mobile ? 'mobile-sheet-action mobile-branch-pr' : 'toolbar-branch-pr'} ${pullRequest.state.toLowerCase()}${draft ? ' draft' : ''}`}
        aria-label={`View ${prStateLabel(pullRequest).toLowerCase()} pull request #${pullRequest.number}`} />} />}>
        {merged ? <IconGitMerge aria-hidden="true" /> : <IconGitPullRequest aria-hidden="true" />}
        <span className={mobile ? undefined : 'toolbar-pr-label'}>{mobile ? `${merged ? 'View merged' : 'Open'} PR #${pullRequest.number}` : `PR #${pullRequest.number}`}</span>
        {draft && !mobile && <span className="toolbar-pr-draft">Draft</span>}
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" sideOffset={8} className="flex-col items-start gap-1 text-left">
        <span className="toolbar-pr-tooltip-title">{pullRequest.title}</span>
        <span className="toolbar-pr-tooltip-meta">{merged ? `Merged into ${pullRequest.baseRefName}` : prStateLabel(pullRequest)} · Choose where to open</span>
      </TooltipContent>
    </Tooltip>
    <DropdownMenuContent aria-label={`Open pull request #${pullRequest.number}`}>
      <DropdownMenuItem onClick={() => { onNavigate?.(); onOpenPullRequest(pullRequest.number); }}>
        <OpenTigMark /> Open in OpenTig
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => { onNavigate?.(); openOnGitHub(pullRequest.url); }}>
        <IconBrandGithub aria-hidden="true" /> Open in GitHub
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
