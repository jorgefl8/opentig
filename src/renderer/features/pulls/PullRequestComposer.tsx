import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { IconChevronDown, IconLoader4 } from '@tabler/icons-react';
import { sileo } from 'sileo';
import type { PullRequestLiveState, ReviewPullRequestInput } from '../../../shared/contracts';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { opentig } from '@/lib/opentig-api';
import { ghDetail, ghErrorTitle, isUncertainFailure } from './gh-utils';
import { MarkdownField } from './MarkdownField';
import { useGitHubAccount } from './useGitHubAccount';

type Send = { kind: 'comment' } | { kind: 'review'; verdict: ReviewPullRequestInput['verdict'] };

const SENT: Record<ReviewPullRequestInput['verdict'], string> = { approve: 'Pull request approved', 'request-changes': 'Changes requested', comment: 'Review submitted' };

export function PullRequestComposer({ repositoryId, number, live, draft, onDraftChange, onRefresh }: {
  repositoryId: string;
  number: number;
  live: PullRequestLiveState;
  draft: string;
  onDraftChange(value: string): void;
  onRefresh(): void;
}) {
  const queryClient = useQueryClient();
  const accountQuery = useGitHubAccount(repositoryId);
  const account = accountQuery.data;
  // Sending again after no answer could post the same text twice.
  const [uncertain, setUncertain] = useState(false);
  const send = useMutation({
    mutationFn: (request: Send) => {
      if (account?.state !== 'ready' || !account.login) throw new Error('Check the GitHub account in Settings and try again.');
      const base = { repositoryId, number, body: draft, expectedAccount: { login: account.login, revision: account.revision } };
      return request.kind === 'comment'
        ? opentig.github.commentOnPullRequest(base)
        : opentig.github.reviewPullRequest({ ...base, expectedHeadOid: live.headRefOid, verdict: request.verdict });
    },
    onSuccess: (_result, request) => {
      onDraftChange('');
      sileo.success({ title: request.kind === 'comment' ? 'Comment posted' : SENT[request.verdict], description: `#${number}` });
    },
    onError: (reason) => {
      const detail = ghDetail(reason);
      if (isUncertainFailure(reason)) {
        setUncertain(true);
        sileo.info({ title: 'No answer from GitHub yet', description: 'It may have been posted. Check the conversation before sending it again.', duration: 10_000 });
      } else {
        sileo.error({ title: ghErrorTitle(detail), description: detail?.message ?? (reason instanceof Error ? reason.message : 'An unexpected error occurred.'), duration: 10_000 });
      }
      if (detail?.code === 'GH_ACCOUNT_UNRESOLVED') void accountQuery.refetch();
    },
    onSettled: () => {
      for (const resource of ['pull-request-conversation', 'pull-request-state', 'pull-request', 'pulls']) void queryClient.invalidateQueries({ queryKey: ['repository', repositoryId, resource] });
    },
  });
  const busy = send.isPending;
  const hasText = Boolean(draft.trim());
  const blocked = busy || uncertain || account?.state !== 'ready';
  const canReview = live.state === 'OPEN';
  return (
    <div className="pr-composer">
      <MarkdownField id={`pr-comment-${number}`} label="Add a comment" value={draft} rows={4} placeholder="Write a comment (GitHub Markdown)" emptyPreview="_Nothing to preview._" disabled={busy} onChange={onDraftChange} />
      <div className="pr-composer-actions">
        {uncertain
          ? <span className="pr-composer-account" role="status">It may have been posted. Check the conversation first. <Button variant="ghost" size="xs" onClick={() => { setUncertain(false); onRefresh(); }}>Refresh</Button></span>
          : account?.login && <span className="pr-composer-account">Posting as @{account.login}</span>}
        {canReview && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="xs" disabled={blocked} />}>Review <IconChevronDown /></DropdownMenuTrigger>
            <DropdownMenuContent>
              {!live.viewer.didAuthor && <DropdownMenuItem onClick={() => send.mutate({ kind: 'review', verdict: 'approve' })}>Approve</DropdownMenuItem>}
              {!live.viewer.didAuthor && <DropdownMenuItem disabled={!hasText} onClick={() => send.mutate({ kind: 'review', verdict: 'request-changes' })}>Request changes</DropdownMenuItem>}
              <DropdownMenuItem disabled={!hasText} onClick={() => send.mutate({ kind: 'review', verdict: 'comment' })}>Comment as a review</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button size="xs" disabled={blocked || !hasText} onClick={() => send.mutate({ kind: 'comment' })}>
          {busy ? <><IconLoader4 className="animate-spin" /> <ShimmeringText text="Sending…" /></> : 'Comment'}
        </Button>
      </div>
    </div>
  );
}
